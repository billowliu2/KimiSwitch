import { describe, expect, it } from "vitest";
import type { Config, Model } from "../types";
import type { ModelRef } from "./models-dev";
import {
  PREFERRED_EFFORT,
  TIER_RANK,
  THINKING_EFFORTS,
  effectiveDefaultEffort,
  materializeModelEfforts,
  normalizeSupportEfforts,
  readDefaultEffort,
  readSupportEfforts,
  resolveDefaultTier,
  resolveModelEfforts,
  resolveThinkingEffortSupport,
  seedModelEffort,
  seedModelFromReference,
  setModelEffort,
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

// ---------------------------------------------------------------------------
// Per-model effort defaults — seeded from the model's support_efforts,
// or from models.dev when the model declares none
// ---------------------------------------------------------------------------

/** Minimal model entry; every test overrides only what it cares about. */
function model(over: Partial<Model> = {}): Model {
  return {
    alias: "a",
    provider: "p",
    model: "m",
    max_context_size: 0,
    display_name: null,
    ...over,
  };
}

describe("PREFERRED_EFFORT / TIER_RANK", () => {
  it("prefers high and ranks the known tiers in ascending strength", () => {
    expect(PREFERRED_EFFORT).toBe("high");
    expect(TIER_RANK.minimal).toBeLessThan(TIER_RANK.low);
    expect(TIER_RANK.low).toBeLessThan(TIER_RANK.medium);
    expect(TIER_RANK.medium).toBeLessThan(TIER_RANK.high);
    expect(TIER_RANK.high).toBeLessThan(TIER_RANK.xhigh);
    expect(TIER_RANK.xhigh).toBeLessThan(TIER_RANK.max);
  });
});

describe("resolveDefaultTier", () => {
  it("returns high whenever the model offers it", () => {
    expect(resolveDefaultTier(["minimal", "low", "medium", "high"])).toBe("high");
  });

  it("falls back to the strongest tier when high is missing", () => {
    expect(resolveDefaultTier(["low", "medium", "xhigh"])).toBe("xhigh");
    expect(resolveDefaultTier(["medium", "xhigh"])).toBe("xhigh");
    expect(resolveDefaultTier(["max"])).toBe("max");
    expect(resolveDefaultTier(["low", "medium"])).toBe("medium");
  });

  it("returns undefined for empty / null / undefined lists", () => {
    expect(resolveDefaultTier([])).toBeUndefined();
    expect(resolveDefaultTier(null)).toBeUndefined();
    expect(resolveDefaultTier(undefined)).toBeUndefined();
  });

  it("ignores unknown labels without crashing", () => {
    expect(resolveDefaultTier(["weird", "low"])).toBe("low");
  });
});

describe("effectiveDefaultEffort", () => {
  it("keeps a stored tier the model still supports", () => {
    expect(effectiveDefaultEffort(["low", "high"], "low")).toBe("low");
  });

  it("replaces a stored tier the model no longer supports", () => {
    expect(effectiveDefaultEffort(["low", "high"], "max")).toBe("high");
  });

  it("picks the best tier when nothing is stored", () => {
    expect(effectiveDefaultEffort(["low", "medium"], undefined)).toBe("medium");
  });

  it("returns undefined when the tiers are unknown", () => {
    expect(effectiveDefaultEffort(null, "high")).toBeUndefined();
  });
});

describe("resolveModelEfforts", () => {
  it("prefers the model's own support_efforts over models.dev efforts", () => {
    const resolved = resolveModelEfforts(
      model({ raw_other: { support_efforts: ["low"] } }),
      { efforts: ["high", "max"] }
    );
    expect(resolved.tiers).toEqual(["low"]);
  });

  it("uses the ref's efforts when the model declares no support_efforts", () => {
    const resolved = resolveModelEfforts(model({ raw_other: { other: 1 } }), {
      efforts: ["low", "high"],
      reasoning: true,
    });
    expect(resolved.tiers).toEqual(["low", "high"]);
  });

  it("reports unknown tiers when neither source declares any", () => {
    expect(resolveModelEfforts(model()).tiers).toBeNull();
  });

  it("surfaces the ref's off tier", () => {
    expect(
      resolveModelEfforts(model(), { efforts: ["low"], off_effort: "none" })
        .offEffort
    ).toBe("none");
  });

  it("only calls thinking unsupported on an explicit reasoning: false", () => {
    expect(resolveModelEfforts(model(), { reasoning: false }).thinkingSupported).toBe(
      false
    );
    // A declared tier list outranks the flag.
    expect(
      resolveModelEfforts(model(), { reasoning: false, efforts: ["high"] })
        .thinkingSupported
    ).toBe(true);
    // A local capability flag outranks the flag too.
    expect(
      resolveModelEfforts(model({ capabilities: ["thinking"] }), {
        reasoning: false,
      }).thinkingSupported
    ).toBe(true);
    expect(
      resolveModelEfforts(model({ capabilities: ["always_thinking"] }), {
        reasoning: false,
      }).thinkingSupported
    ).toBe(true);
    // Unknown stays supported.
    expect(resolveModelEfforts(model()).thinkingSupported).toBe(true);
  });
});

describe("readDefaultEffort", () => {
  it("reads a non-empty string and ignores everything else", () => {
    expect(readDefaultEffort(model({ raw_other: { default_effort: "high" } }))).toBe(
      "high"
    );
    expect(readDefaultEffort(model({ raw_other: { default_effort: "" } }))).toBeUndefined();
    expect(readDefaultEffort(model({ raw_other: { default_effort: 3 } }))).toBeUndefined();
    expect(readDefaultEffort(model())).toBeUndefined();
  });
});

describe("setModelEffort", () => {
  it("writes default_effort readable back through readDefaultEffort", () => {
    const next = setModelEffort(model(), "high", ["low", "high"]);
    expect(readDefaultEffort(next)).toBe("high");
  });

  it("keeps an existing non-empty support_efforts", () => {
    const next = setModelEffort(
      model({ raw_other: { support_efforts: ["low"] } }),
      "low",
      ["low", "medium"]
    );
    expect(readSupportEfforts(next)).toEqual(["low"]);
  });

  it("backfills support_efforts when the model had none", () => {
    const next = setModelEffort(model(), "high", ["low", "medium", "high"]);
    expect(readSupportEfforts(next)).toEqual(["low", "medium", "high"]);
  });

  it("preserves every other preserved key", () => {
    const next = setModelEffort(
      model({ raw_other: { max_output_size: 8192, note: "x" } }),
      "high",
      ["high"]
    );
    expect(next.raw_other).toEqual({
      max_output_size: 8192,
      note: "x",
      default_effort: "high",
      support_efforts: ["high"],
    });
  });
});

describe("seedModelEffort", () => {
  it("leaves a valid stored default_effort alone", () => {
    const entry = model({ raw_other: { default_effort: "low" } });
    expect(seedModelEffort(entry, { efforts: ["low", "high"] })).toBe(entry);
  });

  it("replaces an invalid default_effort with the strongest tier", () => {
    const next = seedModelEffort(
      model({ raw_other: { default_effort: "max" } }),
      { efforts: ["low", "medium"] }
    );
    expect(readDefaultEffort(next)).toBe("medium");
  });

  it("seeds the strongest tier when nothing is stored", () => {
    const next = seedModelEffort(model(), { efforts: ["low", "xhigh"] });
    expect(readDefaultEffort(next)).toBe("xhigh");
    expect(readSupportEfforts(next)).toEqual(["low", "xhigh"]);
  });

  it("writes a default_effort inside the model's own support_efforts", () => {
    const next = seedModelEffort(
      model({ raw_other: { support_efforts: ["low"] } }),
      { efforts: ["high", "max"] }
    );
    expect(readDefaultEffort(next)).toBe("low");
    expect(readSupportEfforts(next)).toEqual(["low"]);
  });

  it("is a no-op for models with unknown tiers or on a second run", () => {
    const unknown = model();
    expect(seedModelEffort(unknown)).toBe(unknown);

    const once = seedModelEffort(model(), { efforts: ["low", "high"] });
    expect(seedModelEffort(once, { efforts: ["low", "high"] })).toEqual(once);
  });
});

describe("seedModelFromReference", () => {
  const ref: ModelRef = {
    reasoning: true,
    tool_call: true,
    image: true,
    efforts: ["low", "high"],
  };

  it("fills empty capabilities from the reference", () => {
    const next = seedModelFromReference(model(), ref);
    expect(next.capabilities).toEqual([
      "thinking",
      "tool_use",
      "image_in",
      "always_thinking",
    ]);
  });

  it("never overwrites declared capabilities", () => {
    const entry = model({ capabilities: ["thinking"] });
    expect(seedModelFromReference(entry, ref).capabilities).toEqual(["thinking"]);
  });

  it("is idempotent", () => {
    const once = seedModelFromReference(model(), ref);
    expect(seedModelFromReference(once, ref)).toEqual(once);
  });
});

describe("materializeModelEfforts", () => {
  const config: Config = {
    default_model: "m1",
    providers: {},
    models: {
      m1: model({
        alias: "m1",
        model: "kimi-k2",
        raw_other: { support_efforts: ["low", "medium"] },
      }),
      m2: model({
        alias: "m2",
        model: "no-ref",
        raw_other: { default_effort: "high" },
      }),
    },
    imported_section_keys: ["thinking"],
  };

  it("seeds the models and leaves the other fields untouched", () => {
    const next = materializeModelEfforts(config);
    expect(readDefaultEffort(next.models.m1)).toBe("medium");
    expect(next.default_model).toBe(config.default_model);
    expect(next.providers).toBe(config.providers);
    expect(next.imported_section_keys).toBe(config.imported_section_keys);
    // A model with no tiers at all is returned by reference.
    expect(next.models.m2).toBe(config.models.m2);
  });

  it("is idempotent", () => {
    const once = materializeModelEfforts(config);
    expect(materializeModelEfforts(once)).toEqual(once);
  });
});
