//! Pi CLI configuration I/O.
//!
//! Pi stores custom providers and models in `~/.pi/agent/models.json`.
//! This module reads and writes that file and converts between Pi's JSON
//! format and Pi Switch's internal `Config`/`Provider`/`Model` types.

use std::path::PathBuf;

use anyhow::Context;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::{Config, Model, Provider, ProviderType};

pub type PiResult<T> = anyhow::Result<T>;

/// Returns the default Pi agent config directory for the current user.
pub fn pi_agent_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".pi").join("agent"))
        .expect("failed to resolve home directory")
}

/// Returns the path to Pi's `models.json` file.
pub fn pi_models_path() -> PathBuf {
    pi_agent_dir().join("models.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PiCost {
    pub input: f64,
    pub output: f64,
    #[serde(rename = "cacheRead", default)]
    pub cache_read: f64,
    #[serde(rename = "cacheWrite", default)]
    pub cache_write: f64,
}

/// A single Pi model entry.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PiModel {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default)]
    pub reasoning: bool,
    #[serde(default = "default_input", skip_serializing_if = "is_default_input")]
    pub input: Vec<String>,
    #[serde(rename = "contextWindow", default = "default_context_window")]
    pub context_window: u64,
    #[serde(rename = "maxTokens", default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<PiCost>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compat: Option<Value>,
    #[serde(flatten)]
    pub extra: Value,
}

fn default_input() -> Vec<String> {
    vec!["text".to_string()]
}

fn is_default_input(input: &[String]) -> bool {
    input.len() == 1 && input.first().map(String::as_str) == Some("text")
}

fn default_context_window() -> u64 {
    128_000
}

fn default_true() -> bool {
    true
}

/// A single Pi provider entry.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PiProvider {
    #[serde(rename = "baseUrl", default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,
    #[serde(rename = "apiKey", default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compat: Option<Value>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub models: Vec<PiModel>,
    #[serde(flatten)]
    pub extra: Value,
}

/// Root Pi `models.json` structure.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PiModelsFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(default)]
    pub providers: IndexMap<String, PiProvider>,
    #[serde(flatten)]
    pub extra: Value,
}

/// Read the existing Pi `models.json` file, or return a default empty struct
/// if the file does not exist yet.
pub fn load_pi_models() -> PiResult<PiModelsFile> {
    let path = pi_models_path();
    if !path.exists() {
        return Ok(PiModelsFile::default());
    }
    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let file: PiModelsFile = serde_json::from_str(&content)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    Ok(file)
}

/// Write the given Pi models file, creating the parent directory if needed.
/// A backup of the previous file is created when it already exists.
pub fn save_pi_models(file: &PiModelsFile) -> PiResult<()> {
    let path = pi_models_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }

    if path.exists() {
        let timestamp = chrono::Local::now()
            .format("%Y%m%d_%H%M%S_%.3f")
            .to_string();
        let mut backup_path = path.with_extension(format!("json.bak.{}", timestamp));
        if backup_path.exists() {
            for n in 1..1000 {
                let candidate = path.with_extension(format!("json.bak.{}.{:03}", timestamp, n));
                if !candidate.exists() {
                    backup_path = candidate;
                    break;
                }
            }
        }
        std::fs::copy(&path, &backup_path)
            .with_context(|| format!("failed to back up {} to {}", path.display(), backup_path.display()))?;
    }

    let content = serde_json::to_string_pretty(file)
        .with_context(|| "failed to serialize Pi models.json")?;
    std::fs::write(&path, content)
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

/// Convert a Pi Switch provider type to the Pi `api` field value.
pub fn pi_api_for_provider(provider_type: &ProviderType) -> &'static str {
    match provider_type {
        ProviderType::Openai => "openai-completions",
        ProviderType::OpenaiResponses => "openai-responses",
        ProviderType::Anthropic => "anthropic-messages",
        ProviderType::GoogleGenai => "google-generative-ai",
        ProviderType::Vertexai => "google-vertex",
        // Treat Kimi as OpenAI-compatible since it is not a native Pi API.
        ProviderType::Kimi => "openai-completions",
    }
}

/// Convert a Pi `api` field value back to a Pi Switch provider type.
pub fn provider_type_for_pi_api(api: &str) -> ProviderType {
    match api {
        "openai-responses" => ProviderType::OpenaiResponses,
        "anthropic-messages" => ProviderType::Anthropic,
        "google-generative-ai" => ProviderType::GoogleGenai,
        "google-vertex" => ProviderType::Vertexai,
        _ => ProviderType::Openai,
    }
}

