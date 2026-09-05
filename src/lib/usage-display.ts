import type { TranslationKey } from "../i18n/zh";

type TranslateFn = (
  key: TranslationKey,
  vars?: Record<string, string | number>
) => string;

/**
 * Map a raw Rust plan/tier name to a localized label. Unknown names (proper
 * nouns like "OpenRouter", "NewAPI", currency codes) pass through unchanged.
 *
 * Coverage note: ALL plan-type (套餐) queries flow through
 * src-tauri/src/services/coding_plan.rs::percent_tier, whose names come only
 * from TIER_FIVE_HOUR / TIER_WEEKLY_LIMIT / TIER_MONTHLY_LIMIT — so this
 * mapping covers every current and future plan provider automatically. If a
 * new tier id is ever added there, add a case here too.
 */
export function planLabel(name: string, t: TranslateFn): string {
  switch (name) {
    case "five_hour":
      return t("usageTier5h");
    case "weekly_limit":
      return t("usageTierWeekly");
    case "monthly_limit":
      return t("usageTierMonthly");
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
