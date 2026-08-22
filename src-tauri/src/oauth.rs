//! Kimi Code OAuth credentials (login session) for usage queries.
//!
//! The official `kimi` CLI stores its OAuth session in
//! `~/.kimi-code/credentials/kimi-code.json` after `kimi login`:
//! ```json
//! {
//!   "access_token": "eyJ...",   // JWT, 15 min TTL (expires_in 900)
//!   "refresh_token": "eyJ...",  // 30 day TTL, rotated on refresh
//!   "expires_at": 1785510484,   // unix seconds
//!   "scope": "kimi-code",
//!   "token_type": "Bearer",
//!   "expires_in": 900
//! }
//! ```
//!
//! v2 refreshes expired tokens via the OAuth refresh_token grant and writes
//! the rotated tokens back to the credentials file. Concurrency safety:
//! - a process-wide single-flight mutex serializes refreshes, and the file is
//!   re-read under the lock so a refresh done by the running `kimi` CLI (or
//!   another waiter) is adopted instead of duplicated;
//! - right before writing back, the file is re-read once more — if the CLI
//!   refreshed meanwhile its newer tokens win (refresh tokens rotate on use,
//!   so clobbering the CLI's write would break its next refresh).
//!
//! v3 adds the in-app sign-in flow: a Device Code Flow (RFC 8628) identical
//! to the official `kimi` CLI, so users can authorize Kimi from the app
//! instead of running `kimi login` in a terminal. Flow:
//! 1. `start_device_authorization()` → POST /api/oauth/device_authorization,
//!    returns user_code + device_code + verification_uri;
//! 2. user opens the verification URI in a browser and approves;
//! 3. `poll_device_token()` polls POST /api/oauth/token with the device_code
//!    grant until the tokens arrive, then writes them to the same
//!    `~/.kimi-code/credentials/<key>.json` file the CLI uses.
//!
//! v4 mirrors the official CLI's dual-region OAuth (v0.38.0, #2862): the login
//! flow and credential lookup are scoped by region. The mainland-cn region
//! (default) uses the shared `oauth/kimi-code` slot (`credentials/kimi-code.json`)
//! and persists no `oauthHost`; the global region derives a scoped key
//! `oauth/kimi-code-env-<sha256>` from (oauthHost, baseUrl), writes
//! `credentials/<scoped>.json`, and persists `oauthHost` in config.toml. Usage
//! queries and token refresh resolve their credentials path + refresh endpoint
//! from the provider's oauth ref instead of always assuming mainland.

use serde::{Deserialize, Serialize};

use crate::kimi_code_io::kimi_code_config_dir;

/// Seconds of leeway when checking expiry, so a token that is about to die
/// mid-request counts as expired.
const EXPIRY_LEEWAY_SECS: i64 = 30;

/// Region endpoints (mirror `packages/oauth/src/region.ts`).
const CN_OAUTH_HOST: &str = "https://auth.kimi.com";
const CN_BASE_URL: &str = "https://api.kimi.com/coding/v1";
const GLOBAL_OAUTH_HOST: &str = "https://auth.kimi.ai";
const GLOBAL_BASE_URL: &str = "https://api.kimi.ai/coding/v1";
/// Shared mainland credential slot (mirror `KIMI_CODE_OAUTH_KEY`).
const DEFAULT_OAUTH_KEY: &str = "oauth/kimi-code";
/// Prefix of region-scoped credential keys (mirror `KIMI_CODE_SCOPED_OAUTH_KEY_PREFIX`).
const SCOPED_OAUTH_KEY_PREFIX: &str = "oauth/kimi-code-env-";
/// OAuth token endpoint host suffix (remaining path after the oauth host).
const TOKEN_PATH: &str = "/api/oauth/token";
/// Device authorization endpoint suffix (RFC 8628).
const DEVICE_AUTHORIZATION_PATH: &str = "/api/oauth/device_authorization";
/// Public OAuth client id used by the official CLI (from kimi.exe).
const CLIENT_ID: &str = "17e5f671-d194-4dfb-9706-5516cb48c098";
/// The managed Kimi Code provider name in config.toml.
const MANAGED_PROVIDER_NAME: &str = "managed:kimi-code";

/// A Kimi Code account region (mainland `.com` vs global `.ai`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KimiRegion {
    /// Mainland China — `auth.kimi.com` / `api.kimi.com`.
    Cn,
    /// International — `auth.kimi.ai` / `api.kimi.ai`.
    Global,
}

