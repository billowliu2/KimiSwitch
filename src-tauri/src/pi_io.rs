//! Pi CLI configuration I/O.
//!
//! Pi stores custom providers and models in `~/.pi/agent/models.json`.
//! This module reads and writes that file and converts between Pi's JSON
//! format and Kimi Switch's internal `Config`/`Provider`/`Model` types.

use std::path::PathBuf;

use anyhow::Context;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config_io::backup_file;
use crate::models::{Config, Model, Provider, ProviderType};

pub type PiResult<T> = anyhow::Result<T>;

/// Returns the default Pi agent config directory for the current user.
pub fn pi_agent_dir() -> PathBuf {
    std::env::var_os("PI_CODING_AGENT_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".pi").join("agent")))
        .expect("failed to resolve Pi agent config directory")
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
        backup_file(&path, 7).with_context(|| {
            format!("failed to back up Pi models {}", path.display())
        })?;
    }

    let content = serde_json::to_string_pretty(file)
        .with_context(|| "failed to serialize Pi models.json")?;
    std::fs::write(&path, content)
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

/// Returns the path to Pi's `settings.json` file.
pub fn pi_settings_path() -> PathBuf {
    pi_agent_dir().join("settings.json")
}

/// Pi's `settings.json` file (only the fields Kimi Switch manipulates).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PiSettingsFile {
    #[serde(rename = "defaultProvider", default, skip_serializing_if = "Option::is_none")]
    pub default_provider: Option<String>,
    #[serde(rename = "defaultModel", default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(flatten)]
    pub extra: Value,
}

/// Read the existing Pi `settings.json` file, or return a default empty struct
/// if the file does not exist yet.
pub fn load_pi_settings() -> PiResult<PiSettingsFile> {
    let path = pi_settings_path();
    if !path.exists() {
        return Ok(PiSettingsFile::default());
    }
    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let file: PiSettingsFile = serde_json::from_str(&content)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    Ok(file)
}

/// Write the given Pi settings file, creating the parent directory if needed.
/// A backup of the previous file is created when it already exists.
pub fn save_pi_settings(file: &PiSettingsFile) -> PiResult<()> {
    let path = pi_settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }

    if path.exists() {
        backup_file(&path, 7).with_context(|| {
            format!("failed to back up Pi settings {}", path.display())
        })?;
    }

    let content = serde_json::to_string_pretty(file)
        .with_context(|| "failed to serialize Pi settings.json")?;
    std::fs::write(&path, content)
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

/// Convert a Kimi Switch provider type to the Pi `api` field value.
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

/// Convert a Pi `api` field value back to a Kimi Switch provider type.
pub fn provider_type_for_pi_api(api: &str) -> ProviderType {
    match api {
        "openai-responses" => ProviderType::OpenaiResponses,
        "anthropic-messages" => ProviderType::Anthropic,
        "google-generative-ai" => ProviderType::GoogleGenai,
        "google-vertex" => ProviderType::Vertexai,
        _ => ProviderType::Openai,
    }
}

/// Merge provider-level fields that have dedicated `PiProvider` fields into the
/// `raw_other` blob so they survive the round-trip through Kimi Switch's internal
/// `Config`.
fn merge_provider_known_into_raw(pi_provider: &PiProvider, raw: &mut Value) {
    let has_known = pi_provider.headers.is_some()
        || pi_provider.compat.is_some()
        || pi_provider.api.is_some();
    if !has_known {
        return;
    }

    if raw.is_null() {
        *raw = Value::Object(serde_json::Map::new());
    }
    if let Some(obj) = raw.as_object_mut() {
        if let Some(headers) = &pi_provider.headers {
            obj.insert("headers".to_string(), headers.clone());
        }
        if let Some(compat) = &pi_provider.compat {
            obj.insert("compat".to_string(), compat.clone());
        }
        if let Some(api) = &pi_provider.api {
            obj.insert("api".to_string(), Value::String(api.clone()));
        }
    }
}

