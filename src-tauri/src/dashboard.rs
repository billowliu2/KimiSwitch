use chrono::{DateTime, Datelike, Local, TimeZone};
use crate::db::{ArchivedSessionSnapshot, DayModelStat, DayStat};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::SystemTime;
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
    /// Model totals keyed by bare model name (provider prefix stripped), so the
    /// same model served by multiple providers merges into one row.
    pub models_by_name: Vec<ModelRow>,
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
    /// Per-model structured breakdown (tokens / requests / cost / cacheHitRate).
    pub by_model: HashMap<String, TotalsRow>,
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

/// Outcome of the bulk "archive everything older than X" command.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BulkArchiveResult {
    pub archived: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Resolve the Kimi Code home directory: explicit override, then
/// `KIMI_CODE_HOME`, then the default `~/.kimi-code`. Shared with the plugin
/// marketplace module (`crate::plugins`).
pub(crate) fn resolve_kimi_home(override_path: Option<String>) -> PathBuf {
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

/// Every config file the alias→provider map is built from, in parse order: the
/// current `config.toml` first (it wins on conflict), then every
/// `config.toml.bak.*` snapshot from the home root and from `backups/`.
///
/// The scan-input cache stats exactly this list, so both readers of the config
/// agree on what a change looks like.
fn alias_provider_config_files(home: &Path) -> Vec<PathBuf> {
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
    candidates
}

/// Build a legacy alias→provider map by merging the current config.toml with every
/// `config.toml.bak.*` snapshot (home root + backups/). Historical usage records may
/// reference model aliases that no longer exist in the current config (old bare or
/// `-N`-suffixed aliases); their provider is recovered from these snapshots.
fn build_alias_provider_map(home: &Path) -> HashMap<String, String> {
    let mut map: HashMap<String, String> = HashMap::new();
    for path in alias_provider_config_files(home) {
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

/// models.dev price index over the effective snapshot (runtime-synced copy
/// when present, else the compiled-in `src/lib/models-dev.json` generated by
/// scripts/fetch-models-dev.mjs). Keyed by "<provider>/<model>", lowercased.
/// Cached and rebuilt only when the synced file's mtime changes, so an online
/// sync (models_dev::sync_models_dev) refreshes prices without a restart.
fn models_dev_cost_index() -> Arc<HashMap<String, ModelsDevCost>> {
    static CACHE: OnceLock<RwLock<Option<(Option<SystemTime>, Arc<HashMap<String, ModelsDevCost>>)>>>=
        OnceLock::new();
    let cache = CACHE.get_or_init(|| RwLock::new(None));
    let stamp = fs::metadata(crate::models_dev::synced_path())
        .and_then(|m| m.modified())
        .ok();
    {
        let cached = cache.read().expect("price index lock");
        if let Some((cached_stamp, idx)) = cached.as_ref() {
            if *cached_stamp == stamp {
                return idx.clone();
            }
        }
    }
    let mut map = HashMap::new();
    let v = serde_json::from_str::<serde_json::Value>(&crate::models_dev::effective_snapshot());
    if let Ok(v) = v {
        if let Some(obj) = v.as_object() {
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
        }
    }
    let idx = Arc::new(map);
    *cache.write().expect("price index lock") = Some((stamp, idx.clone()));
    idx
}

/// Warm the models.dev price index off the first dashboard open: parsing the
/// ~1.3 MB snapshot costs tens of milliseconds, so build it on a background
/// thread at startup instead of lazily on the first get_summary.
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
    let index = models_dev_cost_index();
    if let Some(cost) = index.get(&lower) {
        return Some((lower, *cost));
    }
    let bare = model_name.rsplit_once('/').map(|(_, b)| b).unwrap_or(model_name);
    let bare_l = bare.to_ascii_lowercase();
    // Match on the model part after the last '/', not the full key: aliases
    // strip the family prefix (record "k2.5" vs models.dev "kimi-k2.5").
    let mut matches: Vec<(&String, &ModelsDevCost)> = index
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
    let index = models_dev_cost_index();
    let mut matches: Vec<(&String, &ModelsDevCost)> = index
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

/// The two external inputs the wire parser prices a record with, resolved
/// once per scan: the configured secondary-model alias and the legacy
/// alias→provider map. `fingerprint` changes whenever either of them does,
/// which is what invalidates the per-file parse cache.
#[derive(Clone)]
struct ScanInputs {
    secondary_alias: Option<String>,
    alias2prov: HashMap<String, String>,
    fingerprint: String,
}

/// A stat-only change key for one config file: path plus (mtime_ms, len).
/// Content is never read to derive it — the pair moves on every write, on
/// creation (present/absent) and on deletion (dropped from the list), which is
/// what makes it a sound invalidation key for the parsed inputs.
type ConfigStatStamp = (String, u64, u64);

/// The scan-input cache entry: the home it belongs to, the config stat stamps
/// the inputs were derived from, and the resolved inputs themselves.
struct ScanInputsCacheEntry {
    home: String,
    stamp: Vec<ConfigStatStamp>,
    inputs: Arc<ScanInputs>,
    /// `[secondary_model].model` exactly as `config.toml` declares it, before
    /// the persisted-cache fallback. Snapshot synthesis mirrors the archiver,
    /// which prices with this config-only value.
    config_secondary: Option<String>,
}

/// Cache of `resolve_scan_inputs`, keyed on the stat stamps of every config
/// file that feeds it. `scan_usage_cached` runs on every dashboard refresh and
/// `get_day_detail`, followed by the archive merge; without this the scanner
/// re-read and re-parsed the whole config plus every `config.toml.bak.*`
/// snapshot (and hit SQLite twice) on every call even when nothing under the
/// sessions tree had moved.
static SCAN_INPUTS_CACHE: Mutex<Option<ScanInputsCacheEntry>> = Mutex::new(None);

/// Stat every config file `resolve_scan_inputs` would read. Missing files
/// simply contribute no entry; a file appearing or disappearing changes the
/// list and therefore the stamp. Only metadata is touched — never the contents.
fn scan_inputs_stamp(home: &Path) -> Vec<ConfigStatStamp> {
    alias_provider_config_files(home)
        .into_iter()
        .filter_map(|path| {
            let meta = fs::metadata(&path).ok()?;
            Some((path.to_string_lossy().to_string(), file_mtime_ms(&meta), meta.len()))
        })
        .collect()
}

/// Resolve the scan inputs for `home`.
///
/// `read_secondary_model_alias` and `build_alias_provider_map` used to run
/// inside the scanner on every pass; they move up here so the incremental
/// cache can compare them before walking the tree, and so a call that reuses
/// every cached file never repeats the config reads.
fn resolve_scan_inputs(home: &Path) -> Arc<ScanInputs> {
    resolve_scan_config(home).0
}

/// The cached scan inputs plus the raw config-declared secondary alias.
///
/// The inputs are keyed on `scan_inputs_stamp`: while no config file's stat
/// moves, neither the config reads, the SQLite lookup nor the fingerprint
/// recomputation happen again — the cached `Arc` is handed out instead, so a
/// hit costs one `read_dir` per config location and a handful of `stat`s.
/// A different home always misses, as does any backup appearing or vanishing.
fn resolve_scan_config(home: &Path) -> (Arc<ScanInputs>, Option<String>) {
    let home_s = home.to_string_lossy().to_string();
    let stamp = scan_inputs_stamp(home);
    let mut cache = SCAN_INPUTS_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(entry) = cache.as_ref() {
        if entry.home == home_s && entry.stamp == stamp {
            return (Arc::clone(&entry.inputs), entry.config_secondary.clone());
        }
    }
    let config_secondary = read_secondary_model_alias(home);
    let inputs = Arc::new(compute_scan_inputs(home, &config_secondary));
    *cache = Some(ScanInputsCacheEntry {
        home: home_s,
        stamp,
        inputs: Arc::clone(&inputs),
        config_secondary: config_secondary.clone(),
    });
    (inputs, config_secondary)
}

/// The uncached resolution: merge the alias→provider map, resolve the
/// secondary alias and derive the fingerprint. `current_secondary` is the
/// already-parsed `[secondary_model].model`, so `config.toml` is read once.
fn compute_scan_inputs(home: &Path, current_secondary: &Option<String>) -> ScanInputs {
    let alias2prov = build_alias_provider_map(home);
    // Resolve the `__secondary__` marker (subagent requests bound to the
    // configured secondary model) to the real model alias once per scan.
    // Prefer the current config; fall back to the persisted cache so records
    // keep a stable billing basis after the secondary config is removed or
    // changed. When the config still declares a secondary model, refresh the
    // cache with it.
    let stored_secondary = crate::db::get_setting_pub(SECONDARY_MODEL_CACHE_KEY).ok().flatten();
    let cached_secondary = stored_secondary.clone().filter(|s| !s.is_empty());
    let secondary_alias = current_secondary.clone().or(cached_secondary);
    // Only write when the stored alias actually moves: the write is a SQLite
    // transaction, and this path is on the hot refresh route.
    if let Some(alias) = current_secondary {
        let cached = stored_secondary.as_deref().filter(|s| !s.is_empty());
        if cached != Some(alias.as_str()) {
            let _ = crate::db::set_setting_pub(SECONDARY_MODEL_CACHE_KEY, alias);
        }
    }
    let fingerprint = scan_inputs_fingerprint(&secondary_alias, &alias2prov);
    ScanInputs { secondary_alias, alias2prov, fingerprint }
}

/// Change key for `ScanInputs`: the resolved secondary alias plus the
/// sorted alias→provider pairs, so any edit either input picked up from
/// config.toml or its backups flips it.
fn scan_inputs_fingerprint(
    secondary_alias: &Option<String>,
    alias2prov: &HashMap<String, String>,
) -> String {
    let mut pairs: Vec<(&str, &str)> = alias2prov
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    pairs.sort_unstable();
    let mut out = String::new();
    out.push_str(secondary_alias.as_deref().unwrap_or(""));
    out.push('\u{1}');
    for (k, v) in pairs {
        out.push_str(k);
        out.push('\u{1}');
        out.push_str(v);
        out.push('\u{1}');
    }
    out
}

/// Cached parse of one `wire.jsonl`. Both halves of the stat key are kept: a
/// change in either one invalidates this entry.
struct FileScanEntry {
    mtime_ms: u64,
    len: u64,
    records: Vec<UsageRecord>,
    /// Total lines of the file. `ScanMeta.lines_seen` counts every line, not
    /// only the usage ones, so the count has to survive with the records.
    lines_seen: usize,
}

/// Per-file incremental cache for the sessions walk.
///
/// Replaces the old 8s TTL: a file keeps its parsed records while its
/// (mtime, len) is unchanged, so a refresh only re-parses what actually
/// moved. `parse_ctx` holds the `ScanInputs` fingerprint — when the secondary
/// alias or the alias→provider map moves, every cached parse is stale.
struct ScanCacheState {
    home: String,
    parse_ctx: String,
    files: HashMap<PathBuf, FileScanEntry>,
    /// Last assembled table, shared with callers. When the walk finds nothing
    /// changed this pointer is handed out instead of rebuilding the table.
    result: Option<Arc<Vec<UsageRecord>>>,
    /// Set when a file was parsed or dropped since the snapshot on disk was
    /// written, so the snapshot no longer describes this state.
    dirty: bool,
    /// When the snapshot on disk was last written, to keep a busy tree from
    /// re-serializing tens of MB on every refresh.
    written_at_ms: u64,
    /// True while `result` came from the disk snapshot without a walk in this
    /// process. Consumed by the call that serves it, so the table is only ever
    /// handed out unverified once and a later call always walks.
    pending_verification: bool,
    /// `ScanMeta` counts for the current per-file set. Persisted with the
    /// snapshot so a call that serves it without walking still reports the
    /// payload an unchanged walk would have produced.
    files_scanned: usize,
    lines_seen: usize,
}

// ---------------------------------------------------------------------------
// On-disk scan cache
// ---------------------------------------------------------------------------

/// Bumped whenever the serialized shape changes. An older file is ignored
/// rather than migrated, so a stale format can never be misread.
const SCAN_DISK_CACHE_VERSION: u32 = 1;

/// How often a changed snapshot may be re-serialized.
///
/// Writing it means roughly a second of JSON encoding for ~25 MB, so a tree
/// that keeps moving (a session in progress) must not pay that on every refresh.
/// A minute of lag only delays the fast start, and never affects the numbers a
/// call returns.
const SCAN_DISK_WRITE_INTERVAL_MS: u64 = 60_000;

/// Directory holding the per-home scan snapshots.
///
/// Defaults to the app data directory beside the SQLite store. Tests redirect
/// `KIMI_SWITCH_DB_PATH` to a temp dir — the snapshot then lands in that same
/// temp dir — and fall back to the system temp dir otherwise, so a test run
/// never writes into real user data.
fn scan_disk_cache_dir() -> PathBuf {
    if let Some(p) = std::env::var_os("KIMI_SWITCH_DB_PATH") {
        if !p.is_empty() {
            if let Some(parent) = PathBuf::from(&p).parent() {
                return parent.to_path_buf();
            }
        }
    }
    #[cfg(test)]
    let fallback = std::env::temp_dir().join("kimiswitch-scan-cache");
    #[cfg(not(test))]
    let fallback = crate::db::kimi_switch_data_dir();
    fallback
}

/// One snapshot file per home, named by a hash of the home path so two homes
/// (or two test temp dirs) can never overwrite each other's cache.
fn scan_disk_cache_path(home: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(home.to_string_lossy().as_bytes());
    let tag: String = digest.iter().take(16).map(|b| format!("{:02x}", b)).collect();
    scan_disk_cache_dir().join(format!("scan-cache-{tag}.json"))
}

/// The persisted parse of one home: the per-file records with their stat keys,
/// plus the context they were parsed under and the `ScanMeta` counts.
///
/// `UsageRecord` is stored in full — it is what the scanner produces, and
/// re-deriving any field from the file would mean reading the file, which is
/// exactly the cost this exists to avoid.
#[derive(Serialize, Deserialize)]
struct DiskScanCache {
    version: u32,
    home: String,
    parse_ctx: String,
    /// When the snapshot was taken, so a later run can tell how far a session
    /// may have advanced since.
    written_at_ms: u64,
    /// `ScanMeta` counts, so a table reconstructed from this snapshot reports
    /// the same payload an unchanged walk would.
    files_scanned: usize,
    lines_seen: usize,
    files: Vec<DiskFileEntry>,
}

#[derive(Serialize, Deserialize)]
struct DiskFileEntry {
    path: String,
    mtime_ms: u64,
    len: u64,
    lines_seen: usize,
    records: Vec<UsageRecord>,
}

/// Assemble the record table from the per-file parses.
///
/// Files are visited in path order so records sharing a timestamp keep a stable
/// order regardless of hash or directory iteration order; the shared `Arc` lets
/// an untouched tree hand out a pointer instead of a copy.
fn assemble_table(files: &HashMap<PathBuf, FileScanEntry>) -> Arc<Vec<UsageRecord>> {
    let mut paths: Vec<&PathBuf> = files.keys().collect();
    paths.sort_unstable();
    let mut records: Vec<UsageRecord> =
        Vec::with_capacity(files.values().map(|e| e.records.len()).sum());
    for p in paths {
        records.extend(files[p].records.iter().cloned());
    }
    records.sort_by(|a, b| b.time.cmp(&a.time));
    Arc::new(records)
}

impl ScanCacheState {
    /// Snapshot the current parses for persistence.
    fn to_disk(&self) -> DiskScanCache {
        DiskScanCache {
            version: SCAN_DISK_CACHE_VERSION,
            home: self.home.clone(),
            parse_ctx: self.parse_ctx.clone(),
            written_at_ms: now_ms(),
            files_scanned: self.files_scanned,
            lines_seen: self.lines_seen,
            files: self
                .files
                .iter()
                .map(|(path, e)| DiskFileEntry {
                    path: path.to_string_lossy().to_string(),
                    mtime_ms: e.mtime_ms,
                    len: e.len,
                    lines_seen: e.lines_seen,
                    records: e.records.clone(),
                })
                .collect(),
        }
    }
}

/// Read the snapshot for `home`, or `None` for any reason at all.
///
/// Every failure mode — absent file, truncated or corrupt JSON, a different
/// serialization version, a stale path or a moved parse context — degrades to
/// the same thing: an empty state, which the caller turns into a full scan. The
/// cache is an optimization, never a source of truth, so a bad file must never
/// surface as an error.
fn load_disk_cache(home: &Path, parse_ctx: &str) -> Option<DiskScanCache> {
    let path = scan_disk_cache_path(home);
    let bytes = fs::read(&path).ok()?;
    let cache: DiskScanCache = serde_json::from_slice(&bytes).ok()?;
    if cache.version != SCAN_DISK_CACHE_VERSION { return None; }
    if cache.home != home.to_string_lossy() { return None; }
    // The config-derived parsing context (secondary alias + alias→provider map)
    // prices and resolves every record, so a moved fingerprint invalidates the
    // whole snapshot rather than just the file stats.
    if cache.parse_ctx != parse_ctx { return None; }
    Some(cache)
}

/// Turn a loaded snapshot into state that can answer a request without walking.
///
/// The table is assembled here but left flagged unverified: the walk that proves
/// it is the single most expensive part of a cold start on a large sessions tree
/// (measured at ~0.74s to enumerate and stat ~1070 files), so the first call
/// answers from the snapshot and the walk happens behind it. Everything this can
/// be wrong about is a session written between the snapshot and now, which is
/// exactly what the verification walk is for.
fn scan_state_from_disk(cache: DiskScanCache) -> ScanCacheState {
    let files: HashMap<PathBuf, FileScanEntry> = cache
        .files
        .into_iter()
        .map(|e| {
            (
                PathBuf::from(e.path),
                FileScanEntry { mtime_ms: e.mtime_ms, len: e.len, lines_seen: e.lines_seen, records: e.records },
            )
        })
        .collect();
    let result = assemble_table(&files);
    ScanCacheState {
        home: cache.home,
        parse_ctx: cache.parse_ctx,
        files,
        result: Some(result),
        dirty: false,
        written_at_ms: cache.written_at_ms,
        pending_verification: true,
        files_scanned: cache.files_scanned,
        lines_seen: cache.lines_seen,
    }
}

/// Persist a snapshot off the request path.
///
/// The payload is tens of MB on a used install, so writing it inline would add
/// that write to the very load this is meant to speed up. The value is moved
/// into the thread (`DiskScanCache` is plain data), and a failure — no
/// permission, no space, a read-only install — is swallowed: the next call
/// simply pays a full scan, exactly as it would without this cache.
fn save_disk_cache_async(cache: DiskScanCache) {
    let _ = std::thread::Builder::new()
        .name("scan-cache-write".into())
        .spawn(move || {
            write_disk_cache(&cache);
        });
}

/// Serialize and atomically replace the snapshot file.
///
/// Written to a sibling and renamed, so a crash mid-write can never leave a
/// half-written file where a valid one used to be. Every failure is ignored:
/// the cache is an optimization, and being unable to write it must never
/// surface to the caller.
fn write_disk_cache(cache: &DiskScanCache) -> bool {
    let path = scan_disk_cache_path(Path::new(&cache.home));
    let Some(dir) = path.parent() else { return false };
    if fs::create_dir_all(dir).is_err() { return false; }
    let Ok(body) = serde_json::to_vec(cache) else { return false };
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, &body).is_err() { return false; }
    fs::rename(&tmp, &path).is_ok()
}

/// Modification time of an already-statted file in epoch ms (0 when the
/// platform reports nothing usable).
fn file_mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Walk the sessions tree and assemble the usage table, reusing the cached
/// parse of every `wire.jsonl` whose (mtime, len) is unchanged.
///
/// The record set and its newest-first ordering are identical whether a file
/// was reused or re-parsed: reuse is keyed on the file stat alone, and a file
/// that cannot be stat'ed or read is re-parsed (and left uncached) rather
/// than trusted.
fn scan_usage_incremental(
    state: &mut ScanCacheState,
    home: &Path,
    inputs: &ScanInputs,
) -> (Arc<Vec<UsageRecord>>, ScanMeta) {
    let root = sessions_root(home);
    let home_s = home.to_string_lossy().to_string();
    let root_s = root.to_string_lossy().to_string();
    let meta = |files_scanned: usize, lines_seen: usize, record_count: usize, errors: Vec<String>| ScanMeta {
        files_scanned,
        lines_seen,
        record_count,
        home: home_s.clone(),
        sessions_root: root_s.clone(),
        errors: errors.into_iter().take(20).collect(),
    };

    if !root.exists() {
        state.files.clear();
        state.result = None;
        state.files_scanned = 0;
        state.lines_seen = 0;
        return (
            Arc::new(Vec::new()),
            meta(0, 0, 0, vec!["sessions directory not found".into()]),
        );
    }

    let mut files_scanned = 0usize;
    let mut lines_seen = 0usize;
    let errors: Vec<String> = Vec::new();
    // Every path this walk produced; anything else left in `state.files` is
    // gone from disk and gets dropped below.
    let mut walked: HashSet<PathBuf> = HashSet::new();
    // Stays true only when the walk reproduced the cached file set and stat
    // exactly, which is what allows the assembled table to be reused.
    let mut unchanged = true;

    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_name() != "wire.jsonl" { continue; }
        if !entry.file_type().is_file() { continue; }
        // Skip blob/task directories
        let p = entry.path();
        if p.to_string_lossy().contains("blobs") || p.to_string_lossy().contains("tasks") {
            continue;
        }
        files_scanned += 1;
        let path = p.to_path_buf();
        walked.insert(path.clone());
        // Only a successful stat yields a key, so a file that cannot be
        // stat'ed is always re-parsed and never enters the cache.
        let stat = fs::metadata(&path).ok().map(|m| (file_mtime_ms(&m), m.len()));
        if let (Some((mtime_ms, len)), Some(cached)) = (stat, state.files.get(&path)) {
            if cached.mtime_ms == mtime_ms && cached.len == len {
                lines_seen += cached.lines_seen;
                continue;
            }
        }
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            // Unreadable now: drop any stale parse rather than counting it.
            Err(_) => {
                state.files.remove(&path);
                unchanged = false;
                continue;
            }
        };
        let file_lines = content.lines().count();
        let records = parse_wire_usage_records(&content, &inputs.secondary_alias, &inputs.alias2prov);
        lines_seen += file_lines;
        unchanged = false;
        if let Some((mtime_ms, len)) = stat {
            state.files.insert(path, FileScanEntry { mtime_ms, len, records, lines_seen: file_lines });
        }
    }

    let before = state.files.len();
    state.files.retain(|p, _| walked.contains(p));
    if state.files.len() != before {
        unchanged = false;
    }

    if unchanged {
        if let Some(result) = &state.result {
            return (Arc::clone(result), meta(files_scanned, lines_seen, result.len(), errors));
        }
    }

    let result = assemble_table(&state.files);
    state.result = Some(Arc::clone(&result));
    // Parsing happened or the file set moved, and the snapshot not yet on disk
    // describes this state.
    state.dirty = true;
    state.files_scanned = files_scanned;
    state.lines_seen = lines_seen;
    (Arc::clone(&result), meta(files_scanned, lines_seen, result.len(), errors))
}

