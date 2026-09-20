use crate::db;
use crate::models::{Agent, Config, DiscoveredModel, Model, Provider, ProviderType, UsageConfig};
use crate::pi_io;
use crate::services::{self, UsageKind, UsageResult};
use indexmap::IndexMap;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

fn fmt_anyhow(err: anyhow::Error) -> String {
    err.chain()
        .map(|e| e.to_string())
        .collect::<Vec<_>>()
        .join(": ")
}

#[tauri::command]
pub fn debug_log(message: String) {
    eprintln!("[frontend] {}", message);
}

/// SQLite settings key for a provider's billing/usage query kinds
/// (JSON array of kind strings, e.g. `["balance:deepseek"]`).
fn usage_kinds_key(provider_name: &str) -> String {
    format!("usage_kinds:{provider_name}")
}

fn usage_config_key(provider_name: &str) -> String {
    format!("usage_config:{provider_name}")
}

/// Merge per-provider `usage_kinds` into a loaded config: explicit SQLite
/// settings first, host-based detection as fallback so existing installs get
/// billing support automatically. The field never enters config.toml.
fn merge_usage_kinds(config: &mut Config) {
    for p in config.providers.values_mut() {
        let from_settings = db::get_setting_pub(&usage_kinds_key(&p.name))
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
            .filter(|v| !v.is_empty());
        p.usage_kinds = from_settings.or_else(|| {
            let kinds = services::detect_provider(&resolve_base_url(p));
            if kinds.is_empty() {
                None
            } else {
                Some(kinds.iter().map(|k| k.as_str().to_string()).collect())
            }
        });
        // Same pattern for the panel-edited usage config.
        p.usage_config = db::get_setting_pub(&usage_config_key(&p.name))
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str::<UsageConfig>(&s).ok());
    }
}

fn load_pi_native_config() -> Result<Config, String> {
    let file = pi_io::load_pi_models().map_err(fmt_anyhow)?;
    let mut config = pi_io::pi_file_to_config(&file);
    if config.default_model.is_none() {
        if let Ok(settings) = pi_io::load_pi_settings() {
            if let (Some(provider), Some(model_id)) =
                (settings.default_provider, settings.default_model)
            {
                if let Some(alias) = config
                    .models
                    .values()
                    .find(|m| m.provider == provider && m.model == model_id)
                {
                    config.default_model = Some(alias.alias.clone());
                }
            }
        }
    }
    Ok(config)
}

#[tauri::command]
pub fn load_agent_config_command(agent: Agent) -> Result<Config, String> {
    // Load Kimi Switch's own SQLite database (metadata + migration fallback).
    let db_config = db::load_config(&agent).ok();

    let mut config = match agent {
        Agent::KimiCode => {
            // config.toml is the authoritative source for provider/model data
            // because the user can add or edit providers at any time via the
            // CLI's /provider command. SQLite only enriches with Kimi
            // Switch-private metadata (note, official_url, remembered default
            // model) and fills gaps when config.toml is incomplete.
            let mut config = crate::kimi_code_io::load_kimi_code_config_as_config()
                .map_err(fmt_anyhow)?;

            if let Some(db) = &db_config {
                // Enrich config.toml providers with SQLite metadata.
                for (name, p) in config.providers.iter_mut() {
                    if let Some(db_p) = db.providers.get(name) {
                        p.note = db_p.note.clone();
                        p.official_url = db_p.official_url.clone();
                        // Restore Kimi Switch metadata that does not live in
                        // the agent's config.toml.
                        p.icon = db_p.icon.clone();
                        p.icon_color = db_p.icon_color.clone();
                        // Restore the remembered per-provider default model
                        // (Kimi-Switch-private, stored in raw_other).
                        if let Some(dm) = db_p.raw_other.get("default_model") {
                            match &mut p.raw_other {
                                serde_json::Value::Object(obj) => {
                                    obj.insert("default_model".to_string(), dm.clone());
                                }
                                _ => {
                                    let mut obj = serde_json::Map::new();
                                    obj.insert("default_model".to_string(), dm.clone());
                                    p.raw_other = serde_json::Value::Object(obj);
                                }
                            }
                        }
                    }
                }
                // Migration safety: include providers/models that exist in
                // SQLite but not in config.toml (e.g. after upgrading from the
                // old single-provider-write behaviour).
                for (name, p) in &db.providers {
                    config.providers.entry(name.clone()).or_insert_with(|| p.clone());
                }
                for (alias, m) in &db.models {
                    config.models.entry(alias.clone()).or_insert_with(|| m.clone());
                }
            }

            config
        }
        Agent::Pi => {
            // Pi: SQLite first, fall back to native config on first use.
            match db_config {
                Some(config) if !config.providers.is_empty() => config,
                _ => load_pi_native_config()?,
            }
        }
    };

    merge_usage_kinds(&mut config);
    Ok(config)
}

#[tauri::command]
pub fn save_agent_config_command(agent: Agent, config: Config) -> Result<(), String> {
    // Save the full Kimi Switch configuration to local SQLite.
    db::save_config(&agent, &config).map_err(fmt_anyhow)?;
    // For Kimi Code, config.toml is the authoritative provider store, so
    // persist changes there immediately — not only on activation. This
    // ensures edits (Ctrl+S) survive a restart even without switching.
    if matches!(agent, Agent::KimiCode) {
        crate::kimi_code_io::save_config_as_kimi_code(&config).map_err(fmt_anyhow)?;
    }
    // Persist usage_kinds to the SQLite settings table (never config.toml;
    // the field is skip_serializing and the TOML export is hand-built).
    // None / empty array → delete the key.
    for provider in config.providers.values() {
        let key = usage_kinds_key(&provider.name);
        match &provider.usage_kinds {
            Some(kinds) if !kinds.is_empty() => {
                let json = serde_json::to_string(kinds).map_err(|e| e.to_string())?;
                db::set_setting_pub(&key, &json).map_err(fmt_anyhow)?;
            }
            _ => db::delete_setting_pub(&key).map_err(fmt_anyhow)?,
        }
        let cfg_key = usage_config_key(&provider.name);
        match &provider.usage_config {
            Some(cfg) => {
                let json = serde_json::to_string(cfg).map_err(|e| e.to_string())?;
                db::set_setting_pub(&cfg_key, &json).map_err(fmt_anyhow)?;
            }
            None => db::delete_setting_pub(&cfg_key).map_err(fmt_anyhow)?,
        }
    }
    Ok(())
}

#[tauri::command]
pub fn activate_agent_config_command(agent: Agent) -> Result<(), String> {
    match agent {
        Agent::KimiCode => {
            // No-op: save_agent_config_command already writes config.toml for
            // Kimi Code. Avoiding a second write here prevents a redundant disk
            // write + backup on every switch.
            Ok(())
        }
        Agent::Pi => {
            // Load the full config from SQLite and write only the active
            // provider to Pi's native config files.
            let config = db::load_config(&agent).map_err(fmt_anyhow)?;
            let active_config = build_active_config(&config);
            let file = pi_io::config_to_pi_file(&active_config);
            pi_io::save_pi_models(&file).map_err(fmt_anyhow)?;

            // Keep Pi's own default provider / model in sync so the switch is
            // actually picked up on the next `pi` run.
            let mut settings = pi_io::load_pi_settings().map_err(fmt_anyhow)?;
            if let Some((provider_name, model_id)) = active_provider_and_model(&active_config) {
                settings.default_provider = Some(provider_name);
                settings.default_model = Some(model_id);
            }
            pi_io::save_pi_settings(&settings).map_err(fmt_anyhow)
        }
    }
}

fn active_provider_and_model(config: &Config) -> Option<(String, String)> {
    let alias = config.default_model.as_ref()?;
    let model = config.models.get(alias)?;
    Some((model.provider.clone(), model.model.clone()))
}

fn build_active_config(config: &Config) -> Config {
    // Used only by Pi: writes only the provider explicitly marked as active
    // to Pi's native config so Pi follows Kimi Switch's selection instead of
    // falling back to another provider. Kimi Code does not use this — it
    // writes all providers and selects via default_model.
    let providers: IndexMap<String, Provider> = config
        .providers
        .iter()
        .filter(|(_, p)| p.active)
        .map(|(k, p)| (k.clone(), p.clone()))
        .collect();

    let active_provider_names: std::collections::HashSet<&str> = providers
        .values()
        .map(|p| p.name.as_str())
        .collect();

    let models: IndexMap<String, Model> = config
        .models
        .iter()
        .filter(|(_, m)| active_provider_names.contains(m.provider.as_str()))
        .map(|(k, m)| (k.clone(), m.clone()))
        .collect();

    Config {
        default_model: config.default_model.clone(),
        providers,
        models,
        raw_other: config.raw_other.clone(),
        imported_section_keys: config.imported_section_keys.clone(),
    }
}

