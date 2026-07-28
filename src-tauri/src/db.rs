//! Kimi Switch local SQLite storage.
//!
//! This module stores the full Kimi Switch configuration (all providers and models
//! for both Kimi Code and Pi agents) in a local SQLite database. It is separate
//! from the agent-specific config files that are written when the user activates
//! a provider.

use std::path::PathBuf;

use anyhow::Context;
use indexmap::IndexMap;
use rusqlite::{params, Connection};
use serde_json::Value;

use crate::models::{Agent, Config, Model, Provider, ProviderType};

pub type DbResult<T> = anyhow::Result<T>;

pub fn kimi_switch_data_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".kimi-switch"))
        .expect("failed to resolve home directory")
}

pub fn db_path() -> PathBuf {
    kimi_switch_data_dir().join("kimi-switch.db")
}

/// One-time migration: if the legacy `~/.pi-switch/` data directory exists and
/// `~/.kimi-switch/` does not, move it so existing users keep their saved
/// configuration. Safe to call on every startup — it is a no-op once the new
/// directory exists.
fn migrate_legacy_data_dir() {
    let new_dir = kimi_switch_data_dir();
    if new_dir.exists() {
        return;
    }
    let old_dir = match dirs::home_dir() {
        Some(h) => h.join(".pi-switch"),
        None => return,
    };
    if !old_dir.exists() {
        return;
    }
    // Best-effort move; failures are silently ignored so the app can still start.
    if let Some(new_parent) = new_dir.parent() {
        if let Err(_) = std::fs::create_dir_all(new_parent) {
            return;
        }
    }
    let _ = std::fs::rename(&old_dir, &new_dir);
}

pub fn init_db() -> DbResult<Connection> {
    migrate_legacy_data_dir();
    let path = db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }
    let conn = Connection::open(&path)
        .with_context(|| format!("failed to open database {}", path.display()))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent TEXT NOT NULL,
            name TEXT NOT NULL,
            provider_type TEXT NOT NULL,
            base_url TEXT,
            api_key TEXT,
            env TEXT,
            note TEXT,
            official_url TEXT,
            managed INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            active INTEGER NOT NULL DEFAULT 0,
            raw_other TEXT,
            UNIQUE(agent, name)
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent TEXT NOT NULL,
            alias TEXT NOT NULL,
            provider_name TEXT NOT NULL,
            model TEXT NOT NULL,
            max_context_size INTEGER NOT NULL,
            display_name TEXT,
            supports_1m INTEGER NOT NULL DEFAULT 0,
            capabilities TEXT,
            raw_other TEXT,
            UNIQUE(agent, alias)
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    // Add icon columns for provider icon picker (introduced in v0.3.1).
    // SQLite has no ADD COLUMN IF NOT EXISTS, so ignore duplicate-column errors.
    for stmt in [
        "ALTER TABLE providers ADD COLUMN icon TEXT",
        "ALTER TABLE providers ADD COLUMN icon_color TEXT",
    ] {
        if let Err(e) = conn.execute(stmt, []) {
            let msg = e.to_string();
            if !msg.contains("duplicate column name") {
                return Err(e).with_context(|| format!("failed to run migration: {}", stmt));
            }
        }
    }

    Ok(conn)
}