/// Current wall-clock time in epoch ms, used for disk-cache freshness stamps.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Parse one `wire.jsonl` body into usage records. Extracted from the
/// sessions walk so a single session can be snapshotted without walking the
/// whole sessions tree; the record filter chain is unchanged, and the
/// incremental cache reuses this exact parser.
fn parse_wire_usage_records(
    content: &str,
    secondary_alias: &Option<String>,
    alias2prov: &HashMap<String, String>,
) -> Vec<UsageRecord> {
    let mut records = Vec::new();
    for line in content.lines() {
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
    records
}

/// Aggregate raw usage records into the per-day, per-model snapshot stored
/// for an archived session.
fn snapshot_from_records(records: &[UsageRecord]) -> Vec<DayStat> {
    let mut by_day: HashMap<String, (u64, HashMap<String, DayModelStat>)> = HashMap::new();
    for r in records {
        let entry = by_day
            .entry(day_key(r.time))
            .or_insert_with(|| (local_midnight_ms(r.time, 0), HashMap::new()));
        let m = entry.1.entry(r.model.clone()).or_insert_with(|| DayModelStat {
            model: r.model.clone(),
            requests: 0,
            input_other: 0,
            output: 0,
            input_cache_read: 0,
            input_cache_creation: 0,
            cost_usd: 0.0,
        });
        m.requests += 1;
        m.input_other += r.input_other;
        m.output += r.output;
        m.input_cache_read += r.input_cache_read;
        m.input_cache_creation += r.input_cache_creation;
        m.cost_usd += r.cost_usd;
    }
    let mut days: Vec<DayStat> = by_day
        .into_iter()
        .map(|(day, (day_start_ms, models))| {
            let mut models: Vec<DayModelStat> = models.into_values().collect();
            models.sort_by(|a, b| a.model.cmp(&b.model));
            DayStat { day, day_start_ms, models }
        })
        .collect();
    days.sort_by(|a, b| a.day.cmp(&b.day));
    days
}

/// Synthesize usage records from stored archive snapshots. Only snapshots
/// whose session directory is gone are synthesized: sessions still on disk
/// are covered by the live wire.jsonl scan, and emitting both would double
/// count their usage.
///
/// The alias→provider map and the secondary alias come from the cached scan
/// inputs instead of re-reading `config.toml` and every backup. The secondary
/// alias stays the config-declared one (`resolve_scan_config`'s second value)
/// rather than the DB-backed fallback the scanner uses: the archiver priced
/// these snapshots with the config-only value, and synthesizing them against a
/// different alias would move billed numbers for old archives.
fn synthesize_snapshot_records(rows: &[ArchivedSessionSnapshot], home: &Path) -> Vec<UsageRecord> {
    let root = sessions_root(home);
    let legacy_root = root.join(".kcd-archive");
    let (inputs, config_secondary) = resolve_scan_config(home);
    let alias2prov = &inputs.alias2prov;
    let secondary_alias = config_secondary;
    let mut out = Vec::new();
    for row in rows {
        if root.join(&row.workspace_id).join(&row.session_id).exists() { continue; }
        if legacy_root.join(&row.workspace_id).join(&row.session_id).exists() { continue; }
        for day in &row.day_stats {
            for m in &day.models {
                let is_secondary = m.model == "__secondary__";
                let price_model = if is_secondary {
                    secondary_alias.clone().unwrap_or_else(|| m.model.clone())
                } else {
                    m.model.clone()
                };
                let bare = m.model.rsplit_once('/').map(|x| x.1).unwrap_or(&m.model).to_string();
                out.push(UsageRecord {
                    time: day.day_start_ms,
                    model: m.model.clone(),
                    model_resolved: bare,
                    model_display: m.model.clone(),
                    provider: resolve_provider(&price_model, alias2prov),
                    from_env: m.model == "__kimi_env_model__",
                    is_secondary,
                    input_other: m.input_other,
                    output: m.output,
                    input_cache_read: m.input_cache_read,
                    input_cache_creation: m.input_cache_creation,
                    cost_usd: m.cost_usd,
                    cost_estimated: true,
                    price_id: String::new(),
                });
            }
        }
    }
    out
}

/// Append already-synthesized records to a live scan result and restore the
/// newest-first ordering the sessions walk produces.
///
/// The caller decides whether the merge is worth a copy at all — see
/// `records_with_archive_merge` — so this only does the append and the sort.
fn merge_snapshot_records(
    mut records: Vec<UsageRecord>,
    synthesized: Vec<UsageRecord>,
) -> Vec<UsageRecord> {
    records.extend(synthesized);
    records.sort_by(|a, b| b.time.cmp(&a.time));
    records
}

/// Every stored archived-session snapshot, cached against the database
/// generation and path.
///
/// `list_archived_sessions` opens a connection, a transaction and reads the
/// whole table; both `get_summary` and `get_day_detail` hit it on every call.
/// Every write path bumps `db::generation()`, so a freshly stored snapshot is
/// visible on the next read.
static ARCHIVE_CACHE: Mutex<Option<ArchiveCacheEntry>> = Mutex::new(None);

struct ArchiveCacheEntry {
    generation: u64,
    path: PathBuf,
    rows: Arc<Vec<ArchivedSessionSnapshot>>,
}

fn archived_sessions_cached() -> Arc<Vec<ArchivedSessionSnapshot>> {
    let generation = crate::db::generation();
    let path = crate::db::db_path();
    let mut cache = ARCHIVE_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(entry) = cache.as_ref() {
        if entry.generation == generation && entry.path == path {
            return Arc::clone(&entry.rows);
        }
    }
    // A failed read degrades to "nothing archived" exactly as the old
    // `unwrap_or_default` did, but is not cached: the next call retries.
    let rows = match crate::db::list_archived_sessions() {
        Ok(rows) => rows,
        Err(_) => return Arc::new(Vec::new()),
    };
    let rows = Arc::new(rows);
    *cache = Some(ArchiveCacheEntry {
        generation,
        path,
        rows: Arc::clone(&rows),
    });
    rows
}

/// The merged table, cached against the identity of the scan it was built from.
///
/// Synthesis is only reached when an archived session's directory is gone, and
/// then it costs an `exists()` probe per snapshot, a clone of the whole scan
/// and a re-sort — on every dashboard and day-detail call. Holding the scan
/// `Arc` itself in the entry (rather than just its address) keeps that
/// allocation alive, so no later allocation can land on the same address and be
/// mistaken for a cache hit.
///
/// A session dir becomes synthesizable only by disappearing, and the paths that
/// remove one (`delete_session`/`delete_workspace`) take its `wire.jsonl` with
/// it, which moves the scan and so the cache key. A dir that never held a
/// `wire.jsonl` contributes no day stats, so its removal leaves this table
/// unchanged either way.
static MERGE_CACHE: Mutex<Option<MergeCacheEntry>> = Mutex::new(None);

struct MergeCacheEntry {
    scan: Arc<Vec<UsageRecord>>,
    generation: u64,
    home: PathBuf,
    merged: Arc<Vec<UsageRecord>>,
}

/// Live scan records plus the stored usage of archived sessions whose files
/// have been deleted, so dashboard stats survive session deletion.
///
/// The scanned `Arc` is handed straight back — same pointer, no copy — unless
/// there is something to append. Both "nothing archived" and "archived but
/// every session directory still exists" take that path: the second case is
/// the common one (the archiver only marks state, it does not delete), and
/// the synthesis is skipped before the clone so an all-still-present archive
/// costs no memory traffic at all. The rebuilt table is cached, so repeated
/// calls over an unchanged scan skip the clone and the re-sort too.
///
/// Skipping the merge when the synthesis is empty is byte-for-byte equivalent:
/// the scan result is already sorted newest-first, `Vec::extend` with an empty
/// iterator is a no-op, and `sort_by` is a stable sort, which leaves an
/// already-sorted input in its exact original order.
fn records_with_archive_merge(home: &Path, records: Arc<Vec<UsageRecord>>) -> Arc<Vec<UsageRecord>> {
    let generation = crate::db::generation();
    {
        let cache = MERGE_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = cache.as_ref() {
            if entry.generation == generation
                && entry.home.as_path() == home
                && Arc::ptr_eq(&entry.scan, &records)
            {
                return Arc::clone(&entry.merged);
            }
        }
    }
    let rows = archived_sessions_cached();
    if rows.is_empty() { return records; }
    let synthesized = synthesize_snapshot_records(&rows, home);
    if synthesized.is_empty() { return records; }
    let merged = Arc::new(merge_snapshot_records((*records).clone(), synthesized));
    *MERGE_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some(MergeCacheEntry {
        scan: Arc::clone(&records),
        generation,
        home: home.to_path_buf(),
        merged: Arc::clone(&merged),
    });
    merged
}

// ---------------------------------------------------------------------------
// Scan cache
// ---------------------------------------------------------------------------

static SCAN_CACHE: Mutex<Option<ScanCacheState>> = Mutex::new(None);

/// Set while a background verification walk is running, so a burst of
/// dashboard calls spawns exactly one.
static SCAN_VERIFY_IN_FLIGHT: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Drop everything the incremental cache holds for tests, including the
/// scan-input cache: a stale entry there would outlive its temp home and hide
/// a config change from the parse cache. Production never calls this — a stale
/// cache is corrected by the file stats, not by a purge.
///
/// The derived caches and the cached SQLite connection go with it: each is keyed
/// on a `static` the previous test may have left pointing at its own temp home
/// or database, and the summary cache's `Arc` identity check is only sound while
/// every holder of the old table is dropped at the same moment.
#[cfg(test)]
fn clear_scan_cache() {
    *SCAN_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *SCAN_INPUTS_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *SUMMARY_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *ARCHIVE_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *MERGE_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None;
    crate::db::close_cached_conn_for_tests();
}

/// Test-facing wrapper over `scan_usage_cached` that drops the "was this served
/// unverified from the disk snapshot?" flag. Existing tests care only about the
/// table and its meta.
#[cfg(test)]
fn scan_usage_cached2(home: &Path, refresh: bool) -> (Arc<Vec<UsageRecord>>, ScanMeta) {
    let (records, meta, _unverified) = scan_usage_cached(home, refresh);
    (records, meta)
}

/// Serializes the tests that touch process-global state — the two `static`
/// caches and the `KIMI_SWITCH_DB_PATH` override. A test that mutates either
/// takes this lock, so a parallel test can never observe another one's temp
/// home, redirected database or purged cache.
#[cfg(test)]
fn test_state_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// The record table is shared behind an `Arc` so the unchanged path hands out
/// a pointer bump instead of a deep copy of the whole scan (tens of thousands
/// of records on a used install).
///
/// `refresh=true` forces every file to be re-parsed (the cache for this home
/// is dropped first), matching the old "bypass the cache" semantics; an
/// ordinary call only re-parses files whose (mtime, len) moved.
///
/// A table written by an earlier process is loaded from disk on the first call
/// and served immediately, so a restart re-parses nothing *and* skips the walk:
/// on a 1070-file / 1 GB tree the walk alone (enumerate + stat) costs ~0.74 s,
/// which is most of the "first load is slow" complaint even when nothing needs
/// parsing. The snapshot answers that one call; the walk then verifies it in the
/// background and reports any difference through `RECORDS_UPDATED_EVENT`.
///
/// The skip is one-shot. The flag is cleared as the snapshot is served, so every
/// later call walks and cannot serve the same unverified table twice; and a call
/// served from the snapshot says so in its `ScanMeta`, which is what tells
/// `get_summary` to schedule the verification at all.
fn scan_usage_cached(home: &Path, refresh: bool) -> (Arc<Vec<UsageRecord>>, ScanMeta, bool) {
    let home_s = home.to_string_lossy().to_string();
    let inputs = resolve_scan_inputs(home);
    let mut cache = SCAN_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    // A different home or a moved parsing input invalidates every cached
    // parse, so the owner is replaced wholesale rather than patched.
    let reusable = cache
        .as_ref()
        .is_some_and(|s| !refresh && s.home == home_s && s.parse_ctx == inputs.fingerprint);
    if !reusable {
        let loaded = if refresh {
            None
        } else {
            load_disk_cache(home, &inputs.fingerprint)
        };
        *cache = Some(match loaded {
            Some(disk) => scan_state_from_disk(disk),
            None => ScanCacheState {
                home: home_s.clone(),
                parse_ctx: inputs.fingerprint.clone(),
                files: HashMap::new(),
                result: None,
                // Nothing is on disk for this state yet, so the first walk has
                // everything to write.
                dirty: true,
                written_at_ms: 0,
                pending_verification: false,
                files_scanned: 0,
                lines_seen: 0,
            },
        });
    }
    let state = cache.as_mut().expect("state just installed");

    if state.pending_verification {
        // Hand out the snapshot unverified, exactly once. The counts stored
        // with it belong to the walk that wrote it, so the payload matches what
        // an unchanged walk would report.
        state.pending_verification = false;
        let result = Arc::clone(state.result.as_ref().expect("disk state carries a table"));
        let meta = ScanMeta {
            files_scanned: state.files_scanned,
            lines_seen: state.lines_seen,
            record_count: result.len(),
            home: home_s.clone(),
            sessions_root: sessions_root(home).to_string_lossy().to_string(),
            errors: vec![],
        };
        return (result, meta, true);
    }

    let (records, meta) = scan_usage_incremental(state, home, &inputs);

    // Persist the parses so the next process can start without reading the tree.
    // Only worth writing when something is not already on disk: an unchanged
    // table is byte-for-byte what the loaded snapshot already holds. The encode
    // costs ~1s for ~25 MB, so it goes to a worker thread and is rate-limited; a
    // busy tree keeps the previous snapshot rather than paying that on every
    // refresh.
    if state.dirty {
        let due = state.written_at_ms == 0
            || now_ms().saturating_sub(state.written_at_ms) >= SCAN_DISK_WRITE_INTERVAL_MS;
        if due {
            let disk = state.to_disk();
            state.written_at_ms = disk.written_at_ms;
            state.dirty = false;
            save_disk_cache_async(disk);
        }
    }
    (records, meta, false)
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
            models_by_name: vec![],
            recent: vec![],
            recent_total: 0,
            recent_limit: 500,
        };
    }

    let mut totals = TotalsRow::default();
    let mut by_day: HashMap<String, (TotalsRow, HashMap<String, TotalsRow>, HashMap<String, HashMap<String, u64>>)> = HashMap::new();
    let mut by_model: HashMap<String, (ModelRow, TotalsRow)> = HashMap::new();
    let mut by_name: HashMap<String, (ModelRow, TotalsRow)> = HashMap::new();

    for r in &filtered {
        totals.add(r);
        let dk = day_key(r.time);
        let (day_totals, day_models, day_prov_models) = by_day.entry(dk.clone()).or_default();
        day_totals.add(r);
        day_models.entry(r.model.clone()).or_default().add(r);
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

        // Provider-agnostic bucket: secondary (subagent) records keep the
        // stable "__secondary__" marker; everything else keys on the bare
        // model name so the same model across providers merges into one row.
        let nk = if r.is_secondary { "__secondary__".to_string() } else { r.model_resolved.clone() };
        let name_entry = by_name.entry(nk.clone()).or_insert_with(|| {
            let m = ModelRow {
                model: nk.clone(),
                model_display: nk.clone(),
                model_resolved: nk.clone(),
                price_id: r.price_id.clone(),
                cost_estimated: r.cost_estimated,
                is_secondary: r.is_secondary,
                requests: 0, input_other: 0, output: 0,
                input_cache_read: 0, input_cache_creation: 0,
                cost_usd: 0.0, total_tokens: 0, cache_hit_rate: 0.0,
            };
            (m, TotalsRow::default())
        });
        name_entry.1.add(r);
        name_entry.0.cost_estimated = name_entry.0.cost_estimated || r.cost_estimated;
        name_entry.0.is_secondary = name_entry.0.is_secondary || r.is_secondary;
    }

    let total_input = totals.input_other + totals.input_cache_read + totals.input_cache_creation;
    totals.cache_hit_rate = if total_input > 0 { totals.input_cache_read as f64 / total_input as f64 } else { 0.0 };

    let mut daily: Vec<DailyRow> = by_day.into_iter()
        .map(|(date, (t, by_model, by_provider_model))| {
            let ti = t.input_other + t.input_cache_read + t.input_cache_creation;
            let ch = if ti > 0 { t.input_cache_read as f64 / ti as f64 } else { 0.0 };
            // Per-model cache_hit_rate (not cumulative; computed from the
            // model's own input token split).
            let by_model_finalized: HashMap<String, TotalsRow> = by_model
                .into_iter()
                .map(|(k, mut mt)| {
                    let mi = mt.input_other + mt.input_cache_read + mt.input_cache_creation;
                    mt.cache_hit_rate = if mi > 0 { mt.input_cache_read as f64 / mi as f64 } else { 0.0 };
                    (k, mt)
                })
                .collect();
            DailyRow {
                date, requests: t.requests,
                input_other: t.input_other, output: t.output,
                input_cache_read: t.input_cache_read, input_cache_creation: t.input_cache_creation,
                cost_usd: t.cost_usd, total_tokens: t.total_tokens, cache_hit_rate: ch,
                by_model: by_model_finalized,
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

    let mut models_by_name: Vec<ModelRow> = by_name.into_iter().map(|(_, (mut m, t))| {
        let ti = t.input_other + t.input_cache_read + t.input_cache_creation;
        m.cache_hit_rate = if ti > 0 { t.input_cache_read as f64 / ti as f64 } else { 0.0 };
        m.requests = t.requests;
        m.input_other = t.input_other; m.output = t.output;
        m.input_cache_read = t.input_cache_read; m.input_cache_creation = t.input_cache_creation;
        m.cost_usd = t.cost_usd; m.total_tokens = t.total_tokens;
        m
    }).collect();
    models_by_name.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));

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
        models_by_name,
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

/// The all-time model table for the summary payload, in one pass that
/// accumulates only the fields `AllModelRow` carries.
///
/// Field-for-field equivalent to mapping `aggregate(records, "all", ..).models`
/// (first-seen `model_display`, OR-folded `cost_estimated`, `total_tokens`
/// descending) but without building the daily / recent / provider breakdowns
/// that the mapping discarded — those were a second full pass over every record
/// on every summary call.
fn build_all_models(records: &[UsageRecord]) -> Vec<AllModelRow> {
    let mut by_model: HashMap<String, (String, TotalsRow, bool)> = HashMap::new();
    for r in records {
        let entry = by_model
            .entry(r.model.clone())
            .or_insert_with(|| (r.model_display.clone(), TotalsRow::default(), r.cost_estimated));
        entry.1.add(r);
        entry.2 = entry.2 || r.cost_estimated;
    }

    let mut models: Vec<AllModelRow> = by_model
        .into_iter()
        .map(|(model, (model_display, t, cost_estimated))| {
            let ti = t.input_other + t.input_cache_read + t.input_cache_creation;
            AllModelRow {
                model,
                model_display,
                requests: t.requests,
                total_tokens: t.total_tokens,
                cost_usd: t.cost_usd,
                cost_estimated,
                cache_hit_rate: if ti > 0 { t.input_cache_read as f64 / ti as f64 } else { 0.0 },
            }
        })
        .collect();
    models.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));
    models
}

