use chrono::{DateTime, Datelike, Local, TimeZone};
use crate::db::{ArchivedSessionSnapshot, DayModelStat, DayStat};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
        lines_seen += content.lines().count();
        records.extend(parse_wire_usage_records(&content, &secondary_alias, &alias2prov));
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

/// Parse one `wire.jsonl` body into usage records. Extracted from
/// `scan_usage` so a single session can be snapshotted without walking the
/// whole sessions tree; the record filter chain is unchanged.
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
fn synthesize_snapshot_records(rows: &[ArchivedSessionSnapshot], home: &Path) -> Vec<UsageRecord> {
    let root = sessions_root(home);
    let legacy_root = root.join(".kcd-archive");
    let alias2prov = build_alias_provider_map(home);
    let secondary_alias = read_secondary_model_alias(home);
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
                    provider: resolve_provider(&price_model, &alias2prov),
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

/// Append the synthesized records for `rows` to a live scan result and
/// restore the newest-first ordering `scan_usage` produces.
fn merge_snapshot_records(
    mut records: Vec<UsageRecord>,
    rows: &[ArchivedSessionSnapshot],
    home: &Path,
) -> Vec<UsageRecord> {
    // Nothing archived yet: keep the scan result untouched (and skip the
    // config reads the synthesis would do).
    if rows.is_empty() { return records; }
    records.extend(synthesize_snapshot_records(rows, home));
    records.sort_by(|a, b| b.time.cmp(&a.time));
    records
}

/// Live scan records plus the stored usage of archived sessions whose files
/// have been deleted, so dashboard stats survive session deletion.
fn records_with_archive_merge(home: &Path, records: Vec<UsageRecord>) -> Vec<UsageRecord> {
    let rows = crate::db::list_archived_sessions().unwrap_or_default();
    merge_snapshot_records(records, &rows, home)
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

fn filter_by_range<'a>(records: &'a [UsageRecord], range: &str, now_ms: u64) -> Vec<&'a UsageRecord> {
    if range == "all" { return records.iter().collect(); }
    let start = range_start(range, now_ms);
    match range_end(range, now_ms) {
        Some(end) => records.iter().filter(|r| r.time >= start && r.time < end).collect(),
        None => records.iter().filter(|r| r.time >= start).collect(),
    }
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

#[tauri::command]
pub fn get_summary(home_override: Option<String>, range: Option<String>, refresh: Option<bool>) -> SummaryResult {
    let t0 = std::time::Instant::now();
    let refresh = refresh.unwrap_or(false);
    let home = resolve_kimi_home(home_override);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let r = range.unwrap_or_else(|| "30d".into());

    let (records, meta) = scan_usage_cached(&home, refresh);
    let records = records_with_archive_merge(&home, records);
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
    for r_k in ["today", "yesterday", "7d", "30d", "all"] {
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
    eprintln!(
        "[dashboard] get_summary range={} records={} scan={:.0}ms aggregate={:.0}ms total={:.0}ms",
        r, records.len(), scan_ms, aggregate_ms, t2.duration_since(t0).as_secs_f64() * 1000.0
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
#[tauri::command]
pub fn get_day_detail(home_override: Option<String>, date: String) -> Option<DailyRow> {
    let home = resolve_kimi_home(home_override);
    let (records, _) = scan_usage_cached(&home, false);
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
        let merged = merge_snapshot_records(live, &rows, &home);

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
        let merged = records_with_archive_merge(&home, vec![]);
        assert!(merged.is_empty(), "no synthesized records while the dir exists");

        // Once the archived directory is deleted, stats come from the snapshot.
        fs::remove_dir_all(&old_dir).unwrap();
        let merged = records_with_archive_merge(&home, vec![]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].input_other, 100);
        assert_eq!(merged[0].output, 50);
        assert_eq!(day_key(merged[0].time), day_key(old_ms));
    }
}