pub fn load_config(agent: &Agent) -> DbResult<Config> {
    let mut conn = init_db()?;
    let tx = conn.transaction()?;

    let default_model = get_setting_tx(&tx, &default_model_key(agent))?;

    let mut providers = IndexMap::new();
    {
        let mut stmt = tx.prepare(
            "SELECT name, provider_type, base_url, api_key, env, note, official_url, managed, enabled, active, icon, icon_color, raw_other
             FROM providers WHERE agent = ?1 ORDER BY id",
        )?;
        let provider_rows = stmt.query_map(params![agent.as_str()], |row| {
            let provider_type: String = row.get(1)?;
            let env_json: Option<String> = row.get(4)?;
            let raw_json: Option<String> = row.get(12)?;
            Ok(Provider {
                name: row.get(0)?,
                provider_type: provider_type_for_str(&provider_type),
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                env: env_json
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_default(),
                note: row.get(5)?,
                official_url: row.get(6)?,
                managed: row.get::<_, i32>(7)? != 0,
                enabled: row.get::<_, i32>(8)? != 0,
                active: row.get::<_, i32>(9)? != 0,
                icon: row.get(10)?,
                icon_color: row.get(11)?,
                raw_other: raw_json
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or(Value::Null),
            })
        })?;

        for provider in provider_rows {
            let p = provider?;
            providers.insert(p.name.clone(), p);
        }
    }

    let mut models = IndexMap::new();
    {
        let mut stmt = tx.prepare(
            "SELECT alias, provider_name, model, max_context_size, display_name, supports_1m, capabilities, raw_other
             FROM models WHERE agent = ?1 ORDER BY id",
        )?;
        let model_rows = stmt.query_map(params![agent.as_str()], |row| {
            let caps_json: Option<String> = row.get(6)?;
            let raw_json: Option<String> = row.get(7)?;
            Ok(Model {
                alias: row.get(0)?,
                provider: row.get(1)?,
                model: row.get(2)?,
                max_context_size: row.get::<_, i64>(3)? as u64,
                display_name: row.get(4)?,
                supports_1m: row.get::<_, i32>(5)? != 0,
                capabilities: caps_json
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_default(),
                raw_other: raw_json
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or(Value::Null),
            })
        })?;

        for model in model_rows {
            let m = model?;
            models.insert(m.alias.clone(), m);
        }
    }

    tx.commit()?;

    Ok(Config {
        default_model,
        providers,
        models,
        raw_other: Value::Null,
    })
}

pub fn save_config(agent: &Agent, config: &Config) -> DbResult<()> {
    let mut conn = init_db()?;
    let tx = conn.transaction()?;

    tx.execute("DELETE FROM providers WHERE agent = ?1", params![agent.as_str()])?;
    tx.execute("DELETE FROM models WHERE agent = ?1", params![agent.as_str()])?;

    {
        let mut insert_provider = tx.prepare(
            "INSERT INTO providers
             (agent, name, provider_type, base_url, api_key, env, note, official_url, managed, enabled, active, icon, icon_color, raw_other)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        )?;

        for provider in config.providers.values() {
            insert_provider.execute(params![
                agent.as_str(),
                provider.name,
                provider.provider_type.as_str(),
                provider.base_url,
                provider.api_key,
                serde_json::to_string(&provider.env).ok(),
                provider.note,
                provider.official_url,
                provider.managed as i32,
                provider.enabled as i32,
                provider.active as i32,
                provider.icon,
                provider.icon_color,
                serde_json::to_string(&provider.raw_other).ok(),
            ])?;
        }
    }

    {
        let mut insert_model = tx.prepare(
            "INSERT INTO models
             (agent, alias, provider_name, model, max_context_size, display_name, supports_1m, capabilities, raw_other)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;

        for model in config.models.values() {
            insert_model.execute(params![
                agent.as_str(),
                model.alias,
                model.provider,
                model.model,
                model.max_context_size as i64,
                model.display_name,
                model.supports_1m as i32,
                serde_json::to_string(&model.capabilities).ok(),
                serde_json::to_string(&model.raw_other).ok(),
            ])?;
        }
    }

    if let Some(default_model) = &config.default_model {
        set_setting_tx(&tx, &default_model_key(agent), default_model)?;
    } else {
        tx.execute("DELETE FROM settings WHERE key = ?1", params![default_model_key(agent)])?;
    }

    tx.commit()?;
    Ok(())
}

fn default_model_key(agent: &Agent) -> String {
    format!("default_model:{}", agent.as_str())
}

fn get_setting_tx(tx: &rusqlite::Transaction, key: &str) -> DbResult<Option<String>> {
    let mut stmt = tx.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

fn set_setting_tx(tx: &rusqlite::Transaction, key: &str, value: &str) -> DbResult<()> {
    tx.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Public helper: read a single setting without an explicit transaction.
pub fn get_setting_pub(key: &str) -> DbResult<Option<String>> {
    let conn = init_db()?;
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

/// Public helper: write a single setting in its own transaction.
pub fn set_setting_pub(key: &str, value: &str) -> DbResult<()> {
    let mut conn = init_db()?;
    let tx = conn.transaction()?;
    set_setting_tx(&tx, key, value)?;
    tx.commit()?;
    Ok(())
}

fn provider_type_for_str(s: &str) -> ProviderType {
    match s {
        "anthropic" => ProviderType::Anthropic,
        "openai" => ProviderType::Openai,
        "openai_responses" => ProviderType::OpenaiResponses,
        "google-genai" => ProviderType::GoogleGenai,
        "vertexai" => ProviderType::Vertexai,
        _ => ProviderType::Kimi,
    }
}