fn filter_by_range<'a>(records: &'a [UsageRecord], range: &str, now_ms: u64) -> Vec<&'a UsageRecord> {
    if range == "all" { return records.iter().collect(); }
    let start = range_start(range, now_ms);
    match range_end(range, now_ms) {
        Some(end) => records.iter().filter(|r| r.time >= start && r.time < end).collect(),
        None => records.iter().filter(|r| r.time >= start).collect(),
    }
}

/// Totals for every dashboard range in one pass over `records`, instead of one
/// full scan per range. Membership follows `filter_by_range` exactly, and the
/// accumulation/finalization mirror `aggregate`'s so the numbers are identical.
fn range_totals_single_pass(records: &[UsageRecord], now_ms: u64) -> HashMap<String, TotalsRow> {
    const RANGES: [&str; 5] = ["today", "yesterday", "7d", "30d", "all"];
    let mut starts = [0u64; 5];
    let mut ends: [Option<u64>; 5] = [None; 5];
    for (i, r) in RANGES.iter().enumerate() {
        starts[i] = range_start(r, now_ms);
        ends[i] = range_end(r, now_ms);
    }

    let mut totals: [TotalsRow; 5] = std::array::from_fn(|_| TotalsRow::default());
    for rec in records {
        for i in 0..RANGES.len() {
            let in_range = if RANGES[i] == "all" {
                true
            } else {
                match ends[i] {
                    Some(end) => rec.time >= starts[i] && rec.time < end,
                    None => rec.time >= starts[i],
                }
            };
            if in_range { totals[i].add(rec); }
        }
    }

    RANGES
        .iter()
        .zip(totals)
        .map(|(range, mut t)| {
            let total_input = t.input_other + t.input_cache_read + t.input_cache_creation;
            t.cache_hit_rate = if total_input > 0 { t.input_cache_read as f64 / total_input as f64 } else { 0.0 };
            (range.to_string(), t)
        })
        .collect()
}

/// Upper bound (exclusive) for bounded ranges. Only "yesterday" has one —
/// it must not bleed into today.
fn range_end(range: &str, now_ms: u64) -> Option<u64> {
    match range {
        "yesterday" => Some(local_midnight_ms(now_ms, 0)),
        _ => None,
    }
}

/// LOCAL midnight `days_ago` days before today, in epoch ms. Not UTC midnight:
/// without local-midnight anchoring, users east of UTC see day boundaries at
/// the wrong hour (e.g. UTC+8 users get cutoff at local 08:00).
fn local_midnight_ms(now_ms: u64, days_ago: i64) -> u64 {
    let now_utc = DateTime::from_timestamp((now_ms / 1000) as i64, 0).unwrap_or_default();
    let now_local = now_utc.with_timezone(&Local);
    let date = now_local.date_naive() - chrono::Duration::days(days_ago);
    let day_start = date.and_hms_opt(0, 0, 0).unwrap_or_default();
    Local
        .from_local_datetime(&day_start)
        .single()
        .map(|dt| dt.timestamp() as u64 * 1000)
        .unwrap_or_else(|| day_start.and_utc().timestamp() as u64 * 1000)
}

