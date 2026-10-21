// Adapted from cc-switch (MIT, © Jason Young)
// https://github.com/farion1231/cc-switch

//! Token Plan 套餐额度查询服务
//!
//! 支持 Kimi For Coding、智谱 GLM、MiniMax、OpenCode Go 的套餐额度查询。
//! cc-switch 的 SubscriptionQuota/tiers 结构在此展平为 `Vec<UsageData>`：
//! 每个窗口（tier）一条 UsageData，`plan_name` = tier 名（"five_hour" /
//! "weekly_limit" / "monthly_limit"），`used` = 已用百分比（0-100），`total` = 100，
//! `remaining` = 剩余百分比，`resets_at` 为 ISO 8601 字符串。
//!
//! 例外：Kimi 的加力钱包（`PLAN_BOOSTER_WALLET`）不是百分比窗口而是金额行，
//! `used` / `total` / `remaining` 均为货币金额（分换算而来），`unit` 为币种。
//!
//! 错误通道语义与 balance.rs 一致（Err = 瞬时，Ok(success:false) = 确定性）。

use super::balance::{get_json, get_json_with_ua, AuthStyle, Fetched};
use super::usage_types::{UsageData, UsageResult};
use std::time::Duration;

// 套餐类 tier id 的唯一来源：所有套餐供应商（Kimi/智谱/MiniMax/OpenCode Go 及
// 未来新增）都只用这四个 id。前端 src/lib/usage-display.ts 的 planLabel() 依赖
// 此约定做本地化映射——新增 tier id 时必须同步加映射。
const TIER_FIVE_HOUR: &str = "five_hour";
const TIER_WEEKLY_LIMIT: &str = "weekly_limit";
const TIER_MONTHLY_LIMIT: &str = "monthly_limit";
/// Kimi quota 模型的月度代码窗口（kimi-code #3787 后 `limit_month_code`）。
const TIER_MONTH_CODE: &str = "month_code";
/// Kimi quota 响应里的加力钱包（boosterWallet）。**不是百分比 tier**：这条是
/// 金额行，前端 src/lib/usage-display.ts 的 planLabel() 负责本地化，
/// UsageFooter 按「金额行」而非配额行渲染（used/total 是钱数，不是配额比例）。
const PLAN_BOOSTER_WALLET: &str = "booster_wallet";

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

/// 时间戳（秒或毫秒，浮点取整）→ ISO 8601；0/负值视为无重置时间。
/// 秒级 < 1e12，毫秒 >= 1e12。
fn timestamp_to_iso8601(n: f64) -> Option<String> {
    if !n.is_finite() || n <= 0.0 {
        return None;
    }
    let ms = if n < 1_000_000_000_000.0 { n * 1000.0 } else { n };
    millis_to_iso8601(ms.round() as i64)
}

/// 从 JSON 值提取重置时间，兼容字符串和数字格式：
/// - 数字（含浮点，如 `1754000000.0`）：判断秒/毫秒并转为 ISO 8601；
///   0/负值视为无重置时间
/// - 字符串：能按数字解析的（如 `"1754000000"`）同上按时间戳处理，
///   否则原样返回（视为 ISO 8601）
pub(crate) fn extract_reset_time(value: &serde_json::Value) -> Option<String> {
    if let Some(s) = value.as_str() {
        return match s.trim().parse::<f64>() {
            Ok(n) if n.is_finite() => timestamp_to_iso8601(n),
            // 非数字字符串（ISO 8601）原样透传，前端 new Date() 直接可用。
            _ => Some(s.to_string()),
        };
    }
    value.as_f64().and_then(timestamp_to_iso8601)
}

/// 解析 JSON 值为 f64，兼容数字和字符串格式（如 `100` 和 `"100"`）
fn parse_f64(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
}

/// 响应里没有任何可解析条目时的确定性失败，附 400 字原始响应预览（仅用量
/// 数字，无密钥）。`label` 是接口归类名，用于让用户知道是哪个端点结构变了。
fn body_preview_failure(label: &str, body: &serde_json::Value) -> UsageResult {
    let preview = serde_json::to_string(body)
        .unwrap_or_else(|_| "<unserializable body>".into());
    let trimmed: String = preview.chars().take(400).collect();
    UsageResult::failure(format!(
        "no plan data in {label} response, raw body: {trimmed}"
    ))
}

// ── Kimi For Coding ─────────────────────────────────────────
// GET {base_url}/usages
//   默认 https://api.kimi.com/coding/v1/usages
//   global: https://api.kimi.ai/coding/v1/usages
// Response（kimi-code #3787 / 0.43.1 起服务端切换为 quota 模型）:
//   { usages: { limit_5h, limit_7d, limit_month_total, limit_month_code:
//               { used_ratio: 0-1, reset_time?: ISO 8601 } },
//     boosterWallet: { balanceCents, totalCents, monthlyChargeLimitEnabled,
//                      monthlyChargeLimitCents, monthlyUsedCents, currency },
//     goods_version }
// 旧结构（兼容保留）: { limits: [{ detail: { limit, remaining, resetTime } }],
//                     usage: { limit, remaining, resetTime } }