impl KimiRegion {
    /// Parse a region hint from the frontend (`"cn"` default, `"global"`).
    pub fn from_opt(s: Option<&str>) -> KimiRegion {
        match s.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
            Some("global") => KimiRegion::Global,
            _ => KimiRegion::Cn,
        }
    }

    pub fn oauth_host(self) -> &'static str {
        match self {
            KimiRegion::Cn => CN_OAUTH_HOST,
            KimiRegion::Global => GLOBAL_OAUTH_HOST,
        }
    }

    /// Managed API base (`/coding/v1`): usages host for this region.
    pub fn base_url(self) -> &'static str {
        match self {
            KimiRegion::Cn => CN_BASE_URL,
            KimiRegion::Global => GLOBAL_BASE_URL,
        }
    }
}

/// The oauth ref stored under a provider's `raw_other["oauth"]`
/// (`storage`/`key`/`oauthHost`), all optional for lenient parsing.
/// `storage` is not read (Kimi Switch only ever uses `file`).
#[derive(Debug, Clone, Default)]
pub struct OAuthRef {
    pub key: Option<String>,
    pub oauth_host: Option<String>,
}

/// Extract the oauth ref from a provider's `raw_other["oauth"]` block, if any.
pub fn oauth_ref_from_provider(provider: &crate::models::Provider) -> Option<OAuthRef> {
    let oauth = provider.raw_other.get("oauth")?.as_object()?;
    Some(OAuthRef {
        key: oauth.get("key").and_then(|v| v.as_str()).map(String::from),
        oauth_host: oauth
            .get("oauthHost")
            .and_then(|v| v.as_str())
            .map(String::from),
    })
}

/// Map an oauth credential `key` to the credentials-file storage name, mirroring
/// the official CLI's `resolveKimiTokenStorageName`:
/// - `"kimi-code"` / `"oauth/kimi-code"` → `"kimi-code"` (file kimi-code.json)
/// - `"oauth/<name>"` → `<name>`
/// - `<name>` (no `/`, not `.`-prefixed) → `<name>` verbatim
/// - anything else → Err
pub fn resolve_storage_name(key: &str) -> Result<String, String> {
    if key == "kimi-code" || key == DEFAULT_OAUTH_KEY {
        return Ok("kimi-code".to_string());
    }
    if let Some(rest) = key.strip_prefix("oauth/") {
        if !rest.is_empty() {
            return Ok(rest.to_string());
        }
    }
    if !key.contains('/') && !key.starts_with('.') {
        return Ok(key.to_string());
    }
    Err(format!("Invalid Kimi OAuth token key: {key}"))
}

/// `trim().replace(/\/+$/, '')`, matching the CLI's `normalizeEndpoint`.
fn normalize_endpoint(s: &str) -> String {
    s.trim().trim_end_matches('/').to_string()
}

/// Derive the oauth credential key for an (oauth_host, base_url) pair, mirroring
/// the official CLI's `resolveKimiCodeOAuthKey`: the mainland defaults map to the
/// shared `oauth/kimi-code` slot; anything else gets a scoped slot
/// `oauth/kimi-code-env-<sha256>` of `JSON.stringify({oauthHost, baseUrl})`.
///
/// The payload must byte-match JS `JSON.stringify({ oauthHost, baseUrl })`
/// (oauthHost first, no spaces), so it is hand-built with `format!` rather than
/// `serde_json::json!` (which can't guarantee field order or exact whitespace).
pub fn derive_scoped_key(oauth_host: &str, base_url: &str) -> String {
    let oauth_host = normalize_endpoint(oauth_host);
    let base_url = normalize_endpoint(base_url);
    if oauth_host == CN_OAUTH_HOST && base_url == CN_BASE_URL {
        return DEFAULT_OAUTH_KEY.to_string();
    }
    let payload = format!(
        "{{\"oauthHost\":\"{oauth_host}\",\"baseUrl\":\"{base_url}\"}}"
    );
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(payload.as_bytes());
    let hex = digest.iter().map(|b| format!("{b:02x}")).collect::<String>();
    format!("{SCOPED_OAUTH_KEY_PREFIX}{}", &hex[..16])
}

/// Resolved credential context for a usage query / token refresh: which
/// credentials file to read/write and which OAuth host to refresh against.
struct OAuthContext {
    storage_name: String,
    oauth_host: String,
}

impl OAuthContext {
    /// Resolve from an optional oauth ref + provider base_url.
    ///
    /// - No ref → the legacy mainland default (`credentials/kimi-code.json` +
    ///   `auth.kimi.com`), so a provider with no oauth block behaves exactly as
    ///   before the region work.
    /// - Ref with a `key` → use that key's storage (scoped slot for global).
    /// - Ref with only `oauthHost` (no key) → derive the scoped key from
    ///   (oauthHost, base_url), matching the CLI's `resolveKimiCodeOAuthRef`.
    fn from(oauth_ref: Option<&OAuthRef>, base_url: &str) -> OAuthContext {
        let (key, oauth_host) = match oauth_ref {
            Some(r) => {
                let host = r
                    .oauth_host
                    .clone()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| CN_OAUTH_HOST.to_string());
                let k = r
                    .key
                    .clone()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| derive_scoped_key(&host, base_url));
                (k, host)
            }
            None => (DEFAULT_OAUTH_KEY.to_string(), CN_OAUTH_HOST.to_string()),
        };
        let storage_name =
            resolve_storage_name(&key).unwrap_or_else(|_| "kimi-code".to_string());
        OAuthContext {
            storage_name,
            oauth_host,
        }
    }

    fn token_endpoint(&self) -> String {
        format!("{}{TOKEN_PATH}", self.oauth_host.trim_end_matches('/'))
    }
}