#[tauri::command]
pub fn open_agent_config_dir(app: tauri::AppHandle, agent: Agent) -> Result<(), String> {
    let path = agent.config_dir();
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let path_str = path.to_string_lossy().to_string();
    app.opener()
        .open_path(&path_str, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Fetch available models from a provider's API.
#[tauri::command]
pub async fn list_provider_models(provider: Provider) -> Result<Vec<DiscoveredModel>, String> {
    let api_key = resolve_api_key(&provider)?
        .ok_or_else(|| format!("Provider '{}' has no API key configured", provider.name))?;

    let base = resolve_base_url(&provider);

    match provider.provider_type {
        ProviderType::Kimi | ProviderType::Openai | ProviderType::OpenaiResponses => {
            fetch_openai_models(&base, &api_key).await
        }
        ProviderType::Anthropic => fetch_anthropic_models(&base, &api_key).await,
        ProviderType::GoogleGenai => fetch_google_genai_models(&base, &api_key).await,
        ProviderType::Vertexai => Err("Vertex AI model discovery requires GCP project/location configuration and is not yet supported".to_string()),
        ProviderType::Unknown(s) => Err(format!(
            "unsupported provider type for model discovery: {s}"
        )),
    }
}

/// Test reachability of a provider's base URL (cc-switch semantics):
/// any HTTP response counts as reachable; only network-layer errors fail.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub status_code: Option<u16>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn test_connectivity(provider: Provider) -> Result<ConnectivityResult, String> {
    let base = resolve_base_url(&provider);
    if base.trim().is_empty() {
        return Ok(ConnectivityResult {
            ok: false,
            latency_ms: 0,
            status_code: None,
            error: Some("no base URL configured".to_string()),
        });
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;
    let start = std::time::Instant::now();
    match client.get(base.as_str()).send().await {
        Ok(resp) => Ok(ConnectivityResult {
            ok: true,
            latency_ms: start.elapsed().as_millis() as u64,
            status_code: Some(resp.status().as_u16()),
            error: None,
        }),
        Err(e) => Ok(ConnectivityResult {
            ok: false,
            latency_ms: start.elapsed().as_millis() as u64,
            status_code: None,
            error: Some(if e.is_connect() {
                "connection refused / DNS failed".to_string()
            } else if e.is_timeout() {
                "request timed out".to_string()
            } else {
                e.to_string()
            }),
        }),
    }
}

/// `api_key_env` (kimi-code 2.0.0+): resolve the referenced environment
/// variable into the key itself. `Ok(None)` = the provider has no env-var
/// reference configured; `Err` = a reference that this process cannot satisfy.
///
/// The error is deterministic (re-exporting the variable is the only fix) and
/// names the provider plus the variable name — never a key value — so it is
/// safe to surface in the UI as-is.
fn resolve_api_key_env(provider: &Provider) -> Result<Option<String>, String> {
    let Some(env_name) = provider
        .api_key_env
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return Ok(None);
    };
    match std::env::var(env_name) {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        _ => Err(format!(
            "provider '{}' reads its API key from the environment variable \
             {env_name}, which is not set in this process",
            provider.name
        )),
    }
}

/// Static credential for a request: an `api_key_env` reference (resolved from
/// this process's environment) outranks a stored `api_key`, which outranks the
/// provider's `[providers.<name>.env]` entry for its type.
fn resolve_api_key(provider: &Provider) -> Result<Option<String>, String> {
    if provider.managed {
        return Ok(Some("managed".to_string()));
    }
    if let Some(key) = resolve_api_key_env(provider)? {
        return Ok(Some(key));
    }
    if let Some(key) = &provider.api_key {
        if !key.is_empty() {
            return Ok(Some(key.clone()));
        }
    }
    if let Some(env_key) = expected_api_key_key(&provider.provider_type) {
        if let Some(key) = provider.env.get(env_key).filter(|s| !s.is_empty()) {
            return Ok(Some(key.clone()));
        }
    }
    Ok(None)
}

fn resolve_base_url(provider: &Provider) -> String {
    provider
        .base_url
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            provider
                .provider_type
                .default_base_url()
                .unwrap_or("")
                .to_string()
        })
}

/// Well-known env var fallback for the API key per provider type; `None`
/// for unknown types (no well-known variable name to look up).
fn expected_api_key_key(provider_type: &ProviderType) -> Option<&'static str> {
    match provider_type {
        ProviderType::Kimi => Some("KIMI_API_KEY"),
        ProviderType::Anthropic => Some("ANTHROPIC_API_KEY"),
        ProviderType::Openai | ProviderType::OpenaiResponses => Some("OPENAI_API_KEY"),
        ProviderType::GoogleGenai => Some("GOOGLE_API_KEY"),
        ProviderType::Vertexai => Some("VERTEXAI_API_KEY"),
        ProviderType::Unknown(_) => None,
    }
}

// ── OpenAI-compatible /models endpoint (with pagination) ─────────────

async fn fetch_openai_models(base: &str, api_key: &str) -> Result<Vec<DiscoveredModel>, String> {
    #[derive(serde::Deserialize)]
    struct OaiModel {
        id: String,
    }
    #[derive(serde::Deserialize)]
    struct OaiList {
        data: Vec<OaiModel>,
        #[serde(default)]
        has_more: Option<bool>,
        #[serde(default)]
        last_id: Option<String>,
        #[serde(default)]
        next_page_token: Option<String>,
    }

    let client = reqwest::Client::new();
    let root = base.trim_end_matches('/').to_string();
    let mut url = format!("{}/models", root);
    let mut all: Vec<OaiModel> = Vec::new();
    const MAX_PAGES: usize = 50;

    for _ in 0..MAX_PAGES {
        let resp = client
            .get(&url)
            .bearer_auth(api_key)
            .send()
            .await
            .map_err(|e| format!("HTTP request to {} failed: {e}", url))?;
        if !resp.status().is_success() {
            return Err(format!("{} returned HTTP {}", url, resp.status()));
        }
        let body: OaiList = resp
            .json()
            .await
            .map_err(|e| format!("failed to parse response from {}: {e}", url))?;
        all.extend(body.data);

        // OpenAI cursor pagination: has_more + last_id → ?after=<last_id>
        if body.has_more.unwrap_or(false) {
            if let Some(last_id) = body.last_id.clone() {
                url = format!("{}/models?after={}", root, last_id);
                continue;
            }
        }
        // Token-based pagination: next_page_token → ?page_token=<token>
        if let Some(token) = body.next_page_token.clone() {
            if !token.is_empty() {
                url = format!("{}/models?page_token={}", root, token);
                continue;
            }
        }
        break;
    }

    let mut seen = std::collections::HashSet::new();
    Ok(all
        .into_iter()
        .filter(|m| seen.insert(m.id.clone()))
        .map(|m| DiscoveredModel {
            id: m.id,
            display_name: None,
            max_context_size: None,
        })
        .collect())
}

// ── Anthropic /v1/models endpoint (with pagination) ──────────────────

async fn fetch_anthropic_models(base: &str, api_key: &str) -> Result<Vec<DiscoveredModel>, String> {
    #[derive(serde::Deserialize)]
    struct AntModel {
        id: String,
        display_name: Option<String>,
    }
    #[derive(serde::Deserialize)]
    struct AntList {
        data: Vec<AntModel>,
        #[serde(default)]
        has_more: Option<bool>,
        #[serde(default)]
        last_id: Option<String>,
    }

    let client = reqwest::Client::new();
    let root = base.trim_end_matches('/').to_string();
    let mut url = format!("{}/v1/models?limit=1000", root);
    let mut all: Vec<AntModel> = Vec::new();
    const MAX_PAGES: usize = 20;

    for _ in 0..MAX_PAGES {
        let resp = client
            .get(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .map_err(|e| format!("HTTP request to {} failed: {e}", url))?;
        if !resp.status().is_success() {
            return Err(format!("{} returned HTTP {}", url, resp.status()));
        }
        let body: AntList = resp
            .json()
            .await
            .map_err(|e| format!("failed to parse response from {}: {e}", url))?;
        let more = body.has_more.unwrap_or(false);
        let cursor = body.last_id.clone();
        all.extend(body.data);
        if !(more && cursor.is_some()) {
            break;
        }
        url = format!("{}/v1/models?limit=1000&after_id={}", root, cursor.unwrap());
    }

    let mut seen = std::collections::HashSet::new();
    Ok(all
        .into_iter()
        .filter(|m| seen.insert(m.id.clone()))
        .map(|m| DiscoveredModel {
            id: m.id,
            display_name: m.display_name,
            max_context_size: None,
        })
        .collect())
}

// ── Google GenAI /v1beta/models endpoint (with pagination) ───────────

async fn fetch_google_genai_models(
    base: &str,
    api_key: &str,
) -> Result<Vec<DiscoveredModel>, String> {
    #[derive(serde::Deserialize)]
    struct GglModel {
        name: String,
        #[serde(rename = "displayName")]
        display_name: Option<String>,
        #[serde(rename = "outputTokenLimit")]
        output_token_limit: Option<u64>,
    }
    #[derive(serde::Deserialize)]
    struct GglList {
        models: Vec<GglModel>,
        #[serde(rename = "nextPageToken", default)]
        next_page_token: Option<String>,
    }

    let client = reqwest::Client::new();
    let root = base.trim_end_matches('/').to_string();
    let mut url = format!("{}/v1beta/models?key={}&pageSize=1000", root, api_key);
    let mut all: Vec<GglModel> = Vec::new();
    const MAX_PAGES: usize = 50;

    for _ in 0..MAX_PAGES {
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("HTTP request to {} failed: {e}", url))?;
        if !resp.status().is_success() {
            return Err(format!("{} returned HTTP {}", url, resp.status()));
        }
        let body: GglList = resp
            .json()
            .await
            .map_err(|e| format!("failed to parse response from {}: {e}", url))?;
        let cursor = body.next_page_token.clone();
        all.extend(body.models);
        match cursor {
            Some(t) if !t.is_empty() => {
                url = format!(
                    "{}/v1beta/models?key={}&pageSize=1000&pageToken={}",
                    root, api_key, t
                );
            }
            _ => break,
        }
    }

    let mut seen = std::collections::HashSet::new();
    Ok(all
        .into_iter()
        .filter(|m| seen.insert(m.name.clone()))
        .map(|m| {
            let id = m
                .name
                .strip_prefix("models/")
                .unwrap_or(&m.name)
                .to_string();
            DiscoveredModel {
                id,
                display_name: m.display_name,
                max_context_size: m.output_token_limit,
            }
        })
        .collect())
}

// ---------------------------------------------------------------------------
// App settings (generic key/value via SQLite)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_app_setting(key: String) -> Option<String> {
    db::get_setting_pub(&key).ok().flatten()
}