/// Merge model-level fields that have dedicated `PiModel` fields into the
/// `raw_other` blob so they survive the round-trip through Kimi Switch's internal
/// `Config`.
fn merge_model_known_into_raw(pi_model: &PiModel, raw: &mut Value) {
    let has_known = pi_model.cost.is_some()
        || pi_model.compat.is_some()
        || pi_model.max_tokens.is_some();
    if !has_known {
        return;
    }

    if raw.is_null() {
        *raw = Value::Object(serde_json::Map::new());
    }
    if let Some(obj) = raw.as_object_mut() {
        if let Some(cost) = &pi_model.cost {
            if let Ok(value) = serde_json::to_value(cost) {
                obj.insert("cost".to_string(), value);
            }
        }
        if let Some(compat) = &pi_model.compat {
            obj.insert("compat".to_string(), compat.clone());
        }
        if let Some(max_tokens) = pi_model.max_tokens {
            obj.insert(
                "maxTokens".to_string(),
                Value::Number(serde_json::Number::from(max_tokens)),
            );
        }
    }
}

/// Extract provider-level fields that PiProvider serializes explicitly from the
/// `raw_other` blob. Any extracted keys are removed from the returned extra so
/// they are not duplicated by `#[serde(flatten)]`.
fn extract_provider_fields(raw: &Value) -> (Option<String>, Option<Value>, Option<Value>, Value) {
    let mut extra = raw.clone();
    let api = extra
        .as_object_mut()
        .and_then(|o| o.remove("api"))
        .and_then(|v| v.as_str().map(String::from));
    let headers = extra.as_object_mut().and_then(|o| o.remove("headers"));
    let compat = extra.as_object_mut().and_then(|o| o.remove("compat"));
    (api, headers, compat, extra)
}

/// Extract model-level fields that PiModel serializes explicitly from the
/// `raw_other` blob. Any extracted keys are removed from the returned extra.
fn extract_model_fields(raw: &Value) -> (Option<PiCost>, Option<Value>, Option<u64>, Value) {
    let mut extra = raw.clone();
    let cost = extra
        .as_object_mut()
        .and_then(|o| o.remove("cost"))
        .and_then(|v| serde_json::from_value(v).ok());
    let compat = extra.as_object_mut().and_then(|o| o.remove("compat"));
    let max_tokens = extra
        .as_object_mut()
        .and_then(|o| o.remove("maxTokens"))
        .and_then(|v| v.as_u64());
    (cost, compat, max_tokens, extra)
}

