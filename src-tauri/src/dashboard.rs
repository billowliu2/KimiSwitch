use chrono::{DateTime, Datelike, Local, TimeZone};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use walkdir::WalkDir;

// ---------------------------------------------------------------------------
// Types – match the Node API JSON shape exactly
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PathsResult {
    pub current: String,
    pub valid: bool,
    pub candidates: Vec<PathCandidate>,
    pub env: EnvInfo,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PathCandidate {
    pub path: String,
    pub valid: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvInfo {
    #[serde(rename = "KIMI_CODE_HOME")]
    pub kimi_code_home: Option<String>,
    #[serde(rename = "KIMI_MODEL_NAME")]
    pub kimi_model_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PriceRow {
    pub id: String,
    pub cache_hit: f64,
    pub input: f64,
    pub output: f64,
    pub context: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PricesResult {
    pub prices: Vec<PriceRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResult {
    pub home: String,
    pub valid: bool,
    pub scanned_at: u64,
    pub meta: ScanMeta,
    pub model_map: ModelMapInfo,
    pub range: String,
    pub stats: RangeStats,
    pub heatmap: HeatmapData,
    pub all_models: Vec<AllModelRow>,
    pub all_model_count: usize,
    pub range_totals: HashMap<String, TotalsRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanMeta {
    pub files_scanned: usize,
    pub lines_seen: usize,
    pub record_count: usize,
    pub home: String,
    pub sessions_root: String,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelMapInfo {
    pub default_model: Option<String>,
    pub env_model: Option<EnvModelInfo>,
    pub alias_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnvModelInfo {
    pub name: String,
    pub provider: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RangeStats {
    pub range: String,
    pub totals: TotalsRow,
    pub daily: Vec<DailyRow>,
    pub models: Vec<ModelRow>,
    pub recent: Vec<RecentRow>,
    pub recent_total: usize,
    pub recent_limit: usize,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TotalsRow {
    pub requests: usize,
    pub input_other: u64,
    pub output: u64,
    pub input_cache_read: u64,
    pub input_cache_creation: u64,
    pub cost_usd: f64,
    pub total_tokens: u64,
    pub cache_hit_rate: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailyRow {
    pub date: String,
    pub requests: usize,
    pub input_other: u64,
    pub output: u64,
    pub input_cache_read: u64,
    pub input_cache_creation: u64,
    pub cost_usd: f64,
    pub total_tokens: u64,
    pub cache_hit_rate: f64,
    /// Per-model token breakdown for stacked-bar rendering
    pub by_model: HashMap<String, u64>,
    /// Per-provider token breakdown for stacked-bar rendering
    pub by_provider: HashMap<String, u64>,
    /// Per-provider, per-model nested token breakdown (provider → model → tokens),
    /// used by the provider-tab drill-down detail.
    pub by_provider_model: HashMap<String, HashMap<String, u64>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelRow {
    pub model: String,
    pub model_display: String,
    pub model_resolved: String,
    pub price_id: String,
    pub cost_estimated: bool,
    /// True when any aggregated record came from a subagent request (Kimi Code
    /// `__secondary__` marker, resolved to the configured secondary model).
    pub is_secondary: bool,
    pub requests: usize,
    pub input_other: u64,
    pub output: u64,
    pub input_cache_read: u64,
    pub input_cache_creation: u64,
    pub cost_usd: f64,
    pub total_tokens: u64,
    pub cache_hit_rate: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecentRow {
    pub time: u64,
    pub model: String,
    pub model_display: String,
    pub model_resolved: String,
    pub input_other: u64,
    pub output: u64,
    pub input_cache_read: u64,
    pub input_cache_creation: u64,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub cost_estimated: bool,
    pub price_id: String,
    pub from_env: bool,
    /// True when the record is a subagent request bound to the configured
    /// secondary model (Kimi Code `__secondary__` marker).
    pub is_secondary: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AllModelRow {
    pub model: String,
    pub model_display: String,
    pub requests: usize,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub cost_estimated: bool,
    pub cache_hit_rate: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapData {
    pub weeks: usize,
    pub start: String,
    pub end: String,
    pub max_tokens: u64,
    pub cells: Vec<HeatmapCell>,
    pub month_labels: Vec<MonthLabel>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapCell {
    pub date: String,
    pub dow: usize,
    pub week_index: usize,
    pub requests: usize,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub cache_hit_rate: f64,
    pub level: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonthLabel {
    pub week_index: usize,
    pub label: String,
}

// Sessions types
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionsResult {
    pub home: String,
    pub archive_root: String,
    pub workspaces: Vec<WorkspaceRow>,
    pub sessions: Vec<SessionRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRow {
    pub id: String,
    pub name: String,
    pub root: Option<String>,
    pub created_at: Option<String>,
    pub last_opened_at: Option<String>,
    pub active_count: usize,
    pub archived_count: usize,
    pub empty: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub id: String,
    pub workspace_id: String,
    pub status: String,
    pub title: Option<String>,
    pub work_dir: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub bytes: u64,
    pub files: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActionResponse {
    pub ok: bool,
    pub workspace_id: String,
    pub session_id: String,
    pub status: Option<String>,
    pub path: Option<String>,
    pub deleted: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub workspace_id: String,
    pub session_id: String,
    pub status: String,
    pub title: Option<String>,
    pub work_dir: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub message_count: usize,
    pub truncated: bool,
    pub messages: Vec<PreviewMessage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PreviewMessage {
    pub role: String,
    pub time: Option<u64>,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDeleteBody {
    pub workspace_id: String,
    pub confirm: Option<bool>,
    pub force: Option<bool>,
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
pub struct AppState {
    pub scan_cache: Mutex<ScanCache>,
}

#[derive(Clone)]
pub struct ScanCache {
    pub home: String,
    pub scanned_at: u64,
    pub records: Vec<UsageRecord>,
    pub meta: ScanMeta,
    pub model_map: ModelMapInfo,
}

#[derive(Debug, Clone)]
pub struct UsageRecord {
    pub time: u64,
    pub model: String,
    pub input_other: u64,
    pub output: u64,
    pub input_cache_read: u64,
    pub input_cache_creation: u64,
    pub cost_usd: f64,
    pub cost_estimated: bool,
    pub price_id: String,
    pub model_resolved: String,
    pub model_display: String,
    pub provider: Option<String>,
    pub from_env: bool,
    /// True when the record is a subagent request bound to the configured
    /// secondary model (Kimi Code `__secondary__` marker).
    pub is_secondary: bool,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn resolve_kimi_home(override_path: Option<String>) -> PathBuf {
    if let Some(p) = override_path {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    if let Ok(env_home) = std::env::var("KIMI_CODE_HOME") {
        if !env_home.trim().is_empty() {
            return PathBuf::from(env_home);
        }
    }
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".kimi-code")
}

fn is_kimi_home(dir: &Path) -> bool {
    if !dir.exists() || !dir.is_dir() {
        return false;
    }
    dir.join("config.toml").exists() || dir.join("sessions").exists()
}

/// Build a legacy alias→provider map by merging the current config.toml with every
/// `config.toml.bak.*` snapshot (home root + backups/). Historical usage records may
/// reference model aliases that no longer exist in the current config (old bare or
/// `-N`-suffixed aliases); their provider is recovered from these snapshots.
fn build_alias_provider_map(home: &Path) -> HashMap<String, String> {
    let mut map: HashMap<String, String> = HashMap::new();
    let mut candidates: Vec<PathBuf> = Vec::new();
    let current = home.join("config.toml");
    if current.is_file() {
        candidates.push(current);
    }
    for dir in [home.to_path_buf(), home.join("backups")] {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with("config.toml.bak.") {
                    candidates.push(e.path());
                }
            }
        }
    }
    for path in candidates {
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let parsed: toml::Value = match toml::from_str(&content) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(models) = parsed.get("models").and_then(|m| m.as_table()) {
            for (alias, m) in models {
                if let Some(p) = m.get("provider").and_then(|p| p.as_str()) {
                    // Current config is parsed first and wins on conflict.
                    map.entry(alias.clone()).or_insert_with(|| p.to_string());
                }
            }
        }
    }
    map
}

/// Read `[secondary_model] model` from the Kimi Code config.toml — the alias
/// subagents bind to when the experimental secondary-model feature is on.
/// Kimi Code emits usage records with the internal marker `__secondary__` for
/// those requests; the marker is resolved to this alias so prices and display
/// line up with the actual model.
fn read_secondary_model_alias(home: &Path) -> Option<String> {
    let path = home.join("config.toml");
    if !path.is_file() {
        return None;
    }
    let content = std::fs::read_to_string(&path).ok()?;
    let parsed: toml::Value = toml::from_str(&content).ok()?;
    parsed
        .get("secondary_model")
        .and_then(|s| s.get("model"))
        .and_then(|m| m.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// Resolve the provider for a usage record's raw model key: prefer the `provider/`
/// prefix, then fall back to the legacy alias→provider map (config + backups).
fn resolve_provider(model_raw: &str, map: &HashMap<String, String>) -> Option<String> {
    let p = model_raw
        .rsplit_once('/')
        .map(|(prov, _)| prov.to_string())
        .or_else(|| map.get(model_raw).cloned());
    p.map(|x| normalize_provider(&x))
}

/// Normalize historical provider-name variants to the canonical name.
fn normalize_provider(p: &str) -> String {
    match p {
        "CodingPlanSite" => "CodingPlan.site".to_string(),
        other => other.to_string(),
    }
}

fn sessions_root(home: &Path) -> PathBuf {
    home.join("sessions")
}

fn workspace_re() -> Regex {
    Regex::new(r"^wd_[A-Za-z0-9._-]+$").unwrap()
}

fn session_re() -> Regex {
    Regex::new(r"^session_[0-9a-fA-F-]{8,}$").unwrap()
}

fn safe_read_dir(path: &Path) -> Vec<fs::DirEntry> {
    let mut entries = Vec::new();
    if let Ok(rd) = fs::read_dir(path) {
        for e in rd.flatten() {
            entries.push(e);
        }
    }
    entries
}

fn file_size_approx(path: &Path) -> (u64, usize) {
    let mut total_bytes = 0u64;
    let mut total_files = 0usize;
    for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                total_bytes += meta.len();
                total_files += 1;
            }
        }
    }
    (total_bytes, total_files)
}

fn day_key(ts_ms: u64) -> String {
    let secs = if ts_ms > 1e12 as u64 { ts_ms / 1000 } else { ts_ms };
    // Bucket by LOCAL calendar date (not UTC) so records around midnight stay on the correct day.
    let local = Local
        .timestamp_opt(secs as i64, 0)
        .single()
        .unwrap_or_else(|| DateTime::from_timestamp(secs as i64, 0).unwrap_or_default().with_timezone(&Local));
    format!("{:04}-{:02}-{:02}", local.year(), local.month(), local.day())
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

fn list_prices() -> Vec<PriceRow> {
    vec![
        PriceRow { id: "kimi-k3".into(), cache_hit: 0.30, input: 3.00, output: 15.00, context: 1_048_576 },
        PriceRow { id: "kimi-k2.7-code".into(), cache_hit: 0.19, input: 0.95, output: 4.00, context: 262_144 },
        PriceRow { id: "kimi-k2.6".into(), cache_hit: 0.16, input: 0.95, output: 4.00, context: 262_144 },
        PriceRow { id: "kimi-k2.5".into(), cache_hit: 0.10, input: 0.60, output: 3.00, context: 262_144 },
        PriceRow { id: "kimi-k2-turbo".into(), cache_hit: 0.15, input: 1.15, output: 8.00, context: 262_144 },
        PriceRow { id: "kimi-k2".into(), cache_hit: 0.15, input: 0.60, output: 2.50, context: 262_144 },
    ]
}

/// Per-model price from the models.dev snapshot (all values in $/M tokens).
#[derive(Debug, Clone, Copy)]
struct ModelsDevCost {
    input: f64,
    output: f64,
    cache_read: f64,
    /// None = models.dev has no cache_write field → caller falls back to input.
    cache_write: Option<f64>,
}

/// Compiled-in models.dev snapshot (`src/lib/models-dev.json`, generated by
/// scripts/fetch-models-dev.mjs before every build via the `pretauri` hook).
/// Keyed by "<provider>/<model>", lowercased.
const MODELS_DEV_SNAPSHOT: &str = include_str!("../../src/lib/models-dev.json");

fn models_dev_cost_index() -> &'static HashMap<String, ModelsDevCost> {
    static INDEX: OnceLock<HashMap<String, ModelsDevCost>> = OnceLock::new();
    INDEX.get_or_init(|| {
        let mut map = HashMap::new();
        let Ok(v) = serde_json::from_str::<serde_json::Value>(MODELS_DEV_SNAPSHOT) else {
            return map;
        };
        let Some(obj) = v.as_object() else {
            return map;
        };
        for (key, entry) in obj {
            // Skip the "last_updated" metadata key and entries without cost.
            if !entry.is_object() || entry.get("cost").is_none() {
                continue;
            }
            let Some(cost) = entry.get("cost").and_then(|c| c.as_object()) else {
                continue;
            };
            let num = |k: &str| cost.get(k).and_then(|x| x.as_f64());
            let (Some(input), Some(output)) = (num("input"), num("output")) else {
                continue;
            };
            map.insert(
                key.to_ascii_lowercase(),
                ModelsDevCost {
                    input,
                    output,
                    cache_read: num("cache_read").unwrap_or(0.0),
                    cache_write: num("cache_write"),
                },
            );
        }
        map
    })
}

/// Warm the compiled-in models.dev price index off the first dashboard open:
/// parsing the ~1.3 MB snapshot costs tens of milliseconds, so build it on a
/// background thread at startup instead of lazily on the first get_summary.
pub fn warm_price_index() {
    std::thread::spawn(|| {
        let _ = models_dev_cost_index();
    });
}

/// Official providers take precedence over resellers when the same model id
/// ships under multiple providers and no provider prefix disambiguates.
const OFFICIAL_PROVIDERS: &[&str] = &[
    "openai", "anthropic", "google", "deepseek", "moonshotai", "zhipuai",
    "minimax", "x-ai", "meta", "mistral", "qwen", "doubao", "volcengine",
    "baidu", "tencent", "nvidia",
];

fn provider_rank(key: &str) -> usize {
    // key = "<provider>/<model>"
    let provider = key.split('/').next().unwrap_or("");
    OFFICIAL_PROVIDERS
        .iter()
        .position(|p| *p == provider)
        .unwrap_or(usize::MAX)
}

/// Look up a model's price in the models.dev snapshot. Resolution order:
/// 1. exact key match (e.g. "moonshotai/kimi-k2.5" passed verbatim),
/// 2. suffix match on the bare model id, preferring an exact provider prefix,
///    then an official provider, then lexicographically smallest key
///    (deterministic tie-break). Returns None when nothing matches.
fn models_dev_lookup(model_name: &str) -> Option<(String, ModelsDevCost)> {
    let lower = model_name.to_ascii_lowercase();
    if let Some(cost) = models_dev_cost_index().get(&lower) {
        return Some((lower, *cost));
    }
    let bare = model_name.rsplit_once('/').map(|(_, b)| b).unwrap_or(model_name);
    let bare_l = bare.to_ascii_lowercase();
    // Match on the model part after the last '/', not the full key: aliases
    // strip the family prefix (record "k2.5" vs models.dev "kimi-k2.5").
    let mut matches: Vec<(&String, &ModelsDevCost)> = models_dev_cost_index()
        .iter()
        .filter(|(key, _)| {
            key.rsplit_once('/')
                .map(|(_, model)| model.ends_with(&bare_l))
                .unwrap_or(false)
        })
        .collect();
    if matches.is_empty() {
        return None;
    }
    matches.sort_by(|(a, _), (b, _)| {
        provider_rank(a)
            .cmp(&provider_rank(b))
            .then_with(|| a.cmp(b))
    });
    let (key, cost) = matches[0];
    Some((key.clone(), *cost))
}

/// Strip a trailing derived-variant suffix ("-highspeed", "-free") from a
/// model id: plan endpoints expose e.g. `glm-5.2-highspeed`, which bills at
/// the base model's price.
fn strip_variant_suffix(model_name: &str) -> Option<String> {
    for suffix in ["-highspeed", "-free"] {
        if let Some(base) = model_name.strip_suffix(suffix) {
            if !base.is_empty() {
                return Some(base.to_string());
            }
        }
    }
    None
}

/// Strip a trailing context-size suffix ("-256k", "-128k", "-1m") from a model
/// id: context variants like "k3-256k" bill at the base model's ("k3") price.
/// Returns the stripped id (provider prefix preserved), or None when there is
/// no such suffix.
fn strip_context_suffix(model_name: &str) -> Option<String> {
    let (prefix, bare) = match model_name.rsplit_once('/') {
        Some((p, b)) => (Some(p), b),
        None => (None, model_name),
    };
    let (stem, suffix) = bare.rsplit_once('-')?;
    let digits = suffix.strip_suffix(|c| matches!(c, 'k' | 'K' | 'm' | 'M'))?;
    if stem.is_empty() || digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(match prefix {
        Some(p) => format!("{p}/{stem}"),
        None => stem.to_string(),
    })
}

/// Memoized price resolution. `match_price` is called once per usage record
/// during the scan, and the models.dev suffix scan is O(5910) per miss — with
/// thousands of records sharing a handful of model names, memoizing the result
/// turns the whole scan from O(records × 5910) into O(unique_models × 5910).
static MATCH_PRICE_MEMO: OnceLock<Mutex<HashMap<String, (String, f64, f64, f64, bool)>>> =
    OnceLock::new();

/// Resolve a model's price, caching per-model results (hits and misses).
fn match_price(model_name: &str) -> (String, f64, f64, f64, bool) {
    let key = model_name.to_ascii_lowercase();
    let memo = MATCH_PRICE_MEMO.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(hit) = memo.lock().unwrap().get(&key) {
        return hit.clone();
    }
    let result = match_price_inner(model_name);
    memo.lock().unwrap().insert(key, result.clone());
    result
}

/// Suffix-match a model against the models.dev index, skipping zero-priced
/// (subscription-plan) listings so a paid official entry wins. Used as the
/// fallback when the exact hit resolves to a zero-cost plan entry such as
/// `zhipuai-coding-plan/glm-5.2` or `kimi-for-coding/kimi-for-coding`.
fn priced_suffix_lookup(model_name: &str) -> Option<(String, ModelsDevCost)> {
    let bare = model_name.rsplit_once('/').map(|(_, b)| b).unwrap_or(model_name);
    let bare_l = bare.to_ascii_lowercase();
    let mut matches: Vec<(&String, &ModelsDevCost)> = models_dev_cost_index()
        .iter()
        .filter(|(key, cost)| {
            (cost.input > 0.0 || cost.output > 0.0)
                && key
                    .rsplit_once('/')
                    .map(|(_, model)| model.ends_with(&bare_l))
                    .unwrap_or(false)
        })
        .collect();
    if matches.is_empty() {
        return None;
    }
    matches.sort_by(|(a, _), (b, _)| {
        provider_rank(a)
            .cmp(&provider_rank(b))
            .then_with(|| a.cmp(b))
    });
    let (key, cost) = matches[0];
    Some((key.clone(), *cost))
}

/// Subscription-plan models without any priced counterpart in the snapshot
/// (e.g. the "Kimi For Coding" plan endpoint has no per-token price) bill at
/// the flagship model of the same family for cost estimation.
const PLAN_MODEL_FALLBACK: &[(&str, &str)] = &[
    ("kimi-for-coding", "moonshotai/kimi-k3"),
];

fn match_price_inner(model_name: &str) -> (String, f64, f64, f64, bool) {
    let bare = match model_name.rsplit_once('/') {
        Some((_, b)) => b,
        None => model_name,
    };
    // 1) models.dev snapshot first (authoritative, all providers).
    if let Some((id, c)) = models_dev_lookup(model_name) {
        if c.input > 0.0 || c.output > 0.0 {
            return (id, c.cache_read, c.input, c.output, false);
        }
        // Zero-priced listing (subscription-plan entries such as
        // zhipuai-coding-plan/glm-5.2 or kimi-for-coding/kimi-for-coding):
        // bill at a priced equivalent — the full id first, then derived
        // variants (-highspeed / -free), then the context-size base, then the
        // curated flagship fallback.
        for base in [
            Some(model_name.to_string()),
            strip_variant_suffix(model_name),
            strip_context_suffix(model_name),
        ]
        .into_iter()
        .flatten()
        {
            if let Some((bid, bc)) = priced_suffix_lookup(&base) {
                if bc.input > 0.0 || bc.output > 0.0 {
                    return (bid, bc.cache_read, bc.input, bc.output, false);
                }
            }
        }
        let bare = model_name.rsplit_once('/').map(|(_, b)| b).unwrap_or(model_name);
        let bare_l = bare.to_ascii_lowercase();
        for (plan, flagship) in PLAN_MODEL_FALLBACK {
            if bare_l.contains(plan) {
                if let Some((fid, fc)) = models_dev_lookup(flagship) {
                    return (fid, fc.cache_read, fc.input, fc.output, false);
                }
            }
        }
        return (id, c.cache_read, c.input, c.output, false);
    }
    // 1b) no direct match: retry with the context-size suffix stripped
    // ("k3-256k" → "k3") before falling back to legacy tables.
    if let Some(base) = strip_context_suffix(model_name) {
        if let Some((id, c)) = models_dev_lookup(&base) {
            return (id, c.cache_read, c.input, c.output, false);
        }
    }
    // 1c) still no exact match: fall back to a cross-provider bare-name
    // suffix lookup in the models.dev snapshot. Custom-gateway aliases (e.g.
    // "CodingPlan.site/deepseek-v4-flash", not catalogued in models.dev)
    // then price against the official listing of the same model id.
    if let Some((id, c)) = priced_suffix_lookup(model_name) {
        if c.input > 0.0 || c.output > 0.0 {
            return (id, c.cache_read, c.input, c.output, false);
        }
    }
    // 2) legacy Kimi table (kept as a fallback for names not in models.dev).
    let bare_l = bare.to_ascii_lowercase();
    for p in &list_prices() {
        let id_l = p.id.to_ascii_lowercase();
        if bare_l == id_l || bare_l.contains(&id_l) || id_l.contains(&bare_l) {
            return (p.id.clone(), p.cache_hit, p.input, p.output, false);
        }
    }
    // 3) last-resort estimate.
    ("kimi-k2.6".into(), 0.16, 0.95, 4.00, true)
}

fn cost_for_usage(input_other: u64, output: u64, cache_read: u64, cache_create: u64, model: &str) -> (f64, bool) {
    let (price_id, cache_hit, input_price, output_price, est) = match_price(model);
    // models.dev reports a separate cache_write price; fall back to input when
    // absent (models without a cache_write field bill cache creation at input).
    // Resolve via the matched price id so context-suffix fallbacks (k3-256k →
    // k3) also pick up the base model's cache_write price.
    let cache_write_price = models_dev_lookup(&price_id)
        .and_then(|(_, c)| c.cache_write)
        .unwrap_or(input_price);
    let cost = (input_other as f64 / 1e6) * input_price
        + (cache_read as f64 / 1e6) * cache_hit
        + (cache_create as f64 / 1e6) * cache_write_price
        + (output as f64 / 1e6) * output_price;
    (cost, est)
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/// Settings key caching the last configured secondary-model alias. Historical
/// `__secondary__` usage records carry no model identity, so billing follows
/// the currently configured secondary model; this cache keeps a stable basis
/// even after the secondary config is removed or changed.
const SECONDARY_MODEL_CACHE_KEY: &str = "dashboard.secondary_model_cache";

fn scan_usage(home: &Path) -> (Vec<UsageRecord>, ScanMeta) {
    let root = sessions_root(home);
    let alias2prov = build_alias_provider_map(home);
    // Resolve the `__secondary__` marker (subagent requests bound to the
    // configured secondary model) to the real model alias once per scan.
    // Prefer the current config; fall back to the persisted cache so records
    // keep a stable billing basis after the secondary config is removed or
    // changed. When the config still declares a secondary model, refresh the
    // cache with it.
    let current_secondary = read_secondary_model_alias(home);
    let cached_secondary = crate::db::get_setting_pub(SECONDARY_MODEL_CACHE_KEY)
        .ok()
        .flatten()
        .filter(|s| !s.is_empty());
    let secondary_alias = current_secondary.clone().or(cached_secondary);
    if let Some(alias) = &current_secondary {
        let _ = crate::db::set_setting_pub(SECONDARY_MODEL_CACHE_KEY, alias);
    }
    let mut records = Vec::new();
    let mut files_scanned = 0;
    let mut lines_seen = 0;
    let errors = Vec::new();

    if !root.exists() {
        return (records, ScanMeta {
            files_scanned: 0, lines_seen: 0, record_count: 0,
            home: home.to_string_lossy().to_string(),
            sessions_root: root.to_string_lossy().to_string(),
            errors: vec!["sessions directory not found".into()],
        });
    }

    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_name() != "wire.jsonl" { continue; }
        if !entry.file_type().is_file() { continue; }
        // Skip blob/task directories
        let p = entry.path();
        if p.to_string_lossy().contains("blobs") || p.to_string_lossy().contains("tasks") {
            continue;
        }
        files_scanned += 1;
        let content = match fs::read_to_string(entry.path()) {
            Ok(c) => c,
            Err(_) => continue,
        };
        for line in content.lines() {
            lines_seen += 1;
            if !line.contains("\"usage.record\"") { continue; }
            let obj: serde_json::Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if obj.get("type").and_then(|v| v.as_str()) != Some("usage.record") { continue; }
            let scope = obj.get("usageScope").and_then(|v| v.as_str()).unwrap_or("turn");
            if scope != "turn" { continue; }

            let model_raw = obj.get("model").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
            // Kimi Code writes the internal marker `__secondary__` as the model
            // key for usage records emitted by subagents bound to the
            // configured secondary model. The record stays keyed on that
            // stable marker so historical records keep their semantics if the
            // secondary config changes later; cost billing follows the
            // currently configured secondary model, and the record is flagged
            // is_secondary so the UI shows it as its own "subagent model"
            // entry.
            let is_secondary = model_raw == "__secondary__";
            let from_env = model_raw == "__kimi_env_model__";
            let price_model = if is_secondary {
                secondary_alias.clone().unwrap_or_else(|| model_raw.clone())
            } else {
                model_raw.clone()
            };
            let time = obj.get("time").and_then(|v| v.as_u64()).unwrap_or(0);
            let usage = &obj["usage"];
            let input_other = usage.get("inputOther").and_then(|v| v.as_u64()).unwrap_or(0);
            let output = usage.get("output").and_then(|v| v.as_u64()).unwrap_or(0);
            let cache_read = usage.get("inputCacheRead").and_then(|v| v.as_u64()).unwrap_or(0);
            let cache_create = usage.get("inputCacheCreation").and_then(|v| v.as_u64()).unwrap_or(0);

            // Resolve model display
            let bare = model_raw.rsplit_once('/').map(|x| x.1).unwrap_or(&model_raw);
            let (cost, est) = cost_for_usage(input_other, output, cache_read, cache_create, &price_model);
            // Subagent records are inherently estimates: the `__secondary__`
            // marker carries no model identity, so the cost is flagged as
            // estimated even when the current secondary config resolves to a
            // priced listing.
            let est = est || is_secondary;
            let (pid, _ch, _ip, _op, _) = match_price(&price_model);

            records.push(UsageRecord {
                time,
                model: model_raw.clone(),
                model_resolved: bare.to_string(),
                model_display: model_raw.clone(),
                provider: resolve_provider(&price_model, &alias2prov),
                from_env,
                is_secondary,
                input_other,
                output,
                input_cache_read: cache_read,
                input_cache_creation: cache_create,
                cost_usd: cost,
                cost_estimated: est,
                price_id: pid,
            });
        }
    }

    records.sort_by(|a, b| b.time.cmp(&a.time));
    let count = records.len();
    (records, ScanMeta {
        files_scanned, lines_seen, record_count: count,
        home: home.to_string_lossy().to_string(),
        sessions_root: root.to_string_lossy().to_string(),
        errors: errors.into_iter().take(20).collect(),
    })
}

// ---------------------------------------------------------------------------
// Scan cache
// ---------------------------------------------------------------------------

/// Short-TTL cache for the expensive `scan_usage` walk (reads every
/// wire.jsonl under the sessions root and prices every record). Tab switches
/// call get_summary repeatedly; re-walking the whole tree on every switch is
/// the main dashboard lag. Keyed by home, expires after 8s; `refresh=true`
/// bypasses it.
struct SummaryCacheEntry {
    home: String,
    scanned_at: std::time::Instant,
    records: Vec<UsageRecord>,
    meta: ScanMeta,
}

static SUMMARY_CACHE: Mutex<Option<SummaryCacheEntry>> = Mutex::new(None);
const SUMMARY_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(8);

fn scan_usage_cached(home: &Path, refresh: bool) -> (Vec<UsageRecord>, ScanMeta) {
    let home_s = home.to_string_lossy().to_string();
    let mut cache = SUMMARY_CACHE.lock().unwrap();
    let hit = cache
        .as_ref()
        .is_some_and(|e| !refresh && e.home == home_s && e.scanned_at.elapsed() < SUMMARY_CACHE_TTL);
    if hit {
        let e = cache.as_ref().unwrap();
        return (e.records.clone(), e.meta.clone());
    }
    let (records, meta) = scan_usage(home);
    *cache = Some(SummaryCacheEntry {
        home: home_s,
        scanned_at: std::time::Instant::now(),
        records: records.clone(),
        meta: meta.clone(),
    });
    (records, meta)
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

fn aggregate(records: &[UsageRecord], range: &str, now_ms: u64) -> RangeStats {
    let filtered: Vec<&UsageRecord> = filter_by_range(records, range, now_ms);
    let range_label = range.to_string();

    if filtered.is_empty() {
        return RangeStats {
            range: range_label,
            totals: TotalsRow::default(),
            daily: vec![],
            models: vec![],
            recent: vec![],
            recent_total: 0,
            recent_limit: 500,
        };
    }

    let mut totals = TotalsRow::default();
    let mut by_day: HashMap<String, (TotalsRow, HashMap<String, u64>, HashMap<String, HashMap<String, u64>>)> = HashMap::new();
    let mut by_model: HashMap<String, (ModelRow, TotalsRow)> = HashMap::new();

    for r in &filtered {
        totals.add(r);
        let dk = day_key(r.time);
        let (day_totals, day_models, day_prov_models) = by_day.entry(dk.clone()).or_default();
        day_totals.add(r);
        *day_models.entry(r.model.clone()).or_insert(0) +=
            r.input_other + r.output + r.input_cache_read + r.input_cache_creation;
        let provider_key = r.provider.clone().unwrap_or_else(|| "unknown".to_string());
        *day_prov_models
            .entry(provider_key)
            .or_default()
            .entry(r.model.clone())
            .or_insert(0) += r.input_other + r.output + r.input_cache_read + r.input_cache_creation;

        let mk = r.model.clone();
        let entry = by_model.entry(mk.clone()).or_insert_with(|| {
            let m = ModelRow {
                model: mk.clone(),
                model_display: r.model_display.clone(),
                model_resolved: r.model_resolved.clone(),
                price_id: r.price_id.clone(),
                cost_estimated: r.cost_estimated,
                is_secondary: r.is_secondary,
                requests: 0, input_other: 0, output: 0,
                input_cache_read: 0, input_cache_creation: 0,
                cost_usd: 0.0, total_tokens: 0, cache_hit_rate: 0.0,
            };
            (m, TotalsRow::default())
        });
        entry.1.add(r);
        entry.0.cost_estimated = entry.0.cost_estimated || r.cost_estimated;
        entry.0.is_secondary = entry.0.is_secondary || r.is_secondary;
    }

    let total_input = totals.input_other + totals.input_cache_read + totals.input_cache_creation;
    totals.cache_hit_rate = if total_input > 0 { totals.input_cache_read as f64 / total_input as f64 } else { 0.0 };

    let mut daily: Vec<DailyRow> = by_day.into_iter()
        .map(|(date, (t, by_model, by_provider_model))| {
            let ti = t.input_other + t.input_cache_read + t.input_cache_creation;
            let ch = if ti > 0 { t.input_cache_read as f64 / ti as f64 } else { 0.0 };
            DailyRow {
                date, requests: t.requests,
                input_other: t.input_other, output: t.output,
                input_cache_read: t.input_cache_read, input_cache_creation: t.input_cache_creation,
                cost_usd: t.cost_usd, total_tokens: t.total_tokens, cache_hit_rate: ch,
                by_model,
                by_provider: by_provider_model
                    .iter()
                    .map(|(p, m)| (p.clone(), m.values().sum::<u64>()))
                    .collect(),
                by_provider_model,
            }
        })
        .collect();
    daily.sort_by(|a, b| a.date.cmp(&b.date));

    let mut models: Vec<ModelRow> = by_model.into_iter().map(|(_, (mut m, t))| {
        let ti = t.input_other + t.input_cache_read + t.input_cache_creation;
        m.cache_hit_rate = if ti > 0 { t.input_cache_read as f64 / ti as f64 } else { 0.0 };
        m.requests = t.requests;
        m.input_other = t.input_other; m.output = t.output;
        m.input_cache_read = t.input_cache_read; m.input_cache_creation = t.input_cache_creation;
        m.cost_usd = t.cost_usd; m.total_tokens = t.total_tokens;
        m
    }).collect();
    models.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));

    let recent_total = filtered.len();
    let recent_limit = 500;
    let recent: Vec<RecentRow> = filtered.iter().take(recent_limit).map(|r| RecentRow {
        time: r.time, model: r.model.clone(), model_display: r.model_display.clone(),
        model_resolved: r.model_resolved.clone(),
        input_other: r.input_other, output: r.output,
        input_cache_read: r.input_cache_read, input_cache_creation: r.input_cache_creation,
        total_tokens: r.input_other + r.output + r.input_cache_read + r.input_cache_creation,
        cost_usd: r.cost_usd, cost_estimated: r.cost_estimated,
        price_id: r.price_id.clone(), from_env: r.from_env,
        is_secondary: r.is_secondary,
    }).collect();

    RangeStats {
        range: range_label,
        totals,
        daily,
        models,
        recent,
        recent_total,
        recent_limit,
    }
}

impl TotalsRow {
    fn default() -> Self {
        TotalsRow {
            requests: 0, input_other: 0, output: 0,
            input_cache_read: 0, input_cache_creation: 0,
            cost_usd: 0.0, total_tokens: 0, cache_hit_rate: 0.0,
        }
    }
    fn add(&mut self, r: &UsageRecord) {
        self.requests += 1;
        self.input_other += r.input_other;
        self.output += r.output;
        self.input_cache_read += r.input_cache_read;
        self.input_cache_creation += r.input_cache_creation;
        self.cost_usd += r.cost_usd;
        self.total_tokens = self.input_other + self.output + self.input_cache_read + self.input_cache_creation;
    }
}

fn filter_by_range<'a>(records: &'a [UsageRecord], range: &str, now_ms: u64) -> Vec<&'a UsageRecord> {
    if range == "all" { return records.iter().collect(); }
    let start = range_start(range, now_ms);
    records.iter().filter(|r| r.time >= start).collect()
}

fn range_start(range: &str, now_ms: u64) -> u64 {
    match range {
        "today" => {
            // LOCAL midnight today — not UTC midnight. Without this, users east of UTC see
            // "today" begin at the wrong hour (e.g. UTC+8 users get cutoff at local 08:00).
            let now_utc = DateTime::from_timestamp((now_ms / 1000) as i64, 0).unwrap_or_default();
            let now_local = now_utc.with_timezone(&Local);
            let today_date = now_local.date_naive();
            let today_start = today_date.and_hms_opt(0, 0, 0).unwrap_or_default();
            Local
                .from_local_datetime(&today_start)
                .single()
                .map(|dt| dt.timestamp() as u64 * 1000)
                .unwrap_or_else(|| today_start.and_utc().timestamp() as u64 * 1000)
        }
        "7d" => now_ms - 7 * 24 * 3600 * 1000,
        "30d" => now_ms - 30 * 24 * 3600 * 1000,
        _ => now_ms - 30 * 24 * 3600 * 1000,
    }
}

fn build_heatmap(records: &[UsageRecord], now_ms: u64) -> HeatmapData {
    let weeks = 53;
    // Use LOCAL today for the heatmap's right edge so the current day's cell lights up correctly.
    let now_utc = DateTime::from_timestamp((now_ms / 1000) as i64, 0).unwrap_or_default();
    let now_local = now_utc.with_timezone(&Local);
    let end_date = now_local.date_naive();
    let start_date = end_date - chrono::Duration::days(weeks * 7 - 1);
    let start_date = start_date - chrono::Duration::days(start_date.weekday().num_days_from_sunday() as i64);

    let mut by_day: HashMap<String, TotalsRow> = HashMap::new();
    for r in records {
        let dk = day_key(r.time);
        let t = by_day.entry(dk).or_default();
        t.add(r);
    }

    let mut cursor = start_date;
    let mut cells = Vec::new();
    let mut max_tokens = 0u64;

    while cursor <= end_date {
        let key = format!("{:04}-{:02}-{:02}", cursor.year(), cursor.month(), cursor.day());
        let t = by_day.get(&key).cloned().unwrap_or_else(TotalsRow::default);
        let tok = t.total_tokens;
        if tok > max_tokens { max_tokens = tok; }
        let dow = cursor.weekday().num_days_from_sunday() as usize;
        let week_idx = ((cursor - start_date).num_days() / 7) as usize;
        let ti = t.input_other + t.input_cache_read + t.input_cache_creation;
        let ch = if ti > 0 { t.input_cache_read as f64 / ti as f64 } else { 0.0 };
        cells.push(HeatmapCell {
            date: key, dow, week_index: week_idx,
            requests: t.requests, total_tokens: tok, cost_usd: t.cost_usd,
            cache_hit_rate: ch, level: 0,
        });
        cursor += chrono::Duration::days(1);
        if cells.len() > (weeks * 7 + 7) as usize { break; }
    }
    for c in &mut cells {
        c.level = if max_tokens == 0 || c.total_tokens == 0 {
            0
        } else {
            let r = c.total_tokens as f64 / max_tokens as f64;
            if r > 0.75 { 4 } else if r > 0.5 { 3 } else if r > 0.25 { 2 } else { 1 }
        };
    }

    let mut month_labels = Vec::new();
    let mut last_month = String::new();
    for c in &cells {
        let m = c.date[..7].to_string();
        if m != last_month {
            month_labels.push(MonthLabel { week_index: c.week_index, label: c.date[5..7].to_string() });
            last_month = m;
        }
    }

    HeatmapData {
        weeks: weeks as usize,
        start: start_date.format("%Y-%m-%d").to_string(),
        end: end_date.format("%Y-%m-%d").to_string(),
        max_tokens,
        cells,
        month_labels,
    }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

fn list_workspace_dirs(home: &Path) -> Vec<String> {
    let root = sessions_root(home);
    if !root.exists() { return vec![]; }
    let mut out = Vec::new();
    let re = workspace_re();
    for entry in safe_read_dir(&root) {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".kcd-archive" { continue; }
        if !re.is_match(&name) { continue; }
        out.push(name);
    }
    out.sort();
    out
}

fn read_state_safe(session_dir: &Path) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    let sp = session_dir.join("state.json");
    if !sp.exists() { return (None, None, None, None); }
    if let Ok(content) = fs::read_to_string(&sp) {
        if let Ok(obj) = serde_json::from_str::<serde_json::Value>(&content) {
            let title = obj.get("title").and_then(|v| v.as_str().map(|s| s.to_string()));
            let work_dir = obj.get("workDir").and_then(|v| v.as_str().map(|s| s.to_string()));
            let created_at = obj.get("createdAt").and_then(|v| v.as_str().map(|s| s.to_string()));
            let updated_at = obj.get("updatedAt").and_then(|v| v.as_str().map(|s| s.to_string()));
            return (title, work_dir, created_at, updated_at);
        }
    }
    (None, None, None, None)
}

fn humanize_workspace(id: &str) -> String {
    let re = Regex::new(r"^wd_(.+)_[0-9a-fA-F]{8,}$").unwrap();
    if let Some(caps) = re.captures(id) {
        caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_else(|| id.to_string())
    } else {
        id.to_string()
    }
}

fn list_sessions_in_dir(dir: &Path, workspace_id: &str, status: &str) -> Vec<SessionRow> {
    let mut sessions = Vec::new();
    if !dir.exists() { return sessions; }
    let re = session_re();
    for entry in safe_read_dir(dir) {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if !re.is_match(&name) { continue; }
        let (title, work_dir, created_at, updated_at) = read_state_safe(&entry.path());
        let (bytes, files) = file_size_approx(&entry.path());
        let mtime = entry.path().metadata().ok().and_then(|m| m.modified().ok())
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)).flatten();
        sessions.push(SessionRow {
            id: name, workspace_id: workspace_id.to_string(), status: status.to_string(),
            title, work_dir, created_at,
            updated_at: updated_at.or_else(|| mtime.map(|m| {
                let secs = if m > 1e12 as u64 { m / 1000 } else { m };
                let dt = DateTime::from_timestamp(secs as i64, 0).unwrap_or_default().naive_utc();
                dt.to_string()
            })),
            bytes, files,
        });
    }
    sessions
}

fn list_sessions_cmd(home: &Path, status: &str, workspace_filter: Option<String>) -> SessionsResult {
    let root = sessions_root(home);
    let archive_root = root.join(".kcd-archive");
    let mut ws_ids: Vec<String> = list_workspace_dirs(home);
    // Also include archive-only workspaces
    if archive_root.exists() {
        for entry in safe_read_dir(&archive_root) {
            let name = entry.file_name().to_string_lossy().to_string();
            if workspace_re().is_match(&name) && !ws_ids.contains(&name) {
                ws_ids.push(name);
            }
        }
    }
    ws_ids.sort();

    // Load workspaces.json
    let wp = home.join("workspaces.json");
    let mut ws_meta: HashMap<String, serde_json::Value> = HashMap::new();
    if let Ok(content) = fs::read_to_string(&wp) {
        if let Ok(obj) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(ws) = obj.get("workspaces").and_then(|v| v.as_object()) {
                for (k, v) in ws {
                    ws_meta.insert(k.clone(), v.clone());
                }
            }
        }
    }

    let mut workspaces = Vec::new();
    let mut all_sessions = Vec::new();

    for wid in &ws_ids {
        if let Some(ref filter) = workspace_filter {
            if wid != filter { continue; }
        }
        let meta = ws_meta.get(wid);
        let name = meta.and_then(|m| m.get("name").and_then(|v| v.as_str()))
            .map(|s| s.to_string()).unwrap_or_else(|| humanize_workspace(wid));
        let root_path = meta.and_then(|m| m.get("root").and_then(|v| v.as_str()).map(|s| s.to_string()));

        let active_dir = root.join(wid);
        let arch_dir = archive_root.join(wid);
        let active_all = list_sessions_in_dir(&active_dir, wid, "active");
        let arch_all = list_sessions_in_dir(&arch_dir, wid, "archived");
        let active_list = if status == "archived" { vec![] } else { active_all.clone() };
        let arch_list = if status == "active" { vec![] } else { arch_all.clone() };

        let empty = active_all.is_empty() && arch_all.is_empty();
        workspaces.push(WorkspaceRow {
            id: wid.clone(), name, root: root_path,
            created_at: None, last_opened_at: None,
            active_count: active_all.len(), archived_count: arch_all.len(), empty,
        });
        all_sessions.extend(active_list);
        all_sessions.extend(arch_list);
    }

    all_sessions.sort_by(|a, b| {
        let ta = a.updated_at.as_deref().or(a.created_at.as_deref()).unwrap_or("").to_string();
        let tb = b.updated_at.as_deref().or(b.created_at.as_deref()).unwrap_or("").to_string();
        tb.cmp(&ta)
    });

    SessionsResult {
        home: home.to_string_lossy().to_string(),
        archive_root: ".kcd-archive".into(),
        workspaces,
        sessions: all_sessions,
    }
}

fn assert_safe_path(home: &Path, workspace_id: &str, session_id: &str) -> Result<PathBuf, String> {
    if !workspace_re().is_match(workspace_id) {
        return Err("invalid workspace id".into());
    }
    if !session_re().is_match(session_id) {
        return Err("invalid session id".into());
    }
    let root = sessions_root(home).canonicalize().unwrap_or_else(|_| sessions_root(home));
    let candidate = root.join(workspace_id).join(session_id).canonicalize().unwrap_or_else(|_| root.join(workspace_id).join(session_id));
    if !candidate.starts_with(&root) {
        return Err("path escape blocked".into());
    }
    Ok(candidate)
}

fn archive_session_cmd(home: &Path, workspace_id: &str, session_id: &str) -> Result<ActionResponse, String> {
    let src = assert_safe_path(home, workspace_id, session_id)?;
    let dest = sessions_root(home).join(".kcd-archive").join(workspace_id).join(session_id);
    if !src.exists() { return Err("session not found".into()); }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    fs::rename(&src, &dest).or_else(|_| {
        // cross-device fallback
        fs_extra::dir::copy(&src, dest.parent().unwrap(), &Default::default()).ok();
        fs::remove_dir_all(&src).ok();
        Ok::<(), String>(())
    }).map_err(|e: String| format!("move: {}", e))?;
    scrub_session_index(home, session_id);
    Ok(ActionResponse {
        ok: true, workspace_id: workspace_id.to_string(),
        session_id: session_id.to_string(), status: Some("archived".into()),
        path: Some(dest.to_string_lossy().to_string()), deleted: None,
    })
}

fn unarchive_session_cmd(home: &Path, workspace_id: &str, session_id: &str) -> Result<ActionResponse, String> {
    let src = sessions_root(home).join(".kcd-archive").join(workspace_id).join(session_id);
    let dest = assert_safe_path(home, workspace_id, session_id)?;
    if !src.exists() { return Err("archived session not found".into()); }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    fs::rename(&src, &dest).or_else(|_| {
        fs_extra::dir::copy(&src, dest.parent().unwrap(), &Default::default()).ok();
        fs::remove_dir_all(&src).ok();
        Ok::<(), String>(())
    }).map_err(|e: String| format!("move: {}", e))?;
    Ok(ActionResponse {
        ok: true, workspace_id: workspace_id.to_string(),
        session_id: session_id.to_string(), status: Some("active".into()),
        path: Some(dest.to_string_lossy().to_string()), deleted: None,
    })
}

fn delete_session_cmd(home: &Path, workspace_id: &str, session_id: &str, status_hint: Option<&str>) -> Result<ActionResponse, String> {
    let active = assert_safe_path(home, workspace_id, session_id)?;
    let archived = sessions_root(home).join(".kcd-archive").join(workspace_id).join(session_id);
    let target = match status_hint {
        Some("archived") if archived.exists() => archived,
        Some("active") if active.exists() => active,
        _ => {
            if active.exists() { active } else if archived.exists() { archived }
            else { return Err("session not found".into()); }
        }
    };
    fs::remove_dir_all(&target).map_err(|e| format!("delete: {}", e))?;
    scrub_session_index(home, session_id);
    Ok(ActionResponse {
        ok: true, workspace_id: workspace_id.to_string(),
        session_id: session_id.to_string(), status: None,
        path: Some(target.to_string_lossy().to_string()), deleted: Some(true),
    })
}

fn scrub_session_index(home: &Path, session_id: &str) {
    let ip = home.join("session_index.jsonl");
    if !ip.exists() { return; }
    if let Ok(content) = fs::read_to_string(&ip) {
        let lines: Vec<&str> = content.lines().filter(|l| {
            let sid = format!("\"sessionId\":\"{}\"", session_id);
            let sid2 = format!("\"sessionId\": \"{}\"", session_id);
            let path_match = format!("/{}\"", session_id);
            !l.contains(&sid) && !l.contains(&sid2) && !l.contains(&path_match)
        }).collect();
        if lines.len() < content.lines().count() {
            let _ = fs::write(&ip, lines.join("\n") + "\n");
        }
    }
}

fn delete_workspace_cmd(home: &Path, workspace_id: &str, _confirm: bool, _force: bool) -> Result<ActionResponse, String> {
    if !workspace_re().is_match(workspace_id) {
        return Err("invalid workspace id".into());
    }
    let root = sessions_root(home);
    let active_dir = root.join(workspace_id);
    let arch_dir = root.join(".kcd-archive").join(workspace_id);

    if active_dir.exists() {
        let active_list = list_sessions_in_dir(&active_dir, workspace_id, "active");
        if !active_list.is_empty() { return Err("workspace is not empty; archive/delete sessions first".into()); }
    }
    if arch_dir.exists() {
        let arch_list = list_sessions_in_dir(&arch_dir, workspace_id, "archived");
        if !arch_list.is_empty() { return Err("workspace is not empty; archive/delete sessions first".into()); }
    }

    if active_dir.exists() { fs::remove_dir_all(&active_dir).ok(); }
    if arch_dir.exists() { fs::remove_dir_all(&arch_dir).ok(); }

    // Update workspaces.json
    let wp = home.join("workspaces.json");
    if let Ok(content) = fs::read_to_string(&wp) {
        if let Ok(mut obj) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(ws) = obj.get_mut("workspaces").and_then(|v| v.as_object_mut()) {
                ws.remove(workspace_id);
            }
            let deleted = obj.get_mut("deleted_workspace_ids")
                .and_then(|v| v.as_array_mut());
            if let Some(arr) = deleted {
                if !arr.iter().any(|v| v.as_str() == Some(workspace_id)) {
                    arr.push(serde_json::Value::String(workspace_id.to_string()));
                }
            }
            let _ = fs::write(&wp, serde_json::to_string_pretty(&obj).unwrap() + "\n");
        }
    }

    Ok(ActionResponse {
        ok: true, workspace_id: workspace_id.to_string(),
        session_id: String::new(), status: None, path: None, deleted: Some(true),
    })
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

fn clip_text(s: &str, max: usize) -> String {
    // Only walk the first `max` bytes — earlier version filtered the whole string,
    // which was fine for short text but blew up when previewing big turns.
    let (end, trunc) = if s.len() <= max {
        (s.len(), false)
    } else {
        let mut e = max;
        while e < s.len() && !s.is_char_boundary(e) { e += 1; }
        (e, true)
    };
    let head = &s[..end];
    let cleaned: String = head.chars().filter(|&c| c != '\0').collect();
    if trunc { format!("{}…", cleaned) } else { cleaned }
}

fn extract_text_parts(content: &serde_json::Value) -> String {
    if let Some(s) = content.as_str() { return s.to_string(); }
    if let Some(arr) = content.as_array() {
        let mut parts = Vec::new();
        for p in arr {
            if let Some(obj) = p.as_object() {
                if let Some(t) = obj.get("text").and_then(|v| v.as_str()) {
                    parts.push(t.to_string());
                }
            }
        }
        return parts.join("\n");
    }
    String::new()
}

fn push_user_msg(msgs: &mut Vec<PreviewMessage>, role: &str, text: &str, time: u64) {
    let norm: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if norm.is_empty() { return; }
    if let Some(last) = msgs.last() {
        if last.role == role {
            let last_norm: String = last.text.split_whitespace().collect::<Vec<_>>().join(" ");
            if last_norm == norm { return; }
        }
    }
    let text = if looks_like_secret(text) { "[redacted: possible secret content]".into() } else { clip_text(text, 2500) };
    msgs.push(PreviewMessage { role: role.into(), time: Some(time), text });
}

fn flush_assistant_msg(msgs: &mut Vec<PreviewMessage>, bucket: &Option<(Vec<String>, u64)>) {
    if let Some((texts, _)) = bucket {
        let combined = texts.join("");
        if !combined.trim().is_empty() {
            let text = if looks_like_secret(&combined) { "[redacted: possible secret content]".into() } else { clip_text(&combined, 2500) };
            if let Some(last) = msgs.last() {
                if last.role == "assistant" {
                    let last_norm: String = last.text.split_whitespace().collect::<Vec<_>>().join(" ");
                    let this_norm: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
                    if last_norm == this_norm { return; }
                }
            }
            msgs.push(PreviewMessage { role: "assistant".into(), time: None, text });
        }
    }
}

fn get_session_preview_cmd(home: &Path, workspace_id: &str, session_id: &str, status_hint: Option<&str>) -> Result<PreviewResult, String> {
    let root = sessions_root(home);
    let active = assert_safe_path(home, workspace_id, session_id)?;
    let archived = root.join(".kcd-archive").join(workspace_id).join(session_id);
    let session_dir = match status_hint {
        Some("archived") if archived.exists() => archived,
        _ => if active.exists() { active } else if archived.exists() { archived }
            else { return Err("session not found".into()); }
    };

    let (title, work_dir, created_at, updated_at) = read_state_safe(&session_dir);
    let api_dir = session_dir.join("agents").join("main");
    let mut wire_path = api_dir.join("wire.jsonl");
    if !wire_path.exists() {
        wire_path = session_dir.join("wire.jsonl");
    }
    if !wire_path.exists() {
        // try first agent wire
        let agents_dir = session_dir.join("agents");
        if agents_dir.exists() {
            for entry in safe_read_dir(&agents_dir) {
                let w = entry.path().join("wire.jsonl");
                if w.exists() { wire_path = w; break; }
            }
        }
    }

    let mut messages: Vec<PreviewMessage> = Vec::new();
    let mut truncated = false;
    let max_msgs = 80;
    let _max_chars = 2500usize;
    // Hard byte cap: refuse to stream more than this from a single wire.jsonl.
    // Typical heavy sessions are 5–30 MB; anything larger risks OOM in the WebView.
    const MAX_WIRE_BYTES: usize = 20 * 1024 * 1024; // 20 MB

    if wire_path.exists() {
        let file = match fs::File::open(&wire_path) {
            Ok(f) => f,
            Err(e) => return Err(format!("open wire: {e}")),
        };
        let reader = BufReader::new(file);
        let mut bytes_read = 0usize;
        let mut line_count = 0usize;
        let mut current_assistant: Option<(Vec<String>, u64)> = None;
        let mut current_step_key: Option<String> = None;

        for line_res in reader.lines() {
            let line = match line_res {
                Ok(l) => l,
                Err(_) => break,
            };
            bytes_read += line.len() + 1; // +1 for the stripped newline
            line_count += 1;
            if bytes_read > MAX_WIRE_BYTES { truncated = true; break; }
            if messages.len() >= max_msgs { truncated = true; break; }
            if !line.contains("\"context.append_message\"") && !line.contains("\"turn.steer\"")
                && !line.contains("\"turn.prompt\"") && !line.contains("\"content.part\"")
                && !line.contains("\"step.end\"") { continue; }
            let obj: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v, Err(_) => continue,
            };
            let typ = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");

            if typ == "context.append_message" {
                flush_assistant_msg(&mut messages, &current_assistant);
                current_assistant = None;
                current_step_key = None;
                let msg = &obj["message"];
                let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("unknown");
                if role == "tool" { continue; }
                let raw = extract_text_parts(&msg["content"]);
                if raw.trim().is_empty() { continue; }
                push_user_msg(&mut messages, role, &raw, obj.get("time").and_then(|v| v.as_u64()).unwrap_or(0));
                continue;
            }

            if typ == "turn.steer" || typ == "turn.prompt" {
                let input = &obj["input"];
                let raw = if let Some(s) = input.as_str() { s.to_string() }
                    else if let Some(arr) = input.as_array() {
                        arr.iter().filter_map(|x| x.get("text").and_then(|v| v.as_str())).collect::<Vec<_>>().join("\n")
                    } else { String::new() };
                if raw.trim().is_empty() { continue; }
                push_user_msg(&mut messages, "user", &raw, obj.get("time").and_then(|v| v.as_u64()).unwrap_or(0));
                continue;
            }

            if typ == "context.append_loop_event" {
                let ev = &obj["event"];
                let ev_type = ev.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if ev_type == "content.part" {
                    let part = &ev["part"];
                    if part.get("type").and_then(|v| v.as_str()) == Some("text") {
                        let text = part.get("text").and_then(|v| v.as_str()).unwrap_or("");
                        if !text.is_empty() {
                            let step_key = ev.get("stepUuid").and_then(|v| v.as_str())
                                .map(|s| s.to_string()).unwrap_or_else(|| format!("{}:{}", ev["turnId"], ev["step"]));
                            // flush if step changed
                            if current_step_key.as_deref() != Some(&step_key) {
                                flush_assistant_msg(&mut messages, &current_assistant);
                                current_assistant = Some((Vec::new(), obj.get("time").and_then(|v| v.as_u64()).unwrap_or(0)));
                                current_step_key = Some(step_key.clone());
                            } else if current_assistant.is_none() {
                                current_assistant = Some((Vec::new(), obj.get("time").and_then(|v| v.as_u64()).unwrap_or(0)));
                            }
                            current_assistant.as_mut().unwrap().0.push(text.to_string());
                        }
                    }
                    continue;
                }
                if ev_type == "step.end" {
                    flush_assistant_msg(&mut messages, &current_assistant);
                    current_assistant = None;
                    current_step_key = None;
                }
            }
        }
        flush_assistant_msg(&mut messages, &current_assistant);
        if line_count > 8000 { truncated = true; }
        if messages.len() >= max_msgs { truncated = true; }
        if bytes_read > MAX_WIRE_BYTES { truncated = true; }
    }

    Ok(PreviewResult {
        workspace_id: workspace_id.to_string(),
        session_id: session_id.to_string(),
        status: if session_dir.to_string_lossy().contains(".kcd-archive") { "archived".into() } else { "active".into() },
        title, work_dir, created_at, updated_at,
        message_count: messages.len(),
        truncated,
        messages,
    })
}

fn looks_like_secret(s: &str) -> bool {
    let re = regex::Regex::new(r"(?i)api[_-]?key|sk-[a-zA-Z0-9]{12,}|BEGIN (RSA |OPENSSH )?PRIVATE KEY").unwrap();
    re.is_match(s)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_paths() -> PathsResult {
    let home = resolve_kimi_home(None);
    let valid = is_kimi_home(&home);
    let mut candidates = Vec::new();
    if let Ok(env_home) = std::env::var("KIMI_CODE_HOME") {
        let p = PathBuf::from(&env_home);
        candidates.push(PathCandidate { path: env_home, valid: is_kimi_home(&p) });
    }
    if let Some(hd) = dirs::home_dir() {
        let p = hd.join(".kimi-code");
        candidates.push(PathCandidate { path: p.to_string_lossy().to_string(), valid: is_kimi_home(&p) });
        if let Ok(up) = std::env::var("USERPROFILE") {
            let p2 = PathBuf::from(&up).join(".kimi-code");
            if !candidates.iter().any(|c| c.path == p2.to_string_lossy()) {
                candidates.push(PathCandidate { path: p2.to_string_lossy().to_string(), valid: is_kimi_home(&p2) });
            }
        }
    }
    PathsResult {
        current: home.to_string_lossy().to_string(),
        valid,
        candidates,
        env: EnvInfo {
            kimi_code_home: std::env::var("KIMI_CODE_HOME").ok(),
            kimi_model_name: std::env::var("KIMI_MODEL_NAME").ok(),
        },
    }
}

#[tauri::command]
pub fn get_prices() -> PricesResult {
    PricesResult { prices: list_prices() }
}

#[tauri::command]
pub fn get_summary(home_override: Option<String>, range: Option<String>, refresh: Option<bool>) -> SummaryResult {
    let t0 = std::time::Instant::now();
    let refresh = refresh.unwrap_or(false);
    let home = resolve_kimi_home(home_override);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let r = range.unwrap_or_else(|| "30d".into());

    let (records, meta) = scan_usage_cached(&home, refresh);
    let t1 = std::time::Instant::now();
    let stats = aggregate(&records, &r, now_ms);
    let all_stats = aggregate(&records, "all", now_ms);
    let heatmap = build_heatmap(&records, now_ms);

    let all_models: Vec<AllModelRow> = all_stats.models.into_iter().map(|m| {
        AllModelRow {
            model: m.model, model_display: m.model_display, requests: m.requests,
            total_tokens: m.total_tokens, cost_usd: m.cost_usd, cost_estimated: m.cost_estimated,
            cache_hit_rate: m.cache_hit_rate,
        }
    }).collect();

    let all_model_count = all_models.len();
    let mut range_totals = HashMap::new();
    for r_k in ["today", "7d", "30d", "all"] {
        let s = aggregate(&records, r_k, now_ms);
        range_totals.insert(r_k.to_string(), s.totals);
    }

    let default_model = None;
    let env_model = std::env::var("KIMI_MODEL_NAME").ok().map(|name| EnvModelInfo {
        name, provider: std::env::var("KIMI_MODEL_PROVIDER").ok(), model: std::env::var("KIMI_MODEL_ID").ok(),
    });

    let t2 = std::time::Instant::now();
    let scan_ms = t1.duration_since(t0).as_secs_f64() * 1000.0;
    let aggregate_ms = t2.duration_since(t1).as_secs_f64() * 1000.0;
    let total_ms = t2.duration_since(t0).as_secs_f64() * 1000.0;
    eprintln!(
        "[dashboard] get_summary range={} records={} scan={:.0}ms aggregate={:.0}ms total={:.0}ms",
        r, records.len(), scan_ms, aggregate_ms, total_ms
    );

    SummaryResult {
        home: home.to_string_lossy().to_string(),
        valid: is_kimi_home(&home),
        scanned_at: now_ms,
        meta,
        model_map: ModelMapInfo { default_model, env_model, alias_count: 0 },
        range: r,
        stats,
        heatmap,
        all_models,
        all_model_count,
        range_totals,
    }
}

#[tauri::command]
pub fn list_sessions(home_override: Option<String>, status: Option<String>, workspace: Option<String>) -> SessionsResult {
    let home = resolve_kimi_home(home_override);
    list_sessions_cmd(&home, &status.unwrap_or_else(|| "active".into()), workspace)
}

#[tauri::command]
pub fn archive_session(home_override: Option<String>, workspace_id: String, session_id: String) -> Result<ActionResponse, String> {
    let home = resolve_kimi_home(home_override);
    archive_session_cmd(&home, &workspace_id, &session_id)
}

#[tauri::command]
pub fn unarchive_session(home_override: Option<String>, workspace_id: String, session_id: String) -> Result<ActionResponse, String> {
    let home = resolve_kimi_home(home_override);
    unarchive_session_cmd(&home, &workspace_id, &session_id)
}

#[tauri::command]
pub fn delete_session(home_override: Option<String>, workspace_id: String, session_id: String, status: Option<String>) -> Result<ActionResponse, String> {
    let home = resolve_kimi_home(home_override);
    delete_session_cmd(&home, &workspace_id, &session_id, status.as_deref())
}

#[tauri::command]
pub fn delete_workspace(home_override: Option<String>, workspace_id: String, confirm: bool, force: Option<bool>) -> Result<ActionResponse, String> {
    if !confirm { return Err("confirm_required: Pass confirm:true to delete an empty workspace".into()); }
    let home = resolve_kimi_home(home_override);
    delete_workspace_cmd(&home, &workspace_id, confirm, force.unwrap_or(false))
}

#[tauri::command]
pub fn get_session_preview(home_override: Option<String>, workspace_id: String, session_id: String, status: Option<String>) -> Result<PreviewResult, String> {
    let home = resolve_kimi_home(home_override);
    get_session_preview_cmd(&home, &workspace_id, &session_id, status.as_deref())
}

#[cfg(test)]
mod pricing_tests {
    use super::*;

    #[test]
    fn models_dev_snapshot_has_pricing() {
        let idx = models_dev_cost_index();
        // The compiled-in snapshot must carry real models.dev prices.
        assert!(idx.len() > 1000, "expected >1000 priced models, got {}", idx.len());
        let kimi = idx.get("moonshotai/kimi-k2.5").copied().expect("kimi-k2.5 present");
        assert_eq!(kimi.input, 0.6);
        assert_eq!(kimi.output, 3.0);
        assert_eq!(kimi.cache_read, 0.1);
    }

    #[test]
    fn match_price_prefers_models_dev() {
        // Bare ids and prefixed ids both resolve via the suffix index.
        let (id, ch, input, output, est) = match_price("glm-4.6");
        assert!(!est);
        assert_eq!(id, "zhipuai/glm-4.6");
        assert_eq!(input, 0.6);
        assert_eq!(output, 2.2);

        let (id, _, _, _, est) = match_price("kimi/k2.5");
        assert!(!est);
        assert_eq!(id, "moonshotai/kimi-k2.5");
    }

    #[test]
    fn match_price_falls_back_to_legacy_table() {
        // kimi-k3 resolves via models.dev (moonshotai); a made-up id hits the
        // last-resort estimate.
        let (id, _, _, _, est) = match_price("kimi-k3");
        assert!(!est);
        assert_eq!(id, "moonshotai/kimi-k3");

        let (_, _, _, _, est) = match_price("totally-unknown-model");
        assert!(est, "unknown models must be flagged as estimated");
    }

    #[test]
    fn custom_gateway_alias_bills_at_official_listing() {
        // Custom-gateway aliases not catalogued in models.dev (e.g. the user's
        // aggregated gateway "CodingPlan.site/deepseek-v4-flash") must resolve
        // via the cross-provider bare-name lookup to a priced official entry
        // instead of falling into the last-resort estimate.
        let (id, _, input, output, est) = match_price("CodingPlan.site/deepseek-v4-flash");
        assert!(!est, "resolved via models.dev, not estimated");
        assert_eq!(id, "deepseek/deepseek-v4-flash");
        assert_eq!(input, 0.14);
        assert_eq!(output, 0.28);
    }

    #[test]
    fn ambiguous_ids_prefer_official_provider() {
        // glm-4.6 ships under resellers too (e.g. 302ai); the official zhipuai
        // entry must win.
        let (id, _, input, _, _) = match_price("glm-4.6");
        assert_eq!(id, "zhipuai/glm-4.6");
        assert_eq!(input, 0.6);
    }

    #[test]
    fn context_suffix_variant_bills_at_base_model() {
        // kimi-code/k3-256k only exists as a zero-priced subscription entry
        // (kimi-for-coding/k3-256k); it must bill at the k3 list price.
        let (id, ch, input, output, est) = match_price("kimi-code/k3-256k");
        assert!(!est);
        assert_eq!(id, "moonshotai/kimi-k3");
        assert_eq!(input, 3.0);
        assert_eq!(output, 15.0);
        assert_eq!(ch, 0.3);

        // The strip helper leaves normal ids alone.
        assert_eq!(strip_context_suffix("kimi-code/k3-256k").as_deref(), Some("kimi-code/k3"));
        assert_eq!(strip_context_suffix("glm-4.6"), None);
        assert_eq!(strip_context_suffix("kimi-k2-thinking"), None);
    }

    #[test]
    fn subscription_plan_models_bill_at_priced_equivalent() {
        // zhipuai-coding-plan/glm-5.2 is a zero-cost plan entry; the priced
        // official zhipuai/glm-5.2 must win.
        let (id, ch, input, output, est) = match_price("zhipuai-coding-plan/glm-5.2");
        assert!(!est);
        assert_eq!(id, "zhipuai/glm-5.2");
        assert_eq!(input, 1.4);
        assert_eq!(output, 4.4);
        assert_eq!(ch, 0.26);

        // Kimi For Coding has no priced counterpart at all → curated flagship.
        let (id, _, input, _, est) = match_price("kimi-code/kimi-for-coding");
        assert!(!est);
        assert_eq!(id, "moonshotai/kimi-k3");
        assert_eq!(input, 3.0);

        // -highspeed variants strip back to the priced base model.
        let (id, _, input, _, est) = match_price("zhipuai-coding-plan/glm-5.2-highspeed");
        assert!(!est);
        assert_eq!(id, "zhipuai/glm-5.2");
        assert_eq!(input, 1.4);
        assert_eq!(
            strip_variant_suffix("glm-5.2-highspeed").as_deref(),
            Some("glm-5.2")
        );
        assert_eq!(strip_variant_suffix("glm-5.2"), None);
    }

    #[test]
    fn cache_write_price_preferred_when_present() {
        // glm-4.6 has cache_write: 0 → cache creation billed at 0, not input.
        let (_id, ch, input, _output, _est) = match_price("glm-4.6");
        let cw = models_dev_lookup("glm-4.6").and_then(|(_, c)| c.cache_write);
        assert_eq!(cw, Some(0.0));
        // 1M input tokens + 1M cache-creation tokens, no output: cache_write 0
        // → total is just the input price.
        let cost = cost_for_usage(1_000_000, 0, 0, 1_000_000, "glm-4.6");
        assert_eq!(cost.0, input);
        assert_eq!(cost.1, false);
        assert_eq!(ch, 0.11);
    }
}