#[tauri::command]
pub fn set_app_setting(key: String, value: String) -> Result<(), String> {
    db::set_setting_pub(&key, &value).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Provider billing / usage query (cc-switch semantics)
// ---------------------------------------------------------------------------

/// 5-minute in-memory cache keyed by (agent, provider_name).
/// Only successful results are cached; failures are always re-queryable.
const USAGE_CACHE_TTL: Duration = Duration::from_secs(300);

type UsageCache = Mutex<HashMap<(String, String), (Instant, UsageResult)>>;

fn usage_cache() -> &'static UsageCache {
    static CACHE: OnceLock<UsageCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Resolve the credential a usage query sends: an `api_key_env` reference
/// (kimi-code 2.0.0+, resolved from this process's environment) > a stored
/// `api_key` > the provider's `[providers.<name>.env]` entry for its type.
///
/// Unlike `resolve_api_key` this does NOT special-case managed (OAuth)
/// providers — the caller falls back to the OAuth session token itself, so a
/// missing static key must stay `None` here rather than become a placeholder.
///
/// `Err(msg)` is a deterministic failure: the provider is configured to read
/// its key from an environment variable this process does not have.
fn resolve_usage_api_key(provider: &Provider) -> Result<Option<String>, String> {
    if let Some(key) = resolve_api_key_env(provider)? {
        return Ok(Some(key));
    }
    Ok(provider
        .api_key
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            expected_api_key_key(&provider.provider_type)
                .and_then(|env_key| provider.env.get(env_key))
                .cloned()
                .filter(|s| !s.is_empty())
        }))
}

/// Query a provider's balance / plan quota. The frontend passes only the
/// provider name — base_url, api_key and usage kinds are all resolved here,
/// so the API key never crosses IPC and the host routing cannot be spoofed.
/// A provider configured with `api_key_env` resolves its key from this
/// process's environment (see `resolve_usage_api_key`).
///
/// Error channel semantics (cc-switch):
/// - `Err(_)` = transient failure (network/timeout/body read) → frontend
///   retries and keeps the last good value.
/// - `Ok(success:false)` = deterministic failure (no key / auth / non-2xx /
///   bad JSON / unsupported provider) → show the error text directly.
#[tauri::command]
pub async fn query_provider_usage(
    agent: Agent,
    provider_name: String,
    force_refresh: Option<bool>,
) -> Result<UsageResult, String> {
    let cache_key = (agent.as_str().to_string(), provider_name.clone());

    if !force_refresh.unwrap_or(false) {
        let cached = usage_cache()
            .lock()
            .unwrap()
            .get(&cache_key)
            .and_then(|(ts, result)| (ts.elapsed() < USAGE_CACHE_TTL).then(|| result.clone()));
        if let Some(result) = cached {
            return Ok(result);
        }
    }

    // Load via the same path as load_agent_config_command so usage_kinds
    // (SQLite merge + host-detect fallback) is already resolved.
    let config = load_agent_config_command(agent)?;
    let Some(provider) = config.providers.get(&provider_name) else {
        return Ok(UsageResult::failure(format!(
            "provider '{provider_name}' not found"
        )));
    };

    // Panel toggle: user disabled usage queries for this provider.
    if let Some(cfg) = &provider.usage_config {
        if !cfg.enabled {
            return Ok(UsageResult::failure(
                "usage query disabled in config panel".to_string(),
            ));
        }
    }

    // The api_key only ever goes into request headers — never into logs,
    // error messages, or the cache key. Managed (OAuth-login) providers have
    // no static key; their credential comes from the Kimi Code OAuth session
    // file (refreshed on demand when the 15-min access token expires).
    let mut api_key = match resolve_usage_api_key(provider) {
        Ok(key) => key,
        // Deterministic: a missing `api_key_env` variable will not appear on
        // retry, so report it instead of letting the frontend keep retrying.
        Err(msg) => return Ok(UsageResult::failure(msg)),
    };
    let mut oauth_err: Option<String> = None;
    if api_key.is_none() && provider.managed {
        // Resolve the credential slot + refresh host from the provider's oauth
        // ref (region-aware); with no ref this falls back to the mainland
        // default, preserving pre-region behavior.
        let oauth_ref = crate::oauth::oauth_ref_from_provider(provider);
        let oauth_base_url = provider.base_url.as_deref().unwrap_or("");
        match crate::oauth::get_valid_access_token(oauth_ref.as_ref(), oauth_base_url).await {
            Ok(token) => api_key = Some(token),
            Err(e) => oauth_err = Some(e),
        }
    }
    let Some(api_key) = api_key else {
        return Ok(UsageResult::failure(if provider.managed {
            oauth_err.unwrap_or_else(|| {
                "no Kimi Code OAuth credentials found; run `kimi login` first".to_string()
            })
        } else {
            "no API key configured".to_string()
        }));
    };

    let base_url = resolve_base_url(provider);

    // NewAPI / Sub2API template: query the gateway's own usage endpoints.
    // NewAPI needs web-console credentials (accessToken + userId); Sub2API
    // reuses the inference API key directly — both bypass usage_kinds.
    if let Some(cfg) = &provider.usage_config {
        let template_kind = match cfg.template_type.as_str() {
            UsageConfig::TEMPLATE_NEWAPI => Some(UsageKind::BalanceNewapi),
            UsageConfig::TEMPLATE_SUB2API => Some(UsageKind::BalanceSub2Api),
            _ => None,
        };
        if let Some(kind) = template_kind {
            // Err = transient (network) → propagate for retry, same semantics
            // as the kinds loop below. Config errors surface as Ok(failure).
            let result =
                services::query_kind(kind, &base_url, &api_key, Some(cfg)).await?;
            if result.success {
                usage_cache()
                    .lock()
                    .unwrap()
                    .insert(cache_key, (Instant::now(), result.clone()));
            }
            return Ok(result);
        }
    }

    let kinds: Vec<UsageKind> = provider
        .usage_kinds
        .as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| {
            v.iter()
                .filter_map(|s| s.parse::<UsageKind>().ok())
                .collect::<Vec<_>>()
        })
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| services::detect_provider(&base_url));
    if kinds.is_empty() {
        return Ok(UsageResult::failure(
            "unsupported provider: no usage query available for this base URL".to_string(),
        ));
    }

    // A failing kind must not take down the others: collect successes,
    // deterministic failures and transient failures separately.
    let mut data: Vec<crate::services::UsageData> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut transient: Vec<String> = Vec::new();
    let mut any_success = false;
    for kind in kinds {
        match services::query_kind(kind, &base_url, &api_key, provider.usage_config.as_ref()).await {
            Ok(result) if result.success => {
                any_success = true;
                if let Some(d) = result.data {
                    data.extend(d);
                }
            }
            Ok(result) => {
                if let Some(e) = result.error {
                    errors.push(format!("{}: {e}", kind.as_str()));
                }
            }
            Err(e) => transient.push(format!("{}: {e}", kind.as_str())),
        }
    }

    if any_success {
        let result = UsageResult {
            success: true,
            data: if data.is_empty() { None } else { Some(data) },
            error: if errors.is_empty() {
                None
            } else {
                Some(errors.join("; "))
            },
        };
        usage_cache()
            .lock()
            .unwrap()
            .insert(cache_key, (Instant::now(), result.clone()));
        Ok(result)
    } else if !transient.is_empty() {
        // All kinds failed transiently → propagate Err so the frontend
        // rejects and retries (keep-last-good).
        Err(transient.join("; "))
    } else {
        Ok(UsageResult::failure(errors.join("; ")))
    }
}

// ---------------------------------------------------------------------------
// 供应商一键体检（探活 + 账单/用量）
// ---------------------------------------------------------------------------

/// 体检并发上限：同时最多 8 个供应商在途，避免瞬间打爆网络 / 触发对端限流。
const HEALTH_CHECK_CONCURRENCY: usize = 8;

/// 整个体检的总超时：超时后返回已完成的部分结果，绝不无限期挂住 UI。
const HEALTH_CHECK_TOTAL_TIMEOUT: Duration = Duration::from_secs(60);

/// 单项检测（探活 / 账单）的三态结论。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthCheck {
    /// 真实通过。
    Pass,
    /// 真实失败。
    Fail,
    /// 中性：无法得出结论，不计入失败。目前只有探活 404 —— 很多中转 /
    /// 套餐端点只代理 chat/completions，没实现 /v1/models，这不能说明
    /// 供应商不可用。
    Neutral,
}

/// 单项检测的结论 + 原始错误文案。错误只用于 tooltip 展示与鉴权判定，
/// 中性（404）的原因不会进 [`HealthResult::error`] 汇总。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub state: HealthCheck,
    pub error: Option<String>,
}

/// 单个供应商的体检结果（IPC 侧 camelCase）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResult {
    pub provider_name: String,
    /// 总体判定：pass=绿 / fail=红 / neutral=灰（判定规则见
    /// [`overall_verdict`]，Rust 侧是唯一事实来源）。
    pub verdict: HealthCheck,
    /// `verdict == Pass` 的便捷布尔，供「x 正常 / y 失败」汇总计数。
    pub ok: bool,
    /// 失败原因汇总（仅 fail 项，`; ` 分隔）；无失败为 None。
    pub error: Option<String>,
    /// 账单/用量查询结论；该供应商未配置 usageKinds（或已关闭用量查询）时为
    /// None，表示未执行。
    pub usage: Option<CheckResult>,
    /// 推理端点探活结论；探活是必做项，恒为 Some。
    pub probe: Option<CheckResult>,
    /// 探活耗时（毫秒）。
    pub latency_ms: u64,
}

/// 体检目标：启用、且探活方式适用的供应商。探活走 OpenAI 兼容的
/// `GET /v1/models`，anthropic / google-genai / vertexai 类型的端点没有这个
/// 路由，硬探只会得到假阴性，故跳过（前端按「未检测」展示）。
fn is_health_target(provider: &Provider) -> bool {
    provider.enabled && provider.provider_type.is_openai_compatible()
}

