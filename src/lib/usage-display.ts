import type { TranslationKey } from "../i18n/zh";

type TranslateFn = (
  key: TranslationKey,
  vars?: Record<string, string | number>
) => string;

/**
 * Kimi quota 的加力钱包行 id（src-tauri/src/services/coding_plan.rs 的
 * PLAN_BOOSTER_WALLET）。它是金额行而非配额百分比行，planLabel() 与
 * UsageFooter 的金额行判定共用此常量，避免字面量散落。
 */
export const BOOSTER_WALLET_PLAN = "booster_wallet";

/**
 * 金额行 vs 配额行：NewAPI 的钱包行与 Kimi 加力钱包（booster_wallet）只报金额，
 * 其 used/total 是钱数而不是配额比例，必须走 formatAmount 渲染路径。
 *
 * 注意 NewAPI 站点同时有钱包与订阅两套账：钱包行的 planName 是 "NewAPI"（金额），
 * 订阅行是 "subscription"（`unit="%"` 的配额占比），后者不在此列表内，正常走
 * 百分比渲染。判定只能看 planName —— sub2api 的 USD 行 unit 同样不是 "%"，但语义
 * 仍是「额度用了百分之多少」，按 unit 判定会把它误渲染成余额。
 */
export function isMoneyRow(d: { planName?: string | null }): boolean {
  return d.planName === "NewAPI" || d.planName === BOOSTER_WALLET_PLAN;
}

/** 额度/配额行：有 planName、非金额行，且报了 total 或 used。 */
export function isPlanRow(d: {
  planName?: string | null;
  total?: number | null;
  used?: number | null;
}): boolean {
  return !!d.planName && !isMoneyRow(d) && (d.total != null || d.used != null);
}

/**
 * 配额行的「已用百分比」。优先 used/total，其次由 remaining/total 反推；
 * total 缺失或 ≤0（无法算比例）返回 null。金额行不应调用此函数。
 */
export function percentOf(d: {
  used?: number | null;
  total?: number | null;
  remaining?: number | null;
}): number | null {
  if (d.used != null && d.total != null && d.total > 0)
    return (d.used / d.total) * 100;
  if (d.remaining != null && d.total != null && d.total > 0)
    return (1 - d.remaining / d.total) * 100;
  return null;
}

/**
 * Map a raw Rust plan/tier name to a localized label. Unknown names (proper
 * nouns like "OpenRouter", "NewAPI", currency codes) pass through unchanged.
 *
 * Coverage note: ALL plan-type (套餐) queries flow through
 * src-tauri/src/services/coding_plan.rs::percent_tier, whose names come only
 * from TIER_FIVE_HOUR / TIER_WEEKLY_LIMIT / TIER_MONTHLY_LIMIT /
 * TIER_MONTH_CODE — so the fixed tiers are covered here. The other cases come
 * from src-tauri/src/services/balance.rs: `booster_wallet` (Kimi 加力钱包) and
 * `subscription` (NewAPI 订阅套餐额度行). If a new tier id is added anywhere,
 * add a case here too.
 */
export function planLabel(name: string, t: TranslateFn): string {
  switch (name) {
    case "five_hour":
      return t("usageTier5h");
    case "daily_limit":
      return t("usageTierDaily");
    case "weekly_limit":
      return t("usageTierWeekly");
    case "monthly_limit":
      return t("usageTierMonthly");
    case "month_code":
      return t("usageTierMonthCode");
    case BOOSTER_WALLET_PLAN:
      return t("usageTierBoosterWallet");
    case "subscription":
      return t("usageTierSubscription");
    default:
      return name;
  }
}

/**
 * Map known Rust error strings to localized text. Unknown errors pass
 * through unchanged (they are diagnostic details like HTTP status + body).
 * Keep patterns aligned with the exact prefixes emitted in
 * src-tauri/src/commands.rs and src-tauri/src/services/*.
 */
export function localizeUsageError(error: string, t: TranslateFn): string {
  // commands.rs 的 kinds 循环把单条错误包成 `{kind}: {msg}`（kind 含数字，
  // 如 plan:zhipu），先剥离再按前缀匹配；未知错误仍回退按原文展示（保留 kind
  // 前缀，属诊断细节）。
  const stripped = error.replace(/^(balance|plan):[a-z0-9_]+:\s*/, "");
  if (stripped.startsWith("unsupported provider")) return t("usageUnsupportedProvider");
  if (stripped.startsWith("no API key configured")) return t("usageErrNoKey");
  if (stripped.startsWith("usage query disabled")) return t("usageErrDisabled");
  if (/login expired|refresh failed/i.test(stripped)) return t("usageErrLoginExpired");
  if (stripped.startsWith("no Kimi Code OAuth credentials")) return t("usageErrNoOauth");
  if (stripped.startsWith("newapi template requires")) return t("usageErrNewapiCreds");
  if (stripped.startsWith("Authentication failed")) return t("usageInvalidKey");
  return error;
}

/**
 * Format a usage amount with its unit. `¤` (U+00A4) is NewAPI's placeholder
 * when the site has no custom currency symbol configured — treat it as "no
 * symbol" and render only the number.
 */
export function formatAmount(
  value: number | null | undefined,
  unit?: string | null
): string {
  if (value == null) return "—";
  const symbol =
    unit === "CNY" ? "¥" : unit === "USD" ? "$" : unit && unit.trim() !== "¤" ? `${unit} ` : "";
  const num = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${symbol}${num}`;
}
