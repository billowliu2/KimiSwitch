use crate::db;
use crate::models::{Agent, Config, DiscoveredModel, Model, Provider, ProviderType};
use crate::pi_io;
use crate::services::{self, UsageKind, UsageResult};
use indexmap::IndexMap;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
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
    let api_key = resolve_api_key(&provider)
        .ok_or_else(|| format!("Provider '{}' has no API key configured", provider.name))?;

    let base = resolve_base_url(&provider);

    match provider.provider_type {
        ProviderType::Kimi | ProviderType::Openai | ProviderType::OpenaiResponses => {
            fetch_openai_models(&base, &api_key).await
        }
        ProviderType::Anthropic => fetch_anthropic_models(&base, &api_key).await,
        ProviderType::GoogleGenai => fetch_google_genai_models(&base, &api_key).await,
        ProviderType::Vertexai => Err("Vertex AI model discovery requires GCP project/location configuration and is not yet supported".to_string()),
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

fn resolve_api_key(provider: &Provider) -> Option<String> {
    if provider.managed {
        return Some("managed".to_string());
    }
    if let Some(key) = &provider.api_key {
        if !key.is_empty() {
            return Some(key.clone());
        }
    }
    let env_key = expected_api_key_key(&provider.provider_type);
    provider.env.get(env_key).filter(|s| !s.is_empty()).cloned()
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

fn expected_api_key_key(provider_type: &ProviderType) -> &'static str {
    match provider_type {
        ProviderType::Kimi => "KIMI_API_KEY",
        ProviderType::Anthropic => "ANTHROPIC_API_KEY",
        ProviderType::Openai | ProviderType::OpenaiResponses => "OPENAI_API_KEY",
        ProviderType::GoogleGenai => "GOOGLE_API_KEY",
        ProviderType::Vertexai => "VERTEXAI_API_KEY",
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

/// Query a provider's balance / plan quota. The frontend passes only the
/// provider name — base_url, api_key and usage kinds are all resolved here,
/// so the API key never crosses IPC and the host routing cannot be spoofed.
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

    // The api_key only ever goes into request headers — never into logs,
    // error messages, or the cache key.
    let api_key = provider
        .api_key
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            provider
                .env
                .get(expected_api_key_key(&provider.provider_type))
                .cloned()
                .filter(|s| !s.is_empty())
        });
    let Some(api_key) = api_key else {
        return Ok(UsageResult::failure(if provider.managed {
            "provider uses managed OAuth; usage query requires an API key".to_string()
        } else {
            "no API key configured".to_string()
        }));
    };

    let base_url = resolve_base_url(provider);
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
        match services::query_kind(kind, &base_url, &api_key).await {
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
    // GitHub Releases API for billowliu2/KimiSwitch. Historical versions
    // (v0.5.x and earlier) live on git.codingplan.site and are not exposed
    // here — only v0.6.0+ is published via GitHub.
    let url = "https://api.github.com/repos/billowliu2/KimiSwitch/releases?per_page=1";

    // GitHub returns 403 without a User-Agent header. Bundle the app version
    // so the source is identifiable in any rate-limit / abuse reports.
    let client = reqwest::Client::builder()
        .user_agent(concat!("KimiSwitch/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("client build failed: {e}"))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let releases: serde_json::Value = resp
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

    let update_available = version_lt(&current, &latest);

    Ok(UpdateInfo {
        current,
        latest,
        update_available,
        release_url,
        download_url,
    })
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