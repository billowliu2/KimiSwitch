// Adapted from cc-switch (MIT, © Jason Young)
// https://github.com/farion1231/cc-switch

//! 供应商账单/用量查询统一入口。
//!
//! - [`UsageKind`]：8 种查询类型，字符串形式与前端 / SQLite settings 约定一致
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
    PlanKimiCoding,
    PlanZhipu,
    PlanMinimax,
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
            UsageKind::PlanKimiCoding => "plan:kimi_coding",
            UsageKind::PlanZhipu => "plan:zhipu",
            UsageKind::PlanMinimax => "plan:minimax",
        }
    }

    pub const ALL: [UsageKind; 8] = [
        UsageKind::BalanceDeepseek,
        UsageKind::BalanceSiliconflow,
        UsageKind::BalanceOpenrouter,
        UsageKind::BalanceStepfun,
        UsageKind::BalanceNovita,
        UsageKind::PlanKimiCoding,
        UsageKind::PlanZhipu,
        UsageKind::PlanMinimax,
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
            "plan:kimi_coding" => UsageKind::PlanKimiCoding,
            "plan:zhipu" => UsageKind::PlanZhipu,
            "plan:minimax" => UsageKind::PlanMinimax,
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
    if url.contains("api.stepfun.com") {
        kinds.push(UsageKind::BalanceStepfun);
    }
    if url.contains("api.novita.ai") {
        kinds.push(UsageKind::BalanceNovita);
    }
    if url.contains("api.kimi.com") && url.contains("/coding") {
        kinds.push(UsageKind::PlanKimiCoding);
    }
    if url.contains("open.bigmodel.cn") || url.contains("api.z.ai") {
        kinds.push(UsageKind::PlanZhipu);
    }
    if url.contains("api.minimaxi.com") {
        kinds.push(UsageKind::PlanMinimax);
    }
    kinds
}

/// 按 kind 路由到对应查询实现。`base_url` 用于消歧同一家供应商的
/// 国内/海外站（SiliconFlow .cn/.com、MiniMax .com/.io、智谱 bigmodel/z.ai）。
pub async fn query_kind(
    kind: UsageKind,
    base_url: &str,
    api_key: &str,
) -> Result<UsageResult, String> {
    let lower = base_url.to_lowercase();
    match kind {
        UsageKind::BalanceDeepseek => balance::query_deepseek(api_key).await,
        UsageKind::BalanceSiliconflow => {
            balance::query_siliconflow(api_key, !lower.contains("siliconflow.com")).await
        }
        UsageKind::BalanceOpenrouter => balance::query_openrouter(api_key).await,
        UsageKind::BalanceStepfun => balance::query_stepfun(api_key).await,
        UsageKind::BalanceNovita => balance::query_novita(api_key).await,
        UsageKind::PlanKimiCoding => coding_plan::query_kimi_coding(api_key).await,
        UsageKind::PlanZhipu => coding_plan::query_zhipu(base_url, api_key).await,
        UsageKind::PlanMinimax => {
            coding_plan::query_minimax(api_key, !lower.contains("minimax.io")).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_provider_maps_known_hosts() {
        let cases: [(&str, UsageKind); 8] = [
            ("https://api.deepseek.com/v1", UsageKind::BalanceDeepseek),
            ("https://api.siliconflow.cn/v1", UsageKind::BalanceSiliconflow),
            ("https://openrouter.ai/api/v1", UsageKind::BalanceOpenrouter),
            ("https://api.stepfun.com/v1", UsageKind::BalanceStepfun),
            ("https://api.novita.ai/v3", UsageKind::BalanceNovita),
            ("https://api.kimi.com/coding/v1", UsageKind::PlanKimiCoding),
            (
                "https://open.bigmodel.cn/api/paas/v4",
                UsageKind::PlanZhipu,
            ),
            ("https://api.minimaxi.com/v1", UsageKind::PlanMinimax),
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
        // api.kimi.com 但无 /coding 路径 → 不命中套餐查询
        assert!(detect_provider("https://api.kimi.com/v1").is_empty());
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
}