/// Credentials file path for a given storage name.
fn credentials_path_for_storage(storage_name: &str) -> std::path::PathBuf {
    kimi_code_config_dir()
        .join("credentials")
        .join(format!("{storage_name}.json"))
}

/// Refresh request timeout; refresh is rare, a bit more headroom than the 8s
/// query default is fine.
const REFRESH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
/// Device grant type (RFC 8628).
const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
/// Total polling budget for the device flow, matching the official CLI.
const POLL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15 * 60);

#[derive(Debug, Clone, Deserialize)]
pub struct OAuthCredentials {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    #[allow(dead_code)]
    pub scope: Option<String>,
    #[allow(dead_code)]
    pub token_type: Option<String>,
    #[allow(dead_code)]
    pub expires_in: Option<i64>,
}

impl OAuthCredentials {
    /// True when the token is expired or expires within the leeway window.
    /// Missing `expires_at` is treated as valid (fail open to the API call,
    /// which returns a definitive 401 if the token is bad).
    pub fn is_expired(&self) -> bool {
        let Some(expires_at) = self.expires_at else {
            return false;
        };
        let now = chrono::Utc::now().timestamp();
        now >= expires_at - EXPIRY_LEEWAY_SECS
    }
}

/// Load OAuth session from the credentials file for a storage name. Errors are
/// deterministic (missing file / unreadable JSON), never transient — the caller
/// turns them into `Ok(success:false)`.
fn load_credentials_for_storage(storage_name: &str) -> Result<OAuthCredentials, String> {
    let path = credentials_path_for_storage(storage_name);
    let content = std::fs::read_to_string(&path).map_err(|e| {
        format!(
            "Kimi Code OAuth credentials not found at {}: {e}. Run `kimi login` first.",
            path.display()
        )
    })?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse Kimi Code OAuth credentials: {e}"))
}

/// Load the legacy mainland Kimi Code OAuth session (`kimi-code.json`).
pub fn load_kimi_code_credentials() -> Result<OAuthCredentials, String> {
    load_credentials_for_storage("kimi-code")
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
    token_type: Option<String>,
}

/// Process-wide single-flight lock for token refresh. Refresh tokens rotate
/// on use, so two concurrent refreshes would invalidate one of them.
fn refresh_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Return a usable access token, refreshing via the refresh_token grant when
/// the stored one is expired. The credential file and refresh endpoint are
/// resolved from the provider's oauth ref + base_url (see [`OAuthContext`]);
/// with no ref this is the legacy mainland default. Errors are deterministic
/// (missing/dead session) — the caller surfaces them as `Ok(success:false)`.
pub async fn get_valid_access_token(
    oauth_ref: Option<&OAuthRef>,
    base_url: &str,
) -> Result<String, String> {
    let ctx = OAuthContext::from(oauth_ref, base_url);
    let creds = load_credentials_for_storage(&ctx.storage_name)?;
    if !creds.is_expired() {
        return Ok(creds.access_token);
    }

    let _guard = refresh_lock().lock().await;
    // Re-read under the lock: the CLI or a previous waiter may have refreshed
    // while we were waiting.
    let creds = load_credentials_for_storage(&ctx.storage_name)?;
    if !creds.is_expired() {
        return Ok(creds.access_token);
    }
    refresh_credentials(&creds, &ctx).await
}

/// Merge a token endpoint response into the existing credentials JSON,
/// preserving unrelated fields. Pure function for testability.
fn merge_token_response(current_json: &str, resp: &TokenResponse) -> String {
    let mut merged: serde_json::Value =
        serde_json::from_str(current_json).unwrap_or_else(|_| serde_json::json!({}));
    let obj = match merged.as_object_mut() {
        Some(o) => o,
        None => return current_json.to_string(),
    };
    obj.insert(
        "access_token".to_string(),
        serde_json::Value::String(resp.access_token.clone()),
    );
    if let Some(rt) = &resp.refresh_token {
        obj.insert(
            "refresh_token".to_string(),
            serde_json::Value::String(rt.clone()),
        );
    }
    if let Some(expires_in) = resp.expires_in {
        obj.insert(
            "expires_in".to_string(),
            serde_json::Value::Number(expires_in.into()),
        );
        obj.insert(
            "expires_at".to_string(),
            serde_json::Value::Number((chrono::Utc::now().timestamp() + expires_in).into()),
        );
    }
    if let Some(scope) = &resp.scope {
        obj.insert(
            "scope".to_string(),
            serde_json::Value::String(scope.clone()),
        );
    }
    if let Some(token_type) = &resp.token_type {
        obj.insert(
            "token_type".to_string(),
            serde_json::Value::String(token_type.clone()),
        );
    }
    serde_json::to_string_pretty(&merged).unwrap_or_else(|_| current_json.to_string())
}

