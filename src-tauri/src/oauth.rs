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
//!    `~/.kimi-code/credentials/kimi-code.json` file the CLI uses.

use serde::{Deserialize, Serialize};

use crate::kimi_code_io::kimi_code_config_dir;

/// Seconds of leeway when checking expiry, so a token that is about to die
/// mid-request counts as expired.
const EXPIRY_LEEWAY_SECS: i64 = 30;

/// OAuth token endpoint (confirmed in the official kimi.exe binary).
const TOKEN_ENDPOINT: &str = "https://auth.kimi.com/api/oauth/token";
/// Device authorization endpoint (RFC 8628).
const DEVICE_AUTHORIZATION_ENDPOINT: &str = "https://auth.kimi.com/api/oauth/device_authorization";
/// Public OAuth client id used by the official CLI (from kimi.exe).
const CLIENT_ID: &str = "17e5f671-d194-4dfb-9706-5516cb48c098";
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

fn credentials_path() -> std::path::PathBuf {
    kimi_code_config_dir()
        .join("credentials")
        .join("kimi-code.json")
}

/// Load the Kimi Code OAuth session. Errors are deterministic (missing file /
/// unreadable JSON), never transient — the caller turns them into
/// `Ok(success:false)`.
pub fn load_kimi_code_credentials() -> Result<OAuthCredentials, String> {
    let path = credentials_path();
    let content = std::fs::read_to_string(&path).map_err(|e| {
        format!(
            "Kimi Code OAuth credentials not found at {}: {e}. Run `kimi login` first.",
            path.display()
        )
    })?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse Kimi Code OAuth credentials: {e}"))
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
/// the stored one is expired. Errors are deterministic (missing/dead session)
/// — the caller surfaces them as `Ok(success:false)`.
pub async fn get_valid_access_token() -> Result<String, String> {
    let creds = load_kimi_code_credentials()?;
    if !creds.is_expired() {
        return Ok(creds.access_token);
    }

    let _guard = refresh_lock().lock().await;
    // Re-read under the lock: the CLI or a previous waiter may have refreshed
    // while we were waiting.
    let creds = load_kimi_code_credentials()?;
    if !creds.is_expired() {
        return Ok(creds.access_token);
    }
    refresh_credentials(&creds).await
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
/// rotated tokens. Caller must hold [`refresh_lock`].
async fn refresh_credentials(creds: &OAuthCredentials) -> Result<String, String> {
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
        .post(TOKEN_ENDPOINT)
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
    let path = credentials_path();
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

/// Step 1 of the device flow: ask the server for a user_code + device_code.
/// No user interaction required here; the frontend shows the code + URL.
pub async fn start_device_authorization() -> Result<DeviceAuthorization, String> {
    let client = reqwest::Client::builder()
        .timeout(REFRESH_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let mut req = client
        .post(DEVICE_AUTHORIZATION_ENDPOINT)
        .form(&[("client_id", CLIENT_ID)]);
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

/// Step 2 of the device flow: poll the token endpoint until the user
/// approves (or the flow fails). On success the tokens are merged into the
/// CLI credentials file, making `kimi login` unnecessary.
pub async fn poll_device_token(
    device_code: &str,
    initial_interval: i64,
) -> Result<DevicePollStatus, String> {
    let client = reqwest::Client::builder()
        .timeout(REFRESH_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let deadline = std::time::Instant::now() + POLL_TIMEOUT;
    let mut interval = initial_interval.max(1);

    loop {
        let mut req = client
            .post(TOKEN_ENDPOINT)
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
            persist_device_token(&token)?;
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

/// Write a freshly obtained token set into the CLI credentials file,
/// preserving unrelated fields and using the same snake_case shape.
fn persist_device_token(token: &TokenResponse) -> Result<(), String> {
    let path = credentials_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    let merged = merge_token_response(&current, token);
    std::fs::write(&path, merged)
        .map_err(|e| format!("Failed to write Kimi credentials: {e}"))
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
}