/// 是否顺带查账单：配置了 usageKinds，且用户没有在配置面板关掉用量查询
/// （关掉是明确意图，不该记成失败）。
fn wants_usage_check(provider: &Provider) -> bool {
    provider
        .usage_kinds
        .as_ref()
        .is_some_and(|v| !v.is_empty())
        && provider
            .usage_config
            .as_ref()
            .map(|c| c.enabled)
            .unwrap_or(true)
}

/// 探活 404 的判定前缀，与 services/probe.rs 的 `endpoint not found` 对应。
fn is_not_found_error(error: &str) -> bool {
    error.starts_with("endpoint not found")
}

/// 剥掉账单错误里的 kind 前缀：commands.rs 的 kinds 循环把单条错误包成
/// `balance:deepseek: msg` / `plan:zhipu: msg`（与前端 localizeUsageError
/// 同一套规则），剥掉后才能按前缀匹配。
fn strip_kind_prefix(error: &str) -> &str {
    for kind in ["balance:", "plan:"] {
        if let Some(rest) = error.strip_prefix(kind) {
            if let Some((_, msg)) = rest.split_once(": ") {
                return msg;
            }
        }
    }
    error
}

/// 账单查询的鉴权类失败（401/403）。key 错了必须红，不能被「探活通过」抵消；
/// 多 kind 时任一条鉴权失败即算（错误串用 `; ` 拼接）。
fn is_auth_error(error: &str) -> bool {
    error
        .split("; ")
        .any(|part| strip_kind_prefix(part).starts_with("Authentication failed"))
}

/// 探活结果 → 三态。404（端点未实现模型列表）归中性，其余网络 / 状态码错误
/// 都是真实失败。
fn classify_probe(outcome: Result<(), String>) -> CheckResult {
    match outcome {
        Ok(()) => CheckResult {
            state: HealthCheck::Pass,
            error: None,
        },
        Err(e) if is_not_found_error(&e) => CheckResult {
            state: HealthCheck::Neutral,
            error: Some(e),
        },
        Err(e) => CheckResult {
            state: HealthCheck::Fail,
            error: Some(e),
        },
    }
}

/// 账单查询结果 → 三态。`Err(_)`（瞬时失败）与 `Ok(success:false)`
/// （确定性失败）都是真实失败；账单链路不产生中性结论。
fn classify_usage(outcome: Result<(), String>) -> CheckResult {
    match outcome {
        Ok(()) => CheckResult {
            state: HealthCheck::Pass,
            error: None,
        },
        Err(e) => CheckResult {
            state: HealthCheck::Fail,
            error: Some(e),
        },
    }
}

/// 综合判定，优先级从高到低（纯函数，便于单测）：
/// 1. 账单鉴权失败（401/403）→ fail（key 错了必须红）
/// 2. 任一 check 真实通过 → pass（账单通或端点通都说明供应商可用）
/// 3. 有 check 失败且无一通过 → fail
/// 4. 其余（全部中性 / 未执行）→ neutral
fn overall_verdict(probe: &CheckResult, usage: Option<&CheckResult>) -> HealthCheck {
    if usage.is_some_and(|u| {
        u.state == HealthCheck::Fail && u.error.as_deref().is_some_and(is_auth_error)
    }) {
        return HealthCheck::Fail;
    }
    let any_pass = probe.state == HealthCheck::Pass
        || usage.is_some_and(|u| u.state == HealthCheck::Pass);
    if any_pass {
        return HealthCheck::Pass;
    }
    let any_fail = probe.state == HealthCheck::Fail
        || usage.is_some_and(|u| u.state == HealthCheck::Fail);
    if any_fail {
        return HealthCheck::Fail;
    }
    HealthCheck::Neutral
}

/// 失败原因汇总（只收 fail 项，中性 / 通过的原始文案不进汇总），按
/// 「探活 → 账单」顺序用 `; ` 拼接。纯函数，便于单测。
fn fail_summary(probe: &CheckResult, usage: Option<&CheckResult>) -> Option<String> {
    let mut errors: Vec<String> = Vec::new();
    for check in std::iter::once(probe).chain(usage) {
        if check.state == HealthCheck::Fail {
            if let Some(e) = &check.error {
                errors.push(e.clone());
            }
        }
    }
    if errors.is_empty() {
        None
    } else {
        Some(errors.join("; "))
    }
}

/// 体检用的凭据：复用 query_provider_usage 的解析顺序（api_key_env >
/// 存储的 api_key > 供应商 env 段）；托管（OAuth）供应商没有静态 key，
/// 回退到 OAuth 会话里的 access token（与 query_provider_usage 一致）。
async fn resolve_health_api_key(provider: &Provider) -> Result<String, String> {
    match resolve_usage_api_key(provider)? {
        Some(key) => Ok(key),
        None if provider.managed => {
            let oauth_ref = crate::oauth::oauth_ref_from_provider(provider);
            let base_url = provider.base_url.as_deref().unwrap_or("");
            crate::oauth::get_valid_access_token(oauth_ref.as_ref(), base_url).await
        }
        None => Err("no API key configured".to_string()),
    }
}

/// 单个供应商的体检：①推理端点探活（必做）②账单/用量（配了 usageKinds 时
/// 顺带查一次）。信号量限流在函数内部获取，调用方可一次性把全部目标并发起来。
async fn check_one_provider(
    agent: Agent,
    provider: Provider,
    sem: &tokio::sync::Semaphore,
) -> HealthResult {
    let name = provider.name.clone();
    // 信号量只在本轮体检内使用、永不 close，acquire 不会失败。
    let _permit = sem
        .acquire()
        .await
        .expect("health-check semaphore is never closed");

    let base_url = resolve_base_url(&provider);
    let api_key = match resolve_health_api_key(&provider).await {
        Ok(key) => key,
        // 凭据缺失是确定性失败，探活无法进行（拿不到 key 必然 401）。
        Err(e) => {
            let probe = CheckResult {
                state: HealthCheck::Fail,
                error: Some(e),
            };
            let error = fail_summary(&probe, None);
            return HealthResult {
                provider_name: name,
                verdict: HealthCheck::Fail,
                ok: false,
                error,
                usage: None,
                probe: Some(probe),
                latency_ms: 0,
            };
        }
    };

    let start = Instant::now();
    let probe =
        services::probe::probe_provider(&base_url, &api_key, services::probe::PROBE_TIMEOUT).await;
    let latency_ms = start.elapsed().as_millis() as u64;
    let probe = classify_probe(probe);

    // 复用 query_provider_usage 的全部逻辑（缓存 / usage_config 模板 /
    // OAuth / kinds 路由）；forceRefresh=true 保证拿到实时值。
    // Err(_) = 瞬时失败，Ok(success:false) = 确定性失败，两者都算体检失败。
    let usage = if wants_usage_check(&provider) {
        Some(classify_usage(
            match query_provider_usage(agent, name.clone(), Some(true)).await {
                Ok(result) if result.success => Ok(()),
                Ok(result) => Err(result
                    .error
                    .unwrap_or_else(|| "usage query failed".to_string())),
                Err(e) => Err(e),
            },
        ))
    } else {
        None
    };

    let verdict = overall_verdict(&probe, usage.as_ref());
    HealthResult {
        provider_name: name,
        ok: verdict == HealthCheck::Pass,
        verdict,
        error: fail_summary(&probe, usage.as_ref()),
        usage,
        probe: Some(probe),
        latency_ms,
    }
}

/// 一键体检：并行检测该 agent 下所有启用且探活适用的供应商。
///
/// 每个供应商跑「探活 + 账单查询」，结论汇总成 [`HealthResult`]，前端按
/// provider 名索引结果并渲染状态点。凭据在 Rust 侧解析，key 不过 IPC。
#[tauri::command]
pub async fn health_check_all(agent: Agent) -> Result<Vec<HealthResult>, String> {
    use futures_util::stream::{FuturesUnordered, StreamExt};

    let config = load_agent_config_command(agent)?;
    let targets: Vec<Provider> = config
        .providers
        .values()
        .filter(|p| is_health_target(p))
        .cloned()
        .collect();

    let sem = std::sync::Arc::new(tokio::sync::Semaphore::new(HEALTH_CHECK_CONCURRENCY));
    let mut pending = FuturesUnordered::new();
    for provider in targets {
        pending.push(check_one_provider(agent, provider, &sem));
    }

    // 总超时兜底：到期返回已完成的部分结果（其余行前端按「未检测」展示），
    // 单个供应商的耗时另有探活 5s + 账单查询自带超时的上界。
    let deadline = tokio::time::Instant::now() + HEALTH_CHECK_TOTAL_TIMEOUT;
    let mut results = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, pending.next()).await {
            Ok(Some(result)) => results.push(result),
            // 全部完成（None），或总超时（Err）——都收工。
            Ok(None) | Err(_) => break,
        }
    }
    Ok(results)
}

#[cfg(test)]
mod health_check_tests {
    use super::*;
    use serde_json::Value;

    fn provider(provider_type: ProviderType, enabled: bool) -> Provider {
        Provider {
            name: "p".to_string(),
            provider_type,
            base_url: None,
            api_key: None,
            api_key_env: None,
            env: IndexMap::new(),
            note: None,
            official_url: None,
            managed: false,
            enabled,
            active: false,
            icon: None,
            icon_color: None,
            raw_other: Value::Null,
            usage_kinds: None,
            usage_config: None,
        }
    }

    #[test]
    fn health_target_requires_enabled_and_openai_compatible() {
        assert!(is_health_target(&provider(ProviderType::Kimi, true)));
        assert!(is_health_target(&provider(ProviderType::Openai, true)));
        assert!(is_health_target(&provider(
            ProviderType::OpenaiResponses,
            true
        )));
        // 停用的供应商不体检
        assert!(!is_health_target(&provider(ProviderType::Kimi, false)));
        // 非 OpenAI 兼容类型没有 /v1/models 路由，硬探是假阴性
        assert!(!is_health_target(&provider(ProviderType::Anthropic, true)));
        assert!(!is_health_target(&provider(
            ProviderType::GoogleGenai,
            true
        )));
        assert!(!is_health_target(&provider(ProviderType::Vertexai, true)));
        assert!(!is_health_target(&provider(
            ProviderType::Unknown("mystery".to_string()),
            true
        )));
    }