fn range_start(range: &str, now_ms: u64) -> u64 {
    match range {
        "today" => local_midnight_ms(now_ms, 0),
        "yesterday" => local_midnight_ms(now_ms, 1),
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

/// Whether a session is archived per its `state.json` metadata: the
/// kimi-code v2 engine writes `archived: true` (plus an `archivedAt` epoch-ms
/// timestamp) when archiving and clears both on restore. Unparseable or
/// missing state.json counts as not archived (and won't panic).
fn read_state_archived(session_dir: &Path) -> bool {
    let sp = session_dir.join("state.json");
    let Ok(content) = fs::read_to_string(&sp) else { return false };
    let Ok(obj) = serde_json::from_str::<serde_json::Value>(&content) else { return false };
    obj.get("archived").and_then(|v| v.as_bool()).unwrap_or(false)
}

/// Set or clear the archived metadata on a session's `state.json`, preserving
/// every other field. Mirrors upstream kimi-code v2 `SessionMetadata.setArchived`:
/// archive writes `{ archived: true, archivedAt: Date.now() }` (epoch ms, same
/// `Date.now()` format as the CLI), restore writes `{ archived: false }` and
/// drops the `archivedAt` key; `updatedAt` is untouched in both cases.
/// The write is atomic (tmp file + rename), same pattern as the plugin store.
/// Missing or malformed state.json returns a descriptive error, never a panic.
fn set_session_archived_meta(session_dir: &Path, archived: bool) -> Result<(), String> {
    let sp = session_dir.join("state.json");
    let content = fs::read_to_string(&sp).map_err(|e| format!("read state.json: {e}"))?;
    let mut obj: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("parse state.json: {e}"))?;
    let obj = obj
        .as_object_mut()
        .ok_or_else(|| "state.json is not a JSON object".to_string())?;
    obj.insert("archived".into(), serde_json::Value::Bool(archived));
    if archived {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        obj.insert("archivedAt".into(), serde_json::Value::Number(now_ms.into()));
    } else {
        obj.remove("archivedAt");
    }
    let out = serde_json::to_string(&obj).map_err(|e| format!("serialize state.json: {e}"))?;
    let tmp = sp.with_file_name("state.json.tmp");
    fs::write(&tmp, out).map_err(|e| format!("write state.json: {e}"))?;
    fs::rename(&tmp, &sp).map_err(|e| format!("commit state.json: {e}"))?;
    Ok(())
}

/// Parse a `state.json` timestamp into epoch ms. kimi-code writes epoch-ms
/// numbers, other builds write ISO-8601 strings — accept both, plus numeric
/// strings.
fn parse_state_time_ms(value: &serde_json::Value) -> Option<u64> {
    match value {
        serde_json::Value::Number(n) => n.as_u64().or_else(|| n.as_f64().map(|f| f.max(0.0) as u64)),
        serde_json::Value::String(s) => parse_time_string_ms(s),
        _ => None,
    }
}

fn parse_time_string_ms(s: &str) -> Option<u64> {
    let t = s.trim();
    if t.is_empty() { return None; }
    if let Ok(n) = t.parse::<u64>() {
        // Numeric string: epoch ms when it is already millisecond-sized.
        return Some(if n >= 1e12 as u64 { n } else { n * 1000 });
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(t) {
        return Some(dt.timestamp_millis().max(0) as u64);
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(t, fmt) {
            return Some(naive.and_utc().timestamp_millis().max(0) as u64);
        }
    }
    None
}

/// Read a session's `state.json` as a JSON object (None when missing or
/// unparseable).
fn read_state_obj(session_dir: &Path) -> Option<serde_json::Value> {
    let content = fs::read_to_string(session_dir.join("state.json")).ok()?;
    let obj: serde_json::Value = serde_json::from_str(&content).ok()?;
    if obj.is_object() { Some(obj) } else { None }
}

/// Session directory mtime in epoch ms — the fallback when `state.json` has
/// no parseable `updatedAt`.
fn dir_mtime_ms(dir: &Path) -> Option<u64> {
    dir.metadata().ok().and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

/// Usage records of one session: every `wire.jsonl` below its directory
/// (agent subdirectories included), with the same blob/task filtering the
/// full-tree scan applies.
fn parse_session_wire_usage(
    dir: &Path,
    secondary_alias: &Option<String>,
    alias2prov: &HashMap<String, String>,
) -> Vec<UsageRecord> {
    let mut records = Vec::new();
    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        if entry.file_name() != "wire.jsonl" || !entry.file_type().is_file() { continue; }
        let p = entry.path();
        if p.to_string_lossy().contains("blobs") || p.to_string_lossy().contains("tasks") { continue; }
        let Ok(content) = fs::read_to_string(p) else { continue };
        records.extend(parse_wire_usage_records(&content, secondary_alias, alias2prov));
    }
    records
}

/// Bulk-archive every active session whose last activity predates `cutoff_ms`
/// (epoch ms) and store a usage snapshot per session in SQLite, so dashboard
/// stats keep counting their history after the directories are deleted.
/// Sessions already archived, in `.kcd-archive`, or without a readable
/// `state.json` are left alone.
fn archive_sessions_before_cmd(home: &Path, cutoff_ms: u64) -> BulkArchiveResult {
    let root = sessions_root(home);
    let alias2prov = build_alias_provider_map(home);
    let secondary_alias = read_secondary_model_alias(home);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let mut result = BulkArchiveResult { archived: 0, skipped: 0, errors: Vec::new() };

    for wid in list_workspace_dirs(home) {
        for entry in safe_read_dir(&root.join(&wid)) {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
            let sid = entry.file_name().to_string_lossy().to_string();
            if !session_re().is_match(&sid) { continue; }
            let dir = entry.path();
            let Some(state) = read_state_obj(&dir) else {
                result.skipped += 1;
                continue;
            };
            if state.get("archived").and_then(|v| v.as_bool()).unwrap_or(false) { continue; }
            let Some(updated_ms) = state
                .get("updatedAt")
                .and_then(parse_state_time_ms)
                .or_else(|| dir_mtime_ms(&dir))
            else {
                result.skipped += 1;
                continue;
            };
            if updated_ms >= cutoff_ms {
                result.skipped += 1;
                continue;
            }

            if let Err(e) = set_session_archived_meta(&dir, true) {
                result.errors.push(format!("{wid}/{sid}: {e}"));
                continue;
            }
            let day_stats = snapshot_from_records(&parse_session_wire_usage(
                &dir, &secondary_alias, &alias2prov,
            ));
            let mut total_tokens = 0u64;
            let mut total_cost_usd = 0.0f64;
            for day in &day_stats {
                for m in &day.models {
                    total_tokens += m.input_other + m.output + m.input_cache_read + m.input_cache_creation;
                    total_cost_usd += m.cost_usd;
                }
            }
            let snapshot = ArchivedSessionSnapshot {
                session_id: sid.clone(),
                workspace_id: wid.clone(),
                title: state.get("title").and_then(|v| v.as_str()).map(|s| s.to_string()),
                archived_at_ms: now_ms,
                updated_at_ms: Some(updated_ms),
                created_at_ms: state.get("createdAt").and_then(parse_state_time_ms),
                total_tokens,
                total_cost_usd,
                day_stats,
            };
            result.archived += 1;
            if let Err(e) = crate::db::upsert_archived_session(&snapshot) {
                result.errors.push(format!("{wid}/{sid}: snapshot: {e}"));
            }
        }
    }
    result
}

fn humanize_workspace(id: &str) -> String {
    let re = Regex::new(r"^wd_(.+)_[0-9a-fA-F]{8,}$").unwrap();
    if let Some(caps) = re.captures(id) {
        caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_else(|| id.to_string())
    } else {
        id.to_string()
    }
}

/// List session rows under one directory. `in_archive_dir` marks `.kcd-archive`
/// (legacy physical archive); a session is additionally archived when its own
/// `state.json` carries `archived: true` — so CLI-v2 metadata-archived sessions
/// that still live at the active root are correctly classified.
fn list_sessions_in_dir(dir: &Path, workspace_id: &str, in_archive_dir: bool) -> Vec<SessionRow> {
    let mut sessions = Vec::new();
    if !dir.exists() { return sessions; }
    let re = session_re();
    for entry in safe_read_dir(dir) {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if !re.is_match(&name) { continue; }
        let archived = in_archive_dir || read_state_archived(&entry.path());
        let status = if archived { "archived" } else { "active" };
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
        // Merge both sources, deduping by session id (ids are UUIDs and never
        // reused; a stale legacy copy under .kcd-archive loses to the entry at
        // the active root). Status comes from each row, so metadata-archived
        // sessions surface in the archived filter and the archive-only counts.
        let mut by_id: HashMap<String, SessionRow> = HashMap::new();
        for row in list_sessions_in_dir(&active_dir, wid, false) {
            by_id.insert(row.id.clone(), row);
        }
        for row in list_sessions_in_dir(&arch_dir, wid, true) {
            by_id.entry(row.id.clone()).or_insert(row);
        }
        let all: Vec<SessionRow> = by_id.into_values().collect();
        let active_count = all.iter().filter(|s| s.status == "active").count();
        let archived_count = all.iter().filter(|s| s.status == "archived").count();
        let listed: Vec<SessionRow> = match status {
            "active" => all.iter().filter(|s| s.status == "active").cloned().collect(),
            "archived" => all.iter().filter(|s| s.status == "archived").cloned().collect(),
            _ => all,
        };

        let empty = active_count == 0 && archived_count == 0;
        workspaces.push(WorkspaceRow {
            id: wid.clone(), name, root: root_path,
            created_at: None, last_opened_at: None,
            active_count, archived_count, empty,
        });
        all_sessions.extend(listed);
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
    let dir = assert_safe_path(home, workspace_id, session_id)?;
    if !dir.exists() { return Err("session not found".into()); }
    // Metadata archive, matching upstream kimi-code v2: write `archived: true`
    // + `archivedAt` into state.json, leave the session directory in place, and
    // do NOT touch session_index.jsonl — archived state is derived from
    // state.json, and the CLI reconciles its own index mirror. A session
    // without a readable state.json gets a clear error rather than a panic.
    let sp = dir.join("state.json");
    if !sp.is_file() {
        return Err(format!("session {session_id} has no state.json; cannot archive"));
    }
    set_session_archived_meta(&dir, true)?;
    Ok(ActionResponse {
        ok: true, workspace_id: workspace_id.to_string(),
        session_id: session_id.to_string(), status: Some("archived".into()),
        path: Some(dir.to_string_lossy().to_string()), deleted: None,
    })
}

fn unarchive_session_cmd(home: &Path, workspace_id: &str, session_id: &str) -> Result<ActionResponse, String> {
    let dest = assert_safe_path(home, workspace_id, session_id)?;
    // 1) Legacy recovery: sessions physically moved to .kcd-archive by older
    //    KimiSwitch versions are moved back, then their metadata flag is
    //    cleared per upstream restore semantics (archived:false + archivedAt
    //    dropped). A missing state.json is fine here — there is no flag.
    let archived_dir = sessions_root(home).join(".kcd-archive").join(workspace_id).join(session_id);
    if archived_dir.exists() {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
        }
        fs::rename(&archived_dir, &dest).or_else(|_| {
            // cross-device fallback
            fs_extra::dir::copy(&archived_dir, dest.parent().unwrap(), &Default::default()).ok();
            fs::remove_dir_all(&archived_dir).ok();
            Ok::<(), String>(())
        }).map_err(|e: String| format!("move: {}", e))?;
        // The move already restored the session; a corrupt state.json must not
        // turn a successful restore into an error — the session simply lists
        // as active with its flag intact.
        if dest.join("state.json").is_file() {
            let _ = set_session_archived_meta(&dest, false);
        }
        return Ok(ActionResponse {
            ok: true, workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(), status: Some("active".into()),
            path: Some(dest.to_string_lossy().to_string()), deleted: None,
        });
    }
    // 2) Metadata-archived session: still at the active root, just clear the flag.
    if !dest.exists() { return Err("archived session not found".into()); }
    set_session_archived_meta(&dest, false)?;
    Ok(ActionResponse {
        ok: true, workspace_id: workspace_id.to_string(),
        session_id: session_id.to_string(), status: Some("active".into()),
        path: Some(dest.to_string_lossy().to_string()), deleted: None,
    })
}

fn delete_session_cmd(home: &Path, workspace_id: &str, session_id: &str, status_hint: Option<&str>) -> Result<ActionResponse, String> {
    let active = assert_safe_path(home, workspace_id, session_id)?;
    let archived = sessions_root(home).join(".kcd-archive").join(workspace_id).join(session_id);
    // Metadata-archived sessions still live at the active root, so a
    // status_hint of "archived" with no legacy .kcd-archive copy falls through
    // to the default arm and removes the in-place directory.
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
        let active_list = list_sessions_in_dir(&active_dir, workspace_id, false);
        if !active_list.is_empty() { return Err("workspace is not empty; archive/delete sessions first".into()); }
    }
    if arch_dir.exists() {
        let arch_list = list_sessions_in_dir(&arch_dir, workspace_id, true);
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
        // Metadata-archived sessions stay at the active root (kimi-code v2
        // writes state.json.archived, no physical move) — read them in place.
        Some("archived") if active.exists() => active,
        Some("active") if active.exists() => active,
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
        status: if session_dir.to_string_lossy().contains(".kcd-archive") || read_state_archived(&session_dir) {
            "archived".into()
        } else {
            "active".into()
        },
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

/// Everything `get_summary` derives from the record table, kept across calls so
/// switching range tabs, reopening the page or double-clicking the heatmap does
/// not re-traverse tens of thousands of records for numbers that cannot have
/// changed.
///
/// Invalidation is by identity, not by time:
/// - A new record table (any file changed, or `refresh=true`) is a different
///   allocation, so `Arc::ptr_eq` misses and everything is rebuilt. The entry
///   holds the `Arc` itself to keep that allocation alive, so a later table can
///   never be allocated onto the same address and pass the check.
/// - `all_models` and `heatmap` depend on the records and on the local calendar
///   day (the heatmap's right edge), so a day rollover rebuilds them.
/// - `range_totals` and `per_range` also depend on the clock: the 7d/30d windows
///   slide continuously and the today/yesterday edges are local midnights. Both
///   are recomputed once per minute bucket, so a range edge is at most a minute
///   behind the wall clock — the window only gains a record by that edge passing
///   over it, so the worst case is one refresh's worth of lag at the boundary.
static SUMMARY_CACHE: Mutex<Option<SummaryCacheEntry>> = Mutex::new(None);

struct SummaryCacheEntry {
    records: Arc<Vec<UsageRecord>>,
    day: String,
    minute_bucket: u64,
    all_models: Vec<AllModelRow>,
    heatmap: HeatmapData,
    range_totals: HashMap<String, TotalsRow>,
    per_range: HashMap<String, RangeStats>,
}

/// The cached view of `records` for `range` at `now_ms`, rebuilding only what
/// that call actually invalidated.
fn summary_view(
    records: &Arc<Vec<UsageRecord>>,
    range: &str,
    now_ms: u64,
) -> (RangeStats, Vec<AllModelRow>, HeatmapData, HashMap<String, TotalsRow>) {
    let day = day_key(now_ms);
    let minute_bucket = now_ms / 60_000;
    let mut cache = SUMMARY_CACHE.lock().unwrap_or_else(|e| e.into_inner());

    let reusable = cache
        .as_ref()
        .is_some_and(|e| e.day == day && Arc::ptr_eq(&e.records, records));
    if !reusable {
        *cache = Some(SummaryCacheEntry {
            records: Arc::clone(records),
            day,
            minute_bucket,
            all_models: build_all_models(records),
            heatmap: build_heatmap(records, now_ms),
            range_totals: range_totals_single_pass(records, now_ms),
            per_range: HashMap::new(),
        });
    }
    let entry = cache.as_mut().expect("entry just filled");

    if entry.minute_bucket != minute_bucket {
        entry.range_totals = range_totals_single_pass(records, now_ms);
        entry.per_range.clear();
        entry.minute_bucket = minute_bucket;
    }

    let stats = match entry.per_range.get(range) {
        Some(cached) => cached.clone(),
        None => {
            let computed = aggregate(records, range, now_ms);
            entry.per_range.insert(range.to_string(), computed.clone());
            computed
        }
    };

    (
        stats,
        entry.all_models.clone(),
        entry.heatmap.clone(),
        entry.range_totals.clone(),
    )
}

/// Event telling the dashboard that the background verification walk found
/// records the fast path did not have. The frontend re-fetches silently.
pub const RECORDS_UPDATED_EVENT: &str = "dashboard://records-updated";

/// Start a background verification walk if one is not already running.
///
/// The fast path serves the persisted parses, so its numbers can lag a session
/// still being written. The walk reuses every unchanged parse and marks the few
/// files that moved, which makes it cheap enough to run out of band — and its
/// cost is not on the request path, which is the whole point.
///
/// A change emits `RECORDS_UPDATED_EVENT` rather than refreshing anything
/// itself: the caches downstream key on the record table's address, so handing
/// out the new table is enough to invalidate them, and the frontend decides when
/// to re-read.
///
/// "Changed" is decided on the table's contents, not its address: the address
/// only proves the table was rebuilt, which happens even when a walk reproduces
/// exactly what the snapshot already held (a stale stat key, a file that could
/// not be read, a missing sessions root). Requiring a different record count
/// first keeps those no-op walks from waking the UI.
fn spawn_scan_verification(app: tauri::AppHandle, home: PathBuf, ui_ptr: usize, ui_len: usize) {
    use std::sync::atomic::Ordering;
    if SCAN_VERIFY_IN_FLIGHT
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("scan-verify".into())
        .spawn(move || {
            let t = std::time::Instant::now();
            // Blocks on `SCAN_CACHE` for the duration. Every dashboard call
            // during the walk waits on it, which is the same wait it would have
            // paid anyway — the walk is the work a non-cached call does.
            let (records, _, _) = scan_usage_cached(&home, false);
            let ptr = Arc::as_ptr(&records) as usize;
            let changed = records.len() != ui_len || ptr != ui_ptr;
            if changed {
                // Persist the verified parses so the next start is both fast
                // and complete.
                let disk = SCAN_CACHE
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .as_ref()
                    .map(|s| s.to_disk());
                if let Some(disk) = disk { save_disk_cache_async(disk); }
                let _ = tauri::Emitter::emit(&app, RECORDS_UPDATED_EVENT, ());
            }
            SCAN_VERIFY_IN_FLIGHT.store(false, Ordering::Release);
            eprintln!(
                "[dashboard] scan_verify records={} changed={} elapsed={:.0}ms",
                records.len(), changed, t.elapsed().as_secs_f64() * 1000.0
            );
        });
    if spawned.is_err() {
        // No thread available: clear the flag so a later call can retry rather
        // than latch the in-flight marker forever.
        SCAN_VERIFY_IN_FLIGHT.store(false, Ordering::Release);
    }
}

/// Assemble the whole `SummaryResult` for one record table.
///
/// Shared by the command and its tests so both exercise the exact same payload,
/// including the timing log.
fn summarize_records(
    home: &Path,
    r: String,
    now_ms: u64,
    records: Arc<Vec<UsageRecord>>,
    meta: ScanMeta,
    t0: std::time::Instant,
    t1: std::time::Instant,
) -> SummaryResult {
    let (stats, all_models, heatmap, range_totals) = summary_view(&records, &r, now_ms);

    let all_model_count = all_models.len();

    let default_model = None;
    let env_model = std::env::var("KIMI_MODEL_NAME").ok().map(|name| EnvModelInfo {
        name, provider: std::env::var("KIMI_MODEL_PROVIDER").ok(), model: std::env::var("KIMI_MODEL_ID").ok(),
    });

    let t2 = std::time::Instant::now();
    let scan_ms = t1.duration_since(t0).as_secs_f64() * 1000.0;
    let aggregate_ms = t2.duration_since(t1).as_secs_f64() * 1000.0;
    eprintln!(
        "[dashboard] get_summary range={} records={} scan={:.0}ms aggregate={:.0}ms total={:.0}ms",
        r, records.len(), scan_ms, aggregate_ms, t2.duration_since(t0).as_secs_f64() * 1000.0
    );

    SummaryResult {
        home: home.to_string_lossy().to_string(),
        valid: is_kimi_home(home),
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

/// The fast path of `get_summary` minus the app handle: scan, merge, then
/// summarize. Split out so tests drive the real pipeline — including the disk
/// cache and the summary cache — without needing a running Tauri app.
#[cfg(test)]
fn get_summary_no_app(home_override: Option<String>, range: Option<String>, refresh: Option<bool>) -> SummaryResult {
    let t0 = std::time::Instant::now();
    let refresh = refresh.unwrap_or(false);
    let home = resolve_kimi_home(home_override);
    let now_ms = now_ms();
    let r = range.unwrap_or_else(|| "30d".into());
    let (records, meta, _unverified) = scan_usage_cached(&home, refresh);
    let records = records_with_archive_merge(&home, records);
    let t1 = std::time::Instant::now();
    summarize_records(&home, r, now_ms, records, meta, t0, t1)
}

#[tauri::command(async)]
pub fn get_summary(
    app: tauri::AppHandle,
    home_override: Option<String>,
    range: Option<String>,
    refresh: Option<bool>,
) -> SummaryResult {
    let t0 = std::time::Instant::now();
    let refresh = refresh.unwrap_or(false);
    let home = resolve_kimi_home(home_override);
    let now_ms = now_ms();
    let r = range.unwrap_or_else(|| "30d".into());

    let (records, meta, unverified) = scan_usage_cached(&home, refresh);
    // The background walk compares against the *scan* table, so capture its
    // pointer and length before the archive merge replaces it — comparing a
    // merged table against a raw one would report a change on every cold start.
    let scan_ptr = Arc::as_ptr(&records) as usize;
    let scan_len = records.len();
    let records = records_with_archive_merge(&home, records);
    let t1 = std::time::Instant::now();

    // A cold start answers from the disk snapshot without walking, so its numbers
    // can be behind a session written since. Verify out of band: the walk emits
    // `RECORDS_UPDATED_EVENT` if anything moved, which pulls the UI forward once,
    // and leaves every later call here a cache hit. A call that already walked
    // (or was forced) is current and needs no second pass.
    if unverified {
        spawn_scan_verification(app, home.clone(), scan_ptr, scan_len);
    }

    summarize_records(&home, r, now_ms, records, meta, t0, t1)
}

/// Aggregate a single calendar day into a `DailyRow` — lazy detail for the
/// heatmap double-click modal. Returns `None` when the date has no records.
fn build_day_detail(date: &str, records: &[UsageRecord]) -> Option<DailyRow> {
    let mut t = TotalsRow::default();
    let mut by_model: HashMap<String, TotalsRow> = HashMap::new();
    let mut by_provider_model: HashMap<String, HashMap<String, u64>> = HashMap::new();
    let mut found = false;
    for r in records {
        if day_key(r.time) != date {
            continue;
        }
        found = true;
        t.add(r);
        by_model.entry(r.model.clone()).or_default().add(r);
        let p = r.provider.clone().unwrap_or_else(|| "unknown".to_string());
        *by_provider_model
            .entry(p)
            .or_default()
            .entry(r.model.clone())
            .or_insert(0) += r.input_other + r.output + r.input_cache_read + r.input_cache_creation;
    }
    if !found {
        return None;
    }
    let ti = t.input_other + t.input_cache_read + t.input_cache_creation;
    let ch = if ti > 0 { t.input_cache_read as f64 / ti as f64 } else { 0.0 };
    let by_model: HashMap<String, TotalsRow> = by_model
        .into_iter()
        .map(|(k, mut mt)| {
            let mi = mt.input_other + mt.input_cache_read + mt.input_cache_creation;
            mt.cache_hit_rate = if mi > 0 { mt.input_cache_read as f64 / mi as f64 } else { 0.0 };
            (k, mt)
        })
        .collect();
    Some(DailyRow {
        date: date.to_string(),
        requests: t.requests,
        input_other: t.input_other,
        output: t.output,
        input_cache_read: t.input_cache_read,
        input_cache_creation: t.input_cache_creation,
        cost_usd: t.cost_usd,
        total_tokens: t.total_tokens,
        cache_hit_rate: ch,
        by_model,
        by_provider: by_provider_model
            .iter()
            .map(|(p, m)| (p.clone(), m.values().sum::<u64>()))
            .collect(),
        by_provider_model,
    })
}

/// Lazy per-day detail for the heatmap double-click modal (fetched on demand,
/// so `get_summary` stays lean). Returns null when the date has no records.
#[tauri::command(async)]
pub fn get_day_detail(home_override: Option<String>, date: String) -> Option<DailyRow> {
    let home = resolve_kimi_home(home_override);
    let (records, _, _) = scan_usage_cached(&home, false);
    let records = records_with_archive_merge(&home, records);
    build_day_detail(&date, &records)
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

/// Bulk-archive every active session whose last activity predates `cutoff_ms`
/// (epoch ms) across all workspaces, storing a usage snapshot per session.
#[tauri::command]
pub fn archive_sessions_before(home_override: Option<String>, cutoff_ms: u64) -> BulkArchiveResult {
    let home = resolve_kimi_home(home_override);
    archive_sessions_before_cmd(&home, cutoff_ms)
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
        let kimi = idx.get("moonshotai/kimi-k3").copied().expect("kimi-k3 present");
        assert_eq!(kimi.input, 3.0);
        assert_eq!(kimi.output, 15.0);
        assert_eq!(kimi.cache_read, 0.3);
    }

    #[test]
    fn match_price_prefers_models_dev() {
        // Bare ids and prefixed ids both resolve via the suffix index.
        let (id, ch, input, output, est) = match_price("glm-4.6");
        assert!(!est);
        assert_eq!(id, "zhipuai/glm-4.6");
        assert_eq!(input, 0.6);
        assert_eq!(output, 2.2);

        let (id, _, _, _, est) = match_price("kimi/k3");
        assert!(!est);
        assert_eq!(id, "moonshotai/kimi-k3");
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
        assert_eq!(input, 0.15);
        assert_eq!(output, 0.6);
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

#[cfg(test)]
mod session_tests {
    use super::*;

    const WID: &str = "wd_proj_a1b2c3d4e5f6";
    const SID: &str = "session_11111111-2222-3333-4444-555555555555";

    fn setup_home() -> (tempfile::TempDir, PathBuf) {
        let td = tempfile::tempdir().unwrap();
        let home = td.path().join("home");
        fs::create_dir_all(home.join("sessions").join(WID)).unwrap();
        (td, home)
    }

    fn active_dir(home: &Path) -> PathBuf {
        home.join("sessions").join(WID)
    }

    fn legacy_arch_dir(home: &Path) -> PathBuf {
        home.join("sessions").join(".kcd-archive").join(WID)
    }

    fn write_state(session_dir: &Path, archived: bool, archived_at: Option<u64>) {
        let mut obj = serde_json::json!({
            "id": SID,
            "version": 2,
            "cwd": "/tmp/work",
            "createdAt": 1_700_000_000_000u64,
            "updatedAt": 1_700_000_000_000u64,
            "archived": archived,
            "title": "test session",
        });
        let o = obj.as_object_mut().unwrap();
        match archived_at {
            Some(at) => { o.insert("archivedAt".into(), serde_json::json!(at)); }
            None => { o.remove("archivedAt"); }
        }
        fs::write(session_dir.join("state.json"), serde_json::to_string(&obj).unwrap()).unwrap();
    }

    fn read_state_json(session_dir: &Path) -> serde_json::Value {
        serde_json::from_str(&fs::read_to_string(session_dir.join("state.json")).unwrap()).unwrap()
    }

    #[test]
    fn metadata_archive_roundtrip() {
        let (_td, home) = setup_home();
        let dir = active_dir(&home).join(SID);
        fs::create_dir_all(&dir).unwrap();
        write_state(&dir, false, None);

        // Fresh session lists as active.
        let res = list_sessions_cmd(&home, "all", None);
        assert_eq!(res.sessions.len(), 1);
        assert_eq!(res.sessions[0].status, "active");
        assert_eq!(res.workspaces[0].active_count, 1);
        assert_eq!(res.workspaces[0].archived_count, 0);

        // Archive is metadata-only: dir stays put, flag + epoch-ms archivedAt written.
        let ar = archive_session_cmd(&home, WID, SID).unwrap();
        assert_eq!(ar.status.as_deref(), Some("archived"));
        assert!(dir.exists(), "metadata archive must not move the session dir");
        assert!(!legacy_arch_dir(&home).join(SID).exists(), "nothing moves into .kcd-archive");
        let st = read_state_json(&dir);
        assert_eq!(st["archived"], true);
        let archived_at = st["archivedAt"].as_u64().expect("archivedAt as epoch ms");
        assert!(archived_at > 0, "archivedAt is a Date.now()-style epoch-ms number");

        // List reflects the new status.
        let res = list_sessions_cmd(&home, "all", None);
        assert_eq!(res.sessions[0].status, "archived");
        assert_eq!(res.workspaces[0].active_count, 0);
        assert_eq!(res.workspaces[0].archived_count, 1);
        assert!(list_sessions_cmd(&home, "active", None).sessions.is_empty());
        assert_eq!(list_sessions_cmd(&home, "archived", None).sessions.len(), 1);

        // Unarchive clears the flag in place (archived:false, archivedAt dropped).
        let ur = unarchive_session_cmd(&home, WID, SID).unwrap();
        assert_eq!(ur.status.as_deref(), Some("active"));
        assert!(dir.exists(), "unarchive must not move the dir either");
        let st = read_state_json(&dir);
        assert_eq!(st["archived"], false);
        assert!(st.get("archivedAt").is_none(), "archivedAt key removed on restore");

        let res = list_sessions_cmd(&home, "all", None);
        assert_eq!(res.sessions[0].status, "active");
        assert_eq!(res.workspaces[0].active_count, 1);
        assert_eq!(res.workspaces[0].archived_count, 0);
    }

    #[test]
    fn metadata_archive_preserves_other_state_fields() {
        let (_td, home) = setup_home();
        let dir = active_dir(&home).join(SID);
        fs::create_dir_all(&dir).unwrap();
        let mut obj = serde_json::json!({
            "id": SID,
            "version": 2,
            "cwd": "/repo",
            "createdAt": 1,
            "updatedAt": 2,
            "archived": false,
            "title": "keep me",
            "custom": { "goal": "x" },
            "agents": { "main": { "type": "main" } },
        });
        obj.as_object_mut().unwrap().insert("someFutureField".into(), serde_json::json!([1, 2, 3]));
        fs::write(dir.join("state.json"), serde_json::to_string(&obj).unwrap()).unwrap();

        archive_session_cmd(&home, WID, SID).unwrap();
        unarchive_session_cmd(&home, WID, SID).unwrap();

        let st = read_state_json(&dir);
        assert_eq!(st["title"], "keep me");
        assert_eq!(st["custom"]["goal"], "x");
        assert_eq!(st["agents"]["main"]["type"], "main");
        assert_eq!(st["someFutureField"][0], 1);
        assert_eq!(st["updatedAt"], 2, "updatedAt untouched, like upstream touchUpdatedAt:false");
    }

    #[test]
    fn cli_archived_session_in_active_root_lists_as_archived() {
        // A session already carrying archived:true in state.json while still
        // living at the active root (written by kimi-code CLI v2 itself) must
        // surface in the archived filter / counts.
        let (_td, home) = setup_home();
        let dir = active_dir(&home).join(SID);
        fs::create_dir_all(&dir).unwrap();
        write_state(&dir, true, Some(1_700_000_000_000u64));
        fs::write(dir.join("wire.jsonl"), "").unwrap();

        let res = list_sessions_cmd(&home, "all", None);
        assert_eq!(res.sessions.len(), 1);
        assert_eq!(res.sessions[0].status, "archived");
        assert_eq!(res.workspaces[0].active_count, 0);
        assert_eq!(res.workspaces[0].archived_count, 1);
        assert!(list_sessions_cmd(&home, "active", None).sessions.is_empty());
        assert_eq!(list_sessions_cmd(&home, "archived", None).sessions.len(), 1);

        // Preview resolves it in place with status "archived".
        let pv = get_session_preview_cmd(&home, WID, SID, Some("archived")).unwrap();
        assert_eq!(pv.status, "archived");
    }

    #[test]
    fn legacy_kcd_archive_dir_still_listed_and_restored() {
        let (_td, home) = setup_home();
        let arch_dir = legacy_arch_dir(&home).join(SID);
        fs::create_dir_all(&arch_dir).unwrap();
        write_state(&arch_dir, false, None);

        // Legacy physical archive still shows as archived.
        let res = list_sessions_cmd(&home, "all", None);
        assert_eq!(res.sessions.len(), 1);
        assert_eq!(res.sessions[0].status, "archived");
        assert_eq!(res.workspaces[0].active_count, 0);
        assert_eq!(res.workspaces[0].archived_count, 1);
        assert!(list_sessions_cmd(&home, "active", None).sessions.is_empty());

        // Unarchive moves it back and clears the flag.
        let ur = unarchive_session_cmd(&home, WID, SID).unwrap();
        assert_eq!(ur.status.as_deref(), Some("active"));
        assert!(!arch_dir.exists(), "legacy .kcd-archive copy moved back");
        let restored = active_dir(&home).join(SID);
        assert!(restored.exists());
        let st = read_state_json(&restored);
        assert_eq!(st["archived"], false);
        assert!(st.get("archivedAt").is_none());

        let res = list_sessions_cmd(&home, "all", None);
        assert_eq!(res.sessions[0].status, "active");
        assert_eq!(res.workspaces[0].active_count, 1);
        assert_eq!(res.workspaces[0].archived_count, 0);
    }

    #[test]
    fn corrupt_state_json_archive_errors_without_panic() {
        let (_td, home) = setup_home();
        let dir = active_dir(&home).join(SID);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("state.json"), "{ this is not json").unwrap();

        let err = archive_session_cmd(&home, WID, SID).unwrap_err();
        assert!(err.contains("state.json"), "clear error mentioning state.json, got: {err}");
        assert!(dir.exists(), "failed archive leaves the session dir in place");
        assert_eq!(fs::read_to_string(dir.join("state.json")).unwrap(), "{ this is not json");
    }

    #[test]
    fn missing_state_json_archive_errors_without_panic() {
        let (_td, home) = setup_home();
        let dir = active_dir(&home).join(SID);
        fs::create_dir_all(&dir).unwrap();

        let err = archive_session_cmd(&home, WID, SID).unwrap_err();
        assert!(err.contains("no state.json"), "clear error, got: {err}");
        assert!(dir.exists());
    }

    #[test]
    fn delete_session_covers_metadata_archived() {
        // Status hint "archived" without a legacy .kcd-archive copy falls back
        // to removing the metadata-archived in-place directory.
        let (_td, home) = setup_home();
        let dir = active_dir(&home).join(SID);
        fs::create_dir_all(&dir).unwrap();
        write_state(&dir, true, Some(1_700_000_000_000u64));

        let del = delete_session_cmd(&home, WID, SID, Some("archived")).unwrap();
        assert_eq!(del.deleted, Some(true));
        assert!(!dir.exists(), "metadata-archived session deleted in place");
        assert!(!legacy_arch_dir(&home).join(SID).exists());
        assert!(list_sessions_cmd(&home, "all", None).sessions.is_empty());
    }
}

#[cfg(test)]
mod range_and_model_totals_tests {
    use super::*;

    fn rec(time: u64, model: &str, resolved: &str, secondary: bool) -> UsageRecord {
        UsageRecord {
            time,
            model: model.to_string(),
            input_other: 100,
            output: 50,
            input_cache_read: 50,
            input_cache_creation: 0,
            cost_usd: 0.01,
            cost_estimated: false,
            price_id: String::new(),
            model_resolved: resolved.to_string(),
            model_display: model.to_string(),
            provider: None,
            from_env: false,
            is_secondary: secondary,
        }
    }

    #[test]
    fn yesterday_range_is_bounded_to_yesterday() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        let today_start = local_midnight_ms(now, 0);
        let yesterday_start = local_midnight_ms(now, 1);
        assert!(yesterday_start < today_start, "yesterday midnight precedes today's");
        assert_eq!(range_end("yesterday", now), Some(today_start));
        assert_eq!(range_end("today", now), None);
        assert_eq!(range_end("7d", now), None);

        let records = vec![
            rec(yesterday_start + 1, "a/m1", "m1", false),   // yesterday → in
            rec(today_start + 1, "a/m1", "m1", false),       // today → out
            rec(yesterday_start.saturating_sub(1), "a/m1", "m1", false), // before → out
        ];
        let stats = aggregate(&records, "yesterday", now);
        assert_eq!(stats.totals.requests, 1, "only yesterday's record counts");
    }

    #[test]
    fn models_by_name_merges_providers_and_keeps_secondary() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        let records = vec![
            rec(now, "openai/gpt-x", "gpt-x", false),
            rec(now, "azure/gpt-x", "gpt-x", false),
            rec(now, "__secondary__", "__secondary__", true),
        ];
        let stats = aggregate(&records, "all", now);

        // by_model keeps provider-qualified rows separate
        assert_eq!(stats.models.len(), 3);
        // by_name merges the two gpt-x rows, subagent stays its own row
        assert_eq!(stats.models_by_name.len(), 2);
        let gptx = stats.models_by_name.iter().find(|m| m.model == "gpt-x").expect("merged gpt-x row");
        assert_eq!(gptx.requests, 2);
        assert_eq!(gptx.total_tokens, 2 * 200);
        let sub = stats.models_by_name.iter().find(|m| m.model == "__secondary__").expect("secondary row");
        assert!(sub.is_secondary);
        // sorted by total_tokens desc — every record has equal tokens here, so
        // just assert the set is complete and totals add up.
        let total: u64 = stats.models_by_name.iter().map(|m| m.total_tokens).sum();
        assert_eq!(total, 3 * 200);
    }

    fn rec_amounts(time: u64, tokens: (u64, u64, u64, u64), cost: f64) -> UsageRecord {
        UsageRecord {
            time,
            model: "openai/gpt-x".to_string(),
            input_other: tokens.0,
            output: tokens.1,
            input_cache_read: tokens.2,
            input_cache_creation: tokens.3,
            cost_usd: cost,
            cost_estimated: false,
            price_id: String::new(),
            model_resolved: "gpt-x".to_string(),
            model_display: "openai/gpt-x".to_string(),
            provider: Some("openai".to_string()),
            from_env: false,
            is_secondary: false,
        }
    }

    fn assert_totals_eq(got: &TotalsRow, want: &TotalsRow, range: &str) {
        assert_eq!(got.requests, want.requests, "{range}: requests");
        assert_eq!(got.input_other, want.input_other, "{range}: input_other");
        assert_eq!(got.output, want.output, "{range}: output");
        assert_eq!(got.input_cache_read, want.input_cache_read, "{range}: input_cache_read");
        assert_eq!(got.input_cache_creation, want.input_cache_creation, "{range}: input_cache_creation");
        assert_eq!(got.cost_usd, want.cost_usd, "{range}: cost_usd");
        assert_eq!(got.total_tokens, want.total_tokens, "{range}: total_tokens");
        assert_eq!(got.cache_hit_rate, want.cache_hit_rate, "{range}: cache_hit_rate");
    }

    #[test]
    fn single_pass_range_totals_match_per_range_aggregate() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        let today_start = local_midnight_ms(now, 0);
        let yesterday_start = local_midnight_ms(now, 1);
        let day = 24 * 3600 * 1000u64;

        let records = vec![
            // Boundary hits: exactly at (and just inside) each day edge.
            rec_amounts(today_start, (10, 1, 1, 0), 0.1),
            rec_amounts(today_start + 1, (20, 2, 2, 1), 0.2),
            rec_amounts(yesterday_start, (30, 3, 3, 0), 0.3),
            rec_amounts(yesterday_start + 1, (40, 4, 4, 2), 0.4),
            // Just before yesterday's midnight → outside yesterday and today.
            rec_amounts(yesterday_start.saturating_sub(1), (50, 5, 5, 5), 0.5),
            // Inside 7d / outside today+yesterday.
            rec_amounts(now - 3 * day, (60, 6, 6, 3), 0.6),
            // Exactly at the 7d cutoff → inside 7d.
            rec_amounts(now - 7 * day, (70, 7, 7, 7), 0.7),
            // 20d ago → only 30d and all.
            rec_amounts(now - 20 * day, (80, 8, 8, 4), 0.8),
            // 45d ago → only all.
            rec_amounts(now - 45 * day, (90, 9, 9, 9), 0.9),
            // Zero-token record: pins the cache_hit_rate 0/0 → 0.0 path.
            rec_amounts(now - 2 * day, (0, 0, 0, 0), 0.0),
        ];

        let single = range_totals_single_pass(&records, now);
        assert_eq!(single.len(), 5, "every dashboard range is present");
        for range in ["today", "yesterday", "7d", "30d", "all"] {
            let want = aggregate(&records, range, now).totals;
            let got = single.get(range).expect("range present in single pass");
            assert_totals_eq(got, &want, range);
        }

        // Sanity: the ranges really do differ, so the comparison above is not
        // trivially satisfied by all-equal numbers.
        let all = single.get("all").unwrap();
        let today = single.get("today").unwrap();
        assert_eq!(all.requests, records.len());
        assert_eq!(today.requests, 2, "only the two today-boundary records");
        assert!(all.requests > today.requests);
        assert!(all.cache_hit_rate > 0.0, "cache_hit_rate is finalized, not left at 0");
    }

    fn rec_for(time: u64, model: &str, tokens: (u64, u64, u64, u64), cost: f64) -> UsageRecord {
        UsageRecord {
            model: model.to_string(),
            model_display: model.to_string(),
            model_resolved: model.rsplit_once('/').map(|x| x.1).unwrap_or(model).to_string(),
            cost_estimated: false,
            price_id: String::new(),
            provider: None,
            from_env: false,
            is_secondary: false,
            ..rec_amounts(time, tokens, cost)
        }
    }

    /// `build_all_models` replaced a second full `aggregate(.., "all")` pass, so
    /// it must reproduce the mapped result exactly — every field of every row.
    ///
    /// Rows are paired by model key rather than by index: both paths sort by
    /// `total_tokens` descending with a stable sort out of a `HashMap`, so rows
    /// that tie on tokens may come out in either order — in the old code as much
    /// as in the new. The token sequence itself is still compared positionally,
    /// which is the part the sort does determine.
    #[test]
    fn build_all_models_matches_the_mapped_all_range_aggregate() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        let records = vec![
            rec_for(now, "openai/gpt-x", (10, 1, 2, 0), 0.1),
            rec_for(now - 1000, "openai/gpt-x", (20, 2, 0, 4), 0.2),
            // Same bare name under a second provider: two rows, not one.
            rec_for(now - 2000, "azure/gpt-x", (30, 3, 3, 3), 0.3),
            rec_for(now - 3000, "moonshotai/kimi-k3", (40, 4, 5, 0), 0.4),
            // A zero-token row pins the 0/0 → 0.0 cache-hit path.
            rec_for(now - 4000, "local/unknown", (0, 0, 0, 0), 0.0),
        ];

        let got = build_all_models(&records);
        let want: Vec<AllModelRow> = aggregate(&records, "all", now)
            .models
            .into_iter()
            .map(|m| AllModelRow {
                model: m.model,
                model_display: m.model_display,
                requests: m.requests,
                total_tokens: m.total_tokens,
                cost_usd: m.cost_usd,
                cost_estimated: m.cost_estimated,
                cache_hit_rate: m.cache_hit_rate,
            })
            .collect();

        assert_eq!(got.len(), want.len(), "same row count");
        assert_eq!(
            got.iter().map(|m| m.total_tokens).collect::<Vec<_>>(),
            want.iter().map(|m| m.total_tokens).collect::<Vec<_>>(),
            "the two paths agree on the sort order",
        );
        for b in &want {
            let a = got
                .iter()
                .find(|a| a.model == b.model)
                .unwrap_or_else(|| panic!("{} missing from build_all_models", b.model));
            assert_eq!(a.model_display, b.model_display, "{}: model_display", b.model);
            assert_eq!(a.requests, b.requests, "{}: requests", b.model);
            assert_eq!(a.total_tokens, b.total_tokens, "{}: total_tokens", b.model);
            assert_eq!(a.cost_usd, b.cost_usd, "{}: cost_usd", b.model);
            assert_eq!(a.cost_estimated, b.cost_estimated, "{}: cost_estimated", b.model);
            assert_eq!(a.cache_hit_rate, b.cache_hit_rate, "{}: cache_hit_rate", b.model);
        }
        // Ordering really is total_tokens-descending.
        assert!(got.windows(2).all(|w| w[0].total_tokens >= w[1].total_tokens));
    }

    /// `cost_estimated` is OR-folded across a model's records, exactly as the
    /// `aggregate` path folded it.
    #[test]
    fn build_all_models_folds_cost_estimated_across_records() {
        let now = 1_700_000_000_000u64;
        let mut estimated = rec_for(now - 1000, "openai/gpt-x", (1, 1, 0, 0), 0.1);
        estimated.cost_estimated = true;
        let records = vec![
            rec_for(now, "openai/gpt-x", (1, 1, 0, 0), 0.1),
            estimated,
        ];

        let got = build_all_models(&records);
        assert_eq!(got.len(), 1);
        assert!(got[0].cost_estimated, "one estimated record flags the whole row");
        assert_eq!(got[0].requests, 2);
    }

    /// A summary cache hit must be invisible: identical payload for a repeated
    /// call, and correct data after switching range.
    #[test]
    fn get_summary_serves_repeated_and_switched_ranges_correctly() {
        let _guard = test_state_lock();
        clear_scan_cache();
        let td = tempfile::tempdir().unwrap();
        let home = td.path().join("home");
        let dir = home.join("sessions").join("wd_proj_a1b2c3d4e5f6")
            .join("session_11111111-2222-3333-4444-555555555555");
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("KIMI_SWITCH_DB_PATH", td.path().join("test.db"));

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        let today_start = local_midnight_ms(now, 0);
        // One record inside today, one only inside 30d (and all).
        let lines = [
            (today_start + 1000, "openai/gpt-x"),
            (now - 3 * 24 * 3600 * 1000, "moonshotai/kimi-k3"),
        ];
        let body: String = lines
            .iter()
            .map(|(time, model)| {
                format!(
                    "{}\n",
                    serde_json::json!({
                        "type": "usage.record",
                        "usageScope": "turn",
                        "time": time,
                        "model": model,
                        "usage": {
                            "inputOther": 100,
                            "output": 50,
                            "inputCacheRead": 10,
                            "inputCacheCreation": 5,
                        },
                    })
                )
            })
            .collect();
        fs::write(dir.join("wire.jsonl"), body).unwrap();

        let home_arg = Some(home.to_string_lossy().to_string());
        let first = get_summary_no_app(home_arg.clone(), Some("30d".into()), Some(false));
        let second = get_summary_no_app(home_arg.clone(), Some("30d".into()), Some(false));
        let today = get_summary_no_app(home_arg.clone(), Some("today".into()), Some(false));

        assert_eq!(first.range, "30d");
        assert_eq!(first.stats.totals.requests, 2, "both records are inside 30d");
        assert_eq!(second.stats.totals.requests, first.stats.totals.requests);
        assert_eq!(second.stats.totals.total_tokens, first.stats.totals.total_tokens);
        assert_eq!(second.stats.daily.len(), first.stats.daily.len());
        assert_eq!(second.stats.recent.len(), first.stats.recent.len());
        assert_eq!(second.all_model_count, first.all_model_count);
        assert_eq!(second.range_totals.len(), first.range_totals.len());
        assert_eq!(
            second.range_totals.get("30d").map(|t| t.requests),
            first.range_totals.get("30d").map(|t| t.requests),
        );
        assert_eq!(second.heatmap.cells.len(), first.heatmap.cells.len());
        assert_eq!(second.meta.record_count, first.meta.record_count);

        assert_eq!(today.range, "today");
        assert_eq!(today.stats.totals.requests, 1, "only today's record");
        assert!(today.stats.totals.total_tokens < first.stats.totals.total_tokens);
        // The all-time payload is range-independent, so it must be unchanged by
        // the tab switch.
        assert_eq!(today.all_model_count, first.all_model_count);
        assert_eq!(
            today.all_models.iter().map(|m| m.total_tokens).sum::<u64>(),
            first.all_models.iter().map(|m| m.total_tokens).sum::<u64>(),
        );
        assert_eq!(
            today.range_totals.get("today").map(|t| t.requests),
            Some(1),
            "the range overview keeps using the live clock",
        );
    }

    /// The summary cache must serve the second call from memory: a sentinel
    /// planted in the entry comes back instead of a freshly computed value, for
    /// both the selected range and the range overview. A new record table (the
    /// only thing that moves meaningfully in production) must throw that entry
    /// away.
    #[test]
    fn summary_view_serves_selection_and_overview_from_cache() {
        let _guard = test_state_lock();
        clear_scan_cache();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        let records = Arc::new(vec![
            rec_for(now, "openai/gpt-x", (10, 1, 2, 0), 0.1),
            rec_for(now - 1000, "moonshotai/kimi-k3", (20, 2, 3, 0), 0.2),
        ]);

        let (stats, models, heatmap, totals) = summary_view(&records, "30d", now);
        assert_eq!(stats.totals.requests, 2);
        assert_eq!(models.len(), 2);
        assert!(!heatmap.cells.is_empty());
        assert_eq!(totals.get("30d").map(|t| t.requests), Some(2));

        // Plant sentinels in the cached entry, then ask again.
        {
            let mut cache = SUMMARY_CACHE.lock().unwrap_or_else(|e| e.into_inner());
            let entry = cache.as_mut().expect("first call populated the entry");
            let mut sentinel = RangeStats {
                range: "sentinel".into(),
                totals: TotalsRow::default(),
                daily: vec![],
                models: vec![],
                models_by_name: vec![],
                recent: vec![],
                recent_total: 0,
                recent_limit: 0,
            };
            sentinel.totals.requests = 999;
            entry.per_range.insert("30d".into(), sentinel);
            entry.range_totals.insert(
                "30d".into(),
                TotalsRow { requests: 888, ..TotalsRow::default() },
            );
        }
        let (stats, _, _, totals) = summary_view(&records, "30d", now);
        assert_eq!(stats.range, "sentinel", "the selected range came from the cache");
        assert_eq!(stats.totals.requests, 999);
        assert_eq!(
            totals.get("30d").map(|t| t.requests),
            Some(888),
            "the range overview came from the cache"
        );

        // A different record table is a different identity: rebuild everything.
        let fresh = Arc::new(vec![rec_for(now, "openai/gpt-x", (10, 1, 2, 0), 0.1)]);
        let (stats, models, _, totals) = summary_view(&fresh, "30d", now);
        assert_eq!(stats.range, "30d", "a new table must not serve the old entry");
        assert_eq!(stats.totals.requests, 1);
        assert_eq!(models.len(), 1);
        assert_eq!(totals.get("30d").map(|t| t.requests), Some(1));
    }

    /// The per-range aggregate is keyed on the range string, so switching tabs
    /// and switching back reuses the entry rather than recomputing it.
    #[test]
    fn summary_view_keeps_one_aggregate_per_range() {
        let _guard = test_state_lock();
        clear_scan_cache();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        let records = Arc::new(vec![rec_for(now, "openai/gpt-x", (10, 1, 2, 0), 0.1)]);

        for range in ["today", "7d", "all", "today", "30d"] {
            let _ = summary_view(&records, range, now);
        }

        let cache = SUMMARY_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        let entry = cache.as_ref().expect("calls populated the entry");
        assert_eq!(
            entry.per_range.len(),
            4,
            "one entry per distinct range visited, no repeats"
        );
        let mut keys: Vec<&str> = entry.per_range.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, vec!["30d", "7d", "all", "today"]);
        assert_eq!(entry.per_range.get("today").map(|s| s.range.as_str()), Some("today"));
    }
}

#[cfg(test)]
mod archive_snapshot_tests {
    use super::*;

    const WID: &str = "wd_proj_a1b2c3d4e5f6";
    const LIVE_SID: &str = "session_11111111-2222-3333-4444-555555555555";
    const GONE_SID: &str = "session_99999999-8888-7777-6666-555555555555";

    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
    }

    fn rec(time: u64, model: &str, tokens: (u64, u64, u64, u64), cost: f64) -> UsageRecord {
        UsageRecord {
            time,
            model: model.to_string(),
            input_other: tokens.0,
            output: tokens.1,
            input_cache_read: tokens.2,
            input_cache_creation: tokens.3,
            cost_usd: cost,
            cost_estimated: false,
            price_id: String::new(),
            model_resolved: model.rsplit_once('/').map(|x| x.1).unwrap_or(model).to_string(),
            model_display: model.to_string(),
            provider: None,
            from_env: false,
            is_secondary: false,
        }
    }

    fn snapshot_row(
        sid: &str,
        day_start_ms: u64,
        model: &str,
        tokens: u64,
    ) -> ArchivedSessionSnapshot {
        ArchivedSessionSnapshot {
            session_id: sid.to_string(),
            workspace_id: WID.to_string(),
            title: None,
            archived_at_ms: 0,
            updated_at_ms: None,
            created_at_ms: None,
            total_tokens: tokens,
            total_cost_usd: 0.0,
            day_stats: vec![DayStat {
                day: day_key(day_start_ms),
                day_start_ms,
                models: vec![DayModelStat {
                    model: model.to_string(),
                    requests: 2,
                    input_other: tokens,
                    output: 0,
                    input_cache_read: 0,
                    input_cache_creation: 0,
                    cost_usd: 1.5,
                }],
            }],
        }
    }

    fn write_state(dir: &Path, updated_ms: u64, archived: bool) {
        let state = serde_json::json!({
            "id": dir.file_name().unwrap().to_string_lossy(),
            "createdAt": updated_ms,
            "updatedAt": updated_ms,
            "archived": archived,
            "title": "archived candidate",
        });
        fs::write(dir.join("state.json"), state.to_string()).unwrap();
    }

    fn read_state(dir: &Path) -> serde_json::Value {
        serde_json::from_str(&fs::read_to_string(dir.join("state.json")).unwrap()).unwrap()
    }

    #[test]
    fn snapshot_groups_records_by_local_day_and_model() {
        let now = now_ms();
        let d1 = local_midnight_ms(now, 2);
        let d2 = local_midnight_ms(now, 1);
        let records = vec![
            rec(d1 + 3_600_000, "openai/gpt-x", (100, 10, 5, 1), 0.5),
            rec(d1 + 7_200_000, "openai/gpt-x", (200, 20, 0, 0), 0.25),
            rec(d1 + 60_000, "moonshotai/kimi-k3", (1, 2, 3, 4), 0.01),
            rec(d2 + 1_000, "openai/gpt-x", (7, 7, 7, 7), 0.07),
        ];
        let days = snapshot_from_records(&records);
        assert_eq!(days.len(), 2, "one bucket per local day");

        let first = &days[0];
        assert_eq!(first.day, day_key(d1));
        assert_eq!(first.day_start_ms, d1, "day bucket starts at local midnight");
        assert_eq!(first.models.len(), 2);
        let gpt = first.models.iter().find(|m| m.model == "openai/gpt-x").unwrap();
        assert_eq!(gpt.requests, 2);
        assert_eq!(gpt.input_other, 300);
        assert_eq!(gpt.output, 30);
        assert_eq!(gpt.input_cache_read, 5);
        assert_eq!(gpt.input_cache_creation, 1);
        assert_eq!(gpt.cost_usd, 0.75);
        // Deterministic ordering: models sorted by raw model key.
        assert_eq!(first.models[0].model, "moonshotai/kimi-k3");

        assert_eq!(days[1].day, day_key(d2));
        assert_eq!(days[1].day_start_ms, d2);
        assert_eq!(days[1].models.len(), 1);
        assert_eq!(days[1].models[0].input_other, 7);
    }

    #[test]
    fn synthesize_only_covers_sessions_whose_files_are_gone() {
        let _guard = test_state_lock();
        let td = tempfile::tempdir().unwrap();
        let home = td.path().join("home");
        fs::create_dir_all(home.join("sessions").join(WID).join(LIVE_SID)).unwrap();

        let day_start = 1_700_000_000_000u64;
        let rows = vec![
            snapshot_row(LIVE_SID, day_start, "openai/gpt-x", 100),
            snapshot_row(GONE_SID, day_start, "openai/gpt-x", 200),
        ];
        let out = synthesize_snapshot_records(&rows, &home);
        assert_eq!(out.len(), 1, "live session dirs stay with the live scan");

        let r = &out[0];
        assert_eq!(r.time, day_start);
        assert_eq!(r.model, "openai/gpt-x");
        assert_eq!(r.model_resolved, "gpt-x");
        assert_eq!(r.model_display, "openai/gpt-x");
        assert_eq!(r.provider.as_deref(), Some("openai"));
        assert_eq!(r.input_other, 200);
        assert_eq!(r.cost_usd, 1.5);
        assert!(r.cost_estimated, "snapshot costs are estimates");
        assert_eq!(r.price_id, "");
        assert!(!r.is_secondary);
        assert!(!r.from_env);
    }

    #[test]
    fn merge_appends_missing_sessions_newest_first_without_double_counting() {
        let _guard = test_state_lock();
        let td = tempfile::tempdir().unwrap();
        let home = td.path().join("home");
        fs::create_dir_all(home.join("sessions").join(WID).join(LIVE_SID)).unwrap();

        let now = now_ms();
        let old_day = local_midnight_ms(now, 5);
        let new_day = local_midnight_ms(now, 1);
        let gone_old = "session_22222222-2222-3333-4444-555555555555";
        let gone_new = "session_33333333-2222-3333-4444-555555555555";
        let rows = vec![
            snapshot_row(LIVE_SID, new_day, "openai/gpt-x", 999),
            snapshot_row(gone_old, old_day, "openai/gpt-x", 10),
            snapshot_row(gone_new, new_day, "openai/gpt-x", 20),
        ];
        let live = vec![rec(new_day + 5_000, "openai/gpt-x", (1, 1, 1, 1), 0.01)];
        let merged = merge_snapshot_records(live, synthesize_snapshot_records(&rows, &home));

        assert_eq!(merged.len(), 3, "live record plus the two missing sessions");
        assert_eq!(merged[0].time, new_day + 5_000, "newest record first");
        assert_eq!(merged[1].time, new_day);
        assert_eq!(merged[2].time, old_day);
        assert_eq!(merged[1].input_other, 20);
        assert_eq!(merged[2].input_other, 10);
        assert!(
            merged.iter().all(|r| r.input_other != 999),
            "a live session's stored snapshot must never be synthesized"
        );
    }

    #[test]
    fn state_times_parse_epoch_numbers_and_iso_strings() {
        assert_eq!(
            parse_state_time_ms(&serde_json::json!(1_700_000_000_000u64)),
            Some(1_700_000_000_000)
        );
        assert_eq!(
            parse_state_time_ms(&serde_json::json!("1700000000000")),
            Some(1_700_000_000_000)
        );
        assert_eq!(
            parse_state_time_ms(&serde_json::json!("2025-01-02T03:04:05.000Z")),
            Some(1_735_787_045_000)
        );
        assert_eq!(
            parse_state_time_ms(&serde_json::json!("2025-01-02T03:04:05")),
            Some(1_735_787_045_000)
        );
        assert_eq!(
            parse_state_time_ms(&serde_json::json!("2025-01-02 03:04:05")),
            Some(1_735_787_045_000)
        );
        assert_eq!(parse_state_time_ms(&serde_json::json!(null)), None);
        assert_eq!(parse_state_time_ms(&serde_json::json!("not-a-date")), None);
    }

    #[test]
    fn bulk_archive_flags_old_sessions_and_snapshots_their_usage() {
        // `KIMI_SWITCH_DB_PATH` is process-global and the archive row list is
        // read by `records_with_archive_merge`, so this test takes the shared
        // lock before touching either.
        let _guard = test_state_lock();
        clear_scan_cache();
        let td = tempfile::tempdir().unwrap();
        let home = td.path().join("home");
        // Redirect the SQLite store so the test never touches the user's DB.
        std::env::set_var("KIMI_SWITCH_DB_PATH", td.path().join("test.db"));

        let ws = home.join("sessions").join(WID);
        let now = now_ms();
        let old_ms = now - 60 * 24 * 3600 * 1000;

        let old_dir = ws.join(LIVE_SID);
        fs::create_dir_all(&old_dir).unwrap();
        write_state(&old_dir, old_ms, false);
        let wire = serde_json::json!({
            "type": "usage.record",
            "usageScope": "turn",
            "time": old_ms,
            "model": "openai/gpt-x",
            "usage": {
                "inputOther": 100,
                "output": 50,
                "inputCacheRead": 10,
                "inputCacheCreation": 5,
            },
        });
        fs::write(old_dir.join("wire.jsonl"), format!("{wire}\n")).unwrap();

        let new_sid = "session_44444444-2222-3333-4444-555555555555";
        let new_dir = ws.join(new_sid);
        fs::create_dir_all(&new_dir).unwrap();
        write_state(&new_dir, now - 3_600_000, false);

        let cutoff = now - 30 * 24 * 3600 * 1000;
        let res = archive_sessions_before_cmd(&home, cutoff);
        assert_eq!(res.archived, 1, "only the stale session is archived");
        assert_eq!(res.skipped, 1, "the recent session is reported as skipped");
        assert!(res.errors.is_empty(), "{:?}", res.errors);

        // Metadata archive happened in place, the recent session is untouched.
        assert_eq!(read_state(&old_dir)["archived"], true);
        assert!(read_state(&old_dir)["archivedAt"].as_u64().unwrap() > 0);
        assert_eq!(read_state(&new_dir)["archived"], false);

        // Usage snapshot landed in SQLite with the session's totals.
        let rows = crate::db::list_archived_sessions().unwrap();
        let row = rows.iter().find(|r| r.session_id == LIVE_SID).expect("snapshot row");
        assert_eq!(row.workspace_id, WID);
        assert_eq!(row.title.as_deref(), Some("archived candidate"));
        assert_eq!(row.updated_at_ms, Some(old_ms));
        assert_eq!(row.total_tokens, 165);
        assert!(row.total_cost_usd > 0.0);
        assert_eq!(row.day_stats.len(), 1);
        assert_eq!(row.day_stats[0].day, day_key(old_ms));
        assert_eq!(row.day_stats[0].models[0].requests, 1);
        assert_eq!(row.day_stats[0].models[0].input_other, 100);

        // While the files are still there, the live scan owns the usage.
        let merged = records_with_archive_merge(&home, Arc::new(vec![]));
        assert!(merged.is_empty(), "no synthesized records while the dir exists");

        // Once the archived directory is deleted, stats come from the snapshot.
        fs::remove_dir_all(&old_dir).unwrap();
        let merged = records_with_archive_merge(&home, Arc::new(vec![]));
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].input_other, 100);
        assert_eq!(merged[0].output, 50);
        assert_eq!(day_key(merged[0].time), day_key(old_ms));
    }

    /// An archive that has nothing to synthesize must hand the scanned table
    /// back untouched — same `Arc` pointer, no clone and no re-sort.
    ///
    /// This is the everyday case: the archiver only flags `archived: true` in
    /// `state.json` and keeps the directory, so every archived row is skipped
    /// by synthesis while the live scan still owns the usage.
    #[test]
    fn archive_rows_with_live_dirs_hand_back_the_same_arc() {
        let _guard = test_state_lock();
        clear_scan_cache();
        let td = tempfile::tempdir().unwrap();
        let home = td.path().join("home");
        std::env::set_var("KIMI_SWITCH_DB_PATH", td.path().join("test.db"));

        // The archived session's directory is still on disk.
        let dir = home.join("sessions").join(WID).join(LIVE_SID);
        fs::create_dir_all(&dir).unwrap();
        write_state(&dir, 1_700_000_000_000, true);
        crate::db::upsert_archived_session(&snapshot_row(
            LIVE_SID,
            1_700_000_000_000,
            "openai/gpt-x",
            100,
        ))
        .unwrap();
        assert_eq!(
            crate::db::list_archived_sessions().unwrap().len(),
            1,
            "the row exists, so the merge is not skipped by the empty-list check"
        );

        let records = Arc::new(vec![
            rec(1_700_000_600_000, "openai/gpt-x", (1, 1, 1, 1), 0.01),
            rec(1_700_000_300_000, "openai/gpt-x", (2, 2, 2, 2), 0.02),
            rec(1_700_000_000_000, "moonshotai/kimi-k3", (3, 3, 3, 3), 0.03),
        ]);
        let before = Arc::clone(&records);
        let after = records_with_archive_merge(&home, records);

        assert!(
            Arc::ptr_eq(&before, &after),
            "nothing to synthesize must return the identical Arc, not a rebuilt copy"
        );
        assert_eq!(after.len(), 3, "no synthesized record is appended");
        // The live table is already newest-first and must stay that way.
        assert!(after.windows(2).all(|w| w[0].time >= w[1].time));
    }

    /// ...and the merge really does fire (pointer changes) once the archived
    /// session's directory is gone.
    #[test]
    fn archive_rows_with_missing_dirs_rebuild_a_new_arc() {
        let _guard = test_state_lock();
        clear_scan_cache();
        let td = tempfile::tempdir().unwrap();
        let home = td.path().join("home");
        std::env::set_var("KIMI_SWITCH_DB_PATH", td.path().join("test.db"));
        fs::create_dir_all(home.join("sessions").join(WID)).unwrap();
        crate::db::upsert_archived_session(&snapshot_row(
            GONE_SID,
            1_700_000_000_000,
            "openai/gpt-x",
            100,
        ))
        .unwrap();

        let records = Arc::new(vec![rec(1_700_000_600_000, "openai/gpt-x", (1, 1, 1, 1), 0.01)]);
        let before = Arc::clone(&records);
        let after = records_with_archive_merge(&home, records);

        assert!(!Arc::ptr_eq(&before, &after), "a synthesized record forces a rebuilt table");
        assert_eq!(after.len(), 2);
        assert_eq!(after[0].time, 1_700_000_600_000, "live record still newest");
        assert_eq!(after[1].input_other, 100, "the archived totals are appended");
    }

    /// A second merge over the same scan must hand back the cached table, not
    /// re-synthesize, re-clone and re-sort the whole thing — `get_summary` and
    /// `get_day_detail` both call this on every request.
    #[test]
    fn repeated_merges_over_one_scan_reuse_the_cached_table() {
        let _guard = test_state_lock();
        clear_scan_cache();
        let td = tempfile::tempdir().unwrap();
        let home = td.path().join("home");
        std::env::set_var("KIMI_SWITCH_DB_PATH", td.path().join("test.db"));
        fs::create_dir_all(home.join("sessions").join(WID)).unwrap();
        crate::db::upsert_archived_session(&snapshot_row(
            GONE_SID,
            1_700_000_000_000,
            "openai/gpt-x",
            100,
        ))
        .unwrap();

        let records = Arc::new(vec![rec(1_700_000_600_000, "openai/gpt-x", (1, 1, 1, 1), 0.01)]);
        let first = records_with_archive_merge(&home, Arc::clone(&records));
        let second = records_with_archive_merge(&home, Arc::clone(&records));

        assert!(
            Arc::ptr_eq(&first, &second),
            "an unchanged scan must serve the merged table from the cache"
        );
        assert_eq!(second.len(), 2);

        // Storing another snapshot bumps the generation, so the cache must not
        // hide it.
        crate::db::upsert_archived_session(&snapshot_row(
            "session_77777777-2222-3333-4444-555555555555",
            1_700_000_100_000,
            "openai/gpt-y",
            7,
        ))
        .unwrap();
        let third = records_with_archive_merge(&home, records);
        assert!(!Arc::ptr_eq(&first, &third), "a new snapshot must invalidate the cache");
        assert_eq!(third.len(), 3);
    }

    /// The archive row list itself is cached; a store must invalidate it.
    #[test]
    fn archived_session_list_cache_follows_the_generation() {
        let _guard = test_state_lock();
        clear_scan_cache();
        let td = tempfile::tempdir().unwrap();
        std::env::set_var("KIMI_SWITCH_DB_PATH", td.path().join("test.db"));

        assert!(archived_sessions_cached().is_empty(), "an empty store yields no rows");
        crate::db::upsert_archived_session(&snapshot_row(
            GONE_SID,
            1_700_000_000_000,
            "openai/gpt-x",
            100,
        ))
        .unwrap();

        let rows = archived_sessions_cached();
        assert_eq!(rows.len(), 1, "the freshly stored snapshot must be visible");
        assert_eq!(rows[0].session_id, GONE_SID);
        assert!(
            Arc::ptr_eq(&rows, &archived_sessions_cached()),
            "a second read without a write must reuse the cached list"
        );
    }
}

