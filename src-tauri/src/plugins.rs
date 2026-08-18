// ---------------------------------------------------------------------------
// Plugin marketplace backend (Rust side of the KimiSwitch plugin market).
//
// Mirrors the plugin semantics of kimi-code 0.36
// (packages/agent-core-v2/src/app/plugin/{marketplace,manager,archive,
// manifest,source,store,github-resolver}.ts):
//
// * marketplace catalog: fetched from `KIMI_CODE_PLUGIN_MARKETPLACE_URL` (or
//   the public default), cached to `$KIMI_CODE_HOME/plugins/marketplace-cache.json`,
//   with the cache as fallback when the fetch fails.
// * installed state: `$KIMI_CODE_HOME/plugins/installed.json`, the exact v1
//   format kimi-code's store.ts writes (`{ "version": 1, "plugins": [...] }`,
//   camelCase record fields). Reads/writes are read-modify-write with an atomic
//   tmp-file + rename swap, so the app never corrupts the file kimi-code shares.
// * install: resolve the source (zip URL / GitHub repo URL), stream-download
//   the zip, extract behind a path-traversal guard, locate the plugin manifest
//   (`kimi.plugin.json` or `.kimi-plugin/plugin.json`), validate the plugin
//   name, publish atomically to `plugins/managed/<id>/` (staging dir + rename,
//   previous copy moved aside and restored on failure), then record it.
// * enable/disable toggles `enabled` + refreshes `updatedAt`; remove deletes
//   only the installed.json record, keeping the managed files on disk.
//
// Timestamps use the same ISO-8601 UTC millis format as kimi-code's
// `new Date().toISOString()`.
// ---------------------------------------------------------------------------

use chrono::{SecondsFormat, Utc};
use futures_util::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tokio::io::AsyncWriteExt;

const DEFAULT_MARKETPLACE_URL: &str = "https://code.kimi.com/kimi-code/plugins/marketplace.json";
const MARKETPLACE_URL_ENV: &str = "KIMI_CODE_PLUGIN_MARKETPLACE_URL";
const MARKETPLACE_CACHE_REL: &str = "plugins/marketplace-cache.json";
const INSTALLED_REL: &str = "plugins/installed.json";
const CATALOG_FETCH_TIMEOUT_SECS: u64 = 60;
const ZIP_DOWNLOAD_TIMEOUT_SECS: u64 = 300;

// ---------------------------------------------------------------------------
// Public types (Tauri command contract, serde camelCase)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginMarketplaceResult {
    pub fetched_at: String,
    pub from_cache: bool,
    pub entries: Vec<MarketplaceEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceEntry {
    pub id: String,
    pub display_name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub keywords: Vec<String>,
    pub homepage: Option<String>,
    pub tier: String,
    pub source: String,
    pub capability_id: Option<String>,
    pub installed: Option<InstalledPluginInfo>,
    pub update_available: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPluginInfo {
    pub id: String,
    pub root: String,
    pub source: String,
    pub enabled: bool,
    pub version: Option<String>,
    pub installed_at: Option<String>,
    pub updated_at: Option<String>,
    pub is_marketplace: bool,
}

// ---------------------------------------------------------------------------
// installed.json store — mirrors kimi-code store.ts exactly
// ---------------------------------------------------------------------------

/// `{ "version": 1, "plugins": [...] }` — top-level is an object with a
/// `plugins` array (kimi-code `InstalledFile`). Unknown top-level keys are
/// preserved across read-modify-write so a newer kimi-code never loses data.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstalledFile {
    #[serde(default = "default_version")]
    pub version: u8,
    pub plugins: Vec<InstalledRecord>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn default_version() -> u8 {
    1
}

impl Default for InstalledFile {
    fn default() -> Self {
        InstalledFile {
            version: 1,
            plugins: Vec::new(),
            extra: serde_json::Map::new(),
        }
    }
}

/// One entry of installed.json — field names/casing must match kimi-code
/// `InstalledRecord` (`installedAt`, `updatedAt`, `originalSource`,
/// `capabilities`, `github`). Unknown record fields are preserved.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRecord {
    pub id: String,
    pub root: String,
    /// "local-path" | "zip-url" | "github" (kimi-code `PluginSource`).
    pub source: String,
    pub enabled: bool,
    pub installed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github: Option<GithubMetadata>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// kimi-code `PluginGithubMetadata` (`installedSha` omitted when unknown,
/// matching JSON.stringify of an undefined field).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubMetadata {
    pub owner: String,
    pub repo: String,
    pub r#ref: GithubRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_sha: Option<String>,
}

/// kimi-code `PluginGithubRef` — kind is one of "branch" | "tag" | "sha".
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GithubRef {
    pub kind: String,
    pub value: String,
}

fn read_installed(home: &Path) -> Result<InstalledFile, String> {
    let path = home.join(INSTALLED_REL);
    if !path.is_file() {
        return Ok(InstalledFile::default());
    }
    // serde already enforces store.ts's structural requirements (`plugins`
    // must be present and an array); a parse failure surfaces as an error
    // just like kimi-code's readInstalled does.
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("failed to parse {}: {e}", path.display()))
}

/// Atomic read-modify-write target: tmp file in the same directory, then rename.
fn write_installed(home: &Path, data: &InstalledFile) -> Result<(), String> {
    let path = home.join(INSTALLED_REL);
    let tmp = path.with_file_name("installed.json.tmp");
    fs::create_dir_all(home.join("plugins"))
        .map_err(|e| format!("failed to create plugins dir: {e}"))?;
    let text = serde_json::to_string_pretty(data).map_err(|e| format!("failed to serialize installed.json: {e}"))?;
    fs::write(&tmp, text).map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("failed to replace {}: {e}", path.display()))
}

// ---------------------------------------------------------------------------
// Marketplace catalog
// ---------------------------------------------------------------------------

