//! 供应商推理端点探活（「一键体检」的第二步）。
//!
//! GET `{base_url}/v1/models`，带 `Authorization: Bearer <api_key>`。
//! 2xx 且响应体是合法 JSON 即算通过（不校验内容结构，只验证端点能应答）；
//! 其余状态码 / 网络错误归类成确定性错误文案。
//!
//! 错误文案与 balance.rs 一致用英文短句，前端 localizeHealthError 负责
//! 双语展示（见 src/hooks/useHealthCheck.ts）。

use std::time::Duration;

/// 探活请求超时。体检要快速出结果、不卡住 UI，比账单查询的 8s 更短。
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// 由 base_url 拼出 `/v1/models` 探测地址。
///
/// 供应商配置里的 base_url 多数已经带 `/v1` 后缀（如
/// `https://api.kimi.com/coding/v1`），直接再拼 `/v1/models` 会得到
/// `/v1/v1/models`，所以先剥掉重复后缀；结尾斜杠与首尾空白一并归一。
/// 空/纯空白返回 None（调用方直接判失败，不发请求）。纯函数，便于单测。
fn models_url(base_url: &str) -> Option<String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return None;
    }
    let root = base.strip_suffix("/v1").unwrap_or(base);
    Some(format!("{root}/v1/models"))
}

/// 探活前置校验：返回最终请求 URL。base_url 缺失、api_key 为空都是确定性
/// 配置错误，不发请求即失败（没有 key 时必然 401，直接给出更可操作的结论）。
fn validate_probe_input(base_url: &str, api_key: &str) -> Result<String, String> {
    let Some(url) = models_url(base_url) else {
        return Err("missing base_url".to_string());
    };
    if api_key.trim().is_empty() {
        return Err("no API key configured".to_string());
    }
    Ok(url)
}

/// 探活一个供应商的推理端点。`Ok(())` = 端点正常应答且返回合法 JSON。
pub async fn probe_provider(
    base_url: &str,
    api_key: &str,
    timeout: Duration,
) -> Result<(), String> {
    let url = validate_probe_input(base_url, api_key)?;

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    // 注意：api_key 只允许进请求头，严禁拼进 URL / 日志 / 错误信息。
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "request timed out".to_string()
            } else if e.is_connect() {
                "connection failed (DNS or refused)".to_string()
            } else {
                format!("network error: {e}")
            }
        })?;

    let status = resp.status();
    if status.is_success() {
        // 先取完整响应体再解析：读体超时/中断是瞬时错误，与「返回的不是
        // JSON」区分开（reqwest 的 .json() 会把两者都包成 decode）。
        let raw = resp
            .bytes()
            .await
            .map_err(|e| format!("failed to read response: {e}"))?;
        return match serde_json::from_slice::<serde_json::Value>(&raw) {
            Ok(_) => Ok(()),
            Err(_) => Err("response is not valid JSON".to_string()),
        };
    }

    match status.as_u16() {
        401 | 403 => Err(format!("Authentication failed (HTTP {status})")),
        404 => Err(format!("endpoint not found (HTTP {status})")),
        code => Err(format!("API error (HTTP {code})")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_url_dedupes_v1_suffix() {
        assert_eq!(
            models_url("https://api.kimi.com/coding/v1").as_deref(),
            Some("https://api.kimi.com/coding/v1/models")
        );
        // 不带 /v1 的裸域补上 /v1
        assert_eq!(
            models_url("https://api.deepseek.com").as_deref(),
            Some("https://api.deepseek.com/v1/models")
        );
    }

    #[test]
    fn models_url_normalizes_slashes_and_whitespace() {
        // 结尾斜杠（含多个）与首尾空白都要归一，且不得拼出 /v1/v1
        assert_eq!(
            models_url("https://api.kimi.com/coding/v1/").as_deref(),
            Some("https://api.kimi.com/coding/v1/models")
        );
        assert_eq!(
            models_url("  https://api.deepseek.com/v1///  ").as_deref(),
            Some("https://api.deepseek.com/v1/models")
        );
        assert_eq!(
            models_url("https://api.deepseek.com/").as_deref(),
            Some("https://api.deepseek.com/v1/models")
        );
        // 非 /v1 的路径后缀原样保留（只有 /v1 需要去重）
        assert_eq!(
            models_url("https://api.novita.ai/v3").as_deref(),
            Some("https://api.novita.ai/v3/v1/models")
        );
    }

    #[test]
    fn models_url_rejects_empty_base() {
        assert_eq!(models_url(""), None);
        assert_eq!(models_url("   "), None);
        assert_eq!(models_url("/"), None);
    }

    #[test]
    fn probe_input_validation_rejects_empty_base_and_missing_key() {
        // 两者都是确定性配置错误，不发请求即返回。
        assert_eq!(
            validate_probe_input("  ", "sk-x").unwrap_err(),
            "missing base_url"
        );
        assert_eq!(
            validate_probe_input("https://example.com", "   ").unwrap_err(),
            "no API key configured"
        );
        assert_eq!(
            validate_probe_input("https://example.com/v1", "sk-x").unwrap(),
            "https://example.com/v1/models"
        );
    }
}