    #[test]
    fn usage_check_skips_empty_kinds_and_disabled_panel() {
        let mut p = provider(ProviderType::Openai, true);
        assert!(!wants_usage_check(&p));

        p.usage_kinds = Some(vec![]);
        assert!(!wants_usage_check(&p));

        p.usage_kinds = Some(vec!["balance:deepseek".to_string()]);
        assert!(wants_usage_check(&p));

        // 面板里明确关掉用量查询 → 不查、也不记成失败
        p.usage_config = Some(UsageConfig {
            enabled: false,
            template_type: "auto".to_string(),
            base_url: None,
            access_token: None,
            user_id: None,
            auto_query_interval_minutes: None,
            timeout_seconds: None,
            threshold: None,
        });
        assert!(!wants_usage_check(&p));
    }

    #[test]
    fn probe_404_is_neutral_other_errors_fail() {
        assert_eq!(classify_probe(Ok(())).state, HealthCheck::Pass);
        // 端点未实现 /v1/models（zhipuai-coding-plan 等中转）→ 中性，不算失败
        assert_eq!(
            classify_probe(Err("endpoint not found (HTTP 404)".to_string())).state,
            HealthCheck::Neutral
        );
        for err in [
            "request timed out",
            "connection failed (DNS or refused)",
            "Authentication failed (HTTP 401)",
            "API error (HTTP 502)",
            "response is not valid JSON",
            "missing base_url",
            "no API key configured",
        ] {
            assert_eq!(
                classify_probe(Err(err.to_string())).state,
                HealthCheck::Fail,
                "err: {err}"
            );
        }
    }

    #[test]
    fn usage_never_yields_neutral() {
        assert_eq!(classify_usage(Ok(())).state, HealthCheck::Pass);
        assert_eq!(
            classify_usage(Err("no API key configured".to_string())).state,
            HealthCheck::Fail
        );
    }

    #[test]
    fn auth_error_detection_survives_the_kind_prefix() {
        assert!(is_auth_error("Authentication failed (HTTP 401)"));
        assert!(is_auth_error("Authentication failed (HTTP 403)"));
        // kinds 循环的 `{kind}: {msg}` 包装
        assert!(is_auth_error(
            "balance:deepseek: Authentication failed (HTTP 401)"
        ));
        assert!(is_auth_error("plan:kimi_coding: Authentication failed (HTTP 401)"));
        // 多 kind 拼接时任一条命中即算
        assert!(is_auth_error(
            "balance:deepseek: API error (HTTP 500); plan:zhipu: Authentication failed (HTTP 401)"
        ));
        // 非鉴权失败不得误判
        assert!(!is_auth_error("API error (HTTP 500)"));
        assert!(!is_auth_error("balance:deepseek: API error (HTTP 500)"));
        assert!(!is_auth_error("usage query disabled in config panel"));
    }

    #[test]
    fn verdict_is_green_when_either_channel_passes() {
        let pass = classify_probe(Ok(()));
        let neutral = classify_probe(Err("endpoint not found (HTTP 404)".to_string()));
        let fail = classify_probe(Err("API error (HTTP 502)".to_string()));
        let usage_pass = classify_usage(Ok(()));

        // 账单通 + 探活 404（zhipuai-coding-plan 的真实场景）→ 绿
        assert_eq!(overall_verdict(&neutral, Some(&usage_pass)), HealthCheck::Pass);
        // 账单通 + 探活失败 → 绿（账单通了说明供应商可用）
        assert_eq!(overall_verdict(&fail, Some(&usage_pass)), HealthCheck::Pass);
        // 探活通 + 账单失败（非鉴权）→ 绿
        let usage_fail = classify_usage(Err("API error (HTTP 500)".to_string()));
        assert_eq!(overall_verdict(&pass, Some(&usage_fail)), HealthCheck::Pass);
        // 只有探活且通过 → 绿
        assert_eq!(overall_verdict(&pass, None), HealthCheck::Pass);
    }

    #[test]
    fn verdict_is_gray_only_when_everything_is_neutral() {
        let neutral = classify_probe(Err("endpoint not found (HTTP 404)".to_string()));
        // 探活 404 且没配 usageKinds → 灰（既没通过也没失败）
        assert_eq!(overall_verdict(&neutral, None), HealthCheck::Neutral);
        assert!(!fail_summary(&neutral, None).is_some());
    }

    #[test]
    fn verdict_is_red_when_everything_fails_or_the_key_is_bad() {
        let neutral = classify_probe(Err("endpoint not found (HTTP 404)".to_string()));
        let pass = classify_probe(Ok(()));
        let fail = classify_probe(Err("request timed out".to_string()));

        // 探活失败且没有账单结果 → 红
        assert_eq!(overall_verdict(&fail, None), HealthCheck::Fail);
        // 探活中性 + 账单失败 → 红
        let usage_fail = classify_usage(Err("API error (HTTP 500)".to_string()));
        assert_eq!(overall_verdict(&neutral, Some(&usage_fail)), HealthCheck::Fail);
        // 账单鉴权失败 → 红，即使探活通过（key 错了必须红）
        let usage_auth = classify_usage(Err("Authentication failed (HTTP 401)".to_string()));
        assert_eq!(overall_verdict(&pass, Some(&usage_auth)), HealthCheck::Fail);
        let usage_auth_kinded =
            classify_usage(Err("balance:deepseek: Authentication failed (HTTP 401)".to_string()));
        assert_eq!(
            overall_verdict(&neutral, Some(&usage_auth_kinded)),
            HealthCheck::Fail
        );
    }

    #[test]
    fn fail_summary_lists_only_failures() {
        let pass = classify_probe(Ok(()));
        let neutral = classify_probe(Err("endpoint not found (HTTP 404)".to_string()));
        let fail = classify_probe(Err("request timed out".to_string()));

        assert_eq!(fail_summary(&pass, None), None);
        // 中性原因不进失败汇总
        assert_eq!(fail_summary(&neutral, None), None);
        assert_eq!(
            fail_summary(&fail, None),
            Some("request timed out".to_string())
        );
        // 探活中性 + 账单失败 → 只汇总账单那条
        let usage_fail = classify_usage(Err("Authentication failed (HTTP 401)".to_string()));
        assert_eq!(
            fail_summary(&neutral, Some(&usage_fail)),
            Some("Authentication failed (HTTP 401)".to_string())
        );
        // 两条都失败：按「探活 → 账单」顺序拼接
        assert_eq!(
            fail_summary(&fail, Some(&usage_fail)),
            Some("request timed out; Authentication failed (HTTP 401)".to_string())
        );
    }
}

// ---------------------------------------------------------------------------
// Version check (lightweight: GET Gitea releases API, compare tag_name)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub update_available: bool,
    pub release_url: String,
    pub download_url: Option<String>,
}

fn parse_version(s: &str) -> Vec<u32> {
    s.trim_start_matches('v')
        .split('.')
        .filter_map(|p| p.parse::<u32>().ok())
        .collect()
}

fn version_lt(current: &str, latest: &str) -> bool {
    let c = parse_version(current);
    let l = parse_version(latest);
    for i in 0..c.len().max(l.len()) {
        let cv = *c.get(i).unwrap_or(&0);
        let lv = *l.get(i).unwrap_or(&0);
        if cv < lv {
            return true;
        }
        if cv > lv {
            return false;
        }
    }
    false
}

#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    // Prefer the private Gitea repo (primary release channel, all versions
    // since v0.1.0). Fall back to GitHub Releases when it is unreachable
    // (e.g. off the LAN/VPN) — v0.6.0+ is mirrored there.
    let sources = [
        "https://git.codingplan.site/api/v1/repos/admin/KimiCodeSwitch/releases?limit=1",
        "https://api.github.com/repos/billowliu2/KimiSwitch/releases?per_page=1",
    ];

    // Both hosts require a User-Agent header (GitHub returns 403 without one).
    // Bundle the app version so the source is identifiable in any rate-limit
    // / abuse reports. A short timeout keeps the fallback responsive when the
    // private server is unreachable.
    let client = reqwest::Client::builder()
        .user_agent(concat!("KimiSwitch/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("client build failed: {e}"))?;

    let mut errors: Vec<String> = Vec::new();
    for url in sources {
        match fetch_latest_release(&client, url).await {
            Ok((latest, release_url, download_url)) => {
                let update_available = version_lt(&current, &latest);
                return Ok(UpdateInfo {
                    current,
                    latest,
                    update_available,
                    release_url,
                    download_url,
                });
            }
            Err(e) => errors.push(format!("{url}: {e}")),
        }
    }

    Err(format!("all update sources failed: {}", errors.join("; ")))
}

/// GET a releases API (Gitea or GitHub, same array shape) and extract the
/// latest tag, release page URL and the installer asset for the current OS.
async fn fetch_latest_release(
    client: &reqwest::Client,
    url: &str,
) -> Result<(String, String, Option<String>), String> {
    let releases: serde_json::Value = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("parse failed: {e}"))?;

    let first = releases
        .as_array()
        .and_then(|a| a.first())
        .ok_or("no releases found")?;

    let latest = first
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.0")
        .to_string();

    let release_url = first
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let download_url = first
        .get("assets")
        .and_then(|a| a.as_array())
        .and_then(|a| pick_asset_for_current_os(a));

    Ok((latest, release_url, download_url))
}

