use crate::db;
use crate::models::{Agent, Config, DiscoveredModel, Model, Provider, ProviderType};
use crate::pi_io;
use indexmap::IndexMap;
use serde::Serialize;
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

#[tauri::command]
pub fn load_agent_config_command(agent: Agent) -> Result<Config, String> {
    // Load Kimi Switch's own SQLite database (metadata + migration fallback).
    let db_config = db::load_config(&agent).ok();

    match agent {
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

            Ok(config)
        }
        Agent::Pi => {
            // Pi: SQLite first, fall back to native config on first use.
            if let Some(config) = db_config {
                if !config.providers.is_empty() {
                    return Ok(config);
                }
            }
            let file = pi_io::load_pi_models().map_err(fmt_anyhow)?;
            let mut config = pi_io::pi_file_to_config(&file);
            if config.default_model.is_none() {
                if let Ok(settings) = pi_io::load_pi_settings() {
                    if let (Some(provider), Some(model_id)) =
                        (settings.default_provider, settings.default_model)
                    {
                        if let Some(alias) = config.models.values().find(|m| {
                            m.provider == provider && m.model == model_id
                        }) {
                            config.default_model = Some(alias.alias.clone());
                        }
                    }
                }
            }
            Ok(config)
        }
    }
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
    let url = "https://git.codingplan.site/api/v1/repos/admin/KimiCodeSwitch/releases?limit=1";

    let resp = reqwest::get(url)
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
        .and_then(|a| a.first())
        .and_then(|a| a.get("browser_download_url"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

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
    let file_path = temp_dir.join("KimiSwitch_update.msi");

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