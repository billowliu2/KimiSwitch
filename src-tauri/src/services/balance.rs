// Adapted from cc-switch (MIT, © Jason Young)
// https://github.com/farion1231/cc-switch

//! 供应商余额查询服务
//!
//! 支持 DeepSeek、StepFun、SiliconFlow、OpenRouter、Novita AI 的账户余额查询。
//!
//! 错误通道语义（与 cc-switch 一致）：
//! - `Err(String)` = 瞬时传输失败（网络不可达/超时/读体中断）。前端 invoke reject，
//!   触发 retry 并保留上一次成功的 data（keep-last-good）。
//! - `Ok(success:false)` = 确定性失败（空 key/鉴权失败/非 2xx/响应体非法 JSON），
//!   直接透出错误文案。
//!
//! HTTP 调用与 JSON→UsageData 解析拆成纯函数，便于无 mock 单元测试。

use super::usage_types::{UsageData, UsageResult};
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

/// 鉴权头形式：绝大多数供应商用 `Bearer <key>`；智谱套餐接口不加前缀（见 coding_plan）。
pub(crate) enum AuthStyle {
    Bearer,
    Raw,
}

/// GET 请求的归类结果。
pub(crate) enum Fetched {
    /// 2xx 且响应体是合法 JSON。
    Body(serde_json::Value),
    /// 确定性失败（401/403/非 2xx/解析失败），调用方原样包成 Ok 返回。
    Failed(UsageResult),
}

/// 统一的 GET + JSON 读取助手。瞬时失败（网络/超时/读体中断）返回 `Err`；
/// 确定性失败收进 `Fetched::Failed`。
///
/// 先 `bytes()` 再解析：读体失败（超时/连接中断）是瞬时 → Err；拿到完整响应体
/// 后解析失败才是确定性。reqwest 的 `.json()` 把读体错误也包成 decode，无法区分。
pub(crate) async fn get_json(
    url: &str,
    api_key: &str,
    auth: AuthStyle,
) -> Result<Fetched, String> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    // 注意：api_key 只允许进请求头，严禁拼进 URL / 日志 / 错误信息。
    let req = client.get(url).header("Accept", "application/json");
    let req = match auth {
        AuthStyle::Bearer => req.header("Authorization", format!("Bearer {api_key}")),
        AuthStyle::Raw => req.header("Authorization", api_key),
    };

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => return Err(format!("Network error: {e}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Ok(Fetched::Failed(UsageResult::failure(format!(
            "Authentication failed (HTTP {status})"
        ))));
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Ok(Fetched::Failed(UsageResult::failure(format!(
            "API error (HTTP {status}): {body}"
        ))));
    }

    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => return Err(format!("Failed to read response: {e}")),
    };
    match serde_json::from_slice(&raw) {
        Ok(v) => Ok(Fetched::Body(v)),
        Err(e) => Ok(Fetched::Failed(UsageResult::failure(format!(
            "Failed to parse response: {e}"
        )))),
    }
}

/// 解析 JSON 字段为 f64，兼容数字和字符串格式。
pub(crate) fn parse_f64_field(obj: &serde_json::Value, field: &str) -> Option<f64> {
    obj.get(field).and_then(|v| {
        v.as_f64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    })
}

// ── DeepSeek ────────────────────────────────────────────────
// GET https://api.deepseek.com/user/balance
// Response: { balance_infos: [{ currency, total_balance, ... }], is_available }

pub async fn query_deepseek(api_key: &str) -> Result<UsageResult, String> {
    match get_json("https://api.deepseek.com/user/balance", api_key, AuthStyle::Bearer).await? {
        Fetched::Body(body) => Ok(UsageResult::ok(parse_deepseek(&body))),
        Fetched::Failed(err) => Ok(err),
    }
}

