import { describe, expect, it } from "vitest";
import { getAgentSettings, setAgentSettings } from "./agent-settings";

// ---------------------------------------------------------------------------
// Helpers — drill into the written `[thinking]` / `[loop_control]` sections
// ---------------------------------------------------------------------------

function thinkingOf(raw: unknown): Record<string, unknown> {
  const t = (raw as { thinking?: unknown })?.thinking;
  return t && typeof t === "object" && !Array.isArray(t)
    ? (t as Record<string, unknown>)
    : {};
}

function loopOf(raw: unknown): Record<string, unknown> {
  const l = (raw as { loop_control?: unknown })?.loop_control;
  return l && typeof l === "object" && !Array.isArray(l)
    ? (l as Record<string, unknown>)
    : {};
}

// ---------------------------------------------------------------------------
// Reading — legacy off values normalized to "off", "max" → "high"
// ---------------------------------------------------------------------------

describe("getAgentSettings — thinking.keep normalization", () => {
  it("normalizes a legacy boolean `false` to \"off\"", () => {
    expect(getAgentSettings({ thinking: { keep: false } }).thinking?.keep).toBe(
      "off"
    );
  });

  it("normalizes the other legacy off values (0, null, \"no\", \"none\") to \"off\"", () => {
    for (const v of [0, null, "no", "none"]) {
      expect(
        getAgentSettings({ thinking: { keep: v } }).thinking?.keep
      ).toBe("off");
    }
  });

  it("keeps \"all\" and \"off\" as-is on read", () => {
    expect(getAgentSettings({ thinking: { keep: "all" } }).thinking?.keep).toBe(
      "all"
    );
    expect(getAgentSettings({ thinking: { keep: "off" } }).thinking?.keep).toBe(
      "off"
    );
  });

  it("keeps the default \"all\" when the key is absent", () => {
    expect(getAgentSettings({}).thinking?.keep).toBe("all");
  });
});

describe("getAgentSettings — effort \"max\" read mapping", () => {
  it("normalizes a stored \"max\" to \"high\" on read", () => {
    expect(getAgentSettings({ thinking: { effort: "max" } }).thinking?.effort).toBe(
      "high"
    );
  });
});

// ---------------------------------------------------------------------------
// Writing — keep: "all" round-trips, "off" is written for legacy off values,
// absent keep is not materialized
// ---------------------------------------------------------------------------

describe("setAgentSettings — keep serialization", () => {
  it("round-trips keep = \"all\"", () => {
    const raw = { thinking: { keep: "all" } };
    const next = setAgentSettings(raw, { thinking: { keep: "all" } });
    expect(thinkingOf(next).keep).toBe("all");
  });

  it("writes \"off\" (string) for a legacy keep = false, never a boolean", () => {
    const next = setAgentSettings({ thinking: { keep: false } }, {});
    expect(thinkingOf(next).keep).toBe("off");
  });

  it("does not write the keep key when it was never set (absent in raw and patch)", () => {
    expect(thinkingOf(setAgentSettings({}, {}))).not.toHaveProperty("keep");
    const next = setAgentSettings(
      { thinking: { enabled: true } },
      { thinking: { effort: "high" } }
    );
    expect(thinkingOf(next)).not.toHaveProperty("keep");
    expect(thinkingOf(next).effort).toBe("high");
  });

  it("writes the key when an absent raw config's keep is explicitly toggled off", () => {
    const next = setAgentSettings({}, { thinking: { keep: "off" } });
    expect(thinkingOf(next).keep).toBe("off");
  });
});

// ---------------------------------------------------------------------------
// loop_control — v2 default writes only max_attempts_per_step; legacyV1 opts
// dual-writes; read fallback from the v1 key is preserved
// ---------------------------------------------------------------------------

describe("loop_control — v1/v2 key handling", () => {
  const raw = { loop_control: { max_attempts_per_step: 5, max_retries_per_step: 5 } };

  it("default (v2): a save strips the legacy max_retries_per_step key", () => {
    const next = setAgentSettings(raw, { loop_control: { reserved_context_size: 60000 } });
    expect(loopOf(next).max_attempts_per_step).toBe(5);
    expect(loopOf(next)).not.toHaveProperty("max_retries_per_step");
  });

  it("default (v2): a dual-write patch ends up with only the v2 key", () => {
    const next = setAgentSettings(
      raw,
      { loop_control: { max_attempts_per_step: 7, max_retries_per_step: 7 } }
    );
    expect(loopOf(next).max_attempts_per_step).toBe(7);
    expect(loopOf(next)).not.toHaveProperty("max_retries_per_step");
  });

  it("legacyV1: both keys are written", () => {
    const next = setAgentSettings(
      raw,
      { loop_control: { max_attempts_per_step: 7, max_retries_per_step: 7 } },
      { legacyV1: true }
    );
    expect(loopOf(next).max_attempts_per_step).toBe(7);
    expect(loopOf(next).max_retries_per_step).toBe(7);
  });

  it("read fallback keeps a max_retries_per_step-only config editable", () => {
    const s = getAgentSettings({ loop_control: { max_retries_per_step: 4 } });
    expect(s.loop_control?.max_attempts_per_step).toBe(4);
    expect(s.loop_control?.max_retries_per_step).toBe(4);
  });
});