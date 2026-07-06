use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
pub use toml_edit::Table;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    Kimi,
    Anthropic,
    Openai,
    #[serde(rename = "openai_responses")]
    OpenaiResponses,
    #[serde(rename = "google-genai")]
    GoogleGenai,
    Vertexai,
}

impl ProviderType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderType::Kimi => "kimi",
            ProviderType::Anthropic => "anthropic",
            ProviderType::Openai => "openai",
            ProviderType::OpenaiResponses => "openai_responses",
            ProviderType::GoogleGenai => "google-genai",
            ProviderType::Vertexai => "vertexai",
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Provider {
    pub name: String,
    pub provider_type: ProviderType,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub env: IndexMap<String, String>,
    #[serde(skip)]
    pub raw_other: Table,
}

impl std::fmt::Debug for Provider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Provider")
            .field("name", &self.name)
            .field("provider_type", &self.provider_type)
            .field("base_url", &self.base_url)
            .field("api_key", &"<redacted>")
            .field("env", &"<redacted>")
            .field("raw_other", &"<table>")
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub alias: String,
    pub provider: String,
    pub model: String,
    pub max_context_size: u64,
    pub display_name: Option<String>,
    #[serde(skip)]
    pub raw_other: Table,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Config {
    pub default_model: Option<String>,
    pub providers: IndexMap<String, Provider>,
    pub models: IndexMap<String, Model>,
    #[serde(skip)]
    pub raw_other: Table,
}

impl std::fmt::Debug for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("default_model", &self.default_model)
            .field("providers", &format!("{} providers", self.providers.len()))
            .field("models", &self.models)
            .field("raw_other", &"<table>")
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileSummary {
    pub name: String,
    pub filename: String,
    pub is_active: bool,
}

#[derive(Debug, Clone)]
pub struct Profile {
    pub name: String,
    pub filename: String,
    pub config: Config,
    pub is_active: bool,
}