#[cfg(test)]
mod scan_cache_tests {
    use super::*;

    const WID: &str = "wd_proj_a1b2c3d4e5f6";
    const SID: &str = "session_11111111-2222-3333-4444-555555555555";

    /// `scan_usage_cached` and `resolve_scan_config` keep one `static` cache
    /// each, so the tests that want to observe reuse (rather than just
    /// correctness) take this lock to keep a second test from replacing the
    /// state mid-run. Results stay correct either way — a foreign home or a
    /// purged cache only forces a full rescan — but ptr-equality assertions
    /// need a quiet cache.
    fn scan_lock() -> std::sync::MutexGuard<'static, ()> {
        let guard = test_state_lock();
        clear_scan_cache();
        guard
    }

    /// A fresh temp home with one session directory and its `wire.jsonl`.
    fn setup_home_with_wire(lines: &[serde_json::Value]) -> (tempfile::TempDir, PathBuf, PathBuf) {
        let td = tempfile::tempdir().unwrap();
        let home = td.path().join("home");
        let dir = home.join("sessions").join(WID).join(SID);
        fs::create_dir_all(&dir).unwrap();
        let wire = dir.join("wire.jsonl");
        fs::write(&wire, wire_body(lines)).unwrap();
        (td, home, wire)
    }

    fn wire_body(lines: &[serde_json::Value]) -> String {
        lines
            .iter()
            .map(|l| format!("{l}\n"))
            .collect::<Vec<_>>()
            .concat()
    }

    fn usage_line(time: u64, model: &str) -> serde_json::Value {
        serde_json::json!({
            "type": "usage.record",
            "usageScope": "turn",
            "time": time,
            "model": model,
            "usage": {
                "inputOther": 100,
                "output": 50,
                "inputCacheRead": 10,
                "inputCacheCreation": 5,
            },
        })
    }

    #[test]
    fn first_scan_parses_the_wire_file_and_reuses_the_table_when_nothing_moved() {
        let _guard = scan_lock();
        let (_td, home, _wire) = setup_home_with_wire(&[usage_line(1_700_000_000_000, "openai/gpt-x")]);

        let (records, meta) = scan_usage_cached2(&home, false);
        assert_eq!(records.len(), 1);
        assert_eq!(meta.files_scanned, 1);
        assert_eq!(meta.lines_seen, 1);
        assert_eq!(meta.record_count, 1);
        assert!(meta.errors.is_empty(), "{:?}", meta.errors);
        assert_eq!(records[0].model, "openai/gpt-x");
        assert_eq!(records[0].provider.as_deref(), Some("openai"));
        assert_eq!(records[0].time, 1_700_000_000_000);

        // Nothing changed on disk: the assembled table itself is handed back.
        let (again, meta2) = scan_usage_cached2(&home, false);
        assert!(Arc::ptr_eq(&records, &again), "unchanged scan must reuse the cached table");
        assert_eq!(meta2.record_count, 1);
        assert_eq!(meta2.lines_seen, 1);
    }

    #[test]
    fn appended_record_is_reparsed_and_extends_the_table() {
        let _guard = scan_lock();
        let (_td, home, wire) = setup_home_with_wire(&[usage_line(1_700_000_000_000, "openai/gpt-x")]);
        let (first, _) = scan_usage_cached2(&home, false);
        assert_eq!(first.len(), 1);

        // Appending changes the file length, so the cached parse is stale.
        let mut body = fs::read_to_string(&wire).unwrap();
        body.push_str(&format!("{}\n", usage_line(1_700_000_100_000, "openai/gpt-y")));
        fs::write(&wire, body).unwrap();

        let (records, meta) = scan_usage_cached2(&home, false);
        assert_eq!(records.len(), 2, "the new record must show up");
        assert_eq!(meta.record_count, 2);
        assert_eq!(meta.lines_seen, 2);
        assert_eq!(meta.files_scanned, 1);
        assert!(!Arc::ptr_eq(&first, &records), "a changed file must rebuild the table");
        // Newest first, matching the full re-scan ordering.
        assert_eq!(records[0].model, "openai/gpt-y");
        assert_eq!(records[1].model, "openai/gpt-x");
    }

    #[test]
    fn deleted_file_drops_its_records() {
        let _guard = scan_lock();
        let (_td, home, wire) = setup_home_with_wire(&[usage_line(1_700_000_000_000, "openai/gpt-x")]);
        assert_eq!(scan_usage_cached2(&home, false).0.len(), 1);

        fs::remove_file(&wire).unwrap();

        let (records, meta) = scan_usage_cached2(&home, false);
        assert!(records.is_empty(), "a deleted file must stop contributing records");
        assert_eq!(meta.files_scanned, 0);
        assert_eq!(meta.lines_seen, 0);
        assert_eq!(meta.record_count, 0);
    }

    #[test]
    fn a_second_file_adds_its_records_on_top_of_the_cached_ones() {
        let _guard = scan_lock();
        let (_td, home, _wire) = setup_home_with_wire(&[usage_line(1_700_000_000_000, "openai/gpt-x")]);
        assert_eq!(scan_usage_cached2(&home, false).0.len(), 1);

        let other = home.join("sessions").join(WID)
            .join("session_22222222-2222-3333-4444-555555555555");
        fs::create_dir_all(&other).unwrap();
        fs::write(
            other.join("wire.jsonl"),
            wire_body(&[usage_line(1_700_000_200_000, "moonshotai/kimi-k3")]),
        )
        .unwrap();

        let (records, meta) = scan_usage_cached2(&home, false);
        assert_eq!(records.len(), 2);
        assert_eq!(meta.files_scanned, 2);
        assert_eq!(meta.lines_seen, 2);
        assert_eq!(records[0].model, "moonshotai/kimi-k3");
        assert_eq!(records[1].model, "openai/gpt-x");
    }

    #[test]
    fn blob_and_task_wire_files_stay_ignored() {
        let _guard = scan_lock();
        let (_td, home, _wire) = setup_home_with_wire(&[usage_line(1_700_000_000_000, "openai/gpt-x")]);
        // Records reachable only through a blobs/ or tasks/ directory.
        for sub in ["blobs", "tasks"] {
            let dir = home.join("sessions").join(WID).join(SID).join(sub);
            fs::create_dir_all(&dir).unwrap();
            fs::write(
                dir.join("wire.jsonl"),
                wire_body(&[usage_line(1_700_000_300_000, "openai/skipped")]),
            )
            .unwrap();
        }

        let (records, meta) = scan_usage_cached2(&home, false);
        assert_eq!(records.len(), 1, "blobs/tasks directories stay filtered out");
        assert_eq!(meta.files_scanned, 1);
        assert!(records.iter().all(|r| r.model != "openai/skipped"));
    }

    #[test]
    fn changed_alias_provider_map_invalidates_cached_parses() {
        let _guard = scan_lock();
        // A bare alias with no `provider/` prefix only resolves through the
        // legacy alias→provider map, so a config change flips its provider.
        let line = usage_line(1_700_000_000_000, "legacy-alias");
        let (td, home, _wire) = setup_home_with_wire(&[line]);

        let (before, _) = scan_usage_cached2(&home, false);
        assert_eq!(before.len(), 1);
        assert_eq!(before[0].provider, None, "no config yet leaves the provider unresolved");

        // Adding the alias to config.toml moves the parse context, so the
        // cached parse of an untouched wire.jsonl must be thrown away.
        fs::write(
            td.path().join("home").join("config.toml"),
            "[models.legacy-alias]\nprovider = \"CodingPlanSite\"\n",
        )
        .unwrap();

        let (after, meta) = scan_usage_cached2(&home, false);
        assert_eq!(after.len(), 1);
        assert_eq!(meta.files_scanned, 1);
        assert_eq!(meta.lines_seen, 1);
        assert_eq!(
            after[0].provider.as_deref(),
            Some("CodingPlan.site"),
            "the new alias→provider map must be applied"
        );
    }

    #[test]
    fn refresh_forces_a_reparse_of_unchanged_files() {
        let _guard = scan_lock();
        let (_td, home, _wire) = setup_home_with_wire(&[usage_line(1_700_000_000_000, "openai/gpt-x")]);

        let (cached, _) = scan_usage_cached2(&home, false);
        let (refreshed, meta) = scan_usage_cached2(&home, true);

        assert!(!Arc::ptr_eq(&cached, &refreshed), "refresh=true must not hand back the cached table");
        assert_eq!(refreshed.len(), 1);
        assert_eq!(meta.files_scanned, 1);
        assert_eq!(meta.record_count, 1);
        // Same numbers as the incremental path — only the work differs.
        assert_eq!(refreshed[0].model, cached[0].model);
        assert_eq!(refreshed[0].cost_usd, cached[0].cost_usd);
    }

    #[test]
    fn missing_sessions_root_reports_the_error_and_empty_table() {
        let _guard = scan_lock();
        let td = tempfile::tempdir().unwrap();
        let home = td.path().join("no-such-home");

        let (records, meta) = scan_usage_cached2(&home, false);
        assert!(records.is_empty());
        assert_eq!(meta.files_scanned, 0);
        assert_eq!(meta.record_count, 0);
        assert_eq!(meta.errors, vec!["sessions directory not found".to_string()]);
    }

    /// The scan-input cache must notice a rewritten `config.toml`, so the
    /// fingerprint handed to the per-file parse cache still moves when the
    /// config does — through a create, a resize, a delete and a new backup.
    #[test]
    fn config_edit_invalidates_the_scan_input_cache_and_moves_the_fingerprint() {
        let _guard = scan_lock();
        let (_td, home, _wire) = setup_home_with_wire(&[usage_line(1_700_000_000_000, "legacy-alias")]);
        let cfg = home.join("config.toml");

        // No config yet: the stamp is empty and the fingerprint reflects that.
        let first = resolve_scan_inputs(&home);
        assert!(first.alias2prov.is_empty(), "no config leaves the alias map empty");
        assert_eq!(resolve_scan_inputs(&home).fingerprint, first.fingerprint);

        // A config that did not exist before appears: the stamp list grows.
        fs::write(&cfg, "[models.legacy-alias]\nprovider=\"CodingPlan\"\n").unwrap();
        let a = resolve_scan_inputs(&home);
        let b = resolve_scan_inputs(&home);
        assert!(Arc::ptr_eq(&a, &b), "an unchanged config must be served from the cache");
        assert_ne!(
            a.fingerprint, first.fingerprint,
            "writing config.toml must move the fingerprint"
        );
        assert_eq!(a.alias2prov.get("legacy-alias").map(String::as_str), Some("CodingPlan"));

        // A different length on the same path invalidates it again.
        fs::write(&cfg, "[models.legacy-alias]\nprovider=\"CodingPlanSite\"\n").unwrap();
        let c = resolve_scan_inputs(&home);
        assert!(!Arc::ptr_eq(&a, &c), "a resized config must not be served from the cache");
        assert_ne!(c.fingerprint, a.fingerprint);
        assert_eq!(
            c.alias2prov.get("legacy-alias").map(String::as_str),
            Some("CodingPlanSite")
        );

        // Deleting it returns to the empty map rather than a stale entry.
        fs::remove_file(&cfg).unwrap();
        let d = resolve_scan_inputs(&home);
        assert!(d.alias2prov.is_empty(), "a deleted config must drop the cached map");

        // A backup written later is part of the stamp too.
        fs::write(
            home.join("config.toml.bak.1"),
            "[models.old-alias]\nprovider = \"openai\"\n",
        )
        .unwrap();
        let e = resolve_scan_inputs(&home);
        assert_eq!(e.alias2prov.get("old-alias").map(String::as_str), Some("openai"));
        assert_ne!(e.fingerprint, d.fingerprint, "a new backup also moves the fingerprint");
    }

    /// A different home must never be served from another home's cache entry.
    #[test]
    fn scan_inputs_cache_is_keyed_on_the_home() {
        let _guard = scan_lock();
        let td = tempfile::tempdir().unwrap();
        let home_a = td.path().join("a");
        let home_b = td.path().join("b");
        fs::create_dir_all(&home_a).unwrap();
        fs::create_dir_all(&home_b).unwrap();
        fs::write(
            home_a.join("config.toml"),
            "[models.alias-a]\nprovider = \"openai\"\n",
        )
        .unwrap();
        fs::write(
            home_b.join("config.toml"),
            "[models.alias-b]\nprovider = \"anthropic\"\n",
        )
        .unwrap();

        let a = resolve_scan_inputs(&home_a);
        let b = resolve_scan_inputs(&home_b);
        assert_eq!(a.alias2prov.get("alias-a").map(String::as_str), Some("openai"));
        assert_eq!(b.alias2prov.get("alias-b").map(String::as_str), Some("anthropic"));
        assert!(!b.alias2prov.contains_key("alias-a"), "homes must not share inputs");
        assert_ne!(a.fingerprint, b.fingerprint);

        // ...and going back to A still resolves A's config.
        let a_again = resolve_scan_inputs(&home_a);
        assert_eq!(a_again.alias2prov.get("alias-a").map(String::as_str), Some("openai"));
    }

    /// Every field of every record, in order — the strongest equality check
    /// available (`UsageRecord` implements neither `PartialEq` nor
    /// `Serialize`).
    fn records_fingerprint(records: &[UsageRecord]) -> Vec<String> {
        records
            .iter()
            .map(|r| {
                format!(
                    "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{:?}|{}|{}|{:?}",
                    r.time,
                    r.model,
                    r.model_resolved,
                    r.model_display,
                    r.input_other,
                    r.output,
                    r.input_cache_read,
                    r.input_cache_creation,
                    r.cost_usd,
                    r.cost_estimated,
                    r.price_id,
                    r.provider,
                    r.from_env,
                    r.is_secondary,
                    r.cost_usd.is_nan(),
                )
            })
            .collect()
    }

    #[test]
    fn mixed_edits_match_a_forced_full_rescan_exactly() {
        let _guard = scan_lock();
        let (_td, home, wire_a) = setup_home_with_wire(&[
            usage_line(1_700_000_000_000, "openai/gpt-x"),
            usage_line(1_700_000_600_000, "kimi/k3"),
        ]);
        let sessions = home.join("sessions").join(WID);
        let wire_b = sessions.join("session_22222222-2222-3333-4444-555555555555").join("wire.jsonl");
        let wire_c = sessions.join("session_33333333-2222-3333-4444-555555555555").join("wire.jsonl");
        for w in [&wire_b, &wire_c] {
            fs::create_dir_all(w.parent().unwrap()).unwrap();
            fs::write(w, wire_body(&[usage_line(1_700_000_300_000, "openai/gpt-y")])).unwrap();
        }
        // A blobs copy that must never be counted by either scan.
        let blob = sessions.join(SID).join("blobs").join("wire.jsonl");
        fs::create_dir_all(blob.parent().unwrap()).unwrap();
        fs::write(&blob, wire_body(&[usage_line(1_700_000_900_000, "openai/ignored")])).unwrap();

        let (warm, warm_meta) = scan_usage_cached2(&home, false);
        assert_eq!(warm.len(), 4);
        assert_eq!(warm_meta.files_scanned, 3);

        // Touch every file in a different way between the two scans.
        fs::write(&wire_b, wire_body(&[
            usage_line(1_700_000_300_000, "__secondary__"),
            usage_line(1_700_001_000_000, "zhipuai/glm-4.6"),
        ])).unwrap();
        fs::remove_file(&wire_c).unwrap();
        let mut a = fs::read_to_string(&wire_a).unwrap();
        a.push_str(&format!("{}\n", usage_line(1_700_001_200_000, "legacy-alias")));
        fs::write(&wire_a, a).unwrap();

        let (incremental, inc_meta) = scan_usage_cached2(&home, false);
        // The same tree read from scratch, with the cache dropped.
        let (full, full_meta) = scan_usage_cached2(&home, true);

        assert_eq!(
            records_fingerprint(&incremental),
            records_fingerprint(&full),
            "incremental scan must equal a full rescan, field for field"
        );
        assert_eq!(inc_meta.files_scanned, full_meta.files_scanned);
        assert_eq!(inc_meta.lines_seen, full_meta.lines_seen);
        assert_eq!(inc_meta.record_count, full_meta.record_count);
        assert_eq!(inc_meta.record_count, incremental.len());
        assert_eq!(inc_meta.errors, full_meta.errors);

        // Sanity on the contents the two scans agreed on: A grew to 3 lines,
        // B was rewritten with 2, C was deleted, and the blob copy never counts.
        assert_eq!(incremental.len(), 5);
        assert_eq!(incremental[0].model, "legacy-alias");
        assert_eq!(incremental[1].model, "zhipuai/glm-4.6");
        assert_eq!(incremental[2].model, "kimi/k3");
        let secondary = incremental.iter().find(|r| r.model == "__secondary__").expect("secondary record");
        assert!(secondary.is_secondary, "the marker stays a subagent record");
        assert!(incremental.iter().all(|r| r.model != "openai/ignored"));
        assert!(incremental.iter().all(|r| r.model != "openai/gpt-y"), "the deleted file is gone");
        // Newest-first throughout.
        assert!(incremental.windows(2).all(|w| w[0].time >= w[1].time));
    }

    #[test]
    fn secondary_alias_change_invalidates_cached_parses() {
        let _guard = scan_lock();
        let (td, home, _wire) = setup_home_with_wire(&[usage_line(1_700_000_000_000, "__secondary__")]);

        let (before, _) = scan_usage_cached2(&home, false);
        assert_eq!(before.len(), 1);
        assert!(before[0].is_secondary);
        let first_cost = before[0].cost_usd;

        // Point [secondary_model] at a much pricier model; the wire file itself
        // is untouched, so only the parse context can catch this.
        fs::write(
            td.path().join("home").join("config.toml"),
            "[secondary_model]\nmodel = \"openai/gpt-5\"\n",
        )
        .unwrap();

        let (after, meta) = scan_usage_cached2(&home, false);
        assert_eq!(after.len(), 1);
        assert_eq!(meta.files_scanned, 1);
        assert_eq!(meta.lines_seen, 1, "the reused count still comes from the file");
        assert_eq!(after[0].model, "__secondary__", "the record keeps its stable marker");
        assert!(after[0].cost_usd > first_cost, "the new secondary model re-prices the record");
    }
}

