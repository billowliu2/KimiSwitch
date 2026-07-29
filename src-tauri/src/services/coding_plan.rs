// Adapted from cc-switch (MIT, © Jason Young)
// https://github.com/farion1231/cc-switch

//! Token Plan 套餐额度查询服务
//!
//! 支持 Kimi For Coding、智谱 GLM、MiniMax 的套餐额度查询。
//! cc-switch 的 SubscriptionQuota/tiers 结构在此展平为 `Vec<UsageData>`：
//! 每个窗口（tier）一条 UsageData，`plan_name` = tier 名（"five_hour" /
//! "weekly_limit"），`used` = 已用百分比（0-100），`total` = 100，
//! `remaining` = 剩余百分比，`resets_at` 为 ISO 8601 字符串。
//!
//! 错误通道语义与 balance.rs 一致（Err = 瞬时，Ok(success:false) = 确定性）。

use super::balance::{get_json, AuthStyle, Fetched};
use super::usage_types::{UsageData, UsageResult};

const TIER_FIVE_HOUR: &str = "five_hour";
const TIER_WEEKLY_LIMIT: &str = "weekly_limit";

/// 套餐条目的统一构造：按百分比表示用量。
fn percent_tier(name: &str, used_percent: f64, resets_at: Option<String>) -> UsageData {
    UsageData {
        plan_name: Some(name.to_string()),
        remaining: Some((100.0 - used_percent).max(0.0)),
        total: Some(100.0),
        used: Some(used_percent),
        unit: Some("%".to_string()),
        is_valid: Some(true),
        resets_at,
    }
}

fn millis_to_iso8601(ms: i64) -> Option<String> {
    let secs = ms / 1000;
    let nsecs = ((ms % 1000) * 1_000_000) as u32;
    chrono::DateTime::from_timestamp(secs, nsecs).map(|dt| dt.to_rfc3339())
}

/// 从 JSON 值提取重置时间，兼容字符串和数字格式：
/// - 字符串：直接返回（视为 ISO 8601）
/// - 数字：自动判断秒/毫秒并转为 ISO 8601；0/负值视为无重置时间
fn extract_reset_time(value: &serde_json::Value) -> Option<String> {
    if let Some(s) = value.as_str() {
        return Some(s.to_string());
    }
    if let Some(n) = value.as_i64() {
        if n <= 0 {
            return None;
        }
        // 秒级时间戳 < 1e12，毫秒 >= 1e12
        let ms = if n < 1_000_000_000_000 { n * 1000 } else { n };
        return millis_to_iso8601(ms);
    }
    None
}

/// 解析 JSON 值为 f64，兼容数字和字符串格式（如 `100` 和 `"100"`）
fn parse_f64(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
}

// ── Kimi For Coding ─────────────────────────────────────────
// GET https://api.kimi.com/coding/v1/usages
// Response: { limits: [{ detail: { limit, remaining, resetTime } }],
//             usage: { limit, remaining, resetTime } }

pub async fn query_kimi_coding(api_key: &str) -> Result<UsageResult, String> {
    match get_json(
        "https://api.kimi.com/coding/v1/usages",
        api_key,
        AuthStyle::Bearer,
    )
    .await?
    {
        Fetched::Body(body) => Ok(UsageResult::ok(parse_kimi_coding(&body))),
        Fetched::Failed(err) => Ok(err),
    }
}

fn parse_kimi_coding(body: &serde_json::Value) -> Vec<UsageData> {
    let mut tiers = Vec::new();

    // 5 小时窗口限额（优先显示）
    if let Some(limits) = body.get("limits").and_then(|v| v.as_array()) {
        for limit_item in limits {
            if let Some(detail) = limit_item.get("detail") {
                tiers.push(kimi_limit_tier(TIER_FIVE_HOUR, detail));
            }
        }
    }

    // 总体用量（周限额）
    if let Some(usage) = body.get("usage") {
        tiers.push(kimi_limit_tier(TIER_WEEKLY_LIMIT, usage));
    }

    tiers
}

fn kimi_limit_tier(name: &str, detail: &serde_json::Value) -> UsageData {
    let limit = detail.get("limit").and_then(parse_f64).unwrap_or(1.0);
    let remaining = detail.get("remaining").and_then(parse_f64).unwrap_or(0.0);
    let resets_at = detail.get("resetTime").and_then(extract_reset_time);

    let used = (limit - remaining).max(0.0);
    let utilization = if limit > 0.0 {
        (used / limit) * 100.0
    } else {
        0.0
    };
    percent_tier(name, utilization, resets_at)
}

// ── 智谱 GLM ────────────────────────────────────────────────
// GET {open.bigmodel.cn | api.z.ai}/api/monitor/usage/quota/limit
// 注意：智谱鉴权不加 Bearer 前缀（cc-switch 实测行为，照搬）。

