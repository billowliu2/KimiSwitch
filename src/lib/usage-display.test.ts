import { describe, expect, it } from "vitest";
import {
  formatAmount,
  isMoneyRow,
  isPlanRow,
  localizeUsageError,
  percentOf,
  planLabel,
} from "./usage-display";

// Minimal TranslateFn: return the key itself so assertions read the key.
const t = (key: string) => key;

describe("localizeUsageError", () => {
  it("maps known Rust error prefixes to their localization keys", () => {
    expect(
      localizeUsageError("unsupported provider: no usage query available", t)
    ).toBe("usageUnsupportedProvider");
    expect(localizeUsageError("no API key configured", t)).toBe("usageErrNoKey");
    expect(localizeUsageError("usage query disabled in config panel", t)).toBe(
      "usageErrDisabled"
    );
    expect(
      localizeUsageError("no Kimi Code OAuth credentials found; run `kimi login` first", t)
    ).toBe("usageErrNoOauth");
    expect(
      localizeUsageError("newapi template requires accessToken and userId", t)
    ).toBe("usageErrNewapiCreds");
    expect(localizeUsageError("Authentication failed: 401 Unauthorized", t)).toBe(
      "usageInvalidKey"
    );
  });

  it("login expired / refresh failed match case-insensitively anywhere", () => {
    expect(localizeUsageError("LOGIN expired at 12:00", t)).toBe("usageErrLoginExpired");
    expect(localizeUsageError("oauth refresh failed: 500", t)).toBe("usageErrLoginExpired");
  });

  it("strips the kinds-loop `{kind}: ` wrapper before matching", () => {
    // commands.rs 的 kinds 循环把错误包成 "balance:newapi: ..." —— 必须仍命中。
    expect(
      localizeUsageError(
        "balance:newapi: newapi template requires accessToken and userId",
        t
      )
    ).toBe("usageErrNewapiCreds");
    expect(localizeUsageError("plan:zhipu: Authentication failed: 401", t)).toBe(
      "usageInvalidKey"
    );
    expect(localizeUsageError("balance:deepseek: no API key configured", t)).toBe(
      "usageErrNoKey"
    );
  });

  it("passes unknown errors through unchanged (kind prefix retained)", () => {
    const raw = "balance:openrouter: HTTP 429 too many requests";
    expect(localizeUsageError(raw, t)).toBe(raw);
    expect(localizeUsageError("HTTP 500 Something broke", t)).toBe(
      "HTTP 500 Something broke"
    );
  });
});

describe("planLabel", () => {
  it("maps known tier ids and passes unknown names through", () => {
    expect(planLabel("five_hour", t)).toBe("usageTier5h");
    expect(planLabel("weekly_limit", t)).toBe("usageTierWeekly");
    expect(planLabel("monthly_limit", t)).toBe("usageTierMonthly");
    expect(planLabel("booster_wallet", t)).toBe("usageTierBoosterWallet");
    expect(planLabel("subscription", t)).toBe("usageTierSubscription");
    expect(planLabel("NewAPI", t)).toBe("NewAPI");
    expect(planLabel("¥", t)).toBe("¥");
  });
});

describe("isMoneyRow / isPlanRow", () => {
  it("treats the NewAPI wallet and booster wallet as money rows", () => {
    // NewAPI 钱包行只报金额，其 used/total 是钱数，不能当百分比渲染。
    expect(isMoneyRow({ planName: "NewAPI" })).toBe(true);
    expect(isMoneyRow({ planName: "booster_wallet" })).toBe(true);
    expect(isMoneyRow({ planName: "subscription" })).toBe(false);
    expect(isMoneyRow({ planName: "weekly_limit" })).toBe(false);
  });

  it("classifies quota rows by planName, not unit", () => {
    // NewAPI 订阅行：unit="%" → 配额行
    expect(
      isPlanRow({ planName: "subscription", total: 100, used: 41 })
    ).toBe(true);
    // sub2api 订阅窗口：unit 是 USD，但语义仍是配额占比 → 仍算配额行
    expect(
      isPlanRow({ planName: "weekly_limit", total: 50, used: 10 })
    ).toBe(true);
    // 钱包行永远不是配额行，即使带了 total/used
    expect(isPlanRow({ planName: "NewAPI", total: 704, used: 204 })).toBe(false);
    // 无 planName 或无数值 → 非配额行
    expect(isPlanRow({ planName: null, total: 100, used: 1 })).toBe(false);
    expect(isPlanRow({ planName: "x" })).toBe(false);
  });
});

describe("percentOf", () => {
  it("prefers used/total and falls back to remaining/total", () => {
    expect(percentOf({ used: 41, total: 100 })).toBe(41);
    expect(percentOf({ remaining: 59, total: 100 })).toBe(41);
  });

  it("returns null when total is missing or non-positive", () => {
    expect(percentOf({ used: 41 })).toBeNull();
    expect(percentOf({ used: 41, total: 0 })).toBeNull();
    expect(percentOf({})).toBeNull();
  });
});

describe("formatAmount", () => {
  it("maps CNY and USD to ¥/$ with two decimals", () => {
    expect(formatAmount(1.5, "CNY")).toBe("¥1.50");
    expect(formatAmount(1.5, "USD")).toBe("$1.50");
  });

  it("treats ¤ (U+00A4) as no configured currency symbol", () => {
    expect(formatAmount(136907472.01013, "¤")).toBe("136907472.01");
    expect(formatAmount(136907472.01013, "\u{00A4}")).toBe("136907472.01");
  });

  it("prefixes arbitrary units without a symbol", () => {
    // Non-integer so the two-decimal rule applies; rounds to 3.00.
    expect(formatAmount(3.004, "credit")).toBe("credit 3.00");
  });

  it("renders null/undefined values as —", () => {
    expect(formatAmount(null, "¤")).toBe("—");
    expect(formatAmount(undefined, "CNY")).toBe("—");
  });

  it("keeps integers without decimals", () => {
    expect(formatAmount(42, "CNY")).toBe("¥42");
    expect(formatAmount(100, "USD")).toBe("$100");
    expect(formatAmount(7, "")).toBe("7");
  });
});