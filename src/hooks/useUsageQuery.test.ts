import { describe, expect, it } from "vitest";
import { isAlertTier, usageQuerySupported, type UsageData } from "./useUsageQuery";

/** 百分比窗口行（five_hour 等）；套餐类 tier 的 unit 恒为 "%"。 */
function percentTier(used: number): UsageData {
  return { planName: "five_hour", used, total: 100, remaining: 100 - used, unit: "%" };
}

describe("isAlertTier", () => {
  it("阈值缺省或 0（关闭）时不告警", () => {
    expect(isAlertTier(percentTier(100), undefined)).toBe(false);
    expect(isAlertTier(percentTier(100), null)).toBe(false);
    expect(isAlertTier(percentTier(100), 0)).toBe(false);
  });

  it("低于阈值不告警", () => {
    expect(isAlertTier(percentTier(79), 80)).toBe(false);
    expect(isAlertTier(percentTier(79.9), 80)).toBe(false);
  });

  it("等于或超过阈值告警", () => {
    expect(isAlertTier(percentTier(80), 80)).toBe(true);
    expect(isAlertTier(percentTier(80.5), 80)).toBe(true);
    expect(isAlertTier(percentTier(100), 80)).toBe(true);
  });

  it("非 % unit 的行不告警（金额行的 used 是钱数）", () => {
    // Kimi 加力钱包：used = monthlyUsedCents/100，与百分比阈值不可比。
    expect(
      isAlertTier(
        { planName: "booster_wallet", used: 8, total: 50, remaining: 12.34, unit: "USD" },
        5
      )
    ).toBe(false);
    // sub2api 的 USD 配额行同理，不参与百分比预警。
    expect(
      isAlertTier({ planName: "daily_limit", used: 90, total: 100, unit: "USD" }, 50)
    ).toBe(false);
  });

  it("used 缺失时不告警", () => {
    expect(isAlertTier({ planName: "five_hour", unit: "%", remaining: 20 }, 50)).toBe(false);
  });
});

describe("usageQuerySupported", () => {
  it("有识别类型即可查询", () => {
    expect(usageQuerySupported(["balance:deepseek"])).toBe(true);
    expect(usageQuerySupported([], true)).toBe(true);
  });

  it("显式模板（newapi/sub2api）绕过 usage_kinds——自定义供应商也该查", () => {
    expect(usageQuerySupported(undefined, true)).toBe(true);
  });

  it("无识别类型且非显式模板时不查询", () => {
    expect(usageQuerySupported(undefined)).toBe(false);
    expect(usageQuerySupported([])).toBe(false);
    // auto 模板没有识别到类型 = 不支持（与弹窗短路口径一致）
    expect(usageQuerySupported([], false)).toBe(false);
    expect(usageQuerySupported(undefined, undefined)).toBe(false);
  });
});
