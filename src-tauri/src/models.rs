use std::borrow::Cow;

use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

/// Target agent whose provider/model config is being edited.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Agent {
    KimiCode,
    Pi,
}

impl Agent {
    pub fn as_str(&self) -> &'static str {
        match self {
            Agent::KimiCode => "kimi_code",
            Agent::Pi => "pi",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderType {
    Anthropic,
    Openai,
    OpenaiResponses,
    GoogleGenai,
    Vertexai,
    /// Kept for compatibility; mapped to OpenAI-compatible in Pi.
    Kimi,
    /// A provider type string the CLI knows but Kimi Switch does not.
    /// Kept verbatim so new upstream `type` values survive the round-trip
    /// instead of being rewritten to "kimi".
    Unknown(String),
}

// Serde is hand-written to keep a pure string wire format: known variants
// map to their CLI string, `Unknown(s)` maps to `s` itself. A derived
// representation would expose the internal variant names.
impl Serialize for ProviderType {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.as_str())
    }
}

impl<'de> Deserialize<'de> for ProviderType {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Ok(ProviderType::from_kimi_type(&s))
    }
}

const fn default_true() -> bool {
    true
}

impl ProviderType {
    pub fn as_str(&self) -> Cow<'static, str> {
        match self {
            ProviderType::Anthropic => Cow::Borrowed("anthropic"),
            ProviderType::Openai => Cow::Borrowed("openai"),
            ProviderType::OpenaiResponses => Cow::Borrowed("openai_responses"),
            ProviderType::GoogleGenai => Cow::Borrowed("google-genai"),
            ProviderType::Vertexai => Cow::Borrowed("vertexai"),
            ProviderType::Kimi => Cow::Borrowed("kimi"),
            ProviderType::Unknown(s) => Cow::Owned(s.clone()),
        }
    }

    /// Map a CLI `type` string to a `ProviderType`; unrecognized values
    /// become `Unknown(s)` so the original string round-trips on export.
    pub fn from_kimi_type(s: &str) -> ProviderType {
        match s {
            "anthropic" => ProviderType::Anthropic,
            "openai" => ProviderType::Openai,
            "openai_responses" => ProviderType::OpenaiResponses,
            "google-genai" => ProviderType::GoogleGenai,
            "vertexai" => ProviderType::Vertexai,
            "kimi" => ProviderType::Kimi,
            other => ProviderType::Unknown(other.to_string()),
        }
    }

    pub fn default_base_url(&self) -> Option<&'static str> {
        match self {
            ProviderType::Openai | ProviderType::OpenaiResponses | ProviderType::Kimi => {
                Some("https://api.openai.com/v1")
            }
            ProviderType::GoogleGenai => Some("https://generativelanguage.googleapis.com"),
            ProviderType::Anthropic | ProviderType::Vertexai | ProviderType::Unknown(_) => None,
        }
    }

    pub fn is_openai_compatible(&self) -> bool {
        matches!(
            self,
            ProviderType::Kimi | ProviderType::Openai | ProviderType::OpenaiResponses
        )
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Provider {
    pub name: String,
    pub provider_type: ProviderType,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    #[serde(default)]
    pub env: IndexMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub official_url: Option<String>,
    #[serde(default)]
    pub managed: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_color: Option<String>,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub raw_other: Value,
    /// Billing/usage query kinds for this provider (e.g. "balance:deepseek",
    /// "plan:kimi_coding"). Persisted in the SQLite settings table under
    /// `usage_kinds:<provider_name>`, NOT in the agent's config.toml — both
    /// export paths (kimi_code_io manual TOML, pi_io PiProvider struct) are
    /// explicit and never serialize this field, while the IPC payload to the
    /// frontend does carry it. Renamed to camelCase to match the TS
    /// `Provider.usageKinds` field — without the rename the frontend reads
    /// `undefined` and no usage footer ever renders.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "usageKinds")]
    pub usage_kinds: Option<Vec<String>>,
    /// Usage query configuration (template, credentials, auto interval),
    /// edited via the "配置用量查询" panel. Same persistence strategy as
    /// `usage_kinds`: SQLite settings `usage_config:<provider_name>`, never
    /// config.toml; IPC carries it as camelCase.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "usageConfig")]
    pub usage_config: Option<UsageConfig>,
}

impl PartialEq for Provider {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name
            && self.provider_type == other.provider_type
            && self.base_url == other.base_url
            && self.api_key == other.api_key
            && self.env == other.env
            && self.note == other.note
            && self.official_url == other.official_url
            && self.managed == other.managed
            && self.enabled == other.enabled
            && self.active == other.active
            && self.icon == other.icon
            && self.icon_color == other.icon_color
            && self.raw_other == other.raw_other
            && self.usage_kinds == other.usage_kinds
            && self.usage_config == other.usage_config
    }
}