// ---------------------------------------------------------------------------
// Silent download with progress events
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn download_update(
    app: tauri::AppHandle,
    url: String,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;
    use tauri::Emitter;

    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("download request failed: {e}"))?;

    let total = resp.content_length().unwrap_or(0);

    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(update_temp_filename());

    let mut file = std::fs::File::create(&file_path)
        .map_err(|e| format!("create temp file failed: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("read chunk failed: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("write failed: {e}"))?;
        downloaded += chunk.len() as u64;

        let progress = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0).min(100.0) as u32
        } else {
            0
        };

        let _ = app.emit(
            "download-progress",
            serde_json::json!({
                "downloaded": downloaded,
                "total": total,
                "progress": progress,
            }),
        );
    }

    drop(file);

    let path_str = file_path.to_string_lossy().to_string();

    let _ = app.emit(
        "download-complete",
        serde_json::json!({ "path": &path_str }),
    );

    Ok(path_str)
}

/// Open the downloaded MSI installer using the system default handler.
#[tauri::command]
pub fn open_installer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Open the Kimi Code WebUI in the system default browser. Reuses an
/// already-running local `kimi web` server (embedded window, terminal, …);
/// otherwise spawns `kimi web`, which starts the server and opens the browser.
#[tauri::command]
pub async fn open_kimi_web(app: tauri::AppHandle) -> Result<(), String> {
    if kimi_web_alive(Duration::from_millis(800)).await {
        // Server already running — just open the browser at the local origin.
        return app
            .opener()
            .open_url(kimi_web_url(), None::<&str>)
            .map_err(|e| e.to_string());
    }
    let mut cmd = std::process::Command::new("kimi");
    cmd.arg("web");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: avoid a console window flashing next to the GUI.
        cmd.creation_flags(0x08000000);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "kimi executable not found on PATH — install Kimi Code CLI first".to_string()
            } else {
                format!("failed to start `kimi web`: {e}")
            }
        })
}

// ---------------------------------------------------------------------------
// Kimi Code WebUI — embedded in-app window
//
// `open_kimi_web_embedded` opens the Kimi Code Web UI inside a dedicated,
// independent top-level window (no parent/child relationship with the main
// window). At most one such window exists: re-invoking focuses it. The local
// `kimi web` server is reused when already running; otherwise one is spawned
// (`--no-open`) and terminated when the window closes or the app exits.
// ---------------------------------------------------------------------------

/// Shared state for the embedded WebUI window and the server we may have spawned.
#[derive(Default)]
pub struct KimiWebState {
    /// The embedded WebUI window (at most one).
    window: Mutex<Option<tauri::WebviewWindow>>,
    /// The `kimi web` child spawned by this app (None when reusing a server).
    child: Mutex<Option<std::process::Child>>,
    /// Serializes `open_kimi_web_embedded` invocations: a rapid double-click
    /// queues here instead of racing the window/server setup.
    launch_lock: tokio::sync::Mutex<()>,
}

const KIMI_WEB_PORT: u16 = 58627;
const KIMI_WEB_ORIGIN: &str = "http://127.0.0.1:58627";
const KIMI_WEB_WINDOW_LABEL: &str = "kimi-web-ui";

/// Build the Web UI URL; the home-wide bearer token rides in the `#token=`
/// fragment (same as the `kimi web` ready banner, see kimi-code
/// `cli/sub/web/access-urls.ts`).
fn kimi_web_url() -> String {
    let token = dirs::home_dir()
        .map(|h| h.join(".kimi-code").join("server.token"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    match token {
        Some(t) => format!("{KIMI_WEB_ORIGIN}/#token={t}"),
        None => format!("{KIMI_WEB_ORIGIN}/"),
    }
}

/// Best-effort probe of the local Kimi web server root.
async fn kimi_web_alive(timeout: Duration) -> bool {
    let Ok(client) = reqwest::Client::builder().timeout(timeout).build() else {
        return false;
    };
    client
        .get(KIMI_WEB_ORIGIN)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Kill the `kimi web` server spawned by this app (no-op when reusing one).
pub fn kill_spawned_kimi_web(state: &tauri::State<'_, KimiWebState>) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Open the Kimi Code WebUI in an embedded, independent top-level window.
#[tauri::command]
pub async fn open_kimi_web_embedded(
    app: tauri::AppHandle,
    state: tauri::State<'_, KimiWebState>,
) -> Result<(), String> {
    // Serialize concurrent invocations (rapid double-click): a second call
    // waits here until the first has finished building the window, then
    // re-checks the singleton below and focuses it instead.
    let _guard = state.launch_lock.lock().await;

    // Singleton (re-checked after acquiring the lock): focus the existing
    // window instead of creating a second one.
    if let Ok(guard) = state.window.lock() {
        if let Some(w) = guard.as_ref() {
            if w.is_visible().unwrap_or(false) {
                let _ = w.unminimize();
                let _ = w.set_focus();
                return Ok(());
            }
        }
    }

    // Reuse the server this app spawned earlier (still running), or a server
    // already running outside the app; only spawn when neither is present.
    // `spawned_by_me` gates every failure-path kill, so a reused server is
    // never terminated.
    let mut spawned_by_me = false;
    let mut child_running = false;
    if let Ok(mut guard) = state.child.lock() {
        // try_wait: Ok(None) = still running. Exited or unwaitable children
        // are treated as gone so a fresh server is spawned below.
        child_running = guard
            .as_mut()
            .map(|child| child.try_wait().map(|st| st.is_none()).unwrap_or(false))
            .unwrap_or(false);
    }
    if !child_running && !kimi_web_alive(Duration::from_millis(800)).await {
        let mut cmd = std::process::Command::new("kimi");
        cmd.args(["web", "--no-open", "--port", &KIMI_WEB_PORT.to_string()]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW — no console flash
        }
        let child = cmd.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "kimi executable not found on PATH — install Kimi Code CLI first".to_string()
            } else {
                format!("failed to start `kimi web`: {e}")
            }
        })?;
        spawned_by_me = true;
        if let Ok(mut guard) = state.child.lock() {
            *guard = Some(child);
        }
    }

    // Wait for the server to come up (fresh start takes a moment).
    if !kimi_web_alive(Duration::from_secs(8)).await {
        if spawned_by_me {
            kill_spawned_kimi_web(&state);
        }
        return Err(format!("kimi web did not come up within 8s ({KIMI_WEB_ORIGIN})"));
    }

    // Build the URL, then create the window on the main thread (required on
    // macOS). The build result is awaited while still holding `launch_lock`,
    // so a concurrent second invocation blocks here and then lands on the
    // singleton re-check above once the window exists.
    let url: tauri::Url = match kimi_web_url().parse() {
        Ok(u) => u,
        Err(_) => return Err("invalid kimi web url".to_string()),
    };
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let builder_app = app.clone();
    app.run_on_main_thread(move || {
        let result = build_kimi_web_window(&builder_app, &url);
        let _ = tx.send(result);
    })
    .map_err(|e| format!("failed to queue window creation: {e}"))?;
    match rx.await {
        Ok(result) => {
            if let Err(e) = result {
                // Window creation failed (e.g. label already taken): only stop
                // the server when this invocation spawned it.
                if spawned_by_me {
                    kill_spawned_kimi_web(&state);
                }
                return Err(e);
            }
            Ok(())
        }
        // Sender dropped without a result (app shutting down, build never
        // ran): never kill the server — a later invocation may reuse it.
        Err(_) => Ok(()),
    }
}

/// Build the embedded WebUI window on the main thread and track it for the
/// singleton check. On success, wires close/destroy events to forget the
/// window and stop the `kimi web` server this app spawned (reused servers are
/// untouched).
fn build_kimi_web_window(app: &tauri::AppHandle, url: &tauri::Url) -> Result<(), String> {
    let window = tauri::WebviewWindowBuilder::new(
        app,
        KIMI_WEB_WINDOW_LABEL,
        tauri::WebviewUrl::External(url.clone()),
    )
    .title("Kimi Code WebUI")
    .inner_size(1100.0, 750.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| format!("failed to create kimi web window: {e}"))?;

    // Track the window for the singleton check.
    if let Ok(mut guard) = app.state::<KimiWebState>().window.lock() {
        *guard = Some(window.clone());
    }
    // Clean up when the window closes: forget it and stop the `kimi web`
    // server we spawned (reused servers are untouched).
    let w = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Destroyed => {
            let app = w.app_handle().clone();
            let state = app.state::<KimiWebState>();
            if let Ok(mut guard) = state.window.lock() {
                *guard = None;
            }
            kill_spawned_kimi_web(&state);
        }
        _ => {}
    });
    Ok(())
}
/// Preference for Linux is AppImage (portable, no install). If the preferred
/// extension is not present, returns None so the UI can fall back to
/// "open release page" instead of guessing a less-preferred format.
fn pick_asset_for_os(assets: &[serde_json::Value], os: &str) -> Option<String> {
    let target_ext = match os {
        "macos" => "dmg",
        "linux" => "AppImage",
        "windows" => "msi",
        _ => return None,
    };
    assets
        .iter()
        .find(|a| {
            a.get("name")
                .and_then(|n| n.as_str())
                .map(|n| n.ends_with(target_ext))
                .unwrap_or(false)
        })
        .and_then(|a| a.get("browser_download_url"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Pick the GitHub release asset for the current OS (runtime target).
fn pick_asset_for_current_os(assets: &[serde_json::Value]) -> Option<String> {
    pick_asset_for_os(assets, std::env::consts::OS)
}

/// Build the platform-specific temp filename for the downloaded installer.
fn update_temp_filename() -> String {
    let ext = match std::env::consts::OS {
        "macos" => "dmg",
        "linux" => "AppImage",
        "windows" => "msi",
        _ => "bin",
    };
    format!("KimiSwitch_update.{ext}")
}

// ---------------------------------------------------------------------------
// Kimi Code CLI version tracking
//
// Settings shows three things: the `kimi` version installed on this machine,
// the latest upstream release, and whether this KimiSwitch build is known to
// work with that CLI version. The status mapping is a static baseline table —
// bump it whenever a CLI release changes something KimiSwitch depends on.
// ---------------------------------------------------------------------------

const KIMI_CODE_LATEST_API: &str =
    "https://api.github.com/repos/MoonshotAI/kimi-code/releases/latest";

/// Hard deadline for `kimi --version`. The CLI is a bundled runtime that needs
/// ~2.5–3.8s just to boot on Windows (measured), so keep generous headroom —
/// a process that overruns it is killed and reported as "not installed".
const KIMI_CODE_VERSION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KimiCodeVersionInfo {
    /// Installed CLI version, `None` when the `kimi` command is unavailable.
    pub installed: Option<String>,
    /// Latest upstream version, normalized to a bare `major.minor.patch`,
    /// `None` when unknown.
    pub latest: Option<String>,
    /// One of: current | outdated | partial | unknown | not_installed.
    pub status: String,
}

/// Extract the first `major.minor.patch` triple out of free-form text. Used on
/// both the CLI's `--version` output ("2.0.2", "kimi-code v0.43.1") and on
/// upstream release tags ("@moonshot-ai/kimi-code@2.0.2"); `None` when nothing
/// parseable shows up.
fn parse_kimi_version(output: &str) -> Option<String> {
    let re = regex::Regex::new(r"(\d+)\.(\d+)\.(\d+)").ok()?;
    let caps = re.captures(output)?;
    Some(format!("{}.{}.{}", &caps[1], &caps[2], &caps[3]))
}

/// Parse a `major.minor.patch` triple. A leading `v` and any pre-release /
/// build suffix are ignored; missing minor/patch default to 0. Hand-rolled on
/// purpose — three integers do not justify a semver dependency.
fn semver_triple(version: &str) -> Option<(u32, u32, u32)> {
    let core = version
        .trim()
        .trim_start_matches(|c: char| c == 'v' || c == 'V')
        .split(|c: char| c == '-' || c == '+')
        .next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.trim().parse::<u32>().ok()?;
    let minor = parts.next().unwrap_or("0").trim().parse::<u32>().ok()?;
    let patch = parts.next().unwrap_or("0").trim().parse::<u32>().ok()?;
    Some((major, minor, patch))
}

/// Adaptation baseline against the kimi-code CLI:
///   >= 2.0.2  fully supported ("current")
///   >= 0.43.1 quota parsing moved upstream — upgrade KimiSwitch ("outdated")
///   >= 0.43.0 the auto_session_title flag is gone ("partial")
///   <  0.43.0 untested ("unknown")
fn kimi_code_status(installed: Option<&str>) -> &'static str {
    let Some(version) = installed else {
        return "not_installed";
    };
    match semver_triple(version) {
        Some(t) if t >= (2, 0, 2) => "current",
        Some(t) if t >= (0, 43, 1) => "outdated",
        Some(t) if t >= (0, 43, 0) => "partial",
        _ => "unknown",
    }
}

/// Wait for a child process with a hard deadline, polling `try_wait` so a hung
/// CLI cannot block the check forever. `None` on spawn failure, wait error or
/// timeout (the child is killed on timeout).
fn run_with_timeout(
    mut cmd: std::process::Command,
    timeout: Duration,
) -> Option<std::process::Output> {
    let mut child = cmd.spawn().ok()?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return None,
        }
    }
    child.wait_with_output().ok()
}

