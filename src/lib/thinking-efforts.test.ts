import { describe, expect, it } from "vitest";
import {
  THINKING_EFFORTS,
  normalizeSupportEfforts,
  readSupportEfforts,
  resolveThinkingEffortSupport,
} from "./thinking-efforts";

// ---------------------------------------------------------------------------
// support_efforts normalization — an absent / malformed key means "unknown",
// never "no tiers supported"
// ---------------------------------------------------------------------------

describe("normalizeSupportEfforts", () => {
  it("keeps a non-empty list of strings", () => {
    expect(normalizeSupportEfforts(["low", "high"])).toEqual(["low", "high"]);
  });

  it("drops blanks and non-strings but keeps the order", () => {
    expect(normalizeSupportEfforts(["low", "", 3, null, "max"])).toEqual([
      "low",
      "max",
    ]);
  });

  it("returns null for absent / empty / non-array values", () => {
    expect(normalizeSupportEfforts(undefined)).toBeNull();
    expect(normalizeSupportEfforts([])).toBeNull();
    expect(normalizeSupportEfforts(["  "])).toBeNull();
    expect(normalizeSupportEfforts("low")).toBeNull();
  });
});

describe("readSupportEfforts", () => {
  const model = (raw_other: unknown) =>
    ({ alias: "a", provider: "p", model: "m", max_context_size: 0, display_name: null, raw_other }) as const;

  it("reads the key from a model entry's preserved config fields", () => {
    expect(readSupportEfforts(model({ support_efforts: ["low", "max"] }))).toEqual([
      "low",
      "max",
    ]);
  });

  it("returns null when the entry or the key is absent", () => {
    expect(readSupportEfforts(undefined)).toBeNull();
    expect(readSupportEfforts(model(undefined))).toBeNull();
    expect(readSupportEfforts(model({ other: 1 }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tier resolution — three layers, in priority order
// ---------------------------------------------------------------------------

describe("resolveThinkingEffortSupport — declared support_efforts wins", () => {
  const support = resolveThinkingEffortSupport({
    supportEfforts: ["low", "high", "max"],
    reasoning: true,
  });

  it("exposes the declared list and keeps thinking enabled", () => {
    expect(support.declared).toEqual(["low", "high", "max"]);
    expect(support.thinkingSupported).toBe(true);
  });

  it("enables exactly the declared tiers", () => {
    for (const tier of THINKING_EFFORTS) {
      expect(support.levels[tier].enabled).toBe(tier === "low" || tier === "high" || tier === "max");
    }
  });

  it("explains a disabled tier with the supported list", () => {
    expect(support.levels.medium).toEqual({
      enabled: false,
      note: { kind: "tierUnsupported", supported: ["low", "high", "max"] },
    });
    expect(support.levels.xhigh.enabled).toBe(false);
  });

  it("does not disable thinking even when models.dev says reasoning: false", () => {
    const conflicting = resolveThinkingEffortSupport({
      supportEfforts: ["high"],
      reasoning: false,
    });
    expect(conflicting.thinkingSupported).toBe(true);
    expect(conflicting.levels.low.enabled).toBe(false);
    expect(conflicting.levels.high.enabled).toBe(true);
  });

  it("matches tiers case-insensitively", () => {
    const upper = resolveThinkingEffortSupport({ supportEfforts: ["HIGH"] });
    expect(upper.levels.high.enabled).toBe(true);
  });
});

describe("resolveThinkingEffortSupport — model without thinking", () => {
  const support = resolveThinkingEffortSupport({ reasoning: false });

  it("disables the whole thinking area", () => {
    expect(support.thinkingSupported).toBe(false);
    expect(support.declared).toBeNull();
    for (const tier of THINKING_EFFORTS) {
      expect(support.levels[tier]).toEqual({
        enabled: false,
        note: { kind: "thinkingUnsupported" },
      });
    }
  });
});

describe("resolveThinkingEffortSupport — nothing known about the model", () => {
  it("offers low/medium/high plain and flags max/xhigh as undeclared", () => {
    const support = resolveThinkingEffortSupport({});
    expect(support.thinkingSupported).toBe(true);
    expect(support.declared).toBeNull();
    for (const tier of ["low", "medium", "high"] as const) {
      expect(support.levels[tier]).toEqual({ enabled: true });
    }
    for (const tier of ["max", "xhigh"] as const) {
      expect(support.levels[tier]).toEqual({
        enabled: true,
        note: { kind: "tierUndeclared" },
      });
    }
  });

  it("treats an undefined reasoning flag as unknown, not as unsupported", () => {
    expect(
      resolveThinkingEffortSupport({ reasoning: undefined }).thinkingSupported
    ).toBe(true);
  });

  it("ignores a malformed support_efforts value and falls back to unknown", () => {
    const support = resolveThinkingEffortSupport({ supportEfforts: "low" });
    expect(support.declared).toBeNull();
    expect(support.levels.low).toEqual({ enabled: true });
  });
});