/// Call the token endpoint with the refresh_token grant and persist the
/// rotated tokens. The refresh endpoint + file come from the resolved context.
/// Caller must hold [`refresh_lock`].
async fn refresh_credentials(creds: &OAuthCredentials, ctx: &OAuthContext) -> Result<String, String> {
    let refresh_token = creds
        .refresh_token
        .clone()
        .filter(|t| !t.is_empty())
        .ok_or_else(|| {
            "Kimi Code session has no refresh token; run `kimi login`".to_string()
        })?;

    let client = reqwest::Client::builder()
        .timeout(REFRESH_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    // Tokens only ever go into the request body — never into logs or errors.
    let resp = client
        .post(ctx.token_endpoint())
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", CLIENT_ID),
            ("refresh_token", refresh_token.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        // OAuth error bodies are tiny ({"error":"invalid_grant", ...}); keep
        // the first 200 chars for diagnosability. They never contain tokens.
        let body = resp.text().await.unwrap_or_default();
        let body: String = body.chars().take(200).collect();
        return Err(format!(
            "Kimi Code login expired and refresh failed (HTTP {status}): {body}. Run `kimi login` to sign in again"
        ));
    }

    let token: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse token refresh response: {e}"))?;

    // Re-read right before writing: if the CLI refreshed meanwhile, its newer
    // (rotated) tokens win — overwriting them would kill its next refresh.
    let path = credentials_path_for_storage(&ctx.storage_name);
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    if let Ok(latest) = serde_json::from_str::<OAuthCredentials>(&current) {
        if !latest.is_expired() && latest.access_token != creds.access_token {
            return Ok(latest.access_token);
        }
    }

    let merged = merge_token_response(&current, &token);
    if let Err(e) = std::fs::write(&path, merged) {
        // Non-fatal: the new access token is still usable for this query; the
        // next one will just refresh again.
        eprintln!("[oauth] failed to write refreshed credentials: {e}");
    }
    Ok(token.access_token)
}

// ---------------------------------------------------------------------------
// Device Code Flow (RFC 8628) — in-app sign-in, mirrors the official CLI
// ---------------------------------------------------------------------------

/// Response of POST /api/oauth/device_authorization.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DeviceAuthorization {
    pub user_code: String,
    pub device_code: String,
    pub verification_uri: Option<String>,
    pub verification_uri_complete: Option<String>,
    pub expires_in: Option<i64>,
    pub interval: Option<i64>,
}

/// Poll outcome, serialized back to the frontend so it can drive the dialog.
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum DevicePollStatus {
    /// Keep polling with the returned interval (seconds).
    Pending { interval: i64 },
    /// Server asked to slow down; keep polling with interval + 5.
    SlowDown { interval: i64 },
    /// Tokens obtained and written to the credentials file.
    Success,
    /// Device code expired; the user must start over.
    Expired,
    /// User denied the authorization.
    AccessDenied,
    /// Polling budget exhausted.
    Timeout,
}

/// `~/.kimi-code/device_id` — reused by the CLI so the app looks like the
/// same device. Created on first use.
fn device_id_path() -> std::path::PathBuf {
    kimi_code_config_dir().join("device_id")
}

fn load_or_create_device_id() -> Option<String> {
    let path = device_id_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        let id = content.trim().to_string();
        if !id.is_empty() {
            return Some(id);
        }
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let id = format!("kimi-switch-{nanos:x}-{}", std::process::id());
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // Best-effort write; a missing file just means the header is omitted.
    let _ = std::fs::write(&path, &id);
    Some(id)
}

/// Device identity headers matching the official CLI (`X-Msh-*`).
fn identity_headers() -> Vec<(&'static str, String)> {
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "kimi-switch".to_string());
    let os_version = std::env::var("OS").unwrap_or_else(|_| std::env::consts::OS.to_string());
    let mut headers = vec![
        ("X-Msh-Platform", "kimi_code_cli".to_string()),
        ("X-Msh-Version", env!("CARGO_PKG_VERSION").to_string()),
        ("X-Msh-Device-Name", hostname.clone()),
        (
            "X-Msh-Device-Model",
            format!("{} {}", std::env::consts::OS, hostname),
        ),
        ("X-Msh-Os-Version", os_version),
    ];
    if let Some(device_id) = load_or_create_device_id() {
        headers.push(("X-Msh-Device-Id", device_id));
    }
    headers
}