/// 智谱 TOKENS_LIMIT 条目按 `unit` 字段的显式窗口分类。
/// 实测：`unit: 3` → 5 小时滚动窗口；`unit: 6` → 每周窗口。
/// 缺失或不识别时走重置时间启发式兜底。
fn parse_zhipu(body: &serde_json::Value) -> Result<Vec<UsageData>, UsageResult> {
    // 业务级别错误
    if body.get("success").and_then(|v| v.as_bool()) == Some(false) {
        let msg = body
            .get("msg")
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

    type Entry = (Option<i64>, f64, Option<String>);
    let mut five_hour: Option<Entry> = None;
    let mut weekly: Option<Entry> = None;
    let mut unclassified: Vec<Entry> = Vec::new();

    if let Some(limits) = data.get("limits").and_then(|v| v.as_array()) {
        for limit_item in limits {
            let limit_type = limit_item
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !limit_type.eq_ignore_ascii_case("TOKENS_LIMIT") {
                continue;
            }
            let percentage = limit_item
                .get("percentage")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let reset_ms = limit_item.get("nextResetTime").and_then(|v| v.as_i64());
            let reset_iso = reset_ms.and_then(millis_to_iso8601);
            let entry = (reset_ms, percentage, reset_iso);
            match limit_item.get("unit").and_then(|v| v.as_i64()) {
                Some(3) if five_hour.is_none() => five_hour = Some(entry),
                Some(6) if weekly.is_none() => weekly = Some(entry),
                _ => unclassified.push(entry),
            }
        }
    }

    // 兜底：无 nextResetTime 的优先归 five_hour，其余按 reset 升序填空槽。
    unclassified.sort_by_key(|(reset, _, _)| (reset.is_some(), reset.unwrap_or(i64::MIN)));
    for entry in unclassified {
        if five_hour.is_none() {
            five_hour = Some(entry);
        } else if weekly.is_none() {
            weekly = Some(entry);
        }
    }

    let mut tiers = Vec::new();
    for (name, slot) in [(TIER_FIVE_HOUR, five_hour), (TIER_WEEKLY_LIMIT, weekly)] {
        if let Some((_, percentage, resets_at)) = slot {
            tiers.push(percent_tier(name, percentage, resets_at));
        }
    }
    Ok(tiers)
}

/// 额度接口与推理接口同 host：bigmodel.cn 与 z.ai 共用同一后端与 JSON shape。
fn zhipu_quota_base(base_url: &str) -> &'static str {
    if base_url.to_lowercase().contains("bigmodel.cn") {
        "https://open.bigmodel.cn"
    } else {
        "https://api.z.ai"
    }
}

pub async fn query_zhipu(base_url: &str, api_key: &str) -> Result<UsageResult, String> {
    let url = format!(
        "{}/api/monitor/usage/quota/limit",
        zhipu_quota_base(base_url)
    );
    match get_json(&url, api_key, AuthStyle::Raw).await? {
        Fetched::Body(body) => Ok(match parse_zhipu(&body) {
            Ok(data) => UsageResult::ok(data),
            Err(err) => err,
        }),
        Fetched::Failed(err) => Ok(err),
    }
}

// ── MiniMax ─────────────────────────────────────────────────
// GET https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains
// （海外站 api.minimax.io）
// 接口直接给"剩余百分比"，反转为已用百分比；只取 model_name == "general"。

pub async fn query_minimax(api_key: &str, is_cn: bool) -> Result<UsageResult, String> {
    let domain = if is_cn {
        "api.minimaxi.com"
    } else {
        "api.minimax.io"
    };
    let url = format!("https://{domain}/v1/api/openplatform/coding_plan/remains");
    match get_json(&url, api_key, AuthStyle::Bearer).await? {
        Fetched::Body(body) => Ok(match parse_minimax(&body) {
            Ok(data) => UsageResult::ok(data),
            Err(err) => err,
        }),
        Fetched::Failed(err) => Ok(err),
    }
}