fn parse_deepseek(body: &serde_json::Value) -> Vec<UsageData> {
    let is_available = body
        .get("is_available")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let mut data = Vec::new();

    if let Some(infos) = body.get("balance_infos").and_then(|v| v.as_array()) {
        for info in infos {
            let currency = info
                .get("currency")
                .and_then(|v| v.as_str())
                .unwrap_or("CNY");
            data.push(UsageData {
                plan_name: Some(currency.to_string()),
                remaining: parse_f64_field(info, "total_balance"),
                is_valid: Some(is_available),
                unit: Some(currency.to_string()),
                ..Default::default()
            });
        }
    }
    data
}

// ── StepFun ─────────────────────────────────────────────────
// GET https://api.stepfun.com/v1/accounts
// Response: { object, type, balance, total_cash_balance, total_voucher_balance }

pub async fn query_stepfun(api_key: &str) -> Result<UsageResult, String> {
    match get_json("https://api.stepfun.com/v1/accounts", api_key, AuthStyle::Bearer).await? {
        Fetched::Body(body) => Ok(UsageResult::ok(parse_stepfun(&body))),
        Fetched::Failed(err) => Ok(err),
    }
}

fn parse_stepfun(body: &serde_json::Value) -> Vec<UsageData> {
    vec![UsageData {
        plan_name: Some("StepFun".to_string()),
        remaining: Some(parse_f64_field(body, "balance").unwrap_or(0.0)),
        unit: Some("CNY".to_string()),
        is_valid: Some(true),
        ..Default::default()
    }]
}

// ── SiliconFlow ─────────────────────────────────────────────
// GET https://api.siliconflow.cn/v1/user/info (.cn；海外站 .com 单位 USD)
// Response: { code, data: { balance, chargeBalance, totalBalance, status } }

pub async fn query_siliconflow(api_key: &str, is_cn: bool) -> Result<UsageResult, String> {
    let domain = if is_cn {
        "api.siliconflow.cn"
    } else {
        "api.siliconflow.com"
    };
    let url = format!("https://{domain}/v1/user/info");
    match get_json(&url, api_key, AuthStyle::Bearer).await? {
        Fetched::Body(body) => Ok(match parse_siliconflow(&body, is_cn) {
            Ok(data) => UsageResult::ok(data),
            Err(err) => err,
        }),
        Fetched::Failed(err) => Ok(err),
    }
}

fn parse_siliconflow(body: &serde_json::Value, is_cn: bool) -> Result<Vec<UsageData>, UsageResult> {
    let data = match body.get("data") {
        Some(d) => d,
        None => {
            return Err(UsageResult::failure(
                "Missing 'data' field in response".to_string(),
            ))
        }
    };
    let (plan_name, unit) = if is_cn {
        ("SiliconFlow", "CNY")
    } else {
        ("SiliconFlow (EN)", "USD")
    };
    Ok(vec![UsageData {
        plan_name: Some(plan_name.to_string()),
        remaining: Some(parse_f64_field(data, "totalBalance").unwrap_or(0.0)),
        unit: Some(unit.to_string()),
        is_valid: Some(true),
        ..Default::default()
    }])
}

// ── OpenRouter ──────────────────────────────────────────────
// GET https://openrouter.ai/api/v1/credits
// Response: { data: { total_credits, total_usage } }

pub async fn query_openrouter(api_key: &str) -> Result<UsageResult, String> {
    match get_json(
        "https://openrouter.ai/api/v1/credits",
        api_key,
        AuthStyle::Bearer,
    )
    .await?
    {
        Fetched::Body(body) => Ok(UsageResult::ok(parse_openrouter(&body))),
        Fetched::Failed(err) => Ok(err),
    }
}

fn parse_openrouter(body: &serde_json::Value) -> Vec<UsageData> {
    let data = body.get("data").unwrap_or(body);
    let total_credits = parse_f64_field(data, "total_credits").unwrap_or(0.0);
    let total_usage = parse_f64_field(data, "total_usage").unwrap_or(0.0);
    let remaining = total_credits - total_usage;

    vec![UsageData {
        plan_name: Some("OpenRouter".to_string()),
        remaining: Some(remaining),
        total: Some(total_credits),
        used: Some(total_usage),
        unit: Some("USD".to_string()),
        is_valid: Some(remaining > 0.0),
        ..Default::default()
    }]
}