/// Step 1 of the device flow: ask the region's server for a user_code +
/// device_code. No user interaction required here; the frontend shows the
/// code + URL.
pub async fn start_device_authorization(region: KimiRegion) -> Result<DeviceAuthorization, String> {
    let client = reqwest::Client::builder()
        .timeout(REFRESH_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let endpoint = format!(
        "{}{DEVICE_AUTHORIZATION_PATH}",
        region.oauth_host().trim_end_matches('/')
    );
    let mut req = client.post(&endpoint).form(&[("client_id", CLIENT_ID)]);
    for (name, value) in identity_headers() {
        req = req.header(name, value);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Device authorization request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let body: String = body.chars().take(200).collect();
        return Err(format!("Device authorization failed (HTTP {status}): {body}"));
    }
    resp.json::<DeviceAuthorization>()
        .await
        .map_err(|e| format!("Failed to parse device authorization response: {e}"))
}

/// Step 2 of the device flow: poll the region's token endpoint until the user
/// approves (or the flow fails). On success the tokens are merged into the
/// region's credentials file and the provider is provisioned, making
/// `kimi login` unnecessary.
pub async fn poll_device_token(
    device_code: &str,
    initial_interval: i64,
    region: KimiRegion,
) -> Result<DevicePollStatus, String> {
    let client = reqwest::Client::builder()
        .timeout(REFRESH_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let token_endpoint = format!(
        "{}{TOKEN_PATH}",
        region.oauth_host().trim_end_matches('/')
    );
    let deadline = std::time::Instant::now() + POLL_TIMEOUT;
    let mut interval = initial_interval.max(1);

    loop {
        let mut req = client
            .post(&token_endpoint)
            .form(&[
                ("grant_type", DEVICE_GRANT_TYPE),
                ("client_id", CLIENT_ID),
                ("device_code", device_code),
            ]);
        for (name, value) in identity_headers() {
            req = req.header(name, value);
        }

        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => return Err(format!("Token polling request failed: {e}")),
        };

        if resp.status().is_success() {
            let token: TokenResponse = match resp.json().await {
                Ok(t) => t,
                Err(e) => return Err(format!("Failed to parse token response: {e}")),
            };
            persist_device_token(&token, region)?;
            return Ok(DevicePollStatus::Success);
        }

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let error: Option<String> = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from));
        match error.as_deref() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval += 5,
            Some("expired_token") => return Ok(DevicePollStatus::Expired),
            Some("access_denied") => return Ok(DevicePollStatus::AccessDenied),
            Some(other) => {
                let body: String = body.chars().take(200).collect();
                return Err(format!("Token polling error ({other}): {body}"));
            }
            None => {
                let body: String = body.chars().take(200).collect();
                return Err(format!("Token polling failed (HTTP {status}): {body}"));
            }
        }

        if std::time::Instant::now() + std::time::Duration::from_secs(interval as u64) >= deadline {
            return Ok(DevicePollStatus::Timeout);
        }
        tokio::time::sleep(std::time::Duration::from_secs(interval as u64)).await;
    }
}

/// Write a freshly obtained token set into the region's credentials file,
/// preserving unrelated fields and using the same snake_case shape, then
/// provision the managed provider in config.toml (mirroring the CLI).
///
/// cn writes the shared `credentials/kimi-code.json`; global resolves the
/// scoped key from (oauthHost, baseUrl) and writes `credentials/<scoped>.json`.
fn persist_device_token(token: &TokenResponse, region: KimiRegion) -> Result<(), String> {
    let key = derive_scoped_key(region.oauth_host(), region.base_url());
    let storage_name = resolve_storage_name(&key)?;
    let path = credentials_path_for_storage(&storage_name);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    let merged = merge_token_response(&current, token);
    std::fs::write(&path, merged)
        .map_err(|e| format!("Failed to write Kimi credentials: {e}"))?;
    provision_managed_provider(region, &key)
}

