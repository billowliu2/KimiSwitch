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
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::{Agent, Config, Model, Provider, ProviderType};

pub type DbResult<T> = anyhow::Result<T>;

pub fn kimi_switch_data_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".kimi-switch"))
        .expect("failed to resolve home directory")
}

pub fn db_path() -> PathBuf {
    // Tests (and power users) can point the store elsewhere; production always
    // resolves to the default location under the home directory.
    if let Some(p) = std::env::var_os("KIMI_SWITCH_DB_PATH") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    kimi_switch_data_dir().join("kimi-switch.db")
}

/// One-time migration: if the legacy `~/.pi-switch/` data directory exists and
/// `~/.kimi-switch/` does not, move it so existing users keep their saved
/// configuration. Safe to call on every startup — it is a no-op once the new
/// directory exists.
fn migrate_legacy_data_dir() {
    // A redirected store (tests) must never touch the real home directory.
    if std::env::var_os("KIMI_SWITCH_DB_PATH").is_some() {
        return;
    }
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

    // Usage snapshots taken when sessions are bulk-archived: keep the session's
    // token/cost history queryable after its directory (and wire.jsonl) is
    // deleted from disk.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS archived_sessions (
            session_id     TEXT PRIMARY KEY,
            workspace_id   TEXT NOT NULL,
            title          TEXT,
            archived_at_ms INTEGER NOT NULL,
            updated_at_ms  INTEGER,
            created_at_ms  INTEGER,
            total_tokens   INTEGER NOT NULL DEFAULT 0,
            total_cost_usd REAL NOT NULL DEFAULT 0,
            day_stats      TEXT NOT NULL DEFAULT '[]'
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
                // Merged from the settings table by load_agent_config_command.
                usage_kinds: None,
                usage_config: None,
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
        // The SQLite snapshot stores no import baseline; an empty baseline
        // makes export's stale-key cleanup a no-op (safe degradation).
        imported_section_keys: Vec::new(),
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

/// Public helper: delete a single setting (no-op if the key does not exist).
pub fn delete_setting_pub(key: &str) -> DbResult<()> {
    let conn = init_db()?;
    conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Archived-session usage snapshots
// ---------------------------------------------------------------------------

/// Per-model usage totals for one calendar day of an archived session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayModelStat {
    /// Raw model key as written to wire.jsonl (`__secondary__` kept verbatim).
    pub model: String,
    pub requests: u64,
    pub input_other: u64,
    pub output: u64,
    pub input_cache_read: u64,
    pub input_cache_creation: u64,
    pub cost_usd: f64,
}

/// One day's per-model usage, stored as JSON in `archived_sessions.day_stats`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStat {
    /// Local calendar day, `YYYY-MM-DD`.
    pub day: String,
    /// Local midnight of `day`, epoch ms — used as the synthesized record time.
    pub day_start_ms: u64,
    pub models: Vec<DayModelStat>,
}

/// Usage snapshot of one session, taken at the moment it is archived.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedSessionSnapshot {
    pub session_id: String,
    pub workspace_id: String,
    pub title: Option<String>,
    pub archived_at_ms: u64,
    pub updated_at_ms: Option<u64>,
    pub created_at_ms: Option<u64>,
    pub total_tokens: u64,
    pub total_cost_usd: f64,
    pub day_stats: Vec<DayStat>,
}

/// Insert or replace one archived-session snapshot (keyed by session id, which
/// is a UUID and never reused).
pub fn upsert_archived_session(row: &ArchivedSessionSnapshot) -> DbResult<()> {
    let conn = init_db()?;
    let day_stats = serde_json::to_string(&row.day_stats)?;
    conn.execute(
        "INSERT OR REPLACE INTO archived_sessions
         (session_id, workspace_id, title, archived_at_ms, updated_at_ms, created_at_ms, total_tokens, total_cost_usd, day_stats)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            row.session_id,
            row.workspace_id,
            row.title,
            row.archived_at_ms as i64,
            row.updated_at_ms.map(|v| v as i64),
            row.created_at_ms.map(|v| v as i64),
            row.total_tokens as i64,
            row.total_cost_usd,
            day_stats,
        ],
    )?;
    Ok(())
}

/// Every stored archived-session snapshot. Unreadable `day_stats` JSON degrades
/// to an empty breakdown instead of failing the whole list.
pub fn list_archived_sessions() -> DbResult<Vec<ArchivedSessionSnapshot>> {
    let conn = init_db()?;
    let mut stmt = conn.prepare(
        "SELECT session_id, workspace_id, title, archived_at_ms, updated_at_ms, created_at_ms,
                total_tokens, total_cost_usd, day_stats
         FROM archived_sessions",
    )?;
    let rows = stmt.query_map([], |row| {
        let day_stats_json: String = row.get(8)?;
        Ok(ArchivedSessionSnapshot {
            session_id: row.get(0)?,
            workspace_id: row.get(1)?,
            title: row.get(2)?,
            archived_at_ms: row.get::<_, i64>(3)? as u64,
            updated_at_ms: row.get::<_, Option<i64>>(4)?.map(|v| v as u64),
            created_at_ms: row.get::<_, Option<i64>>(5)?.map(|v| v as u64),
            total_tokens: row.get::<_, i64>(6)? as u64,
            total_cost_usd: row.get(7)?,
            day_stats: serde_json::from_str(&day_stats_json).unwrap_or_default(),
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn provider_type_for_str(s: &str) -> ProviderType {
    ProviderType::from_kimi_type(s)
}