// ── Novita AI ───────────────────────────────────────────────
// GET https://api.novita.ai/v3/user/balance
// Response: { availableBalance, ... }；金额单位 0.0001 USD，需 /10000。

pub async fn query_novita(api_key: &str) -> Result<UsageResult, String> {
    match get_json(
        "https://api.novita.ai/v3/user/balance",
        api_key,
        AuthStyle::Bearer,
    )
    .await?
    {
        Fetched::Body(body) => Ok(UsageResult::ok(parse_novita(&body))),
        Fetched::Failed(err) => Ok(err),
    }
}

fn parse_novita(body: &serde_json::Value) -> Vec<UsageData> {
    let available = parse_f64_field(body, "availableBalance").unwrap_or(0.0) / 10000.0;
    vec![UsageData {
        plan_name: Some("Novita AI".to_string()),
        remaining: Some(available),
        unit: Some("USD".to_string()),
        is_valid: Some(available > 0.0),
        ..Default::default()
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn deepseek_maps_balance_infos() {
        let body = json!({
            "is_available": true,
            "balance_infos": [
                { "currency": "CNY", "total_balance": "12.34" },
                { "currency": "USD", "total_balance": 5.0 }
            ]
        });
        let data = parse_deepseek(&body);
        assert_eq!(data.len(), 2);
        assert_eq!(data[0].plan_name.as_deref(), Some("CNY"));
        assert_eq!(data[0].remaining, Some(12.34));
        assert_eq!(data[0].unit.as_deref(), Some("CNY"));
        assert_eq!(data[0].is_valid, Some(true));
        assert_eq!(data[1].remaining, Some(5.0));
    }

    #[test]
    fn stepfun_reads_balance() {
        let body = json!({ "balance": 88.5 });
        let data = parse_stepfun(&body);
        assert_eq!(data[0].remaining, Some(88.5));
        assert_eq!(data[0].unit.as_deref(), Some("CNY"));
    }

    #[test]
    fn siliconflow_missing_data_is_deterministic_failure() {
        let body = json!({ "code": 500 });
        let err = parse_siliconflow(&body, true).unwrap_err();
        assert!(!err.success);
        assert!(err.error.unwrap().contains("Missing 'data'"));
    }

    #[test]
    fn siliconflow_cn_and_en_units() {
        let body = json!({ "data": { "totalBalance": "42.0" } });
        let cn = parse_siliconflow(&body, true).unwrap();
        let en = parse_siliconflow(&body, false).unwrap();
        assert_eq!(cn[0].unit.as_deref(), Some("CNY"));
        assert_eq!(en[0].unit.as_deref(), Some("USD"));
        assert_eq!(cn[0].remaining, Some(42.0));
    }

    #[test]
    fn openrouter_computes_remaining_credits() {
        let body = json!({ "data": { "total_credits": 20.0, "total_usage": 7.5 } });
        let data = parse_openrouter(&body);
        assert_eq!(data[0].remaining, Some(12.5));
        assert_eq!(data[0].total, Some(20.0));
        assert_eq!(data[0].used, Some(7.5));
        assert_eq!(data[0].is_valid, Some(true));
    }

    #[test]
    fn novita_converts_ten_thousandth_usd() {
        let body = json!({ "availableBalance": 123400 });
        let data = parse_novita(&body);
        assert_eq!(data[0].remaining, Some(12.34));
        assert_eq!(data[0].unit.as_deref(), Some("USD"));

        let zero = parse_novita(&json!({ "availableBalance": 0 }));
        assert_eq!(zero[0].is_valid, Some(false));
    }
}