/// Update `[providers."managed:kimi-code"]` in config.toml so the official CLI
/// can use the freshly obtained credentials (mirror the CLI's post-login
/// provisioning / `authService.provisionProvider`): ensure the provider exists,
/// `type="kimi"`, `base_url=<region baseUrl>`, `api_key=""`, and the oauth ref
/// block `{storage="file", key=<region key>}` — `oauthHost` is persisted only
/// for global (cn writes none, so `key == "oauth/kimi-code"` stays the
/// explicit-mainland signal). Other fields (icon, ...) are left untouched; the
/// round-trip preserves every unrelated section.
fn provision_managed_provider(region: KimiRegion, oauth_key: &str) -> Result<(), String> {
    use indexmap::IndexMap;

    let mut config = crate::kimi_code_io::load_kimi_code_config_as_config()
        .map_err(|e| format!("Failed to read Kimi Code config: {e}"))?;

    let provider = config
        .providers
        .entry(MANAGED_PROVIDER_NAME.to_string())
        .or_insert_with(|| crate::models::Provider {
            name: MANAGED_PROVIDER_NAME.to_string(),
            provider_type: crate::models::ProviderType::Kimi,
            base_url: None,
            api_key: None,
            env: IndexMap::new(),
            note: None,
            official_url: None,
            managed: true,
            enabled: true,
            active: false,
            icon: None,
            icon_color: None,
            raw_other: serde_json::Value::Object(serde_json::Map::new()),
            usage_kinds: None,
            usage_config: None,
        });

    provider.provider_type = crate::models::ProviderType::Kimi;
    provider.base_url = Some(region.base_url().to_string());
    provider.api_key = Some(String::new());
    provider.managed = true;

    let mut oauth = serde_json::Map::new();
    oauth.insert(
        "storage".to_string(),
        serde_json::Value::String("file".to_string()),
    );
    oauth.insert(
        "key".to_string(),
        serde_json::Value::String(oauth_key.to_string()),
    );
    if region == KimiRegion::Global {
        oauth.insert(
            "oauthHost".to_string(),
            serde_json::Value::String(region.oauth_host().to_string()),
        );
    }
    if let Some(obj) = provider.raw_other.as_object_mut() {
        obj.insert("oauth".to_string(), serde_json::Value::Object(oauth));
    } else {
        provider.raw_other = serde_json::json!({ "oauth": oauth });
    }

    crate::kimi_code_io::save_config_as_kimi_code(&config)
        .map_err(|e| format!("Failed to write Kimi Code config: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expired_token_detected_with_leeway() {
        let past = chrono::Utc::now().timestamp() - 60;
        let creds = OAuthCredentials {
            access_token: "t".to_string(),
            refresh_token: None,
            expires_at: Some(past),
            scope: None,
            token_type: None,
            expires_in: None,
        };
        assert!(creds.is_expired());
    }

    #[test]
    fn valid_token_not_expired() {
        let future = chrono::Utc::now().timestamp() + 3600;
        let creds = OAuthCredentials {
            access_token: "t".to_string(),
            refresh_token: None,
            expires_at: Some(future),
            scope: None,
            token_type: None,
            expires_in: None,
        };
        assert!(!creds.is_expired());
    }

    #[test]
    fn missing_expires_at_fails_open() {
        let creds = OAuthCredentials {
            access_token: "t".to_string(),
            refresh_token: None,
            expires_at: None,
            scope: None,
            token_type: None,
            expires_in: None,
        };
        assert!(!creds.is_expired());
    }

    #[test]
    fn credentials_file_shape_parses() {
        let json = serde_json::json!({
            "access_token": "eyJhbGciOiJFUzI1NiIs...",
            "refresh_token": "eyJhbGciOiJFUzI1NiIs...",
            "expires_at": 1785510484i64,
            "scope": "kimi-code",
            "token_type": "Bearer",
            "expires_in": 900
        });
        let creds: OAuthCredentials = serde_json::from_value(json).unwrap();
        assert_eq!(creds.access_token, "eyJhbGciOiJFUzI1NiIs...");
        assert_eq!(creds.expires_at, Some(1785510484));
    }

    #[test]
    fn merge_preserves_unrelated_fields_and_rotates() {
        let current = r#"{
            "access_token": "old-access",
            "refresh_token": "old-refresh",
            "expires_at": 1,
            "scope": "kimi-code",
            "token_type": "Bearer",
            "expires_in": 900,
            "custom_field": "keep-me"
        }"#;
        let resp = TokenResponse {
            access_token: "new-access".to_string(),
            refresh_token: Some("new-refresh".to_string()),
            expires_in: Some(900),
            scope: None,
            token_type: None,
        };
        let merged = merge_token_response(current, &resp);
        let v: serde_json::Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(v["access_token"], "new-access");
        assert_eq!(v["refresh_token"], "new-refresh");
        assert_eq!(v["custom_field"], "keep-me");
        assert_eq!(v["scope"], "kimi-code"); // resp.scope None → 原值保留
        let now = chrono::Utc::now().timestamp();
        let expires_at = v["expires_at"].as_i64().unwrap();
        assert!(expires_at > now + 800 && expires_at <= now + 900);
    }

    #[test]
    fn merge_without_rotated_refresh_keeps_old_refresh_token() {
        let current = r#"{"access_token": "old", "refresh_token": "old-refresh", "expires_at": 1}"#;
        let resp = TokenResponse {
            access_token: "new-access".to_string(),
            refresh_token: None,
            expires_in: Some(900),
            scope: None,
            token_type: None,
        };
        let merged = merge_token_response(current, &resp);
        let v: serde_json::Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(v["refresh_token"], "old-refresh");
    }

    #[test]
    fn device_authorization_serializes_snake_case() {
        let auth = DeviceAuthorization {
            user_code: "ABC-DEF".to_string(),
            device_code: "dev-1".to_string(),
            verification_uri: Some("https://auth.kimi.com/device".to_string()),
            verification_uri_complete: None,
            expires_in: Some(1800),
            interval: Some(5),
        };
        let v = serde_json::to_value(&auth).unwrap();
        assert_eq!(v["user_code"], "ABC-DEF");
        assert_eq!(v["device_code"], "dev-1");
        assert_eq!(v["verification_uri_complete"], serde_json::Value::Null);
        assert_eq!(v["interval"], 5);
        assert!(v.get("userCode").is_none(), "must be snake_case for the frontend");
    }

    #[test]
    fn device_poll_status_serializes_snake_case() {
        // Internally tagged: {"status":"pending","interval":5} — easy for the
        // frontend to switch on.
        let pending = serde_json::to_value(DevicePollStatus::Pending { interval: 5 }).unwrap();
        assert_eq!(pending["status"], "pending");
        assert_eq!(pending["interval"], 5);
        let success = serde_json::to_value(DevicePollStatus::Success).unwrap();
        assert_eq!(success["status"], "success");
    }

    // ── region / credential-key resolution ────────────────────────────────

    #[test]
    fn resolve_storage_name_maps_all_branches() {
        // Default slot.
        assert_eq!(resolve_storage_name("kimi-code").unwrap(), "kimi-code");
        assert_eq!(resolve_storage_name("oauth/kimi-code").unwrap(), "kimi-code");
        // oauth/<name> strips the prefix.
        assert_eq!(resolve_storage_name("oauth/foo").unwrap(), "foo");
        // Bare name without '/' is kept verbatim.
        assert_eq!(resolve_storage_name("custom").unwrap(), "custom");
        // Invalid keys → Err.
        assert!(resolve_storage_name("oauth/").is_err(), "empty suffix");
        assert!(resolve_storage_name(".hidden").is_err(), "dot-prefixed");
        assert!(resolve_storage_name("a/b").is_err(), "contains slash");
    }

    #[test]
    fn derive_scoped_key_returns_default_for_mainland() {
        assert_eq!(
            derive_scoped_key("https://auth.kimi.com", "https://api.kimi.com/coding/v1"),
            "oauth/kimi-code"
        );
        // Trailing slashes / whitespace normalize to the defaults.
        assert_eq!(
            derive_scoped_key(" https://auth.kimi.com/ ", "https://api.kimi.com/coding/v1/"),
            "oauth/kimi-code"
        );
    }

    #[test]
    fn derive_scoped_key_scopes_by_endpoint_pair() {
        let key = derive_scoped_key("https://auth.kimi.ai", "https://api.kimi.ai/coding/v1");
        assert!(key.starts_with("oauth/kimi-code-env-"), "key: {key}");
        let hex = &key["oauth/kimi-code-env-".len()..];
        assert_eq!(hex.len(), 16, "key: {key}");
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit()), "key: {key}");
        // Byte-exact vs JS JSON.stringify({oauthHost, baseUrl}) — precomputed,
        // guards against serde field order / whitespace drift.
        assert_eq!(key, "oauth/kimi-code-env-0e4f99c69cc27850");
    }

    #[test]
    fn oauth_context_defaults_without_ref() {
        let ctx = OAuthContext::from(None, "https://api.kimi.com/coding/v1");
        assert_eq!(ctx.storage_name, "kimi-code");
        assert_eq!(ctx.oauth_host, "https://auth.kimi.com");
        assert_eq!(ctx.token_endpoint(), "https://auth.kimi.com/api/oauth/token");
    }

    #[test]
    fn oauth_context_defaults_without_ref_even_for_custom_base() {
        // Zero-regression: a ref-less provider must keep using the legacy
        // mainland slot regardless of its base_url (derive only kicks in when
        // an oauth ref carries an oauthHost).
        let ctx = OAuthContext::from(None, "https://proxy.example.com/coding/v1");
        assert_eq!(ctx.storage_name, "kimi-code");
        assert_eq!(ctx.oauth_host, "https://auth.kimi.com");
    }

    #[test]
    fn oauth_context_derives_scoped_key_when_ref_has_only_oauth_host() {
        let r = OAuthRef {
            key: None,
            oauth_host: Some("https://auth.kimi.ai".to_string()),
        };
        let ctx = OAuthContext::from(Some(&r), "https://api.kimi.ai/coding/v1");
        assert_eq!(ctx.storage_name, "kimi-code-env-0e4f99c69cc27850");
        assert_eq!(ctx.oauth_host, "https://auth.kimi.ai");
    }

    #[test]
    fn oauth_context_follows_ref_key_and_host() {
        let r = OAuthRef {
            key: Some("oauth/kimi-code-env-0e4f99c69cc27850".to_string()),
            oauth_host: Some("https://auth.kimi.ai".to_string()),
        };
        let ctx = OAuthContext::from(Some(&r), "https://api.kimi.ai/coding/v1");
        assert_eq!(ctx.storage_name, "kimi-code-env-0e4f99c69cc27850");
        assert_eq!(ctx.oauth_host, "https://auth.kimi.ai");
        assert_eq!(ctx.token_endpoint(), "https://auth.kimi.ai/api/oauth/token");
    }

    // ── login persistence + provisioning (via KIMI_CODE_HOME temp dir) ─────

    /// Run `f` with `KIMI_CODE_HOME` pointed at a fresh temp dir (the config
    /// dir). A process-wide mutex serializes env mutation so parallel tests in
    /// this binary can't observe a stale override.
    fn with_kimi_code_home<T>(f: impl FnOnce(&std::path::Path) -> T) -> T {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        let _guard = LOCK.get_or_init(|| std::sync::Mutex::new(())).lock().unwrap();
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("KIMI_CODE_HOME", home.path());
        let out = f(home.path());
        std::env::remove_var("KIMI_CODE_HOME");
        out
    }

    #[test]
    fn persist_cn_login_writes_default_slot_and_provisions_without_oauth_host() {
        with_kimi_code_home(|dir| {
            // Pre-existing config with an unrelated section must survive.
            std::fs::write(dir.join("config.toml"), "[thinking]\nenabled = true\n").unwrap();

            let token = TokenResponse {
                access_token: "cn-access".to_string(),
                refresh_token: Some("cn-refresh".to_string()),
                expires_in: Some(900),
                scope: Some("kimi-code".to_string()),
                token_type: None,
            };
            persist_device_token(&token, KimiRegion::Cn).unwrap();

            // Credentials land in the shared default slot.
            let cred =
                std::fs::read_to_string(dir.join("credentials/kimi-code.json")).unwrap();
            assert!(cred.contains("cn-access"), "cred: {cred}");

            // Provider provisioned with the cn base_url and NO oauthHost.
            let cfg_toml = std::fs::read_to_string(dir.join("config.toml")).unwrap();
            let cfg: toml::Value = cfg_toml.parse().unwrap();
            let provider = &cfg["providers"]["managed:kimi-code"];
            assert_eq!(provider["type"].as_str(), Some("kimi"));
            assert_eq!(
                provider["base_url"].as_str(),
                Some("https://api.kimi.com/coding/v1")
            );
            assert_eq!(provider["api_key"].as_str(), Some(""));
            let oauth = &provider["oauth"];
            assert_eq!(oauth["storage"].as_str(), Some("file"));
            assert_eq!(oauth["key"].as_str(), Some("oauth/kimi-code"));
            assert!(
                oauth.get("oauthHost").is_none(),
                "cn must not persist oauthHost"
            );
            // Unrelated section preserved by the round-trip.
            assert_eq!(cfg["thinking"]["enabled"].as_bool(), Some(true));
        });
    }

    #[test]
    fn persist_global_login_writes_scoped_slot_and_provisions_oauth_host() {
        with_kimi_code_home(|dir| {
            std::fs::write(dir.join("config.toml"), "").unwrap();

            let token = TokenResponse {
                access_token: "global-access".to_string(),
                refresh_token: Some("global-refresh".to_string()),
                expires_in: Some(900),
                scope: Some("kimi-code".to_string()),
                token_type: None,
            };
            persist_device_token(&token, KimiRegion::Global).unwrap();

            let key = derive_scoped_key("https://auth.kimi.ai", "https://api.kimi.ai/coding/v1");
            assert_eq!(key, "oauth/kimi-code-env-0e4f99c69cc27850");
            let storage = resolve_storage_name(&key).unwrap();
            let cred =
                std::fs::read_to_string(dir.join(format!("credentials/{storage}.json"))).unwrap();
            assert!(cred.contains("global-access"), "cred: {cred}");

            let cfg_toml = std::fs::read_to_string(dir.join("config.toml")).unwrap();
            let cfg: toml::Value = cfg_toml.parse().unwrap();
            let provider = &cfg["providers"]["managed:kimi-code"];
            assert_eq!(
                provider["base_url"].as_str(),
                Some("https://api.kimi.ai/coding/v1")
            );
            let oauth = &provider["oauth"];
            assert_eq!(oauth["key"].as_str(), Some(key.as_str()));
            assert_eq!(oauth["oauthHost"].as_str(), Some("https://auth.kimi.ai"));
        });
    }
}