fn marketplace_url() -> Result<String, String> {
    if let Ok(env) = std::env::var(MARKETPLACE_URL_ENV) {
        let trimmed = env.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    Ok(DEFAULT_MARKETPLACE_URL.to_string())
}

/// Cache payload written to `marketplace-cache.json`: fetch time + the raw
/// catalog object, so a later parse stays independent of the catalog URL.
#[derive(Debug, Serialize, Deserialize)]
struct CatalogCache {
    #[serde(rename = "fetchedAt")]
    fetched_at: String,
    catalog: serde_json::Value,
}

fn write_catalog_cache(home: &Path, fetched_at: &str, catalog: &serde_json::Value) -> Result<(), String> {
    let path = home.join(MARKETPLACE_CACHE_REL);
    let tmp = path.with_file_name("marketplace-cache.json.tmp");
    fs::create_dir_all(home.join("plugins"))
        .map_err(|e| format!("failed to create plugins dir: {e}"))?;
    let cache = CatalogCache {
        fetched_at: fetched_at.to_string(),
        catalog: catalog.clone(),
    };
    let text = serde_json::to_string_pretty(&cache).map_err(|e| format!("failed to serialize marketplace cache: {e}"))?;
    fs::write(&tmp, text).map_err(|e| format!("failed to write marketplace cache: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("failed to replace marketplace cache: {e}"))
}

fn read_catalog_cache(home: &Path) -> Result<Option<CatalogCache>, String> {
    let path = home.join(MARKETPLACE_CACHE_REL);
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read marketplace cache: {e}"))?;
    let cache: CatalogCache =
        serde_json::from_str(&text).map_err(|e| format!("marketplace cache is corrupted: {e}"))?;
    Ok(Some(cache))
}

fn non_blank_str(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    obj.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Parse + normalize a catalog (`{version?, plugins: [...]}`) into entries.
/// Field aliases follow kimi-code (`displayName`/`name`,
/// `source`/`url`/`downloadUrl`, `description`/`shortDescription`,
/// `homepage`/`websiteURL`); entry sources are resolved against `catalog_url`.
fn parse_catalog_from_value(raw: &serde_json::Value, catalog_url: &str) -> Result<Vec<MarketplaceEntry>, String> {
    let obj = raw
        .as_object()
        .ok_or_else(|| "plugin marketplace must be an object".to_string())?;
    let plugins = obj
        .get("plugins")
        .and_then(|p| p.as_array())
        .ok_or_else(|| "plugin marketplace must contain a \"plugins\" array".to_string())?;
    let mut out = Vec::with_capacity(plugins.len());
    for (i, entry) in plugins.iter().enumerate() {
        out.push(parse_marketplace_entry(entry, i, catalog_url)?);
    }
    Ok(out)
}

fn parse_marketplace_entry(value: &serde_json::Value, index: usize, catalog_url: &str) -> Result<MarketplaceEntry, String> {
    let obj = value
        .as_object()
        .ok_or_else(|| format!("plugin marketplace entry {} must be an object", index + 1))?;
    let id = non_blank_str(obj, "id")
        .ok_or_else(|| format!("plugin marketplace entry {} must define \"id\"", index + 1))?;
    let source_raw = non_blank_str(obj, "source")
        .or_else(|| non_blank_str(obj, "url"))
        .or_else(|| non_blank_str(obj, "downloadUrl"))
        .ok_or_else(|| format!("plugin marketplace entry {id} must define \"source\""))?;
    let source = resolve_entry_source(&source_raw, catalog_url);
    let display_name = non_blank_str(obj, "displayName")
        .or_else(|| non_blank_str(obj, "name"))
        .unwrap_or_else(|| id.clone());
    // kimi-code validates tier against {official, curated}; we accept those and
    // fall back to "curated" for anything else / missing (lenient by design).
    let tier = match non_blank_str(obj, "tier").as_deref() {
        Some("official") | Some("curated") => non_blank_str(obj, "tier").unwrap(),
        _ => "curated".to_string(),
    };
    let keywords = obj
        .get("keywords")
        .and_then(|k| k.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(MarketplaceEntry {
        id,
        display_name,
        version: non_blank_str(obj, "version"),
        description: non_blank_str(obj, "description").or_else(|| non_blank_str(obj, "shortDescription")),
        keywords,
        homepage: non_blank_str(obj, "homepage").or_else(|| non_blank_str(obj, "websiteURL")),
        tier,
        source,
        capability_id: non_blank_str(obj, "capabilityId"),
        installed: None,
        update_available: false,
    })
}

/// Resolve an entry source against the catalog location (kimi-code
/// `resolveEntrySource`): http(s) as-is, `file://` decoded, `~` expanded,
/// absolute paths as-is, relative paths joined to the catalog URL/file.
fn resolve_entry_source(source: &str, catalog_url: &str) -> String {
    let trimmed = source.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }
    if let Some(rest) = trimmed.strip_prefix("file://") {
        return percent_decode(rest);
    }
    if trimmed == "~" {
        if let Some(home) = dirs::home_dir() {
            return home.to_string_lossy().to_string();
        }
    } else if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    let p = PathBuf::from(trimmed);
    if p.is_absolute() {
        return trimmed.to_string();
    }
    if catalog_url.starts_with("http://") || catalog_url.starts_with("https://") {
        resolve_relative_url(catalog_url, trimmed)
    } else {
        // Local catalog file: relative to its directory. Resolve lexically so
        // "./" and "../" components are normalized (Path::join keeps them).
        let catalog = PathBuf::from(catalog_url);
        let base_dir = catalog.parent().unwrap_or(Path::new("."));
        lexical_join(base_dir, trimmed).to_string_lossy().to_string()
    }
}

/// Lexically resolve `rel` against `base`, dropping "." and applying "..".
fn lexical_join(base: &Path, rel: &str) -> PathBuf {
    use std::path::Component;
    let mut out: Vec<Component> = base.components().collect();
    for comp in Path::new(rel).components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            c => out.push(c),
        }
    }
    out.into_iter().collect()
}

/// URL resolution equivalent of `new URL(rel, base).toString()` for the
/// relative-source cases the marketplace actually uses (`./x`, `../x`,
/// `/abs`, `//host/x`). Hand-rolled to avoid a `url` crate dependency.
fn resolve_relative_url(base: &str, rel: &str) -> String {
    if rel.starts_with("//") {
        let scheme = base.split("://").next().unwrap_or("https");
        return format!("{scheme}:{rel}");
    }
    let (head, base_path) = match base.split_once("://") {
        Some((scheme, rest)) => {
            let (authority, path) = match rest.find('/') {
                Some(i) => (&rest[..i], &rest[i..]),
                None => (rest, "/"),
            };
            (format!("{scheme}://{authority}"), path.to_string())
        }
        None => (String::new(), base.to_string()),
    };
    if rel.starts_with('/') {
        return format!("{head}{rel}");
    }
    let base_dir = base_path
        .rsplit_once('/')
        .map(|(d, _)| d.to_string())
        .unwrap_or_default();
    let joined = if base_dir.is_empty() {
        format!("/{rel}")
    } else {
        format!("{base_dir}/{rel}")
    };
    let normalized = normalize_url_path(&joined);
    if head.is_empty() {
        normalized
    } else {
        format!("{head}{normalized}")
    }
}

fn normalize_url_path(p: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in p.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    if out.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", out.join("/"))
    }
}

// ---------------------------------------------------------------------------
// Version comparison (simple semver — unparseable versions never update)
// ---------------------------------------------------------------------------

/// Split "1.2.3" / "v1.2" / "1.2.3-beta.1" into numeric components; the
/// pre-release suffix is ignored. Returns None when no numeric version parses.
fn parse_simple_semver(s: &str) -> Option<Vec<u64>> {
    let s = s.trim();
    let s = s.strip_prefix('v').or_else(|| s.strip_prefix('V')).unwrap_or(s);
    if s.is_empty() {
        return None;
    }
    let mut parts = Vec::new();
    for seg in s.split('.') {
        let digits: String = seg.chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() {
            return None;
        }
        parts.push(digits.parse::<u64>().ok()?);
        if digits.len() != seg.len() {
            break; // pre-release suffix — ignore the remainder
        }
    }
    Some(parts)
}

fn compare_simple_semver(a: &str, b: &str) -> Option<Ordering> {
    let a = parse_simple_semver(a)?;
    let b = parse_simple_semver(b)?;
    for i in 0..a.len().max(b.len()) {
        let av = a.get(i).copied().unwrap_or(0);
        let bv = b.get(i).copied().unwrap_or(0);
        if av != bv {
            return Some(av.cmp(&bv));
        }
    }
    Some(Ordering::Equal)
}

// ---------------------------------------------------------------------------
// Source resolution (kimi-code source.ts + github-resolver.ts)
// ---------------------------------------------------------------------------

#[derive(Debug)]
enum ResolvedSource {
    Github {
        owner: String,
        repo: String,
        r#ref: Option<GithubRef>,
    },
    ZipUrl(String),
    LocalPath(String),
}

fn resolve_install_source(source: &str) -> Result<ResolvedSource, String> {
    let trimmed = source.trim();
    if let Some(github) = parse_github_url(trimmed) {
        return Ok(github);
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(ResolvedSource::ZipUrl(trimmed.to_string()));
    }
    if !PathBuf::from(trimmed).is_absolute() {
        return Err(format!("plugin source must be an absolute path or a URL (got {source:?})"));
    }
    Ok(ResolvedSource::LocalPath(trimmed.to_string()))
}

fn is_sha_like(value: &str) -> bool {
    (7..=40).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Recognizes the four kimi-code GitHub forms (source.ts `parseGithubUrl`):
/// bare `https://github.com/o/r`, `.../tree/<ref>`, `.../releases/tag/<tag>`,
/// `.../commit/<sha>` (plus `www.` and `.git` normalization).
fn parse_github_url(raw: &str) -> Option<ResolvedSource> {
    let rest = raw.strip_prefix("https://")?;
    let rest = rest.strip_prefix("www.github.com").or_else(|| rest.strip_prefix("github.com"))?;
    if !rest.starts_with('/') {
        return None;
    }
    let path = &rest[1..];
    let path = path.split(['?', '#']).next().unwrap_or(path);
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let owner = *segments.first()?;
    let repo_raw = *segments.get(1)?;
    if owner.is_empty() {
        return None;
    }
    let repo = repo_raw.strip_suffix(".git").unwrap_or(repo_raw).to_string();
    match &segments[2..] {
        [] => Some(ResolvedSource::Github {
            owner: owner.to_string(),
            repo,
            r#ref: None,
        }),
        [head, _, ..] if *head == "tree" => {
            let value = decode_ref_segments(&segments[3..]);
            if value.is_empty() {
                return None;
            }
            let kind = if is_sha_like(&value) { "sha" } else { "branch" };
            Some(ResolvedSource::Github {
                owner: owner.to_string(),
                repo,
                r#ref: Some(GithubRef {
                    kind: kind.to_string(),
                    value,
                }),
            })
        }
        [head, second, _, ..] if *head == "releases" && *second == "tag" => {
            let value = decode_ref_segments(&segments[4..]);
            if value.is_empty() {
                return None;
            }
            Some(ResolvedSource::Github {
                owner: owner.to_string(),
                repo,
                r#ref: Some(GithubRef {
                    kind: "tag".to_string(),
                    value,
                }),
            })
        }
        [head, _, ..] if *head == "commit" => {
            let value = decode_ref_segments(&segments[3..]);
            if value.is_empty() {
                return None;
            }
            Some(ResolvedSource::Github {
                owner: owner.to_string(),
                repo,
                r#ref: Some(GithubRef {
                    kind: "sha".to_string(),
                    value,
                }),
            })
        }
        _ => None,
    }
}

fn decode_ref_segments(segments: &[&str]) -> String {
    segments
        .iter()
        .map(|s| percent_decode(s))
        .collect::<Vec<_>>()
        .join("/")
}