/// Run `kimi --version` and parse the version out of it. Windows goes through
/// `cmd /C` so npm-style `kimi.cmd` shims resolve as well; a missing binary, a
/// timeout and unparseable output all collapse to `None`.
fn detect_kimi_code_version() -> Option<String> {
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg("kimi").arg("--version");
        c
    } else {
        let mut c = std::process::Command::new("kimi");
        c.arg("--version");
        c
    };
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console window flashing next to the GUI.
        cmd.creation_flags(0x08000000);
    }

    let output = run_with_timeout(cmd, KIMI_CODE_VERSION_TIMEOUT)?;
    // The version normally lands on stdout; some shims write it to stderr, so
    // fall back to stderr only for a successful exit — a failed command's
    // error text must not be scraped for digits.
    if let Some(version) = parse_kimi_version(&String::from_utf8_lossy(&output.stdout)) {
        return Some(version);
    }
    if !output.status.success() {
        return None;
    }
    parse_kimi_version(&String::from_utf8_lossy(&output.stderr))
}

/// Locally installed kimi-code CLI version, `None` when the CLI is missing,
/// times out, or prints nothing parseable. Blocking work runs off the UI
/// thread so the 5s deadline cannot freeze the window.
#[tauri::command]
pub async fn get_kimi_code_version() -> Option<String> {
    tauri::async_runtime::spawn_blocking(detect_kimi_code_version)
        .await
        .unwrap_or(None)
}

/// Latest upstream kimi-code release, normalized to a bare version by
/// `normalize_release_tag`. Mirrors `check_for_update`: GitHub requires a
/// User-Agent, the timeout keeps the check snappy, and network/parse failures
/// surface as `Err` so the UI can tell "unknown" apart from "no release".
#[tauri::command]
pub async fn get_kimi_code_latest() -> Result<Option<String>, String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("KimiSwitch/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("client build failed: {e}"))?;

    let release: serde_json::Value = client
        .get(KIMI_CODE_LATEST_API)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("parse failed: {e}"))?;

    Ok(release
        .get("tag_name")
        .and_then(|v| v.as_str())
        .map(normalize_release_tag)
        .filter(|tag| !tag.is_empty()))
}

/// Reduce a release tag to a bare version. Upstream does not use plain
/// `v1.2.3` tags — they look like `@moonshot-ai/kimi-code@2.0.2` — so pull the
/// first `major.minor.patch` triple out of whatever shape shows up; only when
/// that fails fall back to the tag minus a leading `v`.
fn normalize_release_tag(tag: &str) -> String {
    if let Some(version) = parse_kimi_version(tag) {
        return version;
    }
    tag.trim()
        .trim_start_matches(|c: char| c == 'v' || c == 'V')
        .to_string()
}

/// Installed version + upstream latest + adaptation status, in one round trip
/// for the Settings card. A failing upstream lookup degrades to
/// `latest: None` instead of an error so the local half still renders.
#[tauri::command]
pub async fn get_kimi_code_version_info() -> KimiCodeVersionInfo {
    let installed = get_kimi_code_version().await;
    let latest = get_kimi_code_latest().await.unwrap_or(None);
    KimiCodeVersionInfo {
        status: kimi_code_status(installed.as_deref()).to_string(),
        installed,
        latest,
    }
}

#[cfg(test)]
mod kimi_code_version_tests {
    use super::*;

    #[test]
    fn parses_bare_and_decorated_version_output() {
        assert_eq!(parse_kimi_version("2.0.2"), Some("2.0.2".to_string()));
        assert_eq!(parse_kimi_version("0.43.1\n"), Some("0.43.1".to_string()));
        assert_eq!(
            parse_kimi_version("kimi-code v1.2.3"),
            Some("1.2.3".to_string())
        );
        assert_eq!(
            parse_kimi_version("kimi-code 0.43.1 (build abc123)"),
            Some("0.43.1".to_string())
        );
        // A not-found error or empty output must not yield a version.
        assert_eq!(parse_kimi_version("'kimi' is not recognized"), None);
        assert_eq!(parse_kimi_version(""), None);
    }

    #[test]
    fn semver_triple_handles_prefix_and_suffix() {
        assert_eq!(semver_triple("v2.0.2"), Some((2, 0, 2)));
        assert_eq!(semver_triple("0.43.1-beta.2"), Some((0, 43, 1)));
        assert_eq!(semver_triple("2.0"), Some((2, 0, 0)));
        assert_eq!(semver_triple(" 1.2.3 "), Some((1, 2, 3)));
        assert_eq!(semver_triple("nope"), None);
        assert_eq!(semver_triple(""), None);
    }

    #[test]
    fn normalizes_the_upstream_tag_shapes() {
        // Upstream ships scoped npm-style tags, not plain `vX.Y.Z`.
        assert_eq!(
            normalize_release_tag("@moonshot-ai/kimi-code@2.0.2"),
            "2.0.2".to_string()
        );
        assert_eq!(normalize_release_tag("v0.43.1"), "0.43.1".to_string());
        assert_eq!(normalize_release_tag("2.0.2"), "2.0.2".to_string());
        // Unparseable tag falls back to the raw tag minus a leading `v`.
        assert_eq!(normalize_release_tag("nightly"), "nightly".to_string());
        assert_eq!(normalize_release_tag(""), String::new());
    }

    #[test]
    fn status_follows_the_adaptation_baseline() {
        assert_eq!(kimi_code_status(None), "not_installed");
        assert_eq!(kimi_code_status(Some("2.0.2")), "current");
        assert_eq!(kimi_code_status(Some("2.1.0")), "current");
        assert_eq!(kimi_code_status(Some("0.43.1")), "outdated");
        // 2.0.1 predates the fully-supported baseline.
        assert_eq!(kimi_code_status(Some("2.0.1")), "outdated");
        assert_eq!(kimi_code_status(Some("0.43.0")), "partial");
        assert_eq!(kimi_code_status(Some("0.42.9")), "unknown");
        assert_eq!(kimi_code_status(Some("garbage")), "unknown");
    }

    #[test]
    fn missing_binary_yields_none_instead_of_hanging() {
        let cmd = std::process::Command::new("kimi-code-not-installed-xyz");
        assert!(run_with_timeout(cmd, Duration::from_secs(2)).is_none());
    }
}

#[cfg(test)]
mod asset_picker_tests {
    use super::*;
    use serde_json::json;

    fn assets(names: &[&str]) -> Vec<serde_json::Value> {
        names
            .iter()
            .map(|n| {
                json!({
                    "name": n,
                    "browser_download_url": format!("https://example.com/{n}"),
                })
            })
            .collect()
    }

