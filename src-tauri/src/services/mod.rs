// Adapted from cc-switch (MIT, © Jason Young)
// https://github.com/farion1231/cc-switch

//! 供应商账单/用量查询统一入口。
//!
//! - [`UsageKind`]：11 种查询类型，字符串形式与前端 / SQLite settings 约定一致
//!   （如 `"balance:deepseek"`、`"plan:kimi_coding"`）。
//! - [`detect_provider`]：按 base_url host 子串匹配，旧用户无显式配置时自动识别。
//! - [`query_kind`]：按 kind 路由到 balance / coding_plan 的具体实现。

pub mod balance;
pub mod coding_plan;
pub mod usage_types;

pub use usage_types::{UsageData, UsageResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UsageKind {
    BalanceDeepseek,
    BalanceSiliconflow,
    BalanceOpenrouter,
    BalanceStepfun,
    BalanceNovita,
    BalanceKimi,
    BalanceNewapi,
    PlanKimiCoding,
    PlanZhipu,
    PlanMinimax,
    PlanOpencodeGo,
}

impl UsageKind {
    /// 与前端 / SQLite settings（`usage_kinds:<provider_name>`）约定的字符串形式。
    pub fn as_str(&self) -> &'static str {
        match self {
            UsageKind::BalanceDeepseek => "balance:deepseek",
            UsageKind::BalanceSiliconflow => "balance:siliconflow",
            UsageKind::BalanceOpenrouter => "balance:openrouter",
            UsageKind::BalanceStepfun => "balance:stepfun",
            UsageKind::BalanceNovita => "balance:novita",
            UsageKind::BalanceKimi => "balance:kimi",
            UsageKind::BalanceNewapi => "balance:newapi",
            UsageKind::PlanKimiCoding => "plan:kimi_coding",
            UsageKind::PlanZhipu => "plan:zhipu",
            UsageKind::PlanMinimax => "plan:minimax",
            UsageKind::PlanOpencodeGo => "plan:opencode_go",
        }
    }

    pub const ALL: [UsageKind; 11] = [
        UsageKind::BalanceDeepseek,
        UsageKind::BalanceSiliconflow,
        UsageKind::BalanceOpenrouter,
        UsageKind::BalanceStepfun,
        UsageKind::BalanceNovita,
        UsageKind::BalanceKimi,
        UsageKind::BalanceNewapi,
        UsageKind::PlanKimiCoding,
        UsageKind::PlanZhipu,
        UsageKind::PlanMinimax,
        UsageKind::PlanOpencodeGo,
    ];
}

impl std::str::FromStr for UsageKind {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "balance:deepseek" => UsageKind::BalanceDeepseek,
            "balance:siliconflow" => UsageKind::BalanceSiliconflow,
            "balance:openrouter" => UsageKind::BalanceOpenrouter,
            "balance:stepfun" => UsageKind::BalanceStepfun,
            "balance:novita" => UsageKind::BalanceNovita,
            "balance:kimi" => UsageKind::BalanceKimi,
            "balance:newapi" => UsageKind::BalanceNewapi,
            "plan:kimi_coding" => UsageKind::PlanKimiCoding,
            "plan:zhipu" => UsageKind::PlanZhipu,
            "plan:minimax" => UsageKind::PlanMinimax,
            "plan:opencode_go" => UsageKind::PlanOpencodeGo,
            _ => return Err(()),
        })
    }
}

/// 按 base_url 子串匹配可支持的查询类型；无匹配返回空 vec。
/// 一个 base_url 理论上可同时命中多种（套餐 + 余额），故返回 Vec。
pub fn detect_provider(base_url: &str) -> Vec<UsageKind> {
    let url = base_url.to_lowercase();
    let mut kinds = Vec::new();
    if url.contains("api.deepseek.com") {
        kinds.push(UsageKind::BalanceDeepseek);
    }
    if url.contains("api.siliconflow.cn") {
        kinds.push(UsageKind::BalanceSiliconflow);
    }
    if url.contains("openrouter.ai") {
        kinds.push(UsageKind::BalanceOpenrouter);
    }
    // codingplan.site 检测为 NewAPI 实例（本工具仅支持 NewAPI 查询）；
    // 家族匹配意味着 ai. 子域也自然命中该规则。
    if url.contains("codingplan.site") {
        kinds.push(UsageKind::BalanceNewapi);
    }
    if url.contains("api.stepfun.com") {
        kinds.push(UsageKind::BalanceStepfun);
    }
    if url.contains("api.novita.ai") {
        kinds.push(UsageKind::BalanceNovita);
    }
    // Kimi 开放平台（Moonshot）：国内站 api.moonshot.cn / 国际站 api.moonshot.ai。
    // 注意别与 api.kimi.com（Kimi Code 官方端点）混淆：后者只有 /coding 路径命中套餐。
    if url.contains("api.moonshot.cn") || url.contains("api.moonshot.ai") {
        kinds.push(UsageKind::BalanceKimi);
    }
    if (url.contains("api.kimi.com") || url.contains("api.kimi.ai"))
        && url.contains("/coding")
    {
        kinds.push(UsageKind::PlanKimiCoding);
    }
    if url.contains("open.bigmodel.cn") || url.contains("api.z.ai") {
        kinds.push(UsageKind::PlanZhipu);
    }
    if url.contains("api.minimaxi.com") {
        kinds.push(UsageKind::PlanMinimax);
    }
    // OpenCode Go 套餐：只认 /zen/go 路径；/zen/v1（OpenCode Zen 按量付费）不得命中。
    if url.contains("/zen/go") {
        kinds.push(UsageKind::PlanOpencodeGo);
    }
    kinds
}