/// kimi-code `codeloadUrl`: sha/branch → `zip/<ref>`, tag → `zip/refs/tags/<tag>`.
fn github_zip_url(owner: &str, repo: &str, r#ref: &GithubRef) -> String {
    let encoded = encode_ref_path(&r#ref.value);
    let base = format!("https://codeload.github.com/{owner}/{repo}/zip");
    if r#ref.kind == "tag" {
        format!("{base}/refs/tags/{encoded}")
    } else {
        format!("{base}/{encoded}")
    }
}

fn encode_ref_path(value: &str) -> String {
    value
        .split('/')
        .map(encode_uri_component)
        .collect::<Vec<_>>()
        .join("/")
}

fn encode_uri_component(s: &str) -> String {
    let mut out = String::new();
    for &b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

fn http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("KimiSwitch/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

/// GET + parse + structural validation in one step so a malformed catalog
/// falls through to the cache like a network failure does.
async fn fetch_and_parse_catalog(url: &str) -> Result<serde_json::Value, String> {
    let client = http_client(CATALOG_FETCH_TIMEOUT_SECS)?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("failed to fetch plugin marketplace: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("plugin marketplace returned HTTP {}", resp.status()));
    }
    let raw: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("plugin marketplace is not valid JSON: {e}"))?;
    let _ = parse_catalog_from_value(&raw, url)?;
    Ok(raw)
}

/// kimi-code `tryResolveLatestReleaseTag`: follow `/releases/latest` manually
/// (redirect not followed) and extract the tag from the Location header.
async fn resolve_latest_release_tag(owner: &str, repo: &str) -> Result<Option<String>, String> {
    let url = format!("https://github.com/{owner}/{repo}/releases/latest");
    let client = reqwest::Client::builder()
        .user_agent(concat!("KimiSwitch/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("could not look up latest release of {owner}/{repo}: {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if resp.status() != reqwest::StatusCode::MOVED_PERMANENTLY && resp.status() != reqwest::StatusCode::FOUND {
        return Err(format!(
            "could not look up latest release of {owner}/{repo}: HTTP {} ({url})",
            resp.status()
        ));
    }
    let location = resp
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let Some(location) = location else {
        return Ok(None);
    };
    let Some(start) = location.find("/releases/tag/") else {
        return Ok(None);
    };
    let rest = &location[start + "/releases/tag/".len()..];
    let end = rest.find(['?', '#']).unwrap_or(rest.len());
    Ok(Some(percent_decode(&rest[..end])))
}

/// kimi-code `resolveGithubSource`: explicit ref → codeload zip URL; no ref →
/// latest release tag, else HEAD-probe the default branch.
async fn resolve_github_zip_url(
    owner: &str,
    repo: &str,
    r#ref: &Option<GithubRef>,
) -> Result<(String, GithubRef), String> {
    if let Some(r) = r#ref {
        return Ok((github_zip_url(owner, repo, r), r.clone()));
    }
    if let Some(tag) = resolve_latest_release_tag(owner, repo).await? {
        let r = GithubRef {
            kind: "tag".to_string(),
            value: tag,
        };
        return Ok((github_zip_url(owner, repo, &r), r));
    }
    let head_url = format!("https://codeload.github.com/{owner}/{repo}/zip/HEAD");
    let client = http_client(10)?;
    let resp = client
        .head(&head_url)
        .send()
        .await
        .map_err(|e| format!("could not access `{owner}/{repo}`: {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("repository `{owner}/{repo}` not found or not accessible"));
    }
    if !resp.status().is_success() {
        return Err(format!(
            "could not access `{owner}/{repo}`: HTTP {}",
            resp.status()
        ));
    }
    let r = GithubRef {
        kind: "branch".to_string(),
        value: "HEAD".to_string(),
    };
    Ok((github_zip_url(owner, repo, &r), r))
}

/// Stream the zip to a temp file (300s timeout, no full in-memory buffering).
async fn download_to_temp_file(url: &str) -> Result<PathBuf, String> {
    let client = http_client(ZIP_DOWNLOAD_TIMEOUT_SECS)?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("failed to download {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("failed to download {url}: HTTP {}", resp.status()));
    }
    let tmp = std::env::temp_dir().join(format!(
        "kimi-plugin-download-{}-{}.zip",
        std::process::id(),
        unique_suffix()
    ));
    let result = async {
        let mut file = tokio::fs::File::create(&tmp)
            .await
            .map_err(|e| format!("failed to create temp file: {e}"))?;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("failed to write download: {e}"))?;
        }
        file.flush().await.map_err(|e| format!("failed to flush download: {e}"))?;
        Ok::<(), String>(())
    }
    .await;
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(tmp)
}

// ---------------------------------------------------------------------------
// Zip extraction with a path-traversal guard
// ---------------------------------------------------------------------------

/// Normalize a zip entry name and reject anything that could escape the
/// destination: `..` components, absolute paths, drive letters, and the
/// backslash variants Windows zips sometimes carry. Mirrors kimi-code
/// archive.ts's containment check (destPath must stay under destDir).
fn safe_zip_name(name: &str) -> Result<PathBuf, String> {
    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(format!("path traversal: zip entry {name:?} is absolute"));
    }
    if normalized.contains(':') {
        return Err(format!(
            "path traversal: zip entry {name:?} contains a drive-letter component"
        ));
    }
    let mut out = PathBuf::new();
    for comp in normalized.split('/') {
        match comp {
            "" | "." => {}
            ".." => return Err(format!("path traversal: zip entry {name:?} contains '..'")),
            c => out.push(c),
        }
    }
    if out.as_os_str().is_empty() {
        return Err(format!("path traversal: zip entry {name:?} is not a valid relative path"));
    }
    Ok(out)
}

fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("failed to create extraction dir: {e}"))?;
    let file = fs::File::open(zip_path).map_err(|e| format!("failed to open zip: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("failed to open zip: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("failed to read zip entry {i}: {e}"))?;
        let entry_name = entry.name().to_string();
        let rel = safe_zip_name(&entry_name)?;
        let dest_path = dest.join(&rel);
        // Defense in depth: the sanitized path must still stay under `dest`.
        if !dest_path.starts_with(dest) {
            return Err(format!(
                "path traversal: zip entry {entry_name:?} escapes the destination"
            ));
        }
        if entry.is_dir() {
            fs::create_dir_all(&dest_path).map_err(|e| format!("failed to create dir: {e}"))?;
            continue;
        }
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("failed to create dir: {e}"))?;
        }
        let mut out = fs::File::create(&dest_path).map_err(|e| format!("failed to create file: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("failed to extract entry: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Manifest handling (kimi-code manifest.ts)
// ---------------------------------------------------------------------------

fn plugin_name_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\A[a-z0-9][a-z0-9_-]{0,63}\z").unwrap())
}

fn validate_plugin_name(name: &str) -> Result<(), String> {
    if plugin_name_re().is_match(name) {
        Ok(())
    } else {
        Err(format!(
            "plugin name {name:?} must match ^[a-z0-9][a-z0-9_-]{{0,63}}$"
        ))
    }
}

struct ParsedManifest {
    name: String,
    version: Option<String>,
}

fn parse_manifest(root: &Path) -> Result<ParsedManifest, String> {
    let root_manifest = root.join("kimi.plugin.json");
    let dir_manifest = root.join(".kimi-plugin").join("plugin.json");
    let path = if root_manifest.is_file() {
        root_manifest
    } else if dir_manifest.is_file() {
        dir_manifest
    } else {
        return Err(
            "no plugin manifest (kimi.plugin.json or .kimi-plugin/plugin.json) found".to_string(),
        );
    };
    let text = fs::read_to_string(&path).map_err(|e| format!("failed to read manifest: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("manifest is not valid JSON: {e}"))?;
    let name = v
        .get("name")
        .and_then(|n| n.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "\"name\" is required in the plugin manifest".to_string())?;
    validate_plugin_name(name)?;
    let version = v
        .get("version")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    Ok(ParsedManifest {
        name: name.to_string(),
        version,
    })
}

/// Best-effort version read (None on any error) for update checks.
fn read_manifest_version(root: &Path) -> Option<String> {
    parse_manifest(root).ok().and_then(|m| m.version)
}

fn has_manifest(dir: &Path) -> bool {
    dir.join("kimi.plugin.json").is_file() || dir.join(".kimi-plugin").join("plugin.json").is_file()
}

/// kimi-code `detectPluginRoot`: manifest at the staging root, else a single
/// child directory that carries the manifest.
fn detect_plugin_root(staging: &Path) -> Result<PathBuf, String> {
    if has_manifest(staging) {
        return Ok(staging.to_path_buf());
    }
    let mut subdirs = Vec::new();
    for entry in fs::read_dir(staging).map_err(|e| format!("failed to read staging dir: {e}"))? {
        let entry = entry.map_err(|e| format!("failed to read staging dir: {e}"))?;
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            subdirs.push(entry.path());
        }
    }
    if subdirs.len() == 1 && has_manifest(&subdirs[0]) {
        return Ok(subdirs[0].clone());
    }
    Err(
        "no plugin manifest (kimi.plugin.json or .kimi-plugin/plugin.json) found at the archive root or its single subdirectory"
            .to_string(),
    )
}

// ---------------------------------------------------------------------------
// Install pipeline (kimi-code manager.ts)
// ---------------------------------------------------------------------------

/// Serializes read-modify-write of installed.json inside this process.
static INSTALLED_LOCK: Mutex<()> = Mutex::new(());

static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn unique_suffix() -> String {
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{nanos}-{n}", std::process::id())
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Error for the "move existing managed copy aside" step. On Windows a
/// directory cannot be renamed while any process holds a handle inside it
/// (os error 32) — typically a running kimi-code session or a plugin MCP
/// server child process has files open under the old managed root. Give
/// actionable guidance instead of a bare OS error.
fn move_aside_error(e: &std::io::Error) -> String {
    if e.raw_os_error() == Some(32) {
        return "plugin directory is in use by another process (os error 32): \
                a running kimi-code session or plugin MCP server has files open \
                under the old plugin directory. Close kimi-code (including any \
                running sessions) and retry the install/update."
            .to_string();
    }
    format!("failed to move existing plugin aside: {e}")
}

/// Extract → detect root → parse manifest → validate expected id → publish
/// atomically → record in installed.json. `source_type` is what the record
/// stores ("zip-url" | "github"). On any failure the new managed copy is
/// removed and the previous one restored.
fn install_from_zip(
    home: &Path,
    zip_path: &Path,
    expected_id: Option<&str>,
    original_source: &str,
    source_type: &str,
    github: Option<GithubMetadata>,
) -> Result<InstalledPluginInfo, String> {
    let managed_dir = home.join("plugins").join("managed");
    fs::create_dir_all(&managed_dir).map_err(|e| format!("failed to create managed dir: {e}"))?;

    let staging = managed_dir.join(format!(".tmp-install-{}", unique_suffix()));
    if let Err(e) = extract_zip(zip_path, &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }
    let source_root = match detect_plugin_root(&staging) {
        Ok(root) => root,
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
    };
    let parsed = match parse_manifest(&source_root) {
        Ok(m) => m,
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
    };
    let id = parsed.name.to_lowercase();
    if let Some(expected) = expected_id {
        if expected.to_lowercase() != id {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!(
                "plugin manifest name {:?} does not match the expected id {expected:?}",
                parsed.name
            ));
        }
    }

    // Publish atomically: move the old managed copy aside, rename the new one
    // into place; keep the old copy until installed.json is written.
    let managed_root = managed_dir.join(&id);
    let previous = managed_dir.join(format!("{id}.previous-{}", unique_suffix()));
    let mut moved_previous = false;
    let target = if source_root == staging {
        staging.clone()
    } else {
        source_root.clone()
    };
    let publish = (|| -> Result<(), String> {
        if let Err(e) = fs::rename(&target, &managed_root) {
            if !managed_root.exists() {
                return Err(format!("failed to publish plugin to {}: {e}", managed_root.display()));
            }
            fs::rename(&managed_root, &previous).map_err(|e| move_aside_error(&e))?;
            moved_previous = true;
            fs::rename(&target, &managed_root).map_err(|e| format!("failed to publish plugin: {e}"))?;
        }
        Ok(())
    })();
    if let Err(e) = publish {
        let _ = fs::remove_dir_all(&staging);
        // The old copy may already be parked at `previous` — restore it.
        if moved_previous {
            let _ = fs::rename(&previous, &managed_root);
        }
        return Err(e);
    }
    if source_root != staging {
        let _ = fs::remove_dir_all(&staging);
    }

    let record = match (|| -> Result<InstalledRecord, String> {
        let _guard = INSTALLED_LOCK.lock().unwrap();
        let mut file = read_installed(home)?;
        let now = now_iso();
        let existing = file.plugins.iter().find(|r| r.id == id).cloned();
        let record = InstalledRecord {
            id: id.clone(),
            root: managed_root.to_string_lossy().to_string(),
            source: source_type.to_string(),
            enabled: existing.as_ref().map(|r| r.enabled).unwrap_or(true),
            installed_at: existing
                .as_ref()
                .map(|r| r.installed_at.clone())
                .unwrap_or_else(|| now.clone()),
            updated_at: Some(now),
            original_source: Some(original_source.to_string()),
            capabilities: existing.as_ref().and_then(|r| r.capabilities.clone()),
            github,
            extra: serde_json::Map::new(),
        };
        if let Some(i) = file.plugins.iter().position(|r| r.id == id) {
            file.plugins[i] = record.clone();
        } else {
            file.plugins.push(record.clone());
        }
        write_installed(home, &file)?;
        Ok(record)
    })() {
        Ok(record) => record,
        Err(e) => {
            // Rollback the publish: remove the new copy, restore the old one.
            let _ = fs::remove_dir_all(&managed_root);
            if moved_previous {
                let _ = fs::rename(&previous, &managed_root);
            }
            return Err(e);
        }
    };
    let _ = fs::remove_dir_all(&previous);
    Ok(installed_info(&record, home))
}

// ---------------------------------------------------------------------------
// Marketplace merge helpers
// ---------------------------------------------------------------------------

/// Read the cached catalog (best-effort) into normalized entries, used to
/// decide `is_marketplace` without hitting the network.
fn cached_catalog_entries(home: &Path) -> Vec<MarketplaceEntry> {
    let Ok(Some(cache)) = read_catalog_cache(home) else {
        return Vec::new();
    };
    match marketplace_url().and_then(|url| parse_catalog_from_value(&cache.catalog, &url)) {
        Ok(entries) => entries,
        Err(_) => Vec::new(),
    }
}

/// is_marketplace: the record's id / source / originalSource corresponds to a
/// catalog entry.
fn is_marketplace_install(home: &Path, record: &InstalledRecord) -> bool {
    let entries = cached_catalog_entries(home);
    entries.iter().any(|e| {
        e.id == record.id
            || record.original_source.as_deref() == Some(e.source.as_str())
            || record.source == e.source
    })
}

fn installed_info(record: &InstalledRecord, home: &Path) -> InstalledPluginInfo {
    InstalledPluginInfo {
        id: record.id.clone(),
        root: record.root.clone(),
        source: record.source.clone(),
        enabled: record.enabled,
        version: read_manifest_version(&PathBuf::from(&record.root)),
        installed_at: Some(record.installed_at.clone()),
        updated_at: record.updated_at.clone(),
        is_marketplace: is_marketplace_install(home, record),
    }
}

/// Merge a parsed catalog with local installed state (kimi-code
/// `computeUpdateStatus`: update only on strict latest > installed).
fn build_marketplace_result(
    home: &Path,
    raw: &serde_json::Value,
    catalog_url: &str,
    fetched_at: String,
    from_cache: bool,
) -> Result<PluginMarketplaceResult, String> {
    let entries = parse_catalog_from_value(raw, catalog_url)?;
    let installed = read_installed(home)?;
    let mut by_id: HashMap<String, &InstalledRecord> = HashMap::new();
    for record in &installed.plugins {
        by_id.insert(record.id.to_lowercase(), record);
    }
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        let (installed, update_available) = match by_id.get(&entry.id.to_lowercase()) {
            Some(record) => {
                let version = read_manifest_version(&PathBuf::from(&record.root));
                let update = match (&entry.version, &version) {
                    (Some(latest), Some(local)) => {
                        compare_simple_semver(latest, local) == Some(Ordering::Greater)
                    }
                    _ => false,
                };
                let info = InstalledPluginInfo {
                    id: record.id.clone(),
                    root: record.root.clone(),
                    source: record.source.clone(),
                    enabled: record.enabled,
                    version,
                    installed_at: Some(record.installed_at.clone()),
                    updated_at: record.updated_at.clone(),
                    // Matched against a catalog entry by id → marketplace install.
                    is_marketplace: true,
                };
                (Some(info), update)
            }
            None => (None, false),
        };
        out.push(MarketplaceEntry {
            installed,
            update_available,
            ..entry
        });
    }
    Ok(PluginMarketplaceResult {
        fetched_at,
        from_cache,
        entries: out,
    })
}

/// Backstop for capabilityId entries (the frontend already blocks them): if the
/// cached catalog says `expected_id` is a built-in capability, refuse.
fn find_catalog_capability_entry(home: &Path, id: &str) -> Result<Option<MarketplaceEntry>, String> {
    let Some(cache) = read_catalog_cache(home)? else {
        return Ok(None);
    };
    let entries = parse_catalog_from_value(&cache.catalog, &marketplace_url()?)?;
    Ok(entries
        .into_iter()
        .find(|e| e.id == id && e.capability_id.as_deref().is_some_and(|c| !c.is_empty())))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_plugin_marketplace(
    home_override: Option<String>,
    refresh: Option<bool>,
) -> Result<PluginMarketplaceResult, String> {
    // `refresh` is accepted for API compatibility; the fetch is always
    // attempted and the cache only serves as a fallback on failure.
    let _ = refresh;
    let home = crate::dashboard::resolve_kimi_home(home_override);
    let url = marketplace_url()?;
    match fetch_and_parse_catalog(&url).await {
        Ok(raw) => {
            let fetched_at = now_iso();
            if let Err(e) = write_catalog_cache(&home, &fetched_at, &raw) {
                eprintln!("[plugins] failed to write marketplace cache: {e}");
            }
            build_marketplace_result(&home, &raw, &url, fetched_at, false)
        }
        Err(fetch_err) => match read_catalog_cache(&home) {
            Ok(Some(cache)) => {
                build_marketplace_result(&home, &cache.catalog, &url, cache.fetched_at, true)
            }
            Ok(None) => Err(format!(
                "failed to fetch plugin marketplace: {fetch_err}; no local cache available"
            )),
            Err(cache_err) => Err(format!(
                "failed to fetch plugin marketplace: {fetch_err}; local cache could not be read: {cache_err}"
            )),
        },
    }
}

#[tauri::command]
pub fn list_installed_plugins(home_override: Option<String>) -> Result<Vec<InstalledPluginInfo>, String> {
    let home = crate::dashboard::resolve_kimi_home(home_override);
    let file = read_installed(&home)?;
    let mut out: Vec<InstalledPluginInfo> =
        file.plugins.iter().map(|record| installed_info(record, &home)).collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[tauri::command]
pub async fn install_plugin(
    home_override: Option<String>,
    source: String,
    expected_id: Option<String>,
) -> Result<InstalledPluginInfo, String> {
    let home = crate::dashboard::resolve_kimi_home(home_override);
    if let Some(expected) = expected_id.as_deref() {
        if let Some(entry) = find_catalog_capability_entry(&home, expected)? {
            return Err(format!(
                "plugin {expected:?} is a built-in capability plugin (capabilityId: {}) and cannot be installed from the marketplace; use the official channel",
                entry.capability_id.unwrap_or_default()
            ));
        }
    }
    let original_source = source.trim().to_string();
    match resolve_install_source(&original_source)? {
        ResolvedSource::LocalPath(path) => Err(format!(
            "installing plugins from local paths is not supported ({path}); provide a zip URL or a GitHub repository URL"
        )),
        ResolvedSource::ZipUrl(url) => {
            let tmp = download_to_temp_file(&url).await?;
            let result = install_from_zip(
                &home,
                &tmp,
                expected_id.as_deref(),
                &original_source,
                "zip-url",
                None,
            );
            let _ = fs::remove_file(&tmp);
            result
        }
        ResolvedSource::Github {
            owner,
            repo,
            r#ref,
        } => {
            let (zip_url, resolved_ref) = resolve_github_zip_url(&owner, &repo, &r#ref).await?;
            let tmp = download_to_temp_file(&zip_url).await?;
            // installedSha needs the GitHub Atom feed; left None (documented
            // divergence — update detection here uses the catalog version).
            let github = Some(GithubMetadata {
                owner,
                repo,
                r#ref: resolved_ref,
                installed_sha: None,
            });
            let result = install_from_zip(
                &home,
                &tmp,
                expected_id.as_deref(),
                &original_source,
                "github",
                github,
            );
            let _ = fs::remove_file(&tmp);
            result
        }
    }
}

#[tauri::command]
pub fn set_plugin_enabled(
    home_override: Option<String>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let home = crate::dashboard::resolve_kimi_home(home_override);
    let _guard = INSTALLED_LOCK.lock().unwrap();
    let mut file = read_installed(&home)?;
    let record = file
        .plugins
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| format!("plugin {id:?} is not installed"))?;
    if record.enabled == enabled {
        // No-op, mirrors kimi-code `setEnabled`.
        return Ok(());
    }
    record.enabled = enabled;
    record.updated_at = Some(now_iso());
    write_installed(&home, &file)
}

#[tauri::command]
pub fn remove_plugin(home_override: Option<String>, id: String) -> Result<(), String> {
    let home = crate::dashboard::resolve_kimi_home(home_override);
    let _guard = INSTALLED_LOCK.lock().unwrap();
    let mut file = read_installed(&home)?;
    let before = file.plugins.len();
    file.plugins.retain(|r| r.id != id);
    if file.plugins.len() == before {
        return Err(format!("plugin {id:?} is not installed"));
    }
    write_installed(&home, &file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use tempfile::TempDir;

    fn sandbox() -> TempDir {
        TempDir::new().expect("tempdir")
    }

    fn write(home: &Path, rel: &str, content: &str) {
        let path = home.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn read_to_string(home: &Path, rel: &str) -> String {
        fs::read_to_string(home.join(rel)).unwrap()
    }

    /// A kimi-code store.ts-style installed.json (exact field naming).
    const KIMI_INSTALLED_SAMPLE: &str = r#"{
  "version": 1,
  "plugins": [
    {
      "id": "my-plugin",
      "root": "C:/Users/x/.kimi-code/plugins/managed/my-plugin",
      "source": "github",
      "enabled": true,
      "installedAt": "2026-08-01T10:00:00.000Z",
      "updatedAt": "2026-08-02T10:00:00.000Z",
      "originalSource": "https://github.com/owner/repo",
      "capabilities": { "mcpServers": { "demo-server": { "enabled": true } } },
      "github": { "owner": "owner", "repo": "repo", "ref": { "kind": "tag", "value": "v1.0.0" } }
    }
  ]
}"#;

    #[test]
    fn installed_json_parses_kimi_code_format() {
        let home = sandbox();
        write(home.path(), INSTALLED_REL, KIMI_INSTALLED_SAMPLE);
        let file = read_installed(home.path()).unwrap();
        assert_eq!(file.version, 1);
        assert_eq!(file.plugins.len(), 1);
        let p = &file.plugins[0];
        assert_eq!(p.id, "my-plugin");
        assert_eq!(p.root, "C:/Users/x/.kimi-code/plugins/managed/my-plugin");
        assert_eq!(p.source, "github");
        assert!(p.enabled);
        assert_eq!(p.installed_at, "2026-08-01T10:00:00.000Z");
        assert_eq!(p.updated_at.as_deref(), Some("2026-08-02T10:00:00.000Z"));
        assert_eq!(
            p.original_source.as_deref(),
            Some("https://github.com/owner/repo")
        );
        let caps = p.capabilities.as_ref().unwrap();
        assert_eq!(
            caps["mcpServers"]["demo-server"]["enabled"],
            serde_json::json!(true)
        );
        let gh = p.github.as_ref().unwrap();
        assert_eq!(gh.owner, "owner");
        assert_eq!(gh.repo, "repo");
        assert_eq!(gh.r#ref.kind, "tag");
        assert_eq!(gh.r#ref.value, "v1.0.0");
        assert!(gh.installed_sha.is_none());
    }

    #[test]
    fn installed_json_serializes_exact_kimi_shape() {
        let home = sandbox();
        let record = InstalledRecord {
            id: "my-plugin".into(),
            root: "C:/Users/x/.kimi-code/plugins/managed/my-plugin".into(),
            source: "github".into(),
            enabled: true,
            installed_at: "2026-08-01T10:00:00.000Z".into(),
            updated_at: Some("2026-08-02T10:00:00.000Z".into()),
            original_source: Some("https://github.com/owner/repo".into()),
            capabilities: Some(serde_json::json!({ "mcpServers": { "s": { "enabled": true } } })),
            github: Some(GithubMetadata {
                owner: "owner".into(),
                repo: "repo".into(),
                r#ref: GithubRef { kind: "tag".into(), value: "v1.0.0".into() },
                installed_sha: None,
            }),
            extra: serde_json::Map::new(),
        };
        write_installed(
            home.path(),
            &InstalledFile {
                version: 1,
                plugins: vec![record],
                extra: serde_json::Map::new(),
            },
        )
        .unwrap();
        let text = read_to_string(home.path(), INSTALLED_REL);
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["version"], serde_json::json!(1));
        assert!(parsed["plugins"].is_array());
        let p = &parsed["plugins"][0];
        // camelCase keys, optional fields omitted (installedSha absent).
        assert!(p.get("installedAt").is_some());
        assert!(p.get("updatedAt").is_some());
        assert!(p.get("originalSource").is_some());
        assert!(p.get("capabilities").is_some());
        assert!(p.get("github").is_some());
        assert!(p.get("installedSha").is_none());
        assert_eq!(p["github"]["ref"]["kind"], "tag");
        // Re-parse: the written file is exactly what kimi-code reads back.
        let file = read_installed(home.path()).unwrap();
        assert_eq!(file.plugins[0].id, "my-plugin");
        assert_eq!(file.plugins[0].github.as_ref().unwrap().r#ref.value, "v1.0.0");
    }

    #[test]
    fn installed_json_roundtrip_preserves_unknown_fields() {
        let home = sandbox();
        let raw = r#"{
          "version": 1,
          "futureField": { "keep": true },
          "plugins": [
            {
              "id": "p1",
              "root": "C:/r",
              "source": "zip-url",
              "enabled": false,
              "installedAt": "2026-01-01T00:00:00.000Z",
              "futureRecordField": "preserved"
            }
          ]
        }"#;
        write(home.path(), INSTALLED_REL, raw);
        let mut file = read_installed(home.path()).unwrap();
        file.plugins[0].enabled = true;
        write_installed(home.path(), &file).unwrap();
        let text = read_to_string(home.path(), INSTALLED_REL);
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["futureField"]["keep"], serde_json::json!(true));
        assert_eq!(parsed["plugins"][0]["futureRecordField"], "preserved");
        assert_eq!(parsed["plugins"][0]["enabled"], serde_json::json!(true));
    }

    #[test]
    fn installed_json_exact_string_matches_kimi_format() {
        // The full serialized document our write_installed produces for a
        // GitHub-installed plugin — byte-for-byte the shape kimi-code store.ts
        // writes (2-space indent, camelCase, optional fields omitted).
        let record = InstalledRecord {
            id: "my-plugin".into(),
            root: "C:/Users/x/.kimi-code/plugins/managed/my-plugin".into(),
            source: "github".into(),
            enabled: true,
            installed_at: "2026-08-01T10:00:00.000Z".into(),
            updated_at: Some("2026-08-02T10:00:00.000Z".into()),
            original_source: Some("https://github.com/owner/repo".into()),
            capabilities: Some(serde_json::json!({ "mcpServers": { "demo-server": { "enabled": true } } })),
            github: Some(GithubMetadata {
                owner: "owner".into(),
                repo: "repo".into(),
                r#ref: GithubRef { kind: "tag".into(), value: "v1.0.0".into() },
                installed_sha: None,
            }),
            extra: serde_json::Map::new(),
        };
        let file = InstalledFile {
            version: 1,
            plugins: vec![record],
            extra: serde_json::Map::new(),
        };
        let expected = r#"{
  "version": 1,
  "plugins": [
    {
      "id": "my-plugin",
      "root": "C:/Users/x/.kimi-code/plugins/managed/my-plugin",
      "source": "github",
      "enabled": true,
      "installedAt": "2026-08-01T10:00:00.000Z",
      "updatedAt": "2026-08-02T10:00:00.000Z",
      "originalSource": "https://github.com/owner/repo",
      "capabilities": {
        "mcpServers": {
          "demo-server": {
            "enabled": true
          }
        }
      },
      "github": {
        "owner": "owner",
        "repo": "repo",
        "ref": {
          "kind": "tag",
          "value": "v1.0.0"
        }
      }
    }
  ]
}"#;
        assert_eq!(serde_json::to_string_pretty(&file).unwrap(), expected);
    }

    #[test]
    fn installed_json_missing_file_is_empty() {
        let home = sandbox();
        let file = read_installed(home.path()).unwrap();
        assert_eq!(file.version, 1);
        assert!(file.plugins.is_empty());
    }

    #[test]
    fn catalog_parses_field_aliases_and_defaults() {
        let catalog = serde_json::json!({
            "version": "1",
            "plugins": [
                {
                    "id": "a",
                    "name": "Alias Name",
                    "url": "./official/a.zip",
                    "shortDescription": "legacy desc",
                    "keywords": ["k1", "", "  "]
                },
                {
                    "id": "b",
                    "displayName": "Modern",
                    "source": "./curated/b.zip",
                    "tier": "official",
                    "version": "2.0.0",
                    "capabilityId": "cap-x"
                }
            ]
        });
        let url = "https://code.kimi.com/kimi-code/plugins/marketplace.json";
        let entries = parse_catalog_from_value(&catalog, url).unwrap();
        assert_eq!(entries.len(), 2);
        let a = &entries[0];
        assert_eq!(a.id, "a");
        assert_eq!(a.display_name, "Alias Name"); // name → displayName
        assert_eq!(a.description.as_deref(), Some("legacy desc")); // shortDescription → description
        assert_eq!(a.keywords, vec!["k1"]); // blank keywords dropped
        assert_eq!(a.tier, "curated"); // tier missing → default
        assert!(a.version.is_none());
        assert_eq!(a.source, "https://code.kimi.com/kimi-code/plugins/official/a.zip");
        assert!(a.capability_id.is_none());
        let b = &entries[1];
        assert_eq!(b.tier, "official");
        assert_eq!(b.version.as_deref(), Some("2.0.0"));
        assert_eq!(b.capability_id.as_deref(), Some("cap-x")); // passed through, not dropped
        assert_eq!(b.source, "https://code.kimi.com/kimi-code/plugins/curated/b.zip");
    }

    #[test]
    fn catalog_requires_source() {
        let catalog = serde_json::json!({ "plugins": [{ "id": "a", "name": "A" }] });
        let err = parse_catalog_from_value(&catalog, "https://x/y.json").unwrap_err();
        assert!(err.contains("must define \"source\""), "got: {err}");
    }

    #[test]
    fn catalog_requires_plugins_array() {
        let err = parse_catalog_from_value(&serde_json::json!({ "foo": 1 }), "https://x/y.json").unwrap_err();
        assert!(err.contains("plugins"), "got: {err}");
    }

    #[test]
    fn catalog_relative_source_resolves_against_catalog_url() {
        assert_eq!(
            resolve_relative_url("https://code.kimi.com/kimi-code/plugins/marketplace.json", "./official/x.zip"),
            "https://code.kimi.com/kimi-code/plugins/official/x.zip"
        );
        assert_eq!(
            resolve_relative_url("https://code.kimi.com/kimi-code/plugins/marketplace.json", "../other.zip"),
            "https://code.kimi.com/kimi-code/other.zip"
        );
        assert_eq!(
            resolve_relative_url("https://code.kimi.com/kimi-code/plugins/marketplace.json", "/abs/x.zip"),
            "https://code.kimi.com/abs/x.zip"
        );
        assert_eq!(
            resolve_relative_url("https://code.kimi.com/kimi-code/plugins/marketplace.json", "//cdn.example.com/x.zip"),
            "https://cdn.example.com/x.zip"
        );
        // Local catalog: relative to its directory (platform-native separators).
        let expected = PathBuf::from("C:/somewhere").join("official/x.zip");
        assert_eq!(
            PathBuf::from(resolve_entry_source("./official/x.zip", "C:/somewhere/marketplace.json")),
            expected
        );
    }

    #[test]
    fn github_url_recognition_four_forms() {
        let bare = resolve_install_source("https://github.com/owner/repo").unwrap();
        match bare {
            ResolvedSource::Github { owner, repo, r#ref } => {
                assert_eq!(owner, "owner");
                assert_eq!(repo, "repo");
                assert!(r#ref.is_none());
            }
            other => panic!("expected github, got {other:?}"),
        }

        let tree_branch = resolve_install_source("https://github.com/o/r/tree/main").unwrap();
        match tree_branch {
            ResolvedSource::Github { r#ref: Some(r), .. } => {
                assert_eq!(r.kind, "branch");
                assert_eq!(r.value, "main");
            }
            other => panic!("expected github tree ref, got {other:?}"),
        }

        let tree_sha = resolve_install_source("https://github.com/o/r/tree/abcdef1").unwrap();
        match tree_sha {
            ResolvedSource::Github { r#ref: Some(r), .. } => assert_eq!(r.kind, "sha"),
            other => panic!("expected sha ref, got {other:?}"),
        }

        let tag = resolve_install_source("https://github.com/o/r/releases/tag/v1.2.3").unwrap();
        match tag {
            ResolvedSource::Github { r#ref: Some(r), .. } => {
                assert_eq!(r.kind, "tag");
                assert_eq!(r.value, "v1.2.3");
            }
            other => panic!("expected tag ref, got {other:?}"),
        }

        let commit = resolve_install_source("https://github.com/o/r/commit/0123456789abcdef0123456789abcdef01234567").unwrap();
        match commit {
            ResolvedSource::Github { r#ref: Some(r), .. } => {
                assert_eq!(r.kind, "sha");
                assert_eq!(r.value.len(), 40);
            }
            other => panic!("expected commit ref, got {other:?}"),
        }

        // www + .git normalization, and the codeload URL shape for tags.
        let www = resolve_install_source("https://www.github.com/o/r.git").unwrap();
        match www {
            ResolvedSource::Github { repo, .. } => assert_eq!(repo, "r"),
            other => panic!("expected repo stripped of .git, got {other:?}"),
        }
        let r = GithubRef { kind: "tag".into(), value: "v1.2.3".into() };
        assert_eq!(
            github_zip_url("o", "r", &r),
            "https://codeload.github.com/o/r/zip/refs/tags/v1.2.3"
        );
        let r = GithubRef { kind: "branch".into(), value: "feature/x".into() };
        assert_eq!(
            github_zip_url("o", "r", &r),
            "https://codeload.github.com/o/r/zip/feature/x"
        );

        // Plain http(s) that is not GitHub → zip URL.
        match resolve_install_source("https://example.com/a.zip").unwrap() {
            ResolvedSource::ZipUrl(u) => assert_eq!(u, "https://example.com/a.zip"),
            other => panic!("expected zip url, got {other:?}"),
        }
        // Non-URL, non-absolute → error.
        assert!(resolve_install_source("relative/path").is_err());
    }

    /// Build an in-memory zip with the given (name, content) entries.
    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buf);
            let options = zip::write::SimpleFileOptions::default();
            for (name, content) in entries {
                writer.start_file(*name, options).unwrap();
                writer.write_all(content).unwrap();
            }
            writer.finish().unwrap();
        }
        buf.into_inner()
    }

    fn zip_to_file(zip_bytes: &[u8]) -> TempDir {
        let dir = sandbox();
        fs::write(dir.path().join("pkg.zip"), zip_bytes).unwrap();
        dir
    }

    #[test]
    fn zip_extraction_rejects_path_traversal() {
        // "../evil" — must be refused before anything is written outside.
        let cases: &[&str] = &[
            "../evil.txt",
            "a/../../evil.txt",
            "\\..\\evil.txt",
            "/absolute.txt",
            "C:/drive.txt",
            "C:\\drive.txt",
        ];
        for name in cases {
            let dir = zip_to_file(&build_zip(&[(name, b"x")]));
            let dest = dir.path().join("out");
            let err = extract_zip(&dir.path().join("pkg.zip"), &dest).unwrap_err();
            assert!(err.contains("path traversal"), "entry {name:?} → {err}");
            // Nothing may have been written outside `out`.
            assert!(!dir.path().join("evil.txt").exists());
            assert!(!dir.path().join("drive.txt").exists());
        }
    }

    #[test]
    fn zip_extraction_writes_normal_layout() {
        let dir = zip_to_file(&build_zip(&[
            ("kimi.plugin.json", br#"{"name":"ok","version":"1.0.0"}"#),
            ("skills/readme.md", b"hi"),
        ]));
        let dest = dir.path().join("out");
        extract_zip(&dir.path().join("pkg.zip"), &dest).unwrap();
        assert!(dest.join("kimi.plugin.json").is_file());
        assert_eq!(fs::read_to_string(dest.join("skills/readme.md")).unwrap(), "hi");
    }

    #[test]
    fn zip_extraction_skips_dot_components() {
        let dir = zip_to_file(&build_zip(&[("a/./b.txt", b"x")]));
        let dest = dir.path().join("out");
        extract_zip(&dir.path().join("pkg.zip"), &dest).unwrap();
        assert!(dest.join("a/b.txt").is_file());
    }

    #[test]
    fn plugin_name_regex_validation() {
        for ok in ["my-plugin", "my_plugin", "a", "0start", "x".repeat(64).as_str()] {
            assert!(validate_plugin_name(ok).is_ok(), "{ok:?} should be valid");
        }
        for bad in ["MyPlugin", "-lead", "_lead", "", "x".repeat(65).as_str(), "a b", "插件"] {
            assert!(validate_plugin_name(bad).is_err(), "{bad:?} should be invalid");
        }
    }

    #[test]
    fn semver_compare_behaviour() {
        assert_eq!(compare_simple_semver("1.2.4", "1.2.3"), Some(Ordering::Greater));
        assert_eq!(compare_simple_semver("1.2.3", "1.2.3"), Some(Ordering::Equal));
        assert_eq!(compare_simple_semver("1.2.3", "1.2.4"), Some(Ordering::Less));
        assert_eq!(compare_simple_semver("v1.0.1", "1.0.0"), Some(Ordering::Greater));
        assert_eq!(compare_simple_semver("2.0", "2.0.1"), Some(Ordering::Less));
        assert_eq!(compare_simple_semver("1.2.3-beta.1", "1.2.3"), Some(Ordering::Equal));
        assert_eq!(compare_simple_semver("garbage", "1.0.0"), None);
        assert_eq!(compare_simple_semver("1.0.0", "latest"), None);
    }

    #[test]
    fn set_enabled_updates_file_and_updated_at() {
        let home = sandbox();
        write(home.path(), INSTALLED_REL, KIMI_INSTALLED_SAMPLE);
        set_plugin_enabled(Some(home.path().to_string_lossy().to_string()), "my-plugin".into(), false).unwrap();
        let text = read_to_string(home.path(), INSTALLED_REL);
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["plugins"][0]["enabled"], serde_json::json!(false));
        let updated = parsed["plugins"][0]["updatedAt"].as_str().unwrap();
        assert_ne!(updated, "2026-08-02T10:00:00.000Z");
        assert!(updated.ends_with('Z'));
        // Toggling again is a no-op that keeps the previous updatedAt.
        set_plugin_enabled(Some(home.path().to_string_lossy().to_string()), "my-plugin".into(), false).unwrap();
        let text2 = read_to_string(home.path(), INSTALLED_REL);
        assert_eq!(text, text2);
        // Unknown id → error.
        assert!(set_plugin_enabled(Some(home.path().to_string_lossy().to_string()), "nope".into(), true).is_err());
    }

    #[test]
    fn remove_plugin_deletes_record_keeps_files() {
        let home = sandbox();
        write(home.path(), INSTALLED_REL, KIMI_INSTALLED_SAMPLE);
        let managed = home.path().join("plugins/managed/my-plugin");
        write(home.path(), "plugins/managed/my-plugin/kimi.plugin.json", r#"{"name":"my-plugin"}"#);
        remove_plugin(Some(home.path().to_string_lossy().to_string()), "my-plugin".into()).unwrap();
        let text = read_to_string(home.path(), INSTALLED_REL);
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["plugins"].as_array().unwrap().len(), 0);
        assert_eq!(parsed["version"], serde_json::json!(1));
        // Managed files stay on disk.
        assert!(managed.join("kimi.plugin.json").is_file());
        assert!(remove_plugin(Some(home.path().to_string_lossy().to_string()), "my-plugin".into()).is_err());
    }

    fn manifest_zip(name: &str, version: &str, subdir: bool) -> Vec<u8> {
        let manifest = format!(r#"{{"name":"{name}","version":"{version}","description":"t"}}"#);
        if subdir {
            build_zip(&[("pkg/", b""), ("pkg/kimi.plugin.json", manifest.as_bytes())])
        } else {
            build_zip(&[("kimi.plugin.json", manifest.as_bytes())])
        }
    }

    #[test]
    fn install_pipeline_publishes_and_records() {
        let home = sandbox();
        let zip = zip_to_file(&manifest_zip("test-plugin", "1.2.3", false));
        let info = install_from_zip(
            home.path(),
            &zip.path().join("pkg.zip"),
            None,
            "https://example.com/test-plugin.zip",
            "zip-url",
            None,
        )
        .unwrap();
        assert_eq!(info.id, "test-plugin");
        assert_eq!(info.version.as_deref(), Some("1.2.3"));
        assert_eq!(info.source, "zip-url");
        assert!(info.enabled);
        let root = PathBuf::from(&info.root);
        assert_eq!(root, home.path().join("plugins/managed/test-plugin"));
        assert!(root.join("kimi.plugin.json").is_file());
        // No staging leftovers.
        let entries: Vec<_> = fs::read_dir(home.path().join("plugins/managed")).unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(entries, vec!["test-plugin".to_string()]);
        // Record written in kimi-code format.
        let text = read_to_string(home.path(), INSTALLED_REL);
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["version"], serde_json::json!(1));
        assert_eq!(parsed["plugins"][0]["id"], "test-plugin");
        assert_eq!(parsed["plugins"][0]["source"], "zip-url");
        assert_eq!(
            parsed["plugins"][0]["originalSource"],
            "https://example.com/test-plugin.zip"
        );
        assert_eq!(parsed["plugins"][0]["enabled"], serde_json::json!(true));
        assert!(parsed["plugins"][0]["installedAt"].as_str().unwrap().ends_with('Z'));
    }

    #[test]
    fn install_pipeline_detects_single_subdir_root() {
        let home = sandbox();
        let zip = zip_to_file(&manifest_zip("sub-plugin", "0.1.0", true));
        let info = install_from_zip(home.path(), &zip.path().join("pkg.zip"), None, "https://x/sub.zip", "zip-url", None)
            .unwrap();
        let root = PathBuf::from(&info.root);
        assert!(root.join("kimi.plugin.json").is_file());
        assert_eq!(root.file_name().unwrap(), "sub-plugin");
    }

    #[test]
    fn install_expected_id_mismatch_rejected() {
        let home = sandbox();
        let zip = zip_to_file(&manifest_zip("actual-name", "1.0.0", false));
        let err = install_from_zip(
            home.path(),
            &zip.path().join("pkg.zip"),
            Some("expected-name"),
            "https://x/a.zip",
            "zip-url",
            None,
        )
        .unwrap_err();
        assert!(err.contains("does not match"), "got: {err}");
        // Nothing recorded, nothing published.
        assert!(!home.path().join(INSTALLED_REL).exists());
    }

    #[test]
    fn install_updates_existing_record_preserving_enabled() {
        let home = sandbox();
        // Pre-installed, disabled, with a fixed installedAt.
        let pre = serde_json::json!({
            "version": 1,
            "plugins": [{
                "id": "test-plugin",
                "root": home.path().join("plugins/managed/test-plugin").to_string_lossy(),
                "source": "zip-url",
                "enabled": false,
                "installedAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-01T00:00:00.000Z",
                "originalSource": "https://old.example.com/x.zip"
            }]
        });
        write(home.path(), INSTALLED_REL, &serde_json::to_string_pretty(&pre).unwrap());
        let zip = zip_to_file(&manifest_zip("test-plugin", "2.0.0", false));
        let info = install_from_zip(
            home.path(),
            &zip.path().join("pkg.zip"),
            None,
            "https://new.example.com/y.zip",
            "zip-url",
            None,
        )
        .unwrap();
        assert!(!info.enabled, "reinstall keeps the previous enabled state");
        let text = read_to_string(home.path(), INSTALLED_REL);
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        let p = &parsed["plugins"][0];
        assert_eq!(p["installedAt"], "2026-01-01T00:00:00.000Z"); // preserved
        assert_eq!(p["originalSource"], "https://new.example.com/y.zip"); // refreshed
        assert_ne!(p["updatedAt"], "2026-01-01T00:00:00.000Z"); // refreshed
        assert_eq!(info.version.as_deref(), Some("2.0.0"));
    }

    #[test]
    fn install_pipeline_rolls_back_on_record_write_failure() {
        let home = sandbox();
        // A stale managed root forces the "move aside + restore" publish path.
        let stale_root = home.path().join("plugins/managed/test-plugin");
        fs::create_dir_all(&stale_root).unwrap();
        fs::write(stale_root.join("kimi.plugin.json"), "{}").unwrap();
        // Force the installed.json write to fail: the tmp path is a directory.
        fs::create_dir_all(home.path().join("plugins/installed.json.tmp")).unwrap();

        let zip = zip_to_file(&manifest_zip("test-plugin", "1.0.0", false));
        let err = install_from_zip(
            home.path(),
            &zip.path().join("pkg.zip"),
            None,
            "https://x/a.zip",
            "zip-url",
            None,
        )
        .unwrap_err();
        assert!(err.contains("failed"), "got: {err}");
        // Rollback: the old managed copy is back with its original content.
        assert_eq!(
            fs::read_to_string(stale_root.join("kimi.plugin.json")).unwrap(),
            "{}"
        );
        // No staging leftovers.
        let entries: Vec<_> = fs::read_dir(home.path().join("plugins/managed"))
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(entries, vec!["test-plugin".to_string()]);
    }

    #[test]
    fn install_github_records_metadata_without_sha() {
        let home = sandbox();
        let zip = zip_to_file(&manifest_zip("gh-plugin", "1.0.0", false));
        let github = Some(GithubMetadata {
            owner: "o".into(),
            repo: "r".into(),
            r#ref: GithubRef { kind: "branch".into(), value: "HEAD".into() },
            installed_sha: None,
        });
        let info = install_from_zip(home.path(), &zip.path().join("pkg.zip"), None, "https://github.com/o/r", "github", github)
            .unwrap();
        assert_eq!(info.source, "github");
        let text = read_to_string(home.path(), INSTALLED_REL);
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        let gh = &parsed["plugins"][0]["github"];
        assert_eq!(gh["owner"], "o");
        assert_eq!(gh["repo"], "r");
        assert_eq!(gh["ref"]["kind"], "branch");
        assert!(gh.get("installedSha").is_none(), "installedSha stays omitted");
    }

    #[test]
    fn marketplace_merge_reports_install_and_update() {
        let home = sandbox();
        // Installed plugin at v1.0.0, catalog lists v1.2.0.
        write(home.path(), INSTALLED_REL, KIMI_INSTALLED_SAMPLE);
        let real_root = home.path().join("plugins/managed/my-plugin");
        write(home.path(), "plugins/managed/my-plugin/kimi.plugin.json", r#"{"name":"my-plugin","version":"1.0.0"}"#);
        // Fix the record's root to the sandbox path.
        let mut file = read_installed(home.path()).unwrap();
        file.plugins[0].root = real_root.to_string_lossy().to_string();
        write_installed(home.path(), &file).unwrap();

        let catalog = serde_json::json!({
            "plugins": [
                { "id": "my-plugin", "name": "My Plugin", "source": "./official/my-plugin.zip", "version": "1.2.0" },
                { "id": "not-installed", "name": "Fresh", "source": "./curated/fresh.zip", "version": "3.0.0" }
            ]
        });
        let result = build_marketplace_result(
            home.path(),
            &catalog,
            "https://code.kimi.com/kimi-code/plugins/marketplace.json",
            "2026-08-01T00:00:00.000Z".into(),
            false,
        )
        .unwrap();
        assert!(!result.from_cache);
        assert_eq!(result.entries.len(), 2);
        let mine = &result.entries[0];
        assert!(mine.update_available, "catalog 1.2.0 > installed 1.0.0");
        let installed = mine.installed.as_ref().unwrap();
        assert!(installed.is_marketplace);
        assert_eq!(installed.version.as_deref(), Some("1.0.0"));
        let fresh = &result.entries[1];
        assert!(!fresh.update_available);
        assert!(fresh.installed.is_none());
    }

    #[test]
    fn marketplace_cache_fallback_and_is_marketplace() {
        let home = sandbox();
        // Seed the cache as if a previous fetch had succeeded.
        let catalog = serde_json::json!({
            "plugins": [{ "id": "cached-plug", "name": "Cached", "source": "./official/cached.zip" }]
        });
        write_catalog_cache(home.path(), "2026-07-01T00:00:00.000Z", &catalog).unwrap();
        // list_installed_plugins marks matching installs as marketplace.
        let mut file = InstalledFile::default();
        file.plugins.push(InstalledRecord {
            id: "cached-plug".into(),
            root: home.path().join("plugins/managed/cached-plug").to_string_lossy().to_string(),
            source: "zip-url".into(),
            enabled: true,
            installed_at: "2026-07-02T00:00:00.000Z".into(),
            updated_at: None,
            original_source: Some("https://code.kimi.com/kimi-code/plugins/official/cached.zip".into()),
            capabilities: None,
            github: None,
            extra: serde_json::Map::new(),
        });
        write_installed(home.path(), &file).unwrap();
        let list = list_installed_plugins(Some(home.path().to_string_lossy().to_string())).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].is_marketplace);
        assert_eq!(list[0].source, "zip-url");
        // A non-catalog install is not marketplace.
        file.plugins.push(InstalledRecord {
            id: "local-only".into(),
            root: "C:/nope".into(),
            source: "zip-url".into(),
            enabled: true,
            installed_at: "2026-07-02T00:00:00.000Z".into(),
            updated_at: None,
            original_source: Some("https://unknown.example.com/x.zip".into()),
            capabilities: None,
            github: None,
            extra: serde_json::Map::new(),
        });
        write_installed(home.path(), &file).unwrap();
        let list = list_installed_plugins(Some(home.path().to_string_lossy().to_string())).unwrap();
        let local_only = list.iter().find(|i| i.id == "local-only").unwrap();
        assert!(!local_only.is_marketplace);
    }

    #[test]
    fn capability_entry_backstop_blocks_install() {
        let home = sandbox();
        let catalog = serde_json::json!({
            "plugins": [{ "id": "builtin-x", "name": "X", "source": "./official/x.zip", "capabilityId": "cap-123" }]
        });
        write_catalog_cache(home.path(), "2026-07-01T00:00:00.000Z", &catalog).unwrap();
        let found = find_catalog_capability_entry(home.path(), "builtin-x").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().capability_id.as_deref(), Some("cap-123"));
        // Plain entry → not blocked.
        let catalog2 = serde_json::json!({ "plugins": [{ "id": "normal", "name": "N", "source": "./o.zip" }] });
        write_catalog_cache(home.path(), "2026-07-01T00:00:00.000Z", &catalog2).unwrap();
        assert!(find_catalog_capability_entry(home.path(), "normal").unwrap().is_none());
        assert!(find_catalog_capability_entry(home.path(), "missing").unwrap().is_none());
    }

    #[test]
    fn move_aside_error_explains_os_error_32() {
        let locked = std::io::Error::from_raw_os_error(32);
        let msg = move_aside_error(&locked);
        assert!(msg.contains("os error 32"), "msg: {msg}");
        assert!(msg.contains("Close kimi-code"), "msg: {msg}");
        // Other I/O errors keep the original format.
        let other = std::io::Error::from_raw_os_error(5);
        assert!(move_aside_error(&other).starts_with("failed to move existing plugin aside:"));
    }
}