/// Import a Pi `models.json` into a Pi Switch `Config`.
pub fn pi_file_to_config(file: &PiModelsFile) -> Config {
    let mut providers = IndexMap::new();
    let mut models = IndexMap::new();

    for (name, pi_provider) in &file.providers {
        let provider_type = pi_provider
            .api
            .as_deref()
            .map(provider_type_for_pi_api)
            .unwrap_or(ProviderType::Openai);

        let provider = Provider {
            name: name.clone(),
            provider_type,
            base_url: pi_provider.base_url.clone().filter(|s| !s.is_empty()),
            api_key: pi_provider.api_key.clone().filter(|s| !s.is_empty()),
            env: IndexMap::new(),
            note: None,
            official_url: None,
            managed: false,
            enabled: pi_provider.enabled,
            active: true,
            raw_other: pi_provider.extra.clone(),
        };

        for (idx, pi_model) in pi_provider.models.iter().enumerate() {
            let alias = pi_model
                .name
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| {
                    if pi_model.id.trim().is_empty() {
                        format!("{}-model-{}", name, idx + 1)
                    } else {
                        pi_model.id.clone()
                    }
                });
            let display_name = pi_model.name.clone().filter(|s| !s.is_empty());

            models.insert(
                alias.clone(),
                Model {
                    alias,
                    provider: name.clone(),
                    model: pi_model.id.clone(),
                    max_context_size: pi_model.context_window,
                    display_name,
                    role: None,
                    supports_1m: pi_model.reasoning || pi_model.context_window >= 1_000_000,
                    capabilities: vec![],
                    raw_other: pi_model.extra.clone(),
                },
            );
        }

        providers.insert(name.clone(), provider);
    }

    Config {
        default_model: file.default_model.clone(),
        providers,
        models,
        raw_other: file.extra.clone(),
    }
}

/// Export a Pi Switch `Config` to a Pi `models.json`.
pub fn config_to_pi_file(config: &Config) -> PiModelsFile {
    let mut providers = IndexMap::new();

    for (name, provider) in &config.providers {
        let mut pi_models = Vec::new();
        for model in config.models.values() {
            if model.provider != *name {
                continue;
            }
            let display_name = model.display_name.clone().filter(|s| !s.is_empty());
            let name_field = display_name
                .clone()
                .filter(|s| s != &model.model);
            pi_models.push(PiModel {
                id: model.model.clone(),
                name: name_field,
                reasoning: model.supports_1m,
                input: default_input(),
                context_window: model.max_context_size,
                max_tokens: None,
                cost: None,
                compat: None,
                extra: model.raw_other.clone(),
            });
        }

        providers.insert(
            name.clone(),
            PiProvider {
                base_url: provider.base_url.clone().filter(|s| !s.is_empty()),
                api: Some(pi_api_for_provider(&provider.provider_type).to_string()),
                api_key: provider.api_key.clone().filter(|s| !s.is_empty()),
                headers: None,
                compat: None,
                enabled: provider.enabled,
                models: pi_models,
                extra: provider.raw_other.clone(),
            },
        );
    }

    PiModelsFile {
        default_model: config.default_model.clone(),
        providers,
        extra: config.raw_other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pi_roundtrip_preserves_provider_and_model() {
        let mut providers = IndexMap::new();
        providers.insert(
            "my-openai".to_string(),
            PiProvider {
                base_url: Some("https://proxy.example.com/v1".to_string()),
                api: Some("openai-completions".to_string()),
                api_key: Some("sk-test".to_string()),
                headers: None,
                compat: None,
                enabled: true,
                models: vec![PiModel {
                    id: "gpt-test".to_string(),
                    name: Some("GPT Test".to_string()),
                    reasoning: true,
                    input: vec!["text".to_string()],
                    context_window: 200_000,
                    max_tokens: Some(4096),
                    cost: Some(PiCost {
                        input: 1.0,
                        output: 2.0,
                        cache_read: 0.0,
                        cache_write: 0.0,
                    }),
                    compat: None,
                    extra: Value::Null,
                }],
                extra: Value::Null,
            },
        );
        let file = PiModelsFile {
            default_model: None,
            providers,
            extra: Value::Null,
        };

        let config = pi_file_to_config(&file);
        assert_eq!(config.providers.len(), 1);
        assert_eq!(config.models.len(), 1);

        let provider = config.providers.get("my-openai").unwrap();
        assert_eq!(provider.provider_type, ProviderType::Openai);
        assert_eq!(provider.base_url.as_deref(), Some("https://proxy.example.com/v1"));
        assert_eq!(provider.api_key.as_deref(), Some("sk-test"));

        let model = config.models.get("GPT Test").unwrap();
        assert_eq!(model.model, "gpt-test");
        assert!(model.supports_1m);
        assert_eq!(model.max_context_size, 200_000);

        let exported = config_to_pi_file(&config);
        let exported_provider = exported.providers.get("my-openai").unwrap();
        assert_eq!(exported_provider.api.as_deref(), Some("openai-completions"));
        assert_eq!(exported_provider.models[0].id, "gpt-test");
        assert!(exported_provider.models[0].reasoning);
    }
}