fn parse_minimax(body: &serde_json::Value) -> Result<Vec<UsageData>, UsageResult> {
    // 业务级别错误
    if let Some(base_resp) = body.get("base_resp") {
        let status_code = base_resp
            .get("status_code")
            .and_then(|v| v.as_i64())
            .unwrap_or(-1);
        if status_code != 0 {
            let msg = base_resp
                .get("status_msg")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return Err(UsageResult::failure(format!(
                "API error (code {status_code}): {msg}"
            )));
        }
    }

    let mut tiers = Vec::new();

    let Some(model_remains) = body.get("model_remains").and_then(|v| v.as_array()) else {
        return Ok(tiers);
    };
    // 只取 general（编程套餐），跳过 video 等其他模型
    let Some(item) = model_remains.iter().find(|item| {
        item.get("model_name")
            .and_then(|v| v.as_str())
            .map(|s| s == "general")
            .unwrap_or(false)
    }) else {
        return Ok(tiers);
    };

    // 5h 桶：剩余百分比 → 已用百分比
    if let Some(remain_pct) = item
        .get("current_interval_remaining_percent")
        .and_then(|v| v.as_f64())
    {
        let resets_at = item
            .get("end_time")
            .and_then(|v| v.as_i64())
            .and_then(millis_to_iso8601);
        tiers.push(percent_tier(TIER_FIVE_HOUR, 100.0 - remain_pct, resets_at));
    }

    // 周桶：仅 status=1 时激活；status=3 等表示该套餐无周限额，跳过
    if item.get("current_weekly_status").and_then(|v| v.as_i64()) == Some(1) {
        if let Some(remain_pct) = item
            .get("current_weekly_remaining_percent")
            .and_then(|v| v.as_f64())
        {
            let resets_at = item
                .get("weekly_end_time")
                .and_then(|v| v.as_i64())
                .and_then(millis_to_iso8601);
            tiers.push(percent_tier(
                TIER_WEEKLY_LIMIT,
                100.0 - remain_pct,
                resets_at,
            ));
        }
    }

    Ok(tiers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn kimi_coding_flattens_limits_and_usage() {
        let body = json!({
            "limits": [
                { "detail": { "limit": 100, "remaining": 40, "resetTime": 1_754_000_000_000i64 } }
            ],
            "usage": { "limit": 1000, "remaining": 900, "resetTime": "2026-08-01T00:00:00Z" }
        });
        let tiers = parse_kimi_coding(&body);
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].plan_name.as_deref(), Some("five_hour"));
        assert_eq!(tiers[0].used, Some(60.0));
        assert_eq!(tiers[0].total, Some(100.0));
        assert_eq!(tiers[0].remaining, Some(40.0));
        assert!(tiers[0].resets_at.is_some());
        assert_eq!(tiers[1].plan_name.as_deref(), Some("weekly_limit"));
        assert_eq!(tiers[1].used, Some(10.0));
        assert_eq!(
            tiers[1].resets_at.as_deref(),
            Some("2026-08-01T00:00:00Z")
        );
    }

    #[test]
    fn kimi_coding_reset_time_seconds_vs_millis() {
        // 秒级时间戳自动 ×1000
        let v = json!(1_754_000_000i64);
        assert!(extract_reset_time(&v).is_some());
        // 0 / 负值视为无重置时间
        assert_eq!(extract_reset_time(&json!(0)), None);
        assert_eq!(extract_reset_time(&json!(-1)), None);
    }

    #[test]
    fn zhipu_classifies_by_unit_field() {
        let body = json!({
            "success": true,
            "data": {
                "limits": [
                    { "type": "TOKENS_LIMIT", "percentage": 35.0, "unit": 3, "nextResetTime": 1_754_000_000_000i64 },
                    { "type": "TOKENS_LIMIT", "percentage": 80.0, "unit": 6, "nextResetTime": 1_754_500_000_000i64 }
                ]
            }
        });
        let tiers = parse_zhipu(&body).unwrap();
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].plan_name.as_deref(), Some("five_hour"));
        assert_eq!(tiers[0].used, Some(35.0));
        assert_eq!(tiers[1].plan_name.as_deref(), Some("weekly_limit"));
        assert_eq!(tiers[1].used, Some(80.0));
    }

    #[test]
    fn zhipu_business_error_is_deterministic_failure() {
        let body = json!({ "success": false, "msg": "token invalid" });
        let err = parse_zhipu(&body).unwrap_err();
        assert!(!err.success);
        assert!(err.error.unwrap().contains("token invalid"));
    }

    #[test]
    fn minimax_picks_general_and_inverts_remaining() {
        let body = json!({
            "base_resp": { "status_code": 0, "status_msg": "success" },
            "model_remains": [
                { "model_name": "video", "current_interval_remaining_percent": 50.0 },
                {
                    "model_name": "general",
                    "current_interval_remaining_percent": 70.0,
                    "end_time": 1_754_000_000_000i64,
                    "current_weekly_status": 1,
                    "current_weekly_remaining_percent": 95.0,
                    "weekly_end_time": 1_754_500_000_000i64
                }
            ]
        });
        let tiers = parse_minimax(&body).unwrap();
        assert_eq!(tiers.len(), 2);
        assert_eq!(tiers[0].plan_name.as_deref(), Some("five_hour"));
        assert_eq!(tiers[0].used, Some(30.0));
        assert_eq!(tiers[0].remaining, Some(70.0));
        assert_eq!(tiers[1].plan_name.as_deref(), Some("weekly_limit"));
        assert_eq!(tiers[1].used, Some(5.0));
    }

    #[test]
    fn minimax_skips_inactive_weekly_bucket() {
        let body = json!({
            "model_remains": [
                {
                    "model_name": "general",
                    "current_interval_remaining_percent": 70.0,
                    "current_weekly_status": 3,
                    "current_weekly_remaining_percent": 100.0
                }
            ]
        });
        let tiers = parse_minimax(&body).unwrap();
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].plan_name.as_deref(), Some("five_hour"));
    }

    #[test]
    fn minimax_business_error_is_deterministic_failure() {
        let body = json!({ "base_resp": { "status_code": 1002, "status_msg": "invalid key" } });
        let err = parse_minimax(&body).unwrap_err();
        assert!(!err.success);
        assert!(err.error.unwrap().contains("invalid key"));
    }
}