/// 由 base_url 拼接 usages 查询 URL；base_url 为空/空白时回退大陆默认。
/// 纯函数，便于单测。
fn kimi_coding_usages_url(base_url: &str) -> String {
    let base = if base_url.trim().is_empty() {
        "https://api.kimi.com/coding/v1"
    } else {
        base_url.trim_end_matches('/')
    };
    format!("{base}/usages")
}

pub async fn query_kimi_coding(
    base_url: &str,
    api_key: &str,
    timeout: Duration,
) -> Result<UsageResult, String> {
    let url = kimi_coding_usages_url(base_url);
    match get_json(&url, api_key, AuthStyle::Bearer, timeout).await?
    {
        Fetched::Body(body) => {
            let tiers = parse_kimi_coding(&body);
            if tiers.is_empty() {
                // 响应里没有可解析的套餐档位（quota/usages 与旧 limits/usage
                // 均缺失或字段变了）。把原始响应（仅用量数字，无密钥）透出，
                // 方便对照接口结构修复。
                let preview = serde_json::to_string(&body)
                    .unwrap_or_else(|_| "<unserializable body>".into());
                let trimmed: String = preview.chars().take(400).collect();
                return Ok(UsageResult::failure(format!(
                    "kimi usages 响应无套餐数据，原始返回: {trimmed}"
                )));
            }
            Ok(UsageResult::ok(tiers))
        }
        Fetched::Failed(err) => Ok(err),
    }
}