impl Eq for Provider {}

impl std::fmt::Debug for Provider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Provider")
            .field("name", &self.name)
            .field("provider_type", &self.provider_type)
            .field("base_url", &self.base_url)
            .field("api_key", &"<redacted>")
            .field("env", &"<redacted>")
            .field("managed", &self.managed)
            .field("enabled", &self.enabled)
            .field("active", &self.active)
            .field("icon", &self.icon)
            .field("icon_color", &self.icon_color)
            .field("raw_other", &"<json>")
            .finish()
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Model {
    pub alias: String,
    pub provider: String,
    pub model: String,
    pub max_context_size: u64,
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub supports_1m: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub raw_other: Value,
}

impl std::fmt::Debug for Model {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Model")
            .field("alias", &self.alias)
            .field("provider", &self.provider)
            .field("model", &self.model)
            .field("max_context_size", &self.max_context_size)
            .field("display_name", &self.display_name)
            .field("supports_1m", &self.supports_1m)
            .field("capabilities", &self.capabilities)
            .field("raw_other", &"<json>")
            .finish()
    }
}

impl PartialEq for Model {
    fn eq(&self, other: &Self) -> bool {
        self.alias == other.alias
            && self.provider == other.provider
            && self.model == other.model
            && self.max_context_size == other.max_context_size
            && self.display_name == other.display_name
            && self.supports_1m == other.supports_1m
            && self.capabilities == other.capabilities
            && self.raw_other == other.raw_other
    }
}

impl Eq for Model {}

#[derive(Clone, Serialize, Deserialize)]
pub struct Config {
    pub default_model: Option<String>,
    #[serde(default)]
    pub providers: IndexMap<String, Provider>,
    #[serde(default)]
    pub models: IndexMap<String, Model>,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub raw_other: Value,
    /// Top-level section keys captured at import time. Export uses this
    /// baseline to distinguish "user removed this section in the UI" from
    /// "the CLI added this section after we imported" — only baseline keys
    /// absent from the current raw_other are dropped on export.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub imported_section_keys: Vec<String>,
}

impl PartialEq for Config {
    fn eq(&self, other: &Self) -> bool {
        self.default_model == other.default_model
            && self.providers == other.providers
            && self.models == other.models
            && self.raw_other == other.raw_other
            && self.imported_section_keys == other.imported_section_keys
    }
}

impl Eq for Config {}

/// Usage query configuration edited via the "配置用量查询" panel.
/// Mirrors cc-switch's `UsageScript` but trimmed to what Kimi Switch supports:
/// auto-detected kinds plus the NewAPI/OneAPI template. Serialized camelCase
/// to match the TS `UsageConfig` interface; persisted in SQLite settings, never
/// in the agent's config.toml.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageConfig {
    /// Whether usage queries run for this provider at all.
    pub enabled: bool,
    /// "auto" = query the kinds in `usage_kinds` / host detection;
    /// "newapi" = query a NewAPI/OneAPI gateway with accessToken + userId.
    pub template_type: String,
    /// NewAPI query base URL (falls back to the provider's base_url).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// NewAPI web-console access token (NOT the sk- inference key).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    /// NewAPI user id, sent as the `New-Api-User` header.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// Auto query interval in minutes; 0/None = manual refresh only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_query_interval_minutes: Option<u32>,
    /// Per-request timeout in seconds; 0/None = default (8s).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
}

impl UsageConfig {
    pub const TEMPLATE_AUTO: &'static str = "auto";
    pub const TEMPLATE_NEWAPI: &'static str = "newapi";
}

impl std::fmt::Debug for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("default_model", &self.default_model)
            .field(
                "providers",
                &format!(
                    "{:?} ({} providers)",
                    self.providers.keys().collect::<Vec<_>>(),
                    self.providers.len()
                ),
            )
            .field("models", &self.models)
            .field("raw_other", &"<json>")
            .finish()
    }
}

/// A model discovered from a provider's API endpoint.
/// The frontend uses this to populate a `Model` form entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscoveredModel {
    pub id: String,
    pub display_name: Option<String>,
    pub max_context_size: Option<u64>,
}