    #[test]
    fn windows_picks_msi() {
        let assets = assets(&["KimiSwitch_0.7.0_x64_en-US.msi", "KimiSwitch_0.7.0_aarch64.dmg", "KimiSwitch_0.7.0_amd64.AppImage"]);
        let url = pick_asset_for_os(&assets, "windows");
        assert_eq!(url.as_deref(), Some("https://example.com/KimiSwitch_0.7.0_x64_en-US.msi"));
    }

    #[test]
    fn macos_picks_dmg() {
        let assets = assets(&["KimiSwitch_0.7.0_x64_en-US.msi", "KimiSwitch_0.7.0_aarch64.dmg", "KimiSwitch_0.7.0_amd64.AppImage"]);
        let url = pick_asset_for_os(&assets, "macos");
        assert_eq!(url.as_deref(), Some("https://example.com/KimiSwitch_0.7.0_aarch64.dmg"));
    }

    #[test]
    fn linux_picks_appimage() {
        let assets = assets(&["KimiSwitch_0.7.0_x64_en-US.msi", "KimiSwitch_0.7.0_aarch64.dmg", "KimiSwitch_0.7.0_amd64.AppImage"]);
        let url = pick_asset_for_os(&assets, "linux");
        assert_eq!(url.as_deref(), Some("https://example.com/KimiSwitch_0.7.0_amd64.AppImage"));
    }

    #[test]
    fn missing_target_returns_none() {
        let assets = assets(&["KimiSwitch_0.7.0_x64_en-US.msi"]);
        let url = pick_asset_for_os(&assets, "macos");
        assert_eq!(url, None);
    }

    #[test]
    fn empty_assets_returns_none() {
        let url = pick_asset_for_os(&[], "linux");
        assert_eq!(url, None);
    }

    #[test]
    fn unknown_os_returns_none() {
        let assets = assets(&["KimiSwitch_0.7.0_x64_en-US.msi"]);
        let url = pick_asset_for_os(&assets, "freebsd");
        assert_eq!(url, None);
    }
}

/// Open an external https/http URL in the system default browser.
/// Uses the Rust opener directly (bypassing the JS plugin scope) so it
/// works regardless of capability scope configuration.
#[tauri::command]
pub fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}
// ---------------------------------------------------------------------------
// Kimi OAuth device-code sign-in (in-app replacement for `kimi login`)
// ---------------------------------------------------------------------------

/// Step 1: ask the region's OAuth host for a user_code + verification URI.
/// `region` is `"cn"` (default) or `"global"`.
#[tauri::command]
pub async fn kimi_oauth_start(
    region: Option<String>,
) -> Result<crate::oauth::DeviceAuthorization, String> {
    let region = crate::oauth::KimiRegion::from_opt(region.as_deref());
    crate::oauth::start_device_authorization(region).await
}

/// Step 2: poll the region's token endpoint until the user approves. On
/// success the tokens are written to the region's credentials file and the
/// provider is provisioned in config.toml (`kimi login` no longer needed).
/// Errors are transient (network); deterministic outcomes (pending / success /
/// expired / denied / timeout) come back in the enum.
#[tauri::command]
pub async fn kimi_oauth_poll(
    device_code: String,
    interval: i64,
    region: Option<String>,
) -> Result<crate::oauth::DevicePollStatus, String> {
    let region = crate::oauth::KimiRegion::from_opt(region.as_deref());
    crate::oauth::poll_device_token(&device_code, interval, region).await
}

// ---------------------------------------------------------------------------
// Experimental feature env-var probe (Kimi Code experimental flags)
// ---------------------------------------------------------------------------

/// Read the Kimi Code environment variables that are currently set (non-empty)
/// in this process's environment. Every `[experimental]` feature env var is
/// probed — the frontend uses a per-feature env var to mark the matching
/// config.toml `[experimental]` toggle as locked, since a single-feature env
/// var outranks the config file in Kimi Code's flag resolution. The master
/// `KIMI_CODE_EXPERIMENTAL_FLAG` (0.40.1+: only force-ONs flags without an
/// explicit config entry; never locks a toggle) and `KIMI_CODE_LEGACY_FLAG`
/// are probed too — the latter lets AgentSettingsPanel decide whether to
/// dual-write the v1 engine's loop_control keys.
///
/// As of Kimi Code 0.43.0 the upstream registry holds 5 experimental flags
/// (`auto_session_title` graduated in 0.43.0 — titles are always on);
/// `secondary-model`, `persistence_minidb_readmodel`, `remote-control` and
/// `search_worker` were promoted or removed earlier and are no longer
/// probed here.
///
/// Non-flag probes: `KIMI_CODE_LEGACY_FLAG` (v1 engine switch) and
/// `KIMI_CODE_WATCH` (kimi-code 2.0.1+ `[watch] enabled` override) are not
/// experimental flags — they gate a config section instead — but they are
/// returned through the same map so the frontend can show the config value
/// that is actually in effect.
///
/// The flag id → env var mapping mirrors `EXPERIMENTAL_FLAGS` in
/// src/lib/subagent-settings.ts; keep both lists in sync.
///
/// Truthy values per the CLI: `1` / `true` / `yes` / `on` (case-insensitive);
/// the raw values are returned and the truthy check happens on the frontend.
#[tauri::command]
pub fn get_experimental_env_status() -> HashMap<String, String> {
    const VARS: [(&str, &str); 8] = [
        ("tool-select", "KIMI_CODE_EXPERIMENTAL_TOOL_SELECT"),
        ("tower", "KIMI_CODE_EXPERIMENTAL_TOWER"),
        ("subagent_fork", "KIMI_CODE_EXPERIMENTAL_SUBAGENT_FORK"),
        ("wait_for", "KIMI_CODE_EXPERIMENTAL_WAIT_FOR"),
        ("notify_user", "KIMI_CODE_EXPERIMENTAL_NOTIFY_USER"),
        // Non-flag probes consumed by the frontend:
        ("master", "KIMI_CODE_EXPERIMENTAL_FLAG"),
        ("legacy", "KIMI_CODE_LEGACY_FLAG"),
        // Not an experimental flag either: the `[watch] enabled` override
        // (kimi-code 2.0.1+). Consumed by AgentSettingsPanel's watch toggle.
        ("watch", "KIMI_CODE_WATCH"),
    ];
    let mut out = HashMap::new();
    for (_, name) in VARS {
        if let Ok(value) = std::env::var(name) {
            if !value.trim().is_empty() {
                out.insert(name.to_string(), value);
            }
        }
    }
    out
}

#[cfg(test)]
mod usage_key_tests {
    use super::*;
    use serde_json::Value;

    fn provider(
        api_key: Option<&str>,
        api_key_env: Option<&str>,
        env: IndexMap<String, String>,
    ) -> Provider {
        Provider {
            name: "p".to_string(),
            provider_type: ProviderType::Openai,
            base_url: None,
            api_key: api_key.map(String::from),
            api_key_env: api_key_env.map(String::from),
            env,
            note: None,
            official_url: None,
            managed: false,
            enabled: true,
            active: false,
            icon: None,
            icon_color: None,
            raw_other: Value::Null,
            usage_kinds: None,
            usage_config: None,
        }
    }

    #[test]
    fn api_key_env_resolves_from_the_process_environment() {
        std::env::set_var("KIMI_SWITCH_TEST_KEY_FROM_ENV", "sk-from-env");
        let p = provider(None, Some("KIMI_SWITCH_TEST_KEY_FROM_ENV"), IndexMap::new());
        assert_eq!(
            resolve_usage_api_key(&p).unwrap().as_deref(),
            Some("sk-from-env")
        );
    }

    #[test]
    fn api_key_env_outranks_a_stored_api_key() {
        std::env::set_var("KIMI_SWITCH_TEST_KEY_WINS", "sk-from-env");
        let p = provider(
            Some("sk-stored"),
            Some("KIMI_SWITCH_TEST_KEY_WINS"),
            IndexMap::new(),
        );
        assert_eq!(
            resolve_usage_api_key(&p).unwrap().as_deref(),
            Some("sk-from-env")
        );
    }

    #[test]
    fn unset_api_key_env_fails_naming_provider_and_variable() {
        let mut p = provider(None, Some("KIMI_SWITCH_TEST_KEY_MISSING"), IndexMap::new());
        p.name = "my-proxy".to_string();
        let err = resolve_usage_api_key(&p).unwrap_err();
        assert!(err.contains("my-proxy"), "{err}");
        assert!(err.contains("KIMI_SWITCH_TEST_KEY_MISSING"), "{err}");
    }

    #[test]
    fn blank_api_key_env_value_fails_and_blank_field_falls_through() {
        std::env::set_var("KIMI_SWITCH_TEST_KEY_BLANK", "   ");
        let p = provider(None, Some("KIMI_SWITCH_TEST_KEY_BLANK"), IndexMap::new());
        assert!(resolve_usage_api_key(&p).is_err());

        // An empty field (env mode selected, name not typed yet) is not a
        // reference at all — the stored key is used.
        let p = provider(Some("sk-stored"), Some(""), IndexMap::new());
        assert_eq!(
            resolve_usage_api_key(&p).unwrap().as_deref(),
            Some("sk-stored")
        );
    }

    #[test]
    fn falls_back_to_stored_key_then_provider_env_section() {
        let p = provider(Some("sk-stored"), None, IndexMap::new());
        assert_eq!(
            resolve_usage_api_key(&p).unwrap().as_deref(),
            Some("sk-stored")
        );

        let mut env = IndexMap::new();
        env.insert("OPENAI_API_KEY".to_string(), "sk-env-section".to_string());
        let p = provider(None, None, env);
        assert_eq!(
            resolve_usage_api_key(&p).unwrap().as_deref(),
            Some("sk-env-section")
        );

        let p = provider(None, None, IndexMap::new());
        assert_eq!(resolve_usage_api_key(&p).unwrap(), None);
    }
}