fn parse_kimi_coding(body: &serde_json::Value) -> Vec<UsageData> {
    // 新 quota 模型（kimi-code #3787 / 0.43.1 起服务端下发）：优先解析。
    if let Some(tiers) = parse_kimi_quota(body) {
        return tiers;
    }

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

/// 解析 quota 模型的 `usages` 窗口映射（`limit_5h` / `limit_7d` /
/// `limit_month_total` / `limit_month_code`）+ 加力钱包。窗口与钱包都缺失或
/// 无可解析条目时返回 None，让调用方回退旧结构。
fn parse_kimi_quota(body: &serde_json::Value) -> Option<Vec<UsageData>> {
    let usages = body.get("usages")?;
    let mut tiers = Vec::new();
    for (key, tier) in [
        ("limit_5h", TIER_FIVE_HOUR),
        ("limit_7d", TIER_WEEKLY_LIMIT),
        ("limit_month_total", TIER_MONTHLY_LIMIT),
        ("limit_month_code", TIER_MONTH_CODE),
    ] {
        let Some(entry) = usages.get(key) else { continue };
        let Some(ratio) = entry.get("used_ratio").and_then(parse_f64) else {
            continue;
        };
        // used_ratio 规范为 0-1 比率；>1 时视为已是百分数，原样使用。
        let used_percent = if ratio <= 1.0 { ratio * 100.0 } else { ratio };
        let resets_at = entry.get("reset_time").and_then(extract_reset_time);
        tiers.push(percent_tier(tier, used_percent, resets_at));
    }
    // 加力钱包排在四个窗口之后（钱包是余额，不是滚动窗口）。
    if let Some(wallet) = body.get("boosterWallet").and_then(booster_wallet_tier) {
        tiers.push(wallet);
    }
    if tiers.is_empty() { None } else { Some(tiers) }
}

/// 解析加力钱包（boosterWallet）为金额行。字段单位为「分」，统一换算成元/美元。
///
/// 只在响应含新版 `*Cents` 字段时产出条目：kimi-code #3787 之前的
/// `boosterWallet` 只有 `balance`（无币种/精度语义），产出全 0 的伪行只会误导。
fn booster_wallet_tier(wallet: &serde_json::Value) -> Option<UsageData> {
    let cents = |key: &str| wallet.get(key).and_then(parse_f64);
    let (balance, total, used) = (
        cents("balanceCents"),
        cents("totalCents"),
        cents("monthlyUsedCents"),
    );
    if balance.is_none() && total.is_none() && used.is_none() {
        return None;
    }
    // 币种缺失时不猜（前端 formatAmount 会退化为纯数字展示）。
    let unit = wallet
        .get("currency")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Some(UsageData {
        plan_name: Some(PLAN_BOOSTER_WALLET.to_string()),
        remaining: balance.map(|c| c / 100.0),
        total: total.map(|c| c / 100.0),
        used: used.map(|c| c / 100.0),
        unit,
        is_valid: Some(true),
        // 钱包没有窗口重置时间。
        resets_at: None,
    })
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

pub async fn query_zhipu(base_url: &str, api_key: &str, timeout: Duration) -> Result<UsageResult, String> {
    let url = format!(
        "{}/api/monitor/usage/quota/limit",
        zhipu_quota_base(base_url)
    );
    match get_json(&url, api_key, AuthStyle::Raw, timeout).await? {
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

pub async fn query_minimax(api_key: &str, is_cn: bool, timeout: Duration) -> Result<UsageResult, String> {
    let domain = if is_cn {
        "api.minimaxi.com"
    } else {
        "api.minimax.io"
    };
    let url = format!("https://{domain}/v1/api/openplatform/coding_plan/remains");
    match get_json(&url, api_key, AuthStyle::Bearer, timeout).await? {
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

// ── OpenCode Go ─────────────────────────────────────────────
// GET https://opencode.ai/zen/go/v1/usage
// Response: { usage: { rolling: { status, percent, resetsAt },
//                      weekly:  { status, percent, resetsAt },
//                      monthly: { status, percent, resetsAt } } }
// percent = 已用百分比（与 percent_tier 语义一致）；status 仅作展示参考，缺失容忍；
// resetsAt 为 ISO 8601 字符串。
//
// 坑位：opencode.ai 有 Cloudflare 1010 拦截——reqwest 默认不带 User-Agent 的
// 裸请求会被 403（error code: 1010）。必须显式设置浏览器 UA。

const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

pub async fn query_opencode_go(
    api_key: &str,
    timeout: Duration,
) -> Result<UsageResult, String> {
    match get_json_with_ua(
        "https://opencode.ai/zen/go/v1/usage",
        api_key,
        AuthStyle::Bearer,
        timeout,
        Some(BROWSER_USER_AGENT),
    )
    .await?
    {
        Fetched::Body(body) => {
            let tiers = parse_opencode_go(&body);
            if tiers.is_empty() {
                // 响应里没有可解析的用量窗口（usage 缺失或字段变了）。
                // 把原始响应（仅用量数字，无密钥）透出，方便对照接口结构修复。
                return Ok(opencode_go_empty_failure(&body));
            }
            Ok(UsageResult::ok(tiers))
        }
        Fetched::Failed(err) => Ok(err),
    }
}

/// usage 全缺时的确定性失败，附 400 字原始响应预览。抽成纯函数便于离线单测。
fn opencode_go_empty_failure(body: &serde_json::Value) -> UsageResult {
    let preview = serde_json::to_string(body)
        .unwrap_or_else(|_| "<unserializable body>".into());
    let trimmed: String = preview.chars().take(400).collect();
    UsageResult::failure(format!(
        "opencode go usage 响应无套餐数据，原始返回: {trimmed}"
    ))
}

/// 三个窗口（5 小时滚动 / 周 / 月）各解析为一条 `percent_tier`；
/// 缺失或 percent 不可解析的窗口跳过（status 字段可缺）。
fn parse_opencode_go(body: &serde_json::Value) -> Vec<UsageData> {
    let mut tiers = Vec::new();
    let Some(usage) = body.get("usage") else {
        return tiers;
    };
    let windows = [
        (TIER_FIVE_HOUR, "rolling"),
        (TIER_WEEKLY_LIMIT, "weekly"),
        (TIER_MONTHLY_LIMIT, "monthly"),
    ];
    for (name, key) in windows {
        let Some(window) = usage.get(key) else {
            continue;
        };
        let Some(percent) = window.get("percent").and_then(parse_f64) else {
            continue;
        };
        let resets_at = window.get("resetsAt").and_then(extract_reset_time);
        tiers.push(percent_tier(name, percent, resets_at));
    }
    tiers
}

// ── Command Code GOAT ───────────────────────────────────────
// GET https://api.commandcode.ai/alpha/billing/credits
// 鉴权用账户 API Key（Bearer，即 CLI 存在 ~/.commandcode/auth.json 的 user_… key），
// 不是网页 cookie。
// Response:
//   { credits: { monthlyCredits, purchasedCredits, freeCredits },
//     windowLimits: { fiveHour: { used, cap, resetAt },
//                     weekly:   { used, cap, resetAt } } }
// `credits` 可能整体缺失（此时 body 本身就是 credits 对象），解析时兜底。
// 401/403 由 get_json 归成 Fetched::Failed（"Authentication failed (HTTP …)"
// 前缀，前端 localizeUsageError 认这个前缀），这里原样透传。
//
// 只查 credits 这一个端点：/alpha/usage/summary 的 lifetime 总计与
// /alpha/billing/subscriptions 的到期日需要给 UsageData 扩字段，本轮不做。

const GOAT_BILLING_CREDITS_URL: &str = "https://api.commandcode.ai/alpha/billing/credits";

pub async fn query_goat(api_key: &str, timeout: Duration) -> Result<UsageResult, String> {
    match get_json(GOAT_BILLING_CREDITS_URL, api_key, AuthStyle::Bearer, timeout).await? {
        Fetched::Body(body) => Ok(match parse_goat(&body) {
            Ok(rows) => UsageResult::ok(rows),
            Err(err) => err,
        }),
        Fetched::Failed(err) => Ok(err),
    }
}

fn parse_goat(body: &serde_json::Value) -> Result<Vec<UsageData>, UsageResult> {
    let mut rows = Vec::new();

    // 额度：monthly → credits → balance → remaining → available 回退链
    // （CLI 把月度/加购/赠送三份合成一个数字展示，此处同口径）。
    // `credits` 可能缺失，也可能显式为 null（`{"credits": null, "monthlyCredits": …}`
    // 这种扁平载荷），只有取到对象才用它，否则回退 body 本身。
    let credits = body
        .get("credits")
        .filter(|v| v.is_object())
        .unwrap_or(body);
    let balance = [
        "monthlyCredits",
        "credits",
        "balance",
        "remainingCredits",
        "availableCredits",
    ]
    .iter()
    .find_map(|key| credits.get(*key).and_then(parse_f64));
    if let Some(balance) = balance {
        rows.push(UsageData {
            plan_name: Some("GOAT".to_string()),
            remaining: Some(balance),
            unit: Some("USD".to_string()),
            // 取到余额即视为有效数据：余额 0 是「用完了」，不是「Key 无效」。
            is_valid: Some(true),
            ..Default::default()
        });
    }

    // 两个滚动窗口由服务端给 used/cap，换算成百分比。
    for (name, key) in [(TIER_FIVE_HOUR, "fiveHour"), (TIER_WEEKLY_LIMIT, "weekly")] {
        let Some(window) = body.get("windowLimits").and_then(|l| l.get(key)) else {
            continue;
        };
        // cap 缺失或非正数时算不出比例，整窗跳过。
        let Some(cap) = window.get("cap").and_then(parse_f64).filter(|&c| c > 0.0) else {
            continue;
        };
        let used = window.get("used").and_then(parse_f64).unwrap_or(0.0);
        let percent = (used / cap * 100.0).min(100.0);
        let resets_at = window.get("resetAt").and_then(extract_reset_time);
        rows.push(percent_tier(name, percent, resets_at));
    }

    if rows.is_empty() {
        return Err(body_preview_failure("GOAT billing", body));
    }
    Ok(rows)
}

// ── Ollama Cloud ────────────────────────────────────────────
// GET https://ollama.com/api/usage（Bearer API key）
// Response: { activity: { cost, period }, limits: { session: { usage },
//                                                 weekly:  { usage } } }
// `usage` 是 0-1 的已用比例（个别载荷已给百分数）；接口既不返回 cap 也不返回
// 重置时间。重置排期是固定的全局约定（ollama/ollama#12532）：session 窗口 5
// 小时且与 epoch 对齐，weekly 窗口 7 天 + 4 天 epoch 偏移——故本地推算。

/// 订阅套餐没有余额概念：`activity.cost` 是「近期消费」（通常 0），前端
/// src/lib/usage-display.ts 的 planLabel() / isMoneyRow() 依赖此 id 本地化。
const PLAN_RECENT_SPEND: &str = "recent_spend";

const OLLAMA_SESSION_PERIOD_S: i64 = 18_000;
const OLLAMA_WEEKLY_PERIOD_S: i64 = 604_800;
const OLLAMA_WEEKLY_EPOCH_OFFSET_S: i64 = 4 * 86_400;

/// 下一个 5 小时窗口边界（与 epoch 对齐）。
fn ollama_session_reset_secs(now_sec: i64) -> i64 {
    now_sec + (OLLAMA_SESSION_PERIOD_S - now_sec % OLLAMA_SESSION_PERIOD_S)
}

/// 下一个周窗口边界（7 天周期 + 4 天 epoch 偏移）。
fn ollama_weekly_reset_secs(now_sec: i64) -> i64 {
    now_sec
        + (OLLAMA_WEEKLY_PERIOD_S
            - (now_sec - OLLAMA_WEEKLY_EPOCH_OFFSET_S) % OLLAMA_WEEKLY_PERIOD_S)
}

/// 已用比例归一：<=1 视为 0-1 比例，>1 视为已给的百分数。
fn ollama_usage_ratio(value: &serde_json::Value) -> Option<f64> {
    let n = parse_f64(value)?;
    Some(if n <= 1.0 { n } else { n / 100.0 })
}

pub async fn query_ollama_cloud(api_key: &str, timeout: Duration) -> Result<UsageResult, String> {
    match get_json(
        "https://ollama.com/api/usage",
        api_key,
        AuthStyle::Bearer,
        timeout,
    )
    .await?
    {
        Fetched::Body(body) => Ok(match parse_ollama_cloud(&body, chrono::Utc::now().timestamp()) {
            Ok(rows) => UsageResult::ok(rows),
            Err(err) => err,
        }),
        Fetched::Failed(err) => Ok(err),
    }
}

/// `now_sec` 由调用方传入而非函数内取时钟，便于离线单测重置时间推算。
fn parse_ollama_cloud(
    body: &serde_json::Value,
    now_sec: i64,
) -> Result<Vec<UsageData>, UsageResult> {
    let mut rows = Vec::new();
    let windows = [
        (TIER_FIVE_HOUR, "session", ollama_session_reset_secs(now_sec)),
        (TIER_WEEKLY_LIMIT, "weekly", ollama_weekly_reset_secs(now_sec)),
    ];
    for (name, key, reset_secs) in windows {
        let Some(ratio) = body
            .get("limits")
            .and_then(|l| l.get(key))
            .and_then(|w| w.get("usage"))
            .and_then(ollama_usage_ratio)
        else {
            continue;
        };
        let percent = (ratio * 100.0).min(100.0);
        rows.push(percent_tier(
            name,
            percent,
            millis_to_iso8601(reset_secs * 1000),
        ));
    }

    // 两个窗口都缺 = 响应结构变了（光有 cost 不构成有效用量），确定性失败。
    if rows.is_empty() {
        return Err(body_preview_failure("ollama cloud usage", body));
    }

    // 近期消费仅作上下文；订阅套餐上通常是 0，故排在窗口之后。
    if let Some(cost) = body
        .get("activity")
        .and_then(|a| a.get("cost"))
        .and_then(parse_f64)
    {
        rows.push(UsageData {
            plan_name: Some(PLAN_RECENT_SPEND.to_string()),
            remaining: Some(cost),
            unit: Some("USD".to_string()),
            is_valid: Some(true),
            ..Default::default()
        });
    }

    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn kimi_coding_usages_url_uses_base_and_falls_back() {
        // global base → .ai usages URL
        assert_eq!(
            kimi_coding_usages_url("https://api.kimi.ai/coding/v1"),
            "https://api.kimi.ai/coding/v1/usages"
        );
        // 尾斜杠去掉
        assert_eq!(
            kimi_coding_usages_url("https://api.kimi.ai/coding/v1/"),
            "https://api.kimi.ai/coding/v1/usages"
        );
        // 空串/空白回退大陆默认
        assert_eq!(
            kimi_coding_usages_url(""),
            "https://api.kimi.com/coding/v1/usages"
        );
        assert_eq!(
            kimi_coding_usages_url("   "),
            "https://api.kimi.com/coding/v1/usages"
        );
        // 大陆 base 原样拼接
        assert_eq!(
            kimi_coding_usages_url("https://api.kimi.com/coding/v1"),
            "https://api.kimi.com/coding/v1/usages"
        );
    }

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
    fn kimi_coding_quota_model_four_windows() {
        // kimi-code #3787 / 0.43.1 起服务端下发的 quota 模型：used_ratio 为
        // 0-1 比率，reset_time 为 ISO 8601 字符串。
        let body = json!({
            "goods_version": 3,
            "usages": {
                "limit_5h": { "used_ratio": 0.6, "reset_time": "2026-09-15T17:00:00Z" },
                "limit_7d": { "used_ratio": 0.25 },
                "limit_month_total": { "used_ratio": 0.1, "reset_time": "2026-10-01T00:00:00Z" },
                "limit_month_code": { "used_ratio": 0.88 }
            },
            "boosterWallet": { "balance": 0 }
        });
        let tiers = parse_kimi_coding(&body);
        // 旧版 boosterWallet（只有 balance，无 *Cents）不产出钱包行。
        assert_eq!(tiers.len(), 4);
        assert_eq!(tiers[0].plan_name.as_deref(), Some("five_hour"));
        assert_eq!(tiers[0].used, Some(60.0));
        assert_eq!(tiers[0].remaining, Some(40.0));
        assert_eq!(tiers[0].total, Some(100.0));
        assert_eq!(
            tiers[0].resets_at.as_deref(),
            Some("2026-09-15T17:00:00Z")
        );
        assert_eq!(tiers[1].plan_name.as_deref(), Some("weekly_limit"));
        assert_eq!(tiers[1].used, Some(25.0));
        assert!(tiers[1].resets_at.is_none());
        assert_eq!(tiers[2].plan_name.as_deref(), Some("monthly_limit"));
        assert_eq!(tiers[2].used, Some(10.0));
        assert_eq!(tiers[3].plan_name.as_deref(), Some("month_code"));
        assert_eq!(tiers[3].used, Some(88.0));
        assert_eq!(tiers[3].remaining, Some(12.0));
    }

    #[test]
    fn kimi_coding_quota_appends_booster_wallet_row() {
        // 加力钱包是金额行（分 → 元/美元），追加在四个窗口之后。
        let body = json!({
            "usages": {
                "limit_5h": { "used_ratio": 0.6 },
                "limit_7d": { "used_ratio": 0.25 },
                "limit_month_total": { "used_ratio": 0.1 },
                "limit_month_code": { "used_ratio": 0.88 }
            },
            "boosterWallet": {
                "balanceCents": 1234,
                "totalCents": 5000,
                "monthlyChargeLimitEnabled": true,
                "monthlyChargeLimitCents": 2000,
                "monthlyUsedCents": 800,
                "currency": "USD"
            }
        });
        let tiers = parse_kimi_coding(&body);
        assert_eq!(tiers.len(), 5);
        assert_eq!(tiers[0].plan_name.as_deref(), Some("five_hour"));
        let wallet = &tiers[4];
        assert_eq!(wallet.plan_name.as_deref(), Some("booster_wallet"));
        assert_eq!(wallet.used, Some(8.0));
        assert_eq!(wallet.total, Some(50.0));
        assert_eq!(wallet.remaining, Some(12.34));
        assert_eq!(wallet.unit.as_deref(), Some("USD"));
        assert_eq!(wallet.is_valid, Some(true));
        assert!(wallet.resets_at.is_none());
    }

    #[test]
    fn kimi_coding_quota_ratio_above_one_is_percent() {
        // 防御：>1 的 used_ratio 视为已是百分数，不再乘 100。
        let body = json!({
            "usages": { "limit_5h": { "used_ratio": 42.0 } }
        });
        let tiers = parse_kimi_coding(&body);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].used, Some(42.0));
    }

    #[test]
    fn kimi_coding_quota_missing_windows_falls_back_to_legacy() {
        // usages 存在但没有任何可解析条目 → 回退旧结构解析。
        let body = json!({
            "usages": { "limit_5h": {} },
            "usage": { "limit": 1000, "remaining": 900, "resetTime": "2026-08-01T00:00:00Z" }
        });
        let tiers = parse_kimi_coding(&body);
        assert_eq!(tiers.len(), 1);
        assert_eq!(tiers[0].plan_name.as_deref(), Some("weekly_limit"));
        assert_eq!(tiers[0].used, Some(10.0));
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
    fn extract_reset_time_accepts_numeric_strings_and_floats() {
        let expected = extract_reset_time(&json!(1_754_000_000i64)).unwrap();
        // 字符串秒（某些接口把时间戳当字符串下发）
        assert_eq!(
            extract_reset_time(&json!("1754000000")).as_deref(),
            Some(expected.as_str())
        );
        // 浮点秒（serde 里 1754000000.0 不是 i64）
        assert_eq!(
            extract_reset_time(&json!(1_754_000_000.0)).as_deref(),
            Some(expected.as_str())
        );
        // 字符串毫秒
        assert_eq!(
            extract_reset_time(&json!("1754000000000")).as_deref(),
            Some(expected.as_str())
        );
        // ISO 字符串原样返回（多家供应商共用此函数，行为不得变）
        assert_eq!(
            extract_reset_time(&json!("2026-08-01T00:00:00Z")).as_deref(),
            Some("2026-08-01T00:00:00Z")
        );
        // 字符串 0 / 负数同样视为无重置时间
        assert_eq!(extract_reset_time(&json!("0")), None);
        assert_eq!(extract_reset_time(&json!("-1")), None);
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

    #[test]
    fn opencode_go_parses_three_windows() {
        // 真实 key 实测样例（2026-08）：percent 为已用百分比，直接透传
        let body = json!({
            "usage": {
                "rolling": { "status": "ok", "percent": 9, "resetsAt": "2026-08-18T06:09:19.735Z" },
                "weekly": { "status": "ok", "percent": 5, "resetsAt": "2026-08-24T00:00:00.735Z" },
                "monthly": { "status": "ok", "percent": 59, "resetsAt": "2026-08-27T03:33:50.735Z" }
            }
        });
        let tiers = parse_opencode_go(&body);
        assert_eq!(tiers.len(), 3);
        assert_eq!(tiers[0].plan_name.as_deref(), Some("five_hour"));
        assert_eq!(tiers[0].used, Some(9.0));
        assert_eq!(tiers[0].total, Some(100.0));
        assert_eq!(tiers[0].remaining, Some(91.0));
        assert_eq!(
            tiers[0].resets_at.as_deref(),
            Some("2026-08-18T06:09:19.735Z")
        );
        assert_eq!(tiers[1].plan_name.as_deref(), Some("weekly_limit"));
        assert_eq!(tiers[1].used, Some(5.0));
        assert_eq!(tiers[1].remaining, Some(95.0));
        assert_eq!(tiers[2].plan_name.as_deref(), Some("monthly_limit"));
        assert_eq!(tiers[2].used, Some(59.0));
        assert_eq!(tiers[2].remaining, Some(41.0));
    }

    #[test]
    fn opencode_go_tolerates_missing_status_field() {
        // status 属展示字段，缺失照常解析（percent/resetsAt 都只要求本身存在）
        let body = json!({
            "usage": {
                "rolling": { "percent": 9, "resetsAt": "2026-08-18T06:09:19.735Z" },
                "weekly": { "percent": 5, "resetsAt": "2026-08-24T00:00:00.735Z" },
                "monthly": { "percent": 59, "resetsAt": "2026-08-27T03:33:50.735Z" }
            }
        });
        let tiers = parse_opencode_go(&body);
        assert_eq!(tiers.len(), 3);
        assert_eq!(tiers[1].plan_name.as_deref(), Some("weekly_limit"));
        assert_eq!(tiers[2].used, Some(59.0));
    }

    #[test]
    fn opencode_go_partial_windows_only_emit_present_ones() {
        // 单窗口缺失只出两条；percent 缺失 / 非数字的窗口整窗跳过
        let body = json!({
            "usage": {
                "rolling": { "status": "ok", "percent": "9", "resetsAt": "2026-08-18T06:09:19.735Z" },
                "monthly": { "status": "ok", "resetsAt": "2026-08-27T03:33:50.735Z" }
            }
        });
        let tiers = parse_opencode_go(&body);
        assert_eq!(tiers.len(), 1);
        // percent 以字符串给出也兼容（parse_f64）
        assert_eq!(tiers[0].plan_name.as_deref(), Some("five_hour"));
        assert_eq!(tiers[0].used, Some(9.0));
    }

    #[test]
    fn opencode_go_missing_usage_is_deterministic_failure_with_preview() {
        // usage 全缺：确定性失败，附原始响应预览（400 字内，无密钥）
        let body = json!({ "error": { "message": "boom" } });
        assert!(parse_opencode_go(&body).is_empty());
        let err = opencode_go_empty_failure(&body);
        assert!(!err.success);
        assert!(err.data.is_none());
        let msg = err.error.unwrap();
        assert!(msg.contains("原始返回"), "msg: {msg}");
        assert!(msg.contains(r#""message":"boom""#), "msg: {msg}");
    }

    #[test]
    fn goat_parses_balance_and_two_windows() {
        // resetAt 秒级时间戳与 ISO 字符串各来一个，验证 extract_reset_time 兼容。
        let body = json!({
            "credits": { "monthlyCredits": 100, "purchasedCredits": 5, "freeCredits": 2 },
            "windowLimits": {
                "fiveHour": { "used": 10, "cap": 50, "resetAt": 1_754_000_000i64 },
                "weekly": { "used": "100", "cap": "500", "resetAt": "2026-10-01T00:00:00Z" }
            }
        });
        let rows = parse_goat(&body).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].plan_name.as_deref(), Some("GOAT"));
        assert_eq!(rows[0].remaining, Some(100.0));
        assert_eq!(rows[0].unit.as_deref(), Some("USD"));
        assert_eq!(rows[0].is_valid, Some(true));
        // 余额行没有窗口语义，total/used 留空
        assert_eq!(rows[0].total, None);
        assert_eq!(rows[0].used, None);
        assert_eq!(rows[1].plan_name.as_deref(), Some("five_hour"));
        assert_eq!(rows[1].used, Some(20.0));
        assert_eq!(rows[1].remaining, Some(80.0));
        assert!(rows[1].resets_at.is_some());
        assert_eq!(rows[2].plan_name.as_deref(), Some("weekly_limit"));
        assert_eq!(rows[2].used, Some(20.0));
        assert_eq!(
            rows[2].resets_at.as_deref(),
            Some("2026-10-01T00:00:00Z")
        );
    }

    #[test]
    fn goat_balance_falls_back_through_field_chain() {
        // credits 缺失时 body 本身就是 credits 对象；回退链最后一档命中。
        let body = json!({ "availableCredits": "12.5" });
        let rows = parse_goat(&body).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].plan_name.as_deref(), Some("GOAT"));
        assert_eq!(rows[0].remaining, Some(12.5));

        // monthlyCredits 优先于其余字段
        let body = json!({ "credits": { "availableCredits": 3, "monthlyCredits": 7 } });
        assert_eq!(parse_goat(&body).unwrap()[0].remaining, Some(7.0));

        // 余额 0 是「用完了」，仍是取到了数据 → is_valid 为 true（否则前端会
        // 显示「API Key 无效」，与同一份窗口数据自相矛盾）。
        let body = json!({ "credits": { "balance": 0 } });
        let rows = parse_goat(&body).unwrap();
        assert_eq!(rows[0].remaining, Some(0.0));
        assert_eq!(rows[0].is_valid, Some(true));
    }

    #[test]
    fn goat_null_credits_falls_back_to_body() {
        // credits 显式为 null 的扁平载荷：必须回退到 body 取额度字段。
        let body = json!({ "credits": null, "monthlyCredits": 7 });
        let rows = parse_goat(&body).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].plan_name.as_deref(), Some("GOAT"));
        assert_eq!(rows[0].remaining, Some(7.0));
        assert_eq!(rows[0].is_valid, Some(true));
    }

    #[test]
    fn goat_skips_window_without_positive_cap() {
        let body = json!({
            "windowLimits": {
                "fiveHour": { "used": 10, "cap": 0 },
                "weekly": { "used": 10 }
            }
        });
        // 两个窗口都算不出比例、也没有额度字段 → 确定性失败
        let err = parse_goat(&body).unwrap_err();
        assert!(!err.success);
        assert!(err.error.unwrap().contains("raw body"));

        // 有额度时只跳过窗口，余额行照出
        let body = json!({
            "credits": { "monthlyCredits": 5 },
            "windowLimits": { "fiveHour": { "used": 10, "cap": 0 } }
        });
        let rows = parse_goat(&body).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].plan_name.as_deref(), Some("GOAT"));
    }

    #[test]
    fn goat_clamps_window_percent_to_100() {
        let body = json!({ "windowLimits": { "fiveHour": { "used": 80, "cap": 50 } } });
        let rows = parse_goat(&body).unwrap();
        assert_eq!(rows[0].used, Some(100.0));
        assert_eq!(rows[0].remaining, Some(0.0));
    }

    #[test]
    fn goat_empty_body_is_deterministic_failure() {
        let body = json!({ "error": { "message": "boom" } });
        let err = parse_goat(&body).unwrap_err();
        assert!(!err.success);
        assert!(err.data.is_none());
        let msg = err.error.unwrap();
        assert!(msg.contains("raw body"), "msg: {msg}");
        assert!(msg.contains(r#""message":"boom""#), "msg: {msg}");
    }

    #[test]
    fn ollama_cloud_parses_ratio_windows_and_cost() {
        let body = json!({
            "activity": { "cost": 0.0, "period": "month" },
            "limits": { "session": { "usage": 0.42 }, "weekly": { "usage": 0.1 } }
        });
        let rows = parse_ollama_cloud(&body, 0).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].plan_name.as_deref(), Some("five_hour"));
        assert!((rows[0].used.unwrap() - 42.0).abs() < 0.001);
        assert!((rows[0].remaining.unwrap() - 58.0).abs() < 0.001);
        assert!(rows[0].resets_at.is_some());
        assert_eq!(rows[1].plan_name.as_deref(), Some("weekly_limit"));
        assert!((rows[1].used.unwrap() - 10.0).abs() < 0.001);
        assert!(rows[1].resets_at.is_some());
        // 近期消费行垫在窗口之后（订阅套餐没有余额概念）
        assert_eq!(rows[2].plan_name.as_deref(), Some("recent_spend"));
        assert_eq!(rows[2].remaining, Some(0.0));
        assert_eq!(rows[2].unit.as_deref(), Some("USD"));
    }

    #[test]
    fn ollama_cloud_ratio_above_one_is_already_percent() {
        let body = json!({ "limits": { "session": { "usage": 42 }, "weekly": { "usage": "7" } } });
        let rows = parse_ollama_cloud(&body, 0).unwrap();
        assert_eq!(rows.len(), 2);
        assert!((rows[0].used.unwrap() - 42.0).abs() < 0.001);
        assert!((rows[1].used.unwrap() - 7.0).abs() < 0.001);
        // 无 activity.cost → 不产金额行
        assert!(rows.iter().all(|r| r.plan_name.as_deref() != Some("recent_spend")));
    }

    #[test]
    fn ollama_cloud_reset_schedule_boundaries() {
        // session：5 小时与 epoch 对齐，正好落在边界上时取下一个窗口。
        assert_eq!(ollama_session_reset_secs(0), 18_000);
        assert_eq!(ollama_session_reset_secs(1), 18_000);
        assert_eq!(ollama_session_reset_secs(18_000), 36_000);
        // weekly：7 天周期 + 4 天 epoch 偏移；offset 处即窗口起点。
        assert_eq!(ollama_weekly_reset_secs(4 * 86_400), 4 * 86_400 + 604_800);
        // t=0 时窗口已走了 -345600 mod 604800 → 距下一个边界 950400 秒
        assert_eq!(ollama_weekly_reset_secs(0), 950_400);
    }

    #[test]
    fn ollama_cloud_missing_windows_is_deterministic_failure_with_preview() {
        // 只有 activity.cost、两个窗口都缺 → 确定性失败（附预览）
        let body = json!({ "activity": { "cost": 1.5 } });
        let err = parse_ollama_cloud(&body, 0).unwrap_err();
        assert!(!err.success);
        let msg = err.error.unwrap();
        assert!(msg.contains("raw body"), "msg: {msg}");
        assert!(msg.contains(r#""cost":1.5"#), "msg: {msg}");
    }
}