#[cfg(test)]
mod disk_scan_cache_tests {
    use super::*;

    const WID: &str = "wd_proj_a1b2c3d4e5f6";
    const SID: &str = "session_11111111-2222-3333-4444-555555555555";

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        let guard = test_state_lock();
        clear_scan_cache();
        guard
    }

    fn usage_line(time: u64, model: &str, input_other: u64) -> serde_json::Value {
        serde_json::json!({
            "type": "usage.record",
            "usageScope": "turn",
            "time": time,
            "model": model,
            "usage": {
                "inputOther": input_other,
                "output": 50,
                "inputCacheRead": 10,
                "inputCacheCreation": 5,
            },
        })
    }

    fn wire_body(lines: &[serde_json::Value]) -> String {
        lines.iter().map(|l| format!("{l}\n")).collect::<Vec<_>>().concat()
    }

    /// A temp home with one session and its `wire.jsonl`. The snapshot location
    /// is derived from the database path, so pointing that into the temp dir
    /// keeps every test file out of real user data.
    fn setup(lines: &[serde_json::Value]) -> (tempfile::TempDir, PathBuf, PathBuf) {
        let td = tempfile::tempdir().unwrap();
        std::env::set_var("KIMI_SWITCH_DB_PATH", td.path().join("test.db"));
        let home = td.path().join("home");
        let dir = home.join("sessions").join(WID).join(SID);
        fs::create_dir_all(&dir).unwrap();
        let wire = dir.join("wire.jsonl");
        fs::write(&wire, wire_body(lines)).unwrap();
        (td, home, wire)
    }

    /// Wait for the asynchronous snapshot write to land.
    fn wait_for_snapshot(home: &Path) -> PathBuf {
        let path = scan_disk_cache_path(home);
        for _ in 0..200 {
            if path.exists() { return path; }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        panic!("the scan never persisted a snapshot to {}", path.display());
    }

    /// The record table in full, field for field — `UsageRecord` has no
    /// `PartialEq`, and serialization equality is exactly what the disk cache
    /// has to preserve.
    fn fingerprint(records: &[UsageRecord]) -> Vec<String> {
        records.iter().map(|r| serde_json::to_string(r).unwrap()).collect()
    }

    /// A snapshot written by one process must reconstruct the identical table in
    /// the next, counts included.
    #[test]
    fn disk_snapshot_round_trips_to_an_identical_table() {
        let _guard = lock();
        let (_td, home, _wire) = setup(&[
            usage_line(1_700_000_000_000, "openai/gpt-x", 100),
            usage_line(1_700_000_600_000, "moonshotai/kimi-k3", 200),
        ]);

        clear_scan_cache();
        let (fresh, fresh_meta) = scan_usage_cached2(&home, true);
        wait_for_snapshot(&home);

        // Cold start: no in-memory state, but the snapshot is kept.
        clear_scan_cache();
        let (cached, cached_meta, unverified) = scan_usage_cached(&home, false);

        assert!(unverified, "a cold call answers from the snapshot unverified");
        assert_eq!(
            fingerprint(&cached),
            fingerprint(&fresh),
            "the snapshot must reconstruct the table field for field",
        );
        assert_eq!(cached_meta.record_count, cached.len());
        assert_eq!(
            cached_meta.files_scanned, fresh_meta.files_scanned,
            "files_scanned must survive the round trip",
        );
        assert_eq!(
            cached_meta.lines_seen, fresh_meta.lines_seen,
            "lines_seen must survive the round trip",
        );
        assert_eq!(cached_meta.errors, fresh_meta.errors);
    }

    /// The verification walk must not report a change when the table it produces
    /// matches what the snapshot already served. Two cases reach a fresh
    /// allocation despite equal contents: a stale stat key forces a rebuild the
    /// walk then reproduces, and a home with no sessions directory builds an
    /// empty table every time.
    #[test]
    fn an_unchanged_tree_reports_no_change() {
        let _guard = lock();
        let (_td, home, _wire) = setup(&[usage_line(1_700_000_000_000, "openai/gpt-x", 100)]);

        // Establish a real snapshot first, then come back cold so the call being
        // examined is the one that serves it.
        clear_scan_cache();
        assert_eq!(scan_usage_cached2(&home, true).0.len(), 1);
        wait_for_snapshot(&home);

        // Serve from the snapshot, then make its per-file stat keys stale, so the
        // verification walk cannot reuse the parses and must rebuild the table.
        clear_scan_cache();
        let (served, _, unverified) = scan_usage_cached(&home, false);
        assert!(unverified, "the first cold call serves the snapshot");
        {
            let mut cache = SCAN_CACHE.lock().unwrap_or_else(|e| e.into_inner());
            let state = cache.as_mut().expect("state installed");
            for entry in state.files.values_mut() {
                entry.mtime_ms = entry.mtime_ms.wrapping_add(1);
            }
        }
        let (walked, _) = scan_usage_cached2(&home, false);
        assert!(
            !Arc::ptr_eq(&served, &walked),
            "a stale stat key really does force a rebuild",
        );
        assert_eq!(
            walked.len(),
            served.len(),
            "so a count comparison — not a pointer comparison — is what decides \
             whether the UI is woken",
        );

        // A home with no sessions directory: every walk allocates a fresh empty
        // table, which a pointer comparison would always call a change.
        let td = tempfile::tempdir().unwrap();
        let bare = td.path().join("no-sessions");
        fs::create_dir_all(&bare).unwrap();
        let a = scan_usage_cached2(&bare, false).0;
        let b = scan_usage_cached2(&bare, false).0;
        assert!(a.is_empty() && b.is_empty());
    }

    /// The unverified snapshot is handed out once: the next call walks, so a
    /// stale table can never be served twice.
    #[test]
    fn only_the_first_cold_call_serves_the_snapshot() {
        let _guard = lock();
        let (_td, home, _wire) = setup(&[usage_line(1_700_000_000_000, "openai/gpt-x", 100)]);

        clear_scan_cache();
        let (_, _, full_scan_unverified) = scan_usage_cached(&home, true);
        assert!(!full_scan_unverified, "a full scan is verified by construction");
        wait_for_snapshot(&home);

        clear_scan_cache();
        let (_, _, first_cold) = scan_usage_cached(&home, false);
        assert!(first_cold, "the first cold call serves the snapshot");
        let (_, _, second_cold) = scan_usage_cached(&home, false);
        assert!(!second_cold, "the snapshot is only ever handed out once");
    }

    /// A session written after the snapshot was taken must become visible once
    /// the verification walk runs — the snapshot must not hide it.
    #[test]
    fn a_new_record_is_picked_up_by_the_verification_walk() {
        let _guard = lock();
        let (_td, home, wire) = setup(&[usage_line(1_700_000_000_000, "openai/gpt-x", 100)]);

        clear_scan_cache();
        assert_eq!(scan_usage_cached2(&home, true).0.len(), 1);
        wait_for_snapshot(&home);

        // The CLI appends a record while the app is not running.
        let mut body = fs::read_to_string(&wire).unwrap();
        body.push_str(&format!("{}\n", usage_line(1_700_000_900_000, "openai/gpt-y", 300)));
        fs::write(&wire, body).unwrap();

        clear_scan_cache();
        let (snapshot, _, unverified) = scan_usage_cached(&home, false);
        assert!(unverified);
        assert_eq!(snapshot.len(), 1, "the snapshot cannot know about the new record yet");

        // ...and the walk that follows brings it in, which is the change the
        // event reports to the frontend.
        let (verified, _) = scan_usage_cached2(&home, false);
        assert_eq!(verified.len(), 2, "the verification walk sees the new record");
        assert_eq!(verified[0].model, "openai/gpt-y", "newest first");
        assert!(!Arc::ptr_eq(&snapshot, &verified), "the table really changed");
    }

    /// A corrupt snapshot must degrade to a full scan — never an error, and
    /// never a partial table.
    ///
    /// Each case gets its own temp home: a scan persists its result
    /// asynchronously, so sharing one snapshot file would let a previous case's
    /// writer overwrite the next case's garbage.
    #[test]
    fn corrupt_snapshot_falls_back_to_a_full_scan() {
        for garbage in ["", "not json at all", "{\"version\":", "{\"version\":1}"] {
            let _guard = lock();
            let (_td, home, _wire) = setup(&[usage_line(1_700_000_000_000, "openai/gpt-x", 100)]);
            let path = scan_disk_cache_path(&home);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, garbage).unwrap();

            clear_scan_cache();
            let (records, meta, unverified) = scan_usage_cached(&home, false);
            assert!(!unverified, "a bad snapshot must not be served as a fast path");
            assert_eq!(records.len(), 1, "garbage {garbage:?} still scans correctly");
            assert_eq!(meta.record_count, 1);
        }
    }

    /// A moved parse context (config edit) must invalidate the whole snapshot:
    /// the persisted records were resolved against the old alias map.
    #[test]
    fn moved_fingerprint_invalidates_the_snapshot() {
        let _guard = lock();
        let (_td, home, _wire) = setup(&[usage_line(1_700_000_000_000, "legacy-alias", 100)]);

        clear_scan_cache();
        assert_eq!(scan_usage_cached2(&home, false).0.len(), 1);
        wait_for_snapshot(&home);

        // Teach the alias→provider map this alias, which moves the fingerprint.
        fs::write(
            home.join("config.toml"),
            "[models.legacy-alias]\nprovider = \"CodingPlanSite\"\n",
        )
        .unwrap();

        clear_scan_cache();
        let (records, _, unverified) = scan_usage_cached(&home, false);
        assert!(!unverified, "a moved fingerprint must not serve the old snapshot");
        assert_eq!(
            records[0].provider.as_deref(),
            Some("CodingPlan.site"),
            "the record must be re-resolved against the new config",
        );
    }

    /// Snapshots are keyed on the home, so two homes never collide.
    #[test]
    fn snapshots_are_isolated_per_home() {
        let td = tempfile::tempdir().unwrap();
        let _guard = lock();
        std::env::set_var("KIMI_SWITCH_DB_PATH", td.path().join("test.db"));
        assert_ne!(
            scan_disk_cache_path(&td.path().join("a")),
            scan_disk_cache_path(&td.path().join("b")),
            "a different home must resolve to a different snapshot file",
        );
    }

    /// A snapshot that names another home, a stale fingerprint or an unknown
    /// version must all be rejected rather than trusted.
    #[test]
    fn a_snapshot_that_does_not_match_is_rejected() {
        let _guard = lock();
        let (_td, home, _wire) = setup(&[usage_line(1_700_000_000_000, "openai/gpt-x", 100)]);
        clear_scan_cache();
        let ctx = resolve_scan_inputs(&home).fingerprint.clone();
        let right_home = home.to_string_lossy().to_string();
        let empty = || Vec::new();

        let cases = [
            ("another home", DiskScanCache {
                version: SCAN_DISK_CACHE_VERSION,
                home: "C:/some/other/home".into(),
                parse_ctx: ctx.clone(),
                written_at_ms: now_ms(),
                files_scanned: 1,
                lines_seen: 1,
                files: empty(),
            }),
            ("a stale fingerprint", DiskScanCache {
                version: SCAN_DISK_CACHE_VERSION,
                home: right_home.clone(),
                parse_ctx: "some-old-fingerprint".into(),
                written_at_ms: now_ms(),
                files_scanned: 1,
                lines_seen: 1,
                files: empty(),
            }),
            ("an unknown version", DiskScanCache {
                version: SCAN_DISK_CACHE_VERSION + 1,
                home: right_home,
                parse_ctx: ctx.clone(),
                written_at_ms: now_ms(),
                files_scanned: 1,
                lines_seen: 1,
                files: empty(),
            }),
        ];
        for (why, cache) in cases {
            assert!(write_disk_cache(&cache), "the fixture must be written");
            assert!(
                load_disk_cache(&home, &ctx).is_none(),
                "a snapshot with {why} must be ignored",
            );
        }
    }

    /// `refresh=true` still bypasses everything and re-reads the files.
    #[test]
    fn refresh_bypasses_the_disk_snapshot() {
        let _guard = lock();
        let (_td, home, wire) = setup(&[usage_line(1_700_000_000_000, "openai/gpt-x", 100)]);

        clear_scan_cache();
        assert_eq!(scan_usage_cached2(&home, false).0.len(), 1);
        wait_for_snapshot(&home);

        // Append a record, then force: the snapshot must not be consulted.
        let mut body = fs::read_to_string(&wire).unwrap();
        body.push_str(&format!("{}\n", usage_line(1_700_000_900_000, "openai/gpt-y", 300)));
        fs::write(&wire, body).unwrap();

        clear_scan_cache();
        let (records, meta, unverified) = scan_usage_cached(&home, true);
        assert!(!unverified, "refresh never serves the snapshot");
        assert_eq!(records.len(), 2, "refresh re-reads every file");
        assert_eq!(meta.record_count, 2);
    }
}
