import { describe, expect, it } from "vitest";
import { formatAmount, localizeUsageError, planLabel } from "./usage-display";

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
    expect(planLabel("NewAPI", t)).toBe("NewAPI");
    expect(planLabel("¥", t)).toBe("¥");
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