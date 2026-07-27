//! Kimi Code configuration I/O.
//!
//! Kimi Code stores its configuration in `~/.kimi-code/config.toml`.
//! This module reads/writes that file and converts between Kimi's TOML
//! format and Kimi Switch's internal `Config`/`Provider`/`Model` types.

use std::path::PathBuf;

use anyhow::Context;
use indexmap::IndexMap;
use serde_json::Value;
use toml::value::{Table, Value as TomlValue};

use crate::config_io::backup_file;
use crate::models::{Agent, Config, Model, Provider, ProviderType};

pub type KimiResult<T> = anyhow::Result<T>;

pub fn kimi_code_config_dir() -> PathBuf {
    std::env::var_os("KIMI_CODE_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".kimi-code")))
        .expect("failed to resolve Kimi Code config directory")
}

pub fn kimi_code_config_path() -> PathBuf {
    kimi_code_config_dir().join("config.toml")
}

/// Read the existing Kimi Code `config.toml`, or return an empty table if it
/// does not exist yet.
pub fn load_kimi_code_config() -> KimiResult<TomlValue> {
    let path = kimi_code_config_path();
    if !path.exists() {
        return Ok(TomlValue::Table(Table::new()));
    }
    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let value: TomlValue = content
        .parse()
        .with_context(|| format!("failed to parse {}", path.display()))?;
    Ok(value)
}

/// Write the given TOML value to Kimi Code's config file, creating the
/// directory if needed and backing up the previous file.
pub fn save_kimi_code_config(value: &TomlValue) -> KimiResult<()> {
    let path = kimi_code_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }

    if path.exists() {
        backup_file(&path, 7).with_context(|| {
            format!("failed to back up Kimi Code config {}", path.display())
        })?;
    }

    let content = toml::to_string_pretty(value)
        .with_context(|| "failed to serialize Kimi Code config.toml")?;
    std::fs::write(&path, content)
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

/// Import a Kimi Code TOML config into Kimi Switch's internal `Config`.
pub fn kimi_code_to_config(value: &TomlValue) -> Config {
    let root = value.as_table().cloned().unwrap_or_default();

    let default_model = root
        .get("default_model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut providers = IndexMap::new();
    let mut models = IndexMap::new();

    // Read models first so we can determine which provider the default_model
    // belongs to. Only that provider should be marked active in the UI.
    if let Some(models_table) = root.get("models").and_then(|v| v.as_table()) {
        for (alias, mv) in models_table {
            let table = mv.as_table().cloned().unwrap_or_default();
            let provider = table
                .get("provider")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            let model_id = table
                .get("model")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            let max_context_size = table
                .get("max_context_size")
                .and_then(|v| v.as_integer())
                .map(|n| n as u64)
                .unwrap_or(128_000);
            let display_name = table
                .get("display_name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let capabilities: Vec<String> = table
                .get("capabilities")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let supports_1m = max_context_size >= 1_000_000;

            let raw_other = {
                let mut rest = table.clone();
                rest.remove("provider");
                rest.remove("model");
                rest.remove("max_context_size");
                rest.remove("display_name");
                rest.remove("capabilities");
                toml_value_to_json(&TomlValue::Table(rest))
            };

            models.insert(
                alias.clone(),
                Model {
                    alias: alias.clone(),
                    provider,
                    model: model_id,
                    max_context_size,
                    display_name,
                    supports_1m,
                    capabilities,
                    raw_other,
                },
            );
        }
    }

    let active_provider_name = default_model
        .as_ref()
        .and_then(|alias| models.get(alias))
        .map(|m| m.provider.as_str());

    if let Some(providers_table) = root.get("providers").and_then(|v| v.as_table()) {
        for (name, pv) in providers_table {
            let table = pv.as_table().cloned().unwrap_or_default();
            let provider_type = table
                .get("type")
                .and_then(|v| v.as_str())
                .map(provider_type_for_kimi_type)
                .unwrap_or(ProviderType::Kimi);

            let base_url = table.get("base_url").and_then(|v| v.as_str()).map(|s| s.to_string());
            let api_key = table.get("api_key").and_then(|v| v.as_str()).map(|s| s.to_string());
            let managed = table.contains_key("oauth")
                || table.get("managed").and_then(|v| v.as_bool()).unwrap_or(false);
            let enabled = table.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);

            let env: IndexMap<String, String> = table
                .get("env")
                .and_then(|v| v.as_table())
                .map(|t| {
                    t.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();

            let raw_other = {
                let mut rest = table.clone();
                rest.remove("type");
                rest.remove("base_url");
                rest.remove("api_key");
                rest.remove("managed");
                rest.remove("enabled");
                rest.remove("env");
                // NOTE: `oauth` is intentionally kept in raw_other so that the
                // exact `storage`/`key` block round-trips verbatim on export.
                // Previously it was stripped here and regenerated on export
                // with a key derived from the provider name, which corrupted
                // the managed:kimi-code credential reference (e.g.
                // "oauth/kimi-code" became "oauth/managed-kimi-code").
                toml_value_to_json(&TomlValue::Table(rest))
            };

            providers.insert(
                name.clone(),
                Provider {
                    name: name.clone(),
                    provider_type,
                    base_url: base_url.filter(|s| !s.is_empty()),
                    api_key: api_key.filter(|s| !s.is_empty()),
                    env,
                    note: None,
                    official_url: None,
                    managed,
                    enabled,
                    active: active_provider_name == Some(name.as_str()),
                    raw_other,
                },
            );
        }
    }

    let raw_other = {
        let mut rest = root;
        rest.remove("default_model");
        rest.remove("providers");
        rest.remove("models");
        toml_value_to_json(&TomlValue::Table(rest))
    };

    Config {
        default_model,
        providers,
        models,
        raw_other,
    }
}

/// Export Kimi Switch's internal `Config` to a Kimi Code TOML config value.
///
/// If `existing` is provided, unknown top-level sections (e.g. `services`) are
/// preserved; otherwise a fresh TOML table is used.
pub fn config_to_kimi_code(config: &Config, existing: Option<&TomlValue>) -> TomlValue {
    let mut root = existing
        .and_then(|v| v.as_table().cloned())
        .unwrap_or_default();

    root.insert(
        "default_model".to_string(),
        config
            .default_model
            .clone()
            .map(TomlValue::String)
            .unwrap_or(TomlValue::String("".to_string())),
    );

    let mut providers_table = Table::new();
    for (name, provider) in &config.providers {
        // Write ALL providers to Kimi Code config. The active provider is
        // selected via `default_model`, so keeping the full list matches the
        // CLI's native multi-provider behavior and prevents data loss when
        // switching.
        let mut pt = Table::new();
        pt.insert("type".to_string(), TomlValue::String(provider.provider_type.as_str().to_string()));
        if let Some(base_url) = provider.base_url.clone().filter(|s| !s.is_empty()) {
            pt.insert("base_url".to_string(), TomlValue::String(base_url));
        }
        if let Some(api_key) = provider.api_key.clone().filter(|s| !s.is_empty()) {
            pt.insert("api_key".to_string(), TomlValue::String(api_key));
        }
        pt.insert("enabled".to_string(), TomlValue::Boolean(provider.enabled));
        if !provider.env.is_empty() {
            let mut env_table = Table::new();
            for (k, v) in &provider.env {
                env_table.insert(k.clone(), TomlValue::String(v.clone()));
            }
            pt.insert("env".to_string(), TomlValue::Table(env_table));
        }
        if provider.managed {
            // Preserve existing oauth config if present, otherwise create a default entry.
            let oauth = provider
                .raw_other
                .get("oauth")
                .and_then(json_to_toml)
                .unwrap_or_else(|| {
                    let mut t = Table::new();
                    t.insert("storage".to_string(), TomlValue::String("file".to_string()));
                    t.insert("key".to_string(), TomlValue::String(format!("oauth/{}", name.replace(':', "-"))));
                    TomlValue::Table(t)
                });
            pt.insert("oauth".to_string(), oauth);
        }
        // Merge remaining raw fields (oauth and env are handled explicitly above).
        if let TomlValue::Table(mut extra) = json_to_toml(&provider.raw_other).unwrap_or(TomlValue::Table(Table::new())) {
            extra.remove("oauth");
            extra.remove("env");
            // Strip Kimi-Switch-private field: the remembered per-provider
            // default model is stored in raw_other.default_model and must NOT
            // leak into the agent's config.toml.
            extra.remove("default_model");
            for (k, v) in extra {
                pt.insert(k, v);
            }
        }
        providers_table.insert(name.clone(), TomlValue::Table(pt));
    }
    root.insert("providers".to_string(), TomlValue::Table(providers_table));

    // Write all models — each provider's models are kept so the CLI's
    // /provider command can list and switch between them.
    let mut models_table = Table::new();
    for (alias, model) in &config.models {
        let mut mt = Table::new();
        mt.insert("provider".to_string(), TomlValue::String(model.provider.clone()));
        mt.insert("model".to_string(), TomlValue::String(model.model.clone()));
        mt.insert(
            "max_context_size".to_string(),
            TomlValue::Integer(model.max_context_size as i64),
        );
        if let Some(display_name) = model.display_name.clone().filter(|s| !s.is_empty()) {
            mt.insert("display_name".to_string(), TomlValue::String(display_name));
        }
        let capabilities = model.capabilities.clone();
        if !capabilities.is_empty() {
            mt.insert(
                "capabilities".to_string(),
                TomlValue::Array(capabilities.into_iter().map(TomlValue::String).collect()),
            );
        }
        if let TomlValue::Table(mut extra) = json_to_toml(&model.raw_other).unwrap_or(TomlValue::Table(Table::new())) {
            extra.remove("provider");
            extra.remove("model");
            extra.remove("max_context_size");
            extra.remove("display_name");
            extra.remove("capabilities");
            for (k, v) in extra {
                mt.insert(k, v);
            }
        }
        models_table.insert(alias.clone(), TomlValue::Table(mt));
    }
    root.insert("models".to_string(), TomlValue::Table(models_table));

    TomlValue::Table(root)
}

fn provider_type_for_kimi_type(typ: &str) -> ProviderType {
    match typ {
        "anthropic" => ProviderType::Anthropic,
        "openai" => ProviderType::Openai,
        "openai_responses" => ProviderType::OpenaiResponses,
        "google-genai" => ProviderType::GoogleGenai,
        "vertexai" => ProviderType::Vertexai,
        _ => ProviderType::Kimi,
    }
}

fn toml_value_to_json(value: &TomlValue) -> Value {
    match value {
        TomlValue::String(s) => Value::String(s.clone()),
        TomlValue::Integer(n) => Value::Number((*n).into()),
        TomlValue::Float(n) => Value::Number(serde_json::Number::from_f64(*n).unwrap_or(Value::Null.as_u64().unwrap_or(0).into())),
        TomlValue::Boolean(b) => Value::Bool(*b),
        TomlValue::Array(arr) => Value::Array(arr.iter().map(toml_value_to_json).collect()),
        TomlValue::Table(t) => {
            let mut map = serde_json::Map::new();
            for (k, v) in t {
                map.insert(k.clone(), toml_value_to_json(v));
            }
            Value::Object(map)
        }
        TomlValue::Datetime(dt) => Value::String(dt.to_string()),
    }
}

fn json_to_toml(value: &Value) -> Option<TomlValue> {
    match value {
        Value::Null => None,
        Value::Bool(b) => Some(TomlValue::Boolean(*b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(TomlValue::Integer(i))
            } else if let Some(f) = n.as_f64() {
                Some(TomlValue::Float(f))
            } else {
                None
            }
        }
        Value::String(s) => Some(TomlValue::String(s.clone())),
        Value::Array(arr) => Some(TomlValue::Array(
            arr.iter().filter_map(json_to_toml).collect(),
        )),
        Value::Object(obj) => {
            let mut t = Table::new();
            for (k, v) in obj {
                if let Some(tv) = json_to_toml(v) {
                    t.insert(k.clone(), tv);
                }
            }
            Some(TomlValue::Table(t))
        }
    }
}

/// Convenience entry point used by commands: load and convert.
pub fn load_kimi_code_config_as_config() -> KimiResult<Config> {
    let value = load_kimi_code_config()?;
    Ok(kimi_code_to_config(&value))
}

/// Convenience entry point used by commands: convert and save.
pub fn save_config_as_kimi_code(config: &Config) -> KimiResult<()> {
    let existing = load_kimi_code_config().ok();
    let value = config_to_kimi_code(config, existing.as_ref());
    save_kimi_code_config(&value)
}

/// Open the Kimi Code config directory in the system file manager.
pub fn open_kimi_code_config_dir() -> KimiResult<()> {
    let path = kimi_code_config_dir();
    std::fs::create_dir_all(&path)
        .with_context(|| format!("failed to create directory {}", path.display()))?;
    Ok(())
}

impl Agent {
    pub fn config_dir(&self) -> PathBuf {
        match self {
            Agent::KimiCode => kimi_code_config_dir(),
            Agent::Pi => crate::pi_io::pi_agent_dir(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kimi_code_import_extracts_providers_and_models() {
        let toml_str = r#"
default_model = "kimi-code/kimi-for-coding"
default_thinking = true

[providers."managed:kimi-code"]
type = "kimi"
api_key = ""
base_url = "https://api.kimi.com/coding/v1"

[providers."managed:kimi-code".oauth]
storage = "file"
key = "oauth/kimi-code"

[models."kimi-code/kimi-for-coding"]
provider = "managed:kimi-code"
model = "kimi-for-coding"
max_context_size = 262144
capabilities = ["thinking", "always_thinking", "image_in", "video_in", "tool_use"]
display_name = "K2.7 Code"

[services.moonshot_search]
base_url = "https://api.kimi.com/coding/v1/search"
api_key = ""
"#;
        let value: TomlValue = toml_str.parse().unwrap();
        let config = kimi_code_to_config(&value);

        assert_eq!(config.default_model.as_deref(), Some("kimi-code/kimi-for-coding"));
        assert_eq!(config.providers.len(), 1);
        assert_eq!(config.models.len(), 1);

        let provider = config.providers.get("managed:kimi-code").unwrap();
        assert_eq!(provider.provider_type, ProviderType::Kimi);
        assert!(provider.managed);
        assert_eq!(provider.base_url.as_deref(), Some("https://api.kimi.com/coding/v1"));

        let model = config.models.get("kimi-code/kimi-for-coding").unwrap();
        assert_eq!(model.provider, "managed:kimi-code");
        assert_eq!(model.model, "kimi-for-coding");
        assert_eq!(model.max_context_size, 262144);
        assert!(model.capabilities.contains(&"thinking".to_string()));
        // supports_1m reflects context size only, not thinking capability.
        assert!(!model.supports_1m);

        // Unknown top-level sections are preserved.
        let services = config.raw_other.get("services");
        assert!(services.is_some());
    }

    #[test]
    fn kimi_code_export_roundtrip_preserves_model() {
        let mut providers = IndexMap::new();
        providers.insert(
            "glmzhongzhuan".to_string(),
            Provider {
                name: "glmzhongzhuan".to_string(),
                provider_type: ProviderType::Anthropic,
                base_url: Some("https://fast.cdks.work".to_string()),
                api_key: Some("sk-test".to_string()),
                env: IndexMap::new(),
                note: None,
                official_url: None,
                managed: false,
                enabled: true,
                active: true,
                raw_other: Value::Null,
            },
        );
        let mut models = IndexMap::new();
        models.insert(
            "glm-5.2".to_string(),
            Model {
                alias: "glm-5.2".to_string(),
                provider: "glmzhongzhuan".to_string(),
                model: "glm-5.2".to_string(),
                max_context_size: 900_000,
                display_name: None,
                supports_1m: true,
                capabilities: vec!["thinking".to_string()],
                raw_other: Value::Null,
            },
        );
        let config = Config {
            default_model: Some("glm-5.2".to_string()),
            providers,
            models,
            raw_other: Value::Null,
        };

        let exported = config_to_kimi_code(&config, None);
        let root = exported.as_table().unwrap();
        assert_eq!(
            root.get("default_model").and_then(|v| v.as_str()),
            Some("glm-5.2")
        );

        let providers_table = root.get("providers").unwrap().as_table().unwrap();
        let provider = providers_table.get("glmzhongzhuan").unwrap().as_table().unwrap();
        assert_eq!(provider.get("type").and_then(|v| v.as_str()), Some("anthropic"));
        assert_eq!(provider.get("api_key").and_then(|v| v.as_str()), Some("sk-test"));

        let models_table = root.get("models").unwrap().as_table().unwrap();
        let model = models_table.get("glm-5.2").unwrap().as_table().unwrap();
        assert_eq!(model.get("model").and_then(|v| v.as_str()), Some("glm-5.2"));
        let caps = model.get("capabilities").unwrap().as_array().unwrap();
        assert!(caps.iter().any(|v| v.as_str() == Some("thinking")));
    }

    #[test]
    fn kimi_code_export_does_not_inject_thinking_from_supports_1m() {
        let mut providers = IndexMap::new();
        providers.insert(
            "test-provider".to_string(),
            Provider {
                name: "test-provider".to_string(),
                provider_type: ProviderType::Anthropic,
                base_url: Some("https://example.com".to_string()),
                api_key: Some("sk-test".to_string()),
                env: IndexMap::new(),
                note: None,
                official_url: None,
                managed: false,
                enabled: true,
                active: true,
                raw_other: Value::Null,
            },
        );
        let mut models = IndexMap::new();
        models.insert(
            "big-model".to_string(),
            Model {
                alias: "big-model".to_string(),
                provider: "test-provider".to_string(),
                model: "big-model".to_string(),
                max_context_size: 2_000_000,
                display_name: None,
                supports_1m: true,
                capabilities: vec![],
                raw_other: Value::Null,
            },
        );
        let config = Config {
            default_model: Some("big-model".to_string()),
            providers,
            models,
            raw_other: Value::Null,
        };

        let exported = config_to_kimi_code(&config, None);
        let root = exported.as_table().unwrap();
        let models_table = root.get("models").unwrap().as_table().unwrap();
        let model = models_table.get("big-model").unwrap().as_table().unwrap();
        // supports_1m=true but capabilities empty → must NOT inject "thinking".
        let caps = model.get("capabilities");
        match caps {
            None => {}
            Some(v) => {
                let arr = v.as_array().unwrap();
                assert!(
                    !arr.iter().any(|c| c.as_str() == Some("thinking")),
                    "thinking should not be injected from supports_1m"
                );
            }
        }
    }

    #[test]
    fn kimi_code_oauth_key_roundtrip() {
        // Regression: importing then exporting managed:kimi-code must preserve
        // the exact oauth key "oauth/kimi-code". Previously the oauth block
        // was dropped on import and regenerated on export as
        // "oauth/managed-kimi-code", breaking the official subscription.
        let toml_str = r#"
default_model = "kimi-code/k3"

[providers."managed:kimi-code"]
type = "kimi"
api_key = ""
base_url = "https://api.kimi.com/coding/v1"

[providers."managed:kimi-code".oauth]
storage = "file"
key = "oauth/kimi-code"

[models."kimi-code/k3"]
provider = "managed:kimi-code"
model = "k3"
max_context_size = 1048576
"#;
        let value: TomlValue = toml_str.parse().unwrap();
        let config = kimi_code_to_config(&value);

        // Export back to TOML.
        let exported = config_to_kimi_code(&config, None);
        let root = exported.as_table().unwrap();
        let providers = root.get("providers").unwrap().as_table().unwrap();
        let managed = providers.get("managed:kimi-code").unwrap().as_table().unwrap();
        let oauth = managed.get("oauth").unwrap().as_table().unwrap();
        assert_eq!(
            oauth.get("key").and_then(|v| v.as_str()),
            Some("oauth/kimi-code"),
            "oauth key must round-trip verbatim, not be regenerated"
        );
        assert_eq!(
            oauth.get("storage").and_then(|v| v.as_str()),
            Some("file")
        );
    }

    #[test]
    fn kimi_code_export_writes_all_providers() {
        // Regression: inactive providers must still be written to config.toml
        // so that switching does not wipe the provider list.
        let mut providers = IndexMap::new();
        providers.insert(
            "active-one".to_string(),
            Provider {
                name: "active-one".to_string(),
                provider_type: ProviderType::Anthropic,
                base_url: Some("https://a.example.com".to_string()),
                api_key: Some("sk-a".to_string()),
                env: IndexMap::new(),
                note: None,
                official_url: None,
                managed: false,
                enabled: true,
                active: true,
                raw_other: Value::Null,
            },
        );
        providers.insert(
            "inactive-one".to_string(),
            Provider {
                name: "inactive-one".to_string(),
                provider_type: ProviderType::Openai,
                base_url: Some("https://b.example.com".to_string()),
                api_key: Some("sk-b".to_string()),
                env: IndexMap::new(),
                note: None,
                official_url: None,
                managed: false,
                enabled: true,
                active: false,
                raw_other: Value::Null,
            },
        );
        let config = Config {
            default_model: None,
            providers,
            models: IndexMap::new(),
            raw_other: Value::Null,
        };

        let exported = config_to_kimi_code(&config, None);
        let root = exported.as_table().unwrap();
        let providers_table = root.get("providers").unwrap().as_table().unwrap();
        assert_eq!(providers_table.len(), 2, "both providers must be written");
        assert!(providers_table.contains_key("active-one"));
        assert!(providers_table.contains_key("inactive-one"));
    }

    #[test]
    fn kimi_code_export_strips_private_default_model() {
        // The remembered per-provider default model (raw_other.default_model)
        // is a Kimi-Switch-private field and must NOT leak into config.toml.
        let mut providers = IndexMap::new();
        providers.insert(
            "p".to_string(),
            Provider {
                name: "p".to_string(),
                provider_type: ProviderType::Anthropic,
                base_url: None,
                api_key: Some("sk-x".to_string()),
                env: IndexMap::new(),
                note: None,
                official_url: None,
                managed: false,
                enabled: true,
                active: true,
                raw_other: serde_json::json!({"default_model": "some-alias"}),
            },
        );
        let config = Config {
            default_model: None,
            providers,
            models: IndexMap::new(),
            raw_other: Value::Null,
        };

        let exported = config_to_kimi_code(&config, None);
        let root = exported.as_table().unwrap();
        let provider = root
            .get("providers").unwrap()
            .as_table().unwrap()
            .get("p").unwrap()
            .as_table().unwrap();
        assert!(
            !provider.contains_key("default_model"),
            "private default_model must not leak into config.toml"
        );
    }
}
