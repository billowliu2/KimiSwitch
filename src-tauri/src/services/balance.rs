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

pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

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
    timeout: Duration,
) -> Result<Fetched, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
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

pub async fn query_deepseek(api_key: &str, timeout: Duration) -> Result<UsageResult, String> {
    match get_json("https://api.deepseek.com/user/balance", api_key, AuthStyle::Bearer, timeout).await? {
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

pub async fn query_stepfun(api_key: &str, timeout: Duration) -> Result<UsageResult, String> {
    match get_json("https://api.stepfun.com/v1/accounts", api_key, AuthStyle::Bearer, timeout).await? {
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

pub async fn query_siliconflow(api_key: &str, is_cn: bool, timeout: Duration) -> Result<UsageResult, String> {
    let domain = if is_cn {
        "api.siliconflow.cn"
    } else {
        "api.siliconflow.com"
    };
    let url = format!("https://{domain}/v1/user/info");
    match get_json(&url, api_key, AuthStyle::Bearer, timeout).await? {
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

pub async fn query_openrouter(api_key: &str, timeout: Duration) -> Result<UsageResult, String> {
    match get_json(
        "https://openrouter.ai/api/v1/credits",
        api_key,
        AuthStyle::Bearer,
        timeout,
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

pub async fn query_novita(api_key: &str, timeout: Duration) -> Result<UsageResult, String> {
    match get_json(
        "https://api.novita.ai/v3/user/balance",
        api_key,
        AuthStyle::Bearer,
        timeout,
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

// ── Kimi (Moonshot) 开放平台 ─────────────────────────────────
// GET https://api.moonshot.cn/v1/users/me/balance（国内站；国际站 api.moonshot.ai）
// 官方文档：https://platform.kimi.com/docs/api/balance
// Response: { code, data: { available_balance, voucher_balance, cash_balance }, scode, status }
// code != 0 或 status == false 为业务失败（确定性）；available_balance 单位人民币元。
// 注：国际站货币单位未见于官方文档，先按 USD 处理，待实测确认（与 SiliconFlow 做法一致）。

pub async fn query_kimi(api_key: &str, is_cn: bool, timeout: Duration) -> Result<UsageResult, String> {
    let domain = if is_cn {
        "api.moonshot.cn"
    } else {
        "api.moonshot.ai"
    };
    let url = format!("https://{domain}/v1/users/me/balance");
    match get_json(&url, api_key, AuthStyle::Bearer, timeout).await? {
        Fetched::Body(body) => Ok(match parse_kimi(&body, is_cn) {
            Ok(data) => UsageResult::ok(data),
            Err(err) => err,
        }),
        Fetched::Failed(err) => Ok(err),
    }
}

fn parse_kimi(body: &serde_json::Value, is_cn: bool) -> Result<Vec<UsageData>, UsageResult> {
    // 业务级失败：code != 0 / status == false
    if body.get("code").and_then(|v| v.as_i64()) != Some(0)
        || body.get("status").and_then(|v| v.as_bool()) == Some(false)
    {
        let msg = body
            .get("scode")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return Err(UsageResult::failure(format!("API error: {msg}")));
    }

    let data = match body.get("data") {
        Some(d) => d,
        None => {
            return Err(UsageResult::failure(
                "Missing 'data' field in response".to_string(),
            ))
        }
    };
    let available = parse_f64_field(data, "available_balance").unwrap_or(0.0);
    Ok(vec![UsageData {
        plan_name: Some("Kimi".to_string()),
        remaining: Some(available),
        unit: Some(if is_cn {
            "CNY".to_string()
        } else {
            "USD".to_string()
        }),
        is_valid: Some(available > 0.0),
        ..Default::default()
    }])
}

// ── NewAPI / OneAPI 中转站 ────────────────────────────────────
// GET {base_url}/api/user/self
// 头：Authorization: Bearer <access_token>（网页后台 Access Token，非 sk- key）
//     New-Api-User: <user_id>
// Response: { success, message, data: { quota, used_quota, username, ... } }
// 金额换算：quota / quota_per_unit（从 {base_url}/api/status 拉取，站点可配，
// 典型 500000 = 1 货币单位）。display_in_currency=true 时单位按
// custom_currency_symbol（¥/$/¤），此处统一记 "credit" 由前端按 symbol 显示。
//
// 坑位（cc-switch 实测 + 本站验证）：
// - sk- 推理令牌不能查本接口（401 invalid access token），必须网页 Access Token。
// - quota == 0 常表示"无限额度"（后台设置），不能显示成余额 0。

const DEFAULT_QUOTA_PER_UNIT: f64 = 500_000.0;

/// /api/status 的进程内缓存（key = base_url）。站点配置几乎不变，TTL 与
/// usage 缓存一致（5 分钟）足够。
static QUOTA_PER_UNIT_CACHE: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, (std::time::Instant, f64, String)>>,
> = std::sync::OnceLock::new();

fn quota_cache() -> &'static std::sync::Mutex<
    std::collections::HashMap<String, (std::time::Instant, f64, String)>,
> {
    QUOTA_PER_UNIT_CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// 拉取站点的 quota_per_unit 与货币符号；失败回退默认值。
async fn fetch_newapi_status(base_url: &str, timeout: Duration) -> (f64, String) {
    let base = base_url.trim_end_matches('/');
    {
        let cache = quota_cache().lock().unwrap();
        if let Some((ts, qpu, symbol)) = cache.get(base) {
            if ts.elapsed() < std::time::Duration::from_secs(300) {
                return (*qpu, symbol.clone());
            }
        }
    }

    let client = match reqwest::Client::builder()
        .timeout(timeout)
        .build()
    {
        Ok(c) => c,
        Err(_) => return (DEFAULT_QUOTA_PER_UNIT, "USD".to_string()),
    };
    let url = format!("{base}/api/status");
    let fallback = || (DEFAULT_QUOTA_PER_UNIT, "USD".to_string());
    let result = match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => match resp.bytes().await {
            Ok(raw) => match serde_json::from_slice::<serde_json::Value>(&raw) {
                Ok(v) => {
                    let qpu = v
                        .get("data")
                        .and_then(|d| d.get("quota_per_unit"))
                        .and_then(|v| v.as_f64())
                        .filter(|&n| n > 0.0)
                        .unwrap_or(DEFAULT_QUOTA_PER_UNIT);
                    let symbol = v
                        .get("data")
                        .and_then(|d| d.get("custom_currency_symbol"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("$")
                        .to_string();
                    (qpu, symbol)
                }
                Err(_) => fallback(),
            },
            Err(_) => fallback(),
        },
        _ => fallback(),
    };

    let mut cache = quota_cache().lock().unwrap();
    cache.insert(
        base.to_string(),
        (std::time::Instant::now(), result.0, result.1.clone()),
    );
    result
}

pub async fn query_newapi(
    base_url: &str,
    access_token: &str,
    user_id: &str,
    timeout: Duration,
) -> Result<UsageResult, String> {
    let base = base_url.trim_end_matches('/');
    let url = format!("{base}/api/user/self");

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = match client
        .get(&url)
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("New-Api-User", user_id)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return Err(format!("Network error: {e}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Ok(UsageResult::failure(format!(
            "Authentication failed (HTTP {status})"
        )));
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Ok(UsageResult::failure(format!(
            "API error (HTTP {status}): {body}"
        )));
    }
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => return Err(format!("Failed to read response: {e}")),
    };
    let body: serde_json::Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(e) => {
            return Ok(UsageResult::failure(format!(
                "Failed to parse response: {e}"
            )))
        }
    };

    let (quota_per_unit, symbol) = fetch_newapi_status(base_url, timeout).await;
    Ok(match parse_newapi(&body, quota_per_unit, &symbol) {
        Ok(data) => UsageResult::ok(data),
        Err(err) => err,
    })
}

fn parse_newapi(
    body: &serde_json::Value,
    quota_per_unit: f64,
    symbol: &str,
) -> Result<Vec<UsageData>, UsageResult> {
    if body.get("success").and_then(|v| v.as_bool()) == Some(false) {
        let msg = body
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return Err(UsageResult::failure(format!("API error: {msg}")));
    }

    let data = match body.get("data") {
        Some(d) => d,
        None => {
            return Err(UsageResult::failure(
                "Missing 'data' field in response".to_string(),
            ))
        }
    };

    let quota_raw = parse_f64_field(data, "quota").unwrap_or(0.0);
    let used_raw = parse_f64_field(data, "used_quota").unwrap_or(0.0);

    // quota == 0 && used == 0：站点把该令牌设为"无限额度"，没有数值可显示。
    if quota_raw == 0.0 && used_raw == 0.0 {
        return Ok(vec![UsageData {
            plan_name: Some("NewAPI".to_string()),
            unit: Some(symbol.to_string()),
            is_valid: Some(true),
            ..Default::default()
        }]);
    }

    let remaining = quota_raw / quota_per_unit;
    let used = used_raw / quota_per_unit;
    let total = remaining + used;
    Ok(vec![UsageData {
        plan_name: Some("NewAPI".to_string()),
        remaining: Some(remaining),
        total: Some(total),
        used: Some(used),
        unit: Some(symbol.to_string()),
        is_valid: Some(remaining > 0.0),
        ..Default::default()
    }])
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

    #[test]
    fn kimi_parses_balance() {
        let body = json!({
            "code": 0,
            "data": {
                "available_balance": 49.58894,
                "voucher_balance": 46.58893,
                "cash_balance": 3.00001
            },
            "scode": "0x0",
            "status": true
        });
        let data = parse_kimi(&body, true).unwrap();
        assert_eq!(data.len(), 1);
        assert_eq!(data[0].plan_name.as_deref(), Some("Kimi"));
        assert_eq!(data[0].remaining, Some(49.58894));
        assert_eq!(data[0].unit.as_deref(), Some("CNY"));
        assert_eq!(data[0].is_valid, Some(true));
    }

    #[test]
    fn kimi_en_uses_usd_unit() {
        let body = json!({ "code": 0, "data": { "available_balance": 12.5 }, "status": true });
        let data = parse_kimi(&body, false).unwrap();
        assert_eq!(data[0].unit.as_deref(), Some("USD"));
    }

    #[test]
    fn kimi_business_error_is_deterministic_failure() {
        let body = json!({ "code": 401, "scode": "0x191", "status": false });
        let err = parse_kimi(&body, true).unwrap_err();
        assert!(!err.success);
        assert!(err.error.unwrap().contains("0x191"));
    }

    #[test]
    fn kimi_missing_data_is_deterministic_failure() {
        let body = json!({ "code": 0, "status": true });
        let err = parse_kimi(&body, true).unwrap_err();
        assert!(!err.success);
        assert!(err.error.unwrap().contains("Missing 'data'"));
    }

    #[test]
    fn kimi_zero_balance_is_invalid() {
        let body = json!({ "code": 0, "data": { "available_balance": 0.0 }, "status": true });
        let data = parse_kimi(&body, true).unwrap();
        assert_eq!(data[0].is_valid, Some(false));
    }

    #[test]
    fn newapi_parses_quota_with_unit_division() {
        let body = json!({
            "success": true,
            "data": { "quota": 36_125_000, "used_quota": 2_500_000, "username": "alice" }
        });
        let data = parse_newapi(&body, 500_000.0, "¥").unwrap();
        assert_eq!(data.len(), 1);
        assert_eq!(data[0].plan_name.as_deref(), Some("NewAPI"));
        assert_eq!(data[0].remaining, Some(72.25));
        assert_eq!(data[0].used, Some(5.0));
        assert_eq!(data[0].total, Some(77.25));
        assert_eq!(data[0].unit.as_deref(), Some("¥"));
        assert_eq!(data[0].is_valid, Some(true));
    }

    #[test]
    fn newapi_business_error_is_deterministic_failure() {
        let body = json!({ "success": false, "message": "Unauthorized, invalid access token" });
        let err = parse_newapi(&body, 500_000.0, "¥").unwrap_err();
        assert!(!err.success);
        assert!(err.error.unwrap().contains("invalid access token"));
    }

    #[test]
    fn newapi_missing_data_is_deterministic_failure() {
        let body = json!({ "success": true });
        let err = parse_newapi(&body, 500_000.0, "¥").unwrap_err();
        assert!(err.error.unwrap().contains("Missing 'data'"));
    }

    #[test]
    fn newapi_zero_quota_means_unlimited() {
        let body = json!({ "success": true, "data": { "quota": 0, "used_quota": 0 } });
        let data = parse_newapi(&body, 500_000.0, "$").unwrap();
        assert_eq!(data.len(), 1);
        assert_eq!(data[0].remaining, None);
        assert_eq!(data[0].is_valid, Some(true));
    }

    #[test]
    fn newapi_accepts_string_numbers() {
        let body = json!({ "success": true, "data": { "quota": "500000", "used_quota": "100000" } });
        let data = parse_newapi(&body, 500_000.0, "¥").unwrap();
        assert_eq!(data[0].remaining, Some(1.0));
        assert_eq!(data[0].used, Some(0.2));
    }
}