/// BalanceNewapi 模板所需凭据（web 控制台 access token + user id）。
/// 两者都必须存在且非空；返回 None 表示缺少凭据（确定性配置错误）。
fn newapi_creds(
    usage_config: Option<&crate::models::UsageConfig>,
) -> Option<(&str, &str)> {
    usage_config.and_then(|c| {
        c.access_token
            .as_deref()
            .zip(c.user_id.as_deref())
            .filter(|(t, u)| !t.is_empty() && !u.is_empty())
    })
}

/// 按 kind 路由到对应查询实现。`base_url` 用于消歧同一家供应商的
/// 国内/海外站（SiliconFlow .cn/.com、MiniMax .com/.io、智谱 bigmodel/z.ai）。
/// `usage_config` 仅 BalanceNewapi 分支读取（access_token / user_id），
/// 其余分支忽略；调用方在 templateType=="newapi" 时保证其存在。
pub async fn query_kind(
    kind: UsageKind,
    base_url: &str,
    api_key: &str,
    usage_config: Option<&crate::models::UsageConfig>,
) -> Result<UsageResult, String> {
    let lower = base_url.to_lowercase();
    // 用户配置的超时（秒）；0/未配置回退默认 8s。
    let timeout = usage_config
        .and_then(|c| c.timeout_seconds)
        .filter(|&s| s > 0)
        .map(std::time::Duration::from_secs)
        .unwrap_or(balance::REQUEST_TIMEOUT);
    match kind {
        UsageKind::BalanceDeepseek => balance::query_deepseek(api_key, timeout).await,
        UsageKind::BalanceSiliconflow => {
            balance::query_siliconflow(api_key, !lower.contains("siliconflow.com"), timeout).await
        }
        UsageKind::BalanceOpenrouter => balance::query_openrouter(api_key, timeout).await,
        UsageKind::BalanceStepfun => balance::query_stepfun(api_key, timeout).await,
        UsageKind::BalanceNovita => balance::query_novita(api_key, timeout).await,
        UsageKind::BalanceKimi => {
            balance::query_kimi(api_key, !lower.contains("moonshot.ai"), timeout).await
        }
        UsageKind::BalanceNewapi => {
            // 缺凭据是确定性配置错误 → Ok(failure)（前端按前缀本地化提示），
            // 而非 Err（Err 语义 = 瞬时网络错误，见 commands.rs newapi 分支）。
            let Some((token, uid)) = newapi_creds(usage_config) else {
                return Ok(UsageResult::failure(
                    "newapi template requires accessToken and userId".to_string(),
                ));
            };
            let url = usage_config
                .and_then(|c| c.base_url.as_deref())
                .filter(|s| !s.is_empty())
                .unwrap_or(base_url);
            balance::query_newapi(url, token, uid, timeout).await
        }
        UsageKind::PlanKimiCoding => {
            coding_plan::query_kimi_coding(base_url, api_key, timeout).await
        }
        UsageKind::PlanZhipu => coding_plan::query_zhipu(base_url, api_key, timeout).await,
        UsageKind::PlanMinimax => {
            coding_plan::query_minimax(api_key, !lower.contains("minimax.io"), timeout).await
        }
        UsageKind::PlanOpencodeGo => coding_plan::query_opencode_go(api_key, timeout).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_provider_maps_known_hosts() {
        let cases: [(&str, UsageKind); 10] = [
            ("https://api.deepseek.com/v1", UsageKind::BalanceDeepseek),
            ("https://api.siliconflow.cn/v1", UsageKind::BalanceSiliconflow),
            ("https://openrouter.ai/api/v1", UsageKind::BalanceOpenrouter),
            ("https://api.stepfun.com/v1", UsageKind::BalanceStepfun),
            ("https://api.novita.ai/v3", UsageKind::BalanceNovita),
            ("https://api.moonshot.cn/v1", UsageKind::BalanceKimi),
            ("https://api.kimi.com/coding/v1", UsageKind::PlanKimiCoding),
            (
                "https://open.bigmodel.cn/api/paas/v4",
                UsageKind::PlanZhipu,
            ),
            ("https://api.minimaxi.com/v1", UsageKind::PlanMinimax),
            ("https://opencode.ai/zen/go/v1", UsageKind::PlanOpencodeGo),
        ];
        for (url, expected) in cases {
            assert_eq!(
                detect_provider(url),
                vec![expected],
                "url: {url}"
            );
        }
        // z.ai 也命中智谱
        assert_eq!(
            detect_provider("https://api.z.ai/api/paas/v4"),
            vec![UsageKind::PlanZhipu]
        );
    }

    #[test]
    fn detect_provider_unknown_url_returns_empty() {
        assert!(detect_provider("https://api.openai.com/v1").is_empty());
        assert!(detect_provider("https://example.com").is_empty());
        assert!(detect_provider("").is_empty());
        // api.kimi.com 但无 /coding 路径 → 不命中套餐查询，也不命中 Moonshot 余额
        assert!(detect_provider("https://api.kimi.com/v1").is_empty());
    }

    #[test]
    fn detect_provider_kimi_coding_matches_global_ai_host() {
        // global 站 api.kimi.ai + /coding 命中套餐
        assert_eq!(
            detect_provider("https://api.kimi.ai/coding/v1"),
            vec![UsageKind::PlanKimiCoding]
        );
        assert_eq!(
            detect_provider("https://api.kimi.ai/coding/v1/usages"),
            vec![UsageKind::PlanKimiCoding]
        );
        // api.kimi.ai 但无 /coding 路径 → 不命中（也不命中 Moonshot 余额）
        assert!(detect_provider("https://api.kimi.ai/v1").is_empty());
        // .com 老路径不受影响
        assert_eq!(
            detect_provider("https://api.kimi.com/coding/v1"),
            vec![UsageKind::PlanKimiCoding]
        );
    }

    #[test]
    fn detect_provider_opencode_go_excludes_payg_zen() {
        // /zen/go 命中套餐查询
        assert_eq!(
            detect_provider("https://opencode.ai/zen/go/v1"),
            vec![UsageKind::PlanOpencodeGo]
        );
        // /zen/v1（OpenCode Zen 按量付费）不得命中
        assert!(detect_provider("https://opencode.ai/zen/v1").is_empty());
        // 裸域名也命中（go 套餐 base 无 v1 后缀时）
        assert_eq!(
            detect_provider("https://opencode.ai/zen/go"),
            vec![UsageKind::PlanOpencodeGo]
        );
    }

    #[test]
    fn detect_provider_codingplan_site_family() {
        // codingplan.site 是 NewAPI 实例（本工具仅支持 NewAPI 查询）：
        // 主域与 ai. 子域都命中家族规则，且只映射到 BalanceNewapi。
        assert_eq!(
            detect_provider("https://codingplan.site"),
            vec![UsageKind::BalanceNewapi]
        );
        assert_eq!(
            detect_provider("https://codingplan.site/v1"),
            vec![UsageKind::BalanceNewapi]
        );
        assert_eq!(
            detect_provider("https://ai.codingplan.site"),
            vec![UsageKind::BalanceNewapi]
        );
        assert_eq!(
            detect_provider("https://ai.codingplan.site/v1"),
            vec![UsageKind::BalanceNewapi]
        );
    }

    #[test]
    fn usage_kind_string_roundtrip() {
        use std::str::FromStr;
        for kind in UsageKind::ALL {
            let s = kind.as_str();
            assert_eq!(UsageKind::from_str(s), Ok(kind), "kind: {s}");
        }
        assert!(UsageKind::from_str("balance:unknown").is_err());
        assert!(UsageKind::from_str("").is_err());
    }

    #[test]
    fn newapi_creds_requires_both_and_nonempty() {
        use crate::models::UsageConfig;
        let cfg = |token: Option<&str>, uid: Option<&str>| UsageConfig {
            enabled: true,
            template_type: "newapi".to_string(),
            base_url: None,
            access_token: token.map(str::to_string),
            user_id: uid.map(str::to_string),
            auto_query_interval_minutes: None,
            timeout_seconds: None,
        };
        // 缺 config / 缺任一项 / 空字符串 → None（确定性配置错误）
        assert_eq!(newapi_creds(None), None);
        assert_eq!(newapi_creds(Some(&cfg(None, None))), None);
        assert_eq!(newapi_creds(Some(&cfg(Some("tok"), None))), None);
        assert_eq!(newapi_creds(Some(&cfg(None, Some("uid")))), None);
        assert_eq!(newapi_creds(Some(&cfg(Some(""), Some("uid")))), None);
        assert_eq!(newapi_creds(Some(&cfg(Some("tok"), Some("")))), None);
        // 两项齐全 → Some
        assert_eq!(
            newapi_creds(Some(&cfg(Some("tok"), Some("uid")))),
            Some(("tok", "uid"))
        );
    }
}
