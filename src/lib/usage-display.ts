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
 * from TIER_FIVE_HOUR / TIER_WEEKLY_LIMIT — so this mapping covers every
 * current and future plan provider automatically. If a new tier id is ever
 * added there, add a case here too.
 */
export function planLabel(name: string, t: TranslateFn): string {
  switch (name) {
    case "five_hour":
      return t("usageTier5h");
    case "weekly_limit":
      return t("usageTierWeekly");
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
  if (error.startsWith("unsupported provider")) return t("usageUnsupportedProvider");
  if (error.startsWith("no API key configured")) return t("usageErrNoKey");
  if (error.startsWith("usage query disabled")) return t("usageErrDisabled");
  if (/login expired|refresh failed/i.test(error)) return t("usageErrLoginExpired");
  if (error.startsWith("no Kimi Code OAuth credentials")) return t("usageErrNoOauth");
  if (error.startsWith("newapi template requires")) return t("usageErrNewapiCreds");
  if (error.startsWith("Authentication failed")) return t("usageInvalidKey");
  return error;
}
