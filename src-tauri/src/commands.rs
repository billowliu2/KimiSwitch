use crate::db;
use crate::models::{Agent, Config, DiscoveredModel, Model, Provider, ProviderType};
use crate::pi_io;
use indexmap::IndexMap;
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

// ── OpenAI-compatible /models endpoint ──────────────────────────────

async fn fetch_openai_models(base: &str, api_key: &str) -> Result<Vec<DiscoveredModel>, String> {
    let url = format!("{}/models", base.trim_end_matches('/'));
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("HTTP request to {} failed: {e}", url))?;

    if !resp.status().is_success() {
        return Err(format!("{} returned HTTP {}", url, resp.status()));
    }

    #[derive(serde::Deserialize)]
    struct OaiModel {
        id: String,
    }
    #[derive(serde::Deserialize)]
    struct OaiList {
        data: Vec<OaiModel>,
    }

    let body: OaiList = resp
        .json()
        .await
        .map_err(|e| format!("failed to parse response from {}: {e}", url))?;

    Ok(body
        .data
        .into_iter()
        .map(|m| DiscoveredModel {
            id: m.id,
            display_name: None,
            max_context_size: None,
        })
        .collect())
}

// ── Anthropic /v1/models endpoint ───────────────────────────────────

async fn fetch_anthropic_models(base: &str, api_key: &str) -> Result<Vec<DiscoveredModel>, String> {
    let url = format!("{}/v1/models", base.trim_end_matches('/'));
    let resp = reqwest::Client::new()
        .get(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| format!("HTTP request to {} failed: {e}", url))?;

    if !resp.status().is_success() {
        return Err(format!("{} returned HTTP {}", url, resp.status()));
    }

    #[derive(serde::Deserialize)]
    struct AntModel {
        id: String,
        display_name: Option<String>,
    }
    #[derive(serde::Deserialize)]
    struct AntList {
        data: Vec<AntModel>,
    }

    let body: AntList = resp
        .json()
        .await
        .map_err(|e| format!("failed to parse response from {}: {e}", url))?;

    Ok(body
        .data
        .into_iter()
        .map(|m| DiscoveredModel {
            id: m.id,
            display_name: m.display_name,
            max_context_size: None,
        })
        .collect())
}

// ── Google GenAI /v1beta/models endpoint ────────────────────────────

async fn fetch_google_genai_models(
    base: &str,
    api_key: &str,
) -> Result<Vec<DiscoveredModel>, String> {
    let url = format!(
        "{}/v1beta/models?key={}",
        base.trim_end_matches('/'),
        api_key
    );
    let resp = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP request to {} failed: {e}", url))?;

    if !resp.status().is_success() {
        return Err(format!("{} returned HTTP {}", url, resp.status()));
    }

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
    }

    let body: GglList = resp
        .json()
        .await
        .map_err(|e| format!("failed to parse response from {}: {e}", url))?;

    Ok(body
        .models
        .into_iter()
        .map(|m| {
            let id = m.name.strip_prefix("models/").unwrap_or(&m.name).to_string();
            DiscoveredModel {
                id,
                display_name: m.display_name,
                max_context_size: m.output_token_limit,
            }
        })
        .collect())
}
