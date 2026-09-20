import { describe, expect, it } from "vitest";
import {
  localizeHealthError,
  probeLine,
  usageLine,
  healthDotClass,
  type CheckResult,
} from "./useHealthCheck";

/**
 * 只回显 key，便于断言选中的是哪条文案（真实插值由 i18n Provider 负责）。
 */
const t = ((key: string) => `<${key}>`) as unknown as Parameters<
  typeof localizeHealthError
>[1];

/** 带插值的假 t：`<key|{a}=1>`，用于断言参数透传。 */
const tWithVars = ((key: string, vars?: Record<string, string | number>) =>
  vars
    ? `<${key}|${Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")}>`
    : `<${key}>`) as unknown as Parameters<typeof localizeHealthError>[1];

describe("localizeHealthError", () => {
  it("探活错误按前缀映射到对应文案", () => {
    expect(localizeHealthError("missing base_url", t)).toBe(
      "<healthErrNoBaseUrl>"
    );
    expect(localizeHealthError("no API key configured", t)).toBe(
      "<healthErrNoKey>"
    );
    expect(localizeHealthError("Authentication failed (HTTP 401)", t)).toBe(
      "<healthErrAuth>"
    );
    expect(localizeHealthError("endpoint not found (HTTP 404)", t)).toBe(
      "<healthErrNotFound>"
    );
    expect(localizeHealthError("request timed out", t)).toBe(
      "<healthErrTimeout>"
    );
    expect(
      localizeHealthError("connection failed (DNS or refused)", t)
    ).toBe("<healthErrUnreachable>");
    expect(localizeHealthError("response is not valid JSON", t)).toBe(
      "<healthErrBadJson>"
    );
  });

  it("未知错误原样透出（HTTP 状态码等诊断细节）", () => {
    expect(localizeHealthError("API error (HTTP 502)", t)).toBe(
      "API error (HTTP 502)"
    );
  });

  it("探活 + 账单两段拼接时逐段映射", () => {
    expect(
      localizeHealthError(
        "endpoint not found (HTTP 404); usage query disabled in config panel",
        t
      )
    ).toBe("<healthErrNotFound>; <usageErrDisabled>");
  });

  it("账单链路的报错复用用量错误映射", () => {
    // commands.rs 的 kinds 循环会把单条错误包成 `{kind}: {msg}`。
    expect(
      localizeHealthError(
        "Authentication failed (HTTP 401); balance:deepseek: Authentication failed (HTTP 401)",
        t
      )
    ).toBe("<healthErrAuth>; <usageInvalidKey>");
  });
});

describe("probeLine", () => {
  it("通过时带延迟", () => {
    expect(probeLine({ state: "pass" }, 123, tWithVars)).toBe(
      "<healthProbeOk|latency=123>"
    );
  });

  it("中性（404）说明端点不支持模型列表，而不是报失败", () => {
    expect(
      probeLine(
        { state: "neutral", error: "endpoint not found (HTTP 404)" },
        0,
        tWithVars
      )
    ).toBe("<healthProbeUnsupported>");
  });

  it("失败时透出本地化后的原因", () => {
    expect(
      probeLine({ state: "fail", error: "request timed out" }, 0, tWithVars)
    ).toBe("<healthProbeFail|error=<healthErrTimeout>>");
  });
});

describe("usageLine", () => {
  it("通过 / 失败 / 兜底三态", () => {
    const pass: CheckResult = { state: "pass" };
    expect(usageLine(pass, tWithVars)).toBe("<healthUsageOk>");

    expect(
      usageLine(
        { state: "fail", error: "Authentication failed (HTTP 401)" },
        tWithVars
      )
    ).toBe("<healthUsageFail|error=<healthErrAuth>>");

    // 账单链路不会产生中性结论，兜底按「未判定」展示
    expect(usageLine({ state: "neutral" }, tWithVars)).toBe(
      "<healthNotChecked>"
    );
  });
});

describe("healthDotClass", () => {
  it("绿=通过、红=失败、灰=未判定（中性）", () => {
    expect(healthDotClass("pass")).toBe("bg-green-500");
    expect(healthDotClass("fail")).toBe("bg-red-500");
    expect(healthDotClass("neutral")).toBe("bg-gray-400 dark:bg-gray-500");
  });
});