/// Import a Pi `models.json` into a Kimi Switch `Config`.
pub fn pi_file_to_config(file: &PiModelsFile) -> Config {
    let mut providers = IndexMap::new();
    let mut models = IndexMap::new();

    for (name, pi_provider) in &file.providers {
        let provider_type = pi_provider
            .api
            .as_deref()
            .map(provider_type_for_pi_api)
            .unwrap_or(ProviderType::Openai);

        let mut provider_raw = pi_provider.extra.clone();
        merge_provider_known_into_raw(pi_provider, &mut provider_raw);

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
            icon: None,
            icon_color: None,
            raw_other: provider_raw,
            usage_kinds: None,
            usage_config: None,
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

            let mut model_raw = pi_model.extra.clone();
            merge_model_known_into_raw(pi_model, &mut model_raw);

            models.insert(
                alias.clone(),
                Model {
                    alias,
                    provider: name.clone(),
                    model: pi_model.id.clone(),
                    max_context_size: pi_model.context_window,
                    display_name,
                    supports_1m: pi_model.reasoning || pi_model.context_window >= 1_000_000,
                    capabilities: vec![],
                    raw_other: model_raw,
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

/// Export a Kimi Switch `Config` to a Pi `models.json`.
pub fn config_to_pi_file(config: &Config) -> PiModelsFile {
    let mut providers = IndexMap::new();

    for (name, provider) in &config.providers {
        let (provider_api, provider_headers, provider_compat, provider_extra) =
            extract_provider_fields(&provider.raw_other);
        let api = provider_api.unwrap_or_else(|| pi_api_for_provider(&provider.provider_type).to_string());

        let mut pi_models = Vec::new();
        for model in config.models.values() {
            if model.provider != *name {
                continue;
            }
            let display_name = model.display_name.clone().filter(|s| !s.is_empty());
            let name_field = display_name.clone().filter(|s| s != &model.model);
            let (model_cost, model_compat, model_max_tokens, model_extra) =
                extract_model_fields(&model.raw_other);

            pi_models.push(PiModel {
                id: model.model.clone(),
                name: name_field,
                reasoning: model.supports_1m,
                input: default_input(),
                context_window: model.max_context_size,
                max_tokens: model_max_tokens,
                cost: model_cost,
                compat: model_compat,
                extra: model_extra,
            });
        }

        providers.insert(
            name.clone(),
            PiProvider {
                base_url: provider.base_url.clone().filter(|s| !s.is_empty()),
                api: Some(api),
                api_key: provider.api_key.clone().filter(|s| !s.is_empty()),
                headers: provider_headers,
                compat: provider_compat,
                enabled: provider.enabled,
                models: pi_models,
                extra: provider_extra,
            },
        );
    }

    PiModelsFile {
        // Pi does not use a top-level default_model field; defaults live in
        // ~/.pi/agent/settings.json (defaultProvider / defaultModel).
        default_model: None,
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

    #[test]
    fn pi_roundtrip_preserves_advanced_fields() {
        let mut providers = IndexMap::new();
        providers.insert(
            "my-proxy".to_string(),
            PiProvider {
                base_url: Some("https://proxy.example.com/v1".to_string()),
                api: Some("anthropic-messages".to_string()),
                api_key: Some("sk-test".to_string()),
                headers: Some(serde_json::json!({"X-Custom": "value"})),
                compat: Some(serde_json::json!({"supportsDeveloperRole": false})),
                enabled: true,
                models: vec![PiModel {
                    id: "custom-claude".to_string(),
                    name: Some("Custom Claude".to_string()),
                    reasoning: true,
                    input: vec!["text".to_string(), "image".to_string()],
                    context_window: 200_000,
                    max_tokens: Some(4096),
                    cost: Some(PiCost {
                        input: 1.0,
                        output: 2.0,
                        cache_read: 0.5,
                        cache_write: 0.75,
                    }),
                    compat: Some(serde_json::json!({"forceAdaptiveThinking": true})),
                    extra: serde_json::json!({
                        "thinkingLevelMap": {
                            "off": null,
                            "minimal": null,
                            "low": "low",
                            "medium": "medium",
                            "high": "high",
                            "xhigh": "max"
                        },
                        "headers": {"X-Model-Header": "model-value"},
                        "api": "anthropic-messages"
                    }),
                }],
                extra: serde_json::json!({
                    "name": "My Proxy",
                    "authHeader": true,
                    "modelOverrides": {
                        "claude-sonnet-4": {"name": "Overridden"}
                    }
                }),
            },
        );
        let file = PiModelsFile {
            default_model: None,
            providers,
            extra: Value::Null,
        };

        let config = pi_file_to_config(&file);
        let exported = config_to_pi_file(&config);
        let provider = exported.providers.get("my-proxy").unwrap();

        // Provider-level fields
        assert_eq!(
            provider.extra.get("name").and_then(|v| v.as_str()),
            Some("My Proxy")
        );
        assert_eq!(
            provider.extra.get("authHeader").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            provider
                .extra
                .get("modelOverrides")
                .and_then(|v| v.as_object())
                .and_then(|o| o.get("claude-sonnet-4"))
                .and_then(|v| v.get("name")),
            Some(&serde_json::json!("Overridden"))
        );
        assert_eq!(
            provider.headers.as_ref().and_then(|h| h.get("X-Custom")),
            Some(&serde_json::json!("value"))
        );
        assert_eq!(
            provider.compat.as_ref().and_then(|c| c.get("supportsDeveloperRole")),
            Some(&serde_json::json!(false))
        );

        // Model-level fields
        let model = &provider.models[0];
        assert_eq!(model.id, "custom-claude");
        assert_eq!(model.max_tokens, Some(4096));
        assert_eq!(model.cost.as_ref().map(|c| c.output), Some(2.0));
        assert_eq!(
            model.compat.as_ref().and_then(|c| c.get("forceAdaptiveThinking")),
            Some(&serde_json::json!(true))
        );
        assert_eq!(
            model.extra.get("thinkingLevelMap").and_then(|v| v.get("xhigh")),
            Some(&serde_json::json!("max"))
        );
        assert_eq!(
            model.extra.get("headers").and_then(|v| v.get("X-Model-Header")),
            Some(&serde_json::json!("model-value"))
        );
    }

    #[test]
    fn pi_settings_roundtrip() {
        let file = PiSettingsFile {
            default_provider: Some("my-proxy".to_string()),
            default_model: Some("glm-5.2".to_string()),
            extra: serde_json::json!({"theme": "dark"}),
        };
        let serialized = serde_json::to_string_pretty(&file).unwrap();
        assert!(serialized.contains("defaultProvider"));
        assert!(serialized.contains("defaultModel"));

        let deserialized: PiSettingsFile = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.default_provider, file.default_provider);
        assert_eq!(deserialized.default_model, file.default_model);
        assert_eq!(deserialized.extra.get("theme"), Some(&serde_json::json!("dark")));
    }
}
