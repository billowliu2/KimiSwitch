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
// Reading — legacy off values normalized to "off"; effort tiers pass through
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

describe("getAgentSettings — thinking.effort read mapping", () => {
  it("keeps a stored \"max\" as-is (the tier is valid upstream)", () => {
    expect(getAgentSettings({ thinking: { effort: "max" } }).thinking?.effort).toBe(
      "max"
    );
  });

  it("passes an \"xhigh\" tier through untouched", () => {
    expect(getAgentSettings({ thinking: { effort: "xhigh" } }).thinking?.effort).toBe(
      "xhigh"
    );
  });

  it("reads as undefined when the key is absent (no default materialized)", () => {
    const thinking = getAgentSettings({}).thinking;
    expect(thinking?.effort).toBeUndefined();
    // The key must not exist at all — `effort: undefined` would still travel
    // into a spread-built patch and get written as a key.
    expect(thinking && "effort" in thinking).toBe(false);
    // `enabled` / `keep` stay materialized (unchanged behavior).
    expect(thinking?.enabled).toBe(true);
    expect(thinking?.keep).toBe("all");
  });

  it("drops a non-string effort from a corrupted config", () => {
    expect(
      getAgentSettings({ thinking: { effort: 3 } }).thinking?.effort
    ).toBeUndefined();
  });

  it("round-trips an arbitrary hand-written tier on save", () => {
    const next = setAgentSettings({ thinking: { effort: "ultra" } }, {
      thinking: { effort: "ultra" },
    });
    expect(thinkingOf(next).effort).toBe("ultra");
  });
});

// ---------------------------------------------------------------------------
// Writing — effort: an absent global key is never materialized (it would
// outrank a per-model `[models.*] default_effort`), an explicit one survives
// ---------------------------------------------------------------------------

describe("setAgentSettings — effort serialization", () => {
  it("does not write effort when the raw config has none and the patch leaves it alone", () => {
    const next = setAgentSettings({ thinking: { enabled: true } }, {
      thinking: { enabled: true },
    });
    expect(thinkingOf(next)).not.toHaveProperty("effort");
    // A save that touches an unrelated section must not materialize it either.
    const other = setAgentSettings({ thinking: { enabled: true } }, {
      loop_control: { reserved_context_size: 60000 },
    });
    expect(thinkingOf(other)).not.toHaveProperty("effort");
  });

  it("keeps an existing effort tier on saves that do not touch it", () => {
    const next = setAgentSettings({ thinking: { effort: "high" } }, {
      thinking: { keep: "off" },
    });
    expect(thinkingOf(next).effort).toBe("high");
    const unrelated = setAgentSettings({ thinking: { effort: "high" } }, {});
    expect(thinkingOf(unrelated).effort).toBe("high");
  });

  it("writes effort when the patch sets it (absent on disk)", () => {
    const next = setAgentSettings({ thinking: { enabled: true } }, {
      thinking: { effort: "high" },
    });
    expect(thinkingOf(next).effort).toBe("high");
  });

  it("writes effort through a panel-shaped patch (spread of getAgentSettings)", () => {
    // Mirrors AgentSettingsPanel.updateThinking: the patch is
    // `{ ...settings.thinking, ...{ effort } }`, so an undefined effort on
    // read must not swallow the explicit pick.
    const raw = { thinking: { enabled: true } };
    const settings = getAgentSettings(raw);
    const next = setAgentSettings(raw, {
      thinking: { ...settings.thinking, effort: "max" },
    });
    expect(thinkingOf(next).effort).toBe("max");
  });

  it("overwrites an existing tier when the patch picks a different one", () => {
    const next = setAgentSettings({ thinking: { effort: "low" } }, {
      thinking: { effort: "xhigh" },
    });
    expect(thinkingOf(next).effort).toBe("xhigh");
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

// ---------------------------------------------------------------------------
// loop_control.compaction_max_attempts (kimi-code 0.43.0) — read via the loop
// spread, written only when set, and 0/empty removes the key (upstream
// default 5 applies)
// ---------------------------------------------------------------------------

describe("loop_control.compaction_max_attempts", () => {
  it("reads an existing value through the loop spread", () => {
    expect(
      getAgentSettings({ loop_control: { compaction_max_attempts: 7 } })
        .loop_control?.compaction_max_attempts
    ).toBe(7);
  });

  it("reads as undefined when the key is absent (UI falls back to 5)", () => {
    expect(
      getAgentSettings({ loop_control: {} }).loop_control?.compaction_max_attempts
    ).toBeUndefined();
  });

  it("writes the value when the patch sets it", () => {
    const next = setAgentSettings({}, {
      loop_control: { compaction_max_attempts: 8 },
    });
    expect(loopOf(next).compaction_max_attempts).toBe(8);
  });

  it("drops the key for 0 and for a cleared (undefined) field", () => {
    const raw = { loop_control: { compaction_max_attempts: 6 } };
    expect(loopOf(setAgentSettings(raw, {
      loop_control: { compaction_max_attempts: 0 },
    }))).not.toHaveProperty("compaction_max_attempts");
    expect(loopOf(setAgentSettings(raw, {
      loop_control: { compaction_max_attempts: undefined },
    }))).not.toHaveProperty("compaction_max_attempts");
  });

  it("does not materialize the upstream default on an unrelated save", () => {
    // An absent key must stay absent — a plain save must not pin `5`.
    const next = setAgentSettings({ thinking: { effort: "high" } }, {});
    expect(loopOf(next)).not.toHaveProperty("compaction_max_attempts");
    // An existing value survives a save that does not touch it.
    const kept = setAgentSettings(
      { loop_control: { compaction_max_attempts: 4 } },
      { thinking: { effort: "low" } }
    );
    expect(loopOf(kept).compaction_max_attempts).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// [watch] enabled (kimi-code 2.0.1+) — top-level section; 2.0.2 flipped the
// default off, #4015 flipped it back on. Mirrors the [background] handling.
// ---------------------------------------------------------------------------

function watchOf(raw: unknown): Record<string, unknown> {
  const w = (raw as { watch?: unknown })?.watch;
  return w && typeof w === "object" && !Array.isArray(w)
    ? (w as Record<string, unknown>)
    : {};
}

describe("[watch] enabled", () => {
  it("reads as true when the section or key is absent (#4015 default)", () => {
    expect(getAgentSettings({}).watch?.enabled).toBe(true);
    expect(getAgentSettings({ watch: {} }).watch?.enabled).toBe(true);
  });

  it("reads an explicit value", () => {
    expect(getAgentSettings({ watch: { enabled: true } }).watch?.enabled).toBe(true);
    expect(getAgentSettings({ watch: { enabled: false } }).watch?.enabled).toBe(false);
  });

  it("writes the top-level [watch] section", () => {
    const next = setAgentSettings({}, { watch: { enabled: true } }) as {
      watch?: Record<string, unknown>;
    };
    expect(next.watch).toEqual({ enabled: true });
  });

  it("keeps the section on saves that do not touch it", () => {
    const next = setAgentSettings(
      { watch: { enabled: true } },
      { thinking: { effort: "high" } }
    ) as { watch?: Record<string, unknown> };
    expect(next.watch).toEqual({ enabled: true });
  });

  it("does not disturb the other managed sections", () => {
    const next = setAgentSettings(
      { background: { max_running_tasks: 2 } },
      { watch: { enabled: true } }
    ) as { background?: Record<string, unknown> };
    expect(next.background?.max_running_tasks).toBe(2);
    expect(watchOf(next).enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Top-level booleans (auto_session_title #3962 / repeat_breaker #3995):
// upstream default true — false is written explicitly, true removes the key.
// ---------------------------------------------------------------------------

describe("top-level boolean switches", () => {
  it("reads as undefined when the key is absent (default true)", () => {
    const s = getAgentSettings({});
    expect(s.auto_session_title).toBeUndefined();
    expect(s.repeat_breaker).toBeUndefined();
  });

  it("reads explicit false values", () => {
    const s = getAgentSettings({
      auto_session_title: false,
      repeat_breaker: false,
    });
    expect(s.auto_session_title).toBe(false);
    expect(s.repeat_breaker).toBe(false);
  });

  it("writes false explicitly and removes the key on true", () => {
    const off = setAgentSettings({}, { repeat_breaker: false }) as Record<
      string,
      unknown
    >;
    expect(off.repeat_breaker).toBe(false);
    const on = setAgentSettings(
      { repeat_breaker: false },
      { repeat_breaker: true }
    ) as Record<string, unknown>;
    expect("repeat_breaker" in on).toBe(false);
  });

  it("keeps an explicit false on saves that do not touch it", () => {
    const next = setAgentSettings(
      { auto_session_title: false },
      { thinking: { effort: "high" } }
    ) as Record<string, unknown>;
    expect(next.auto_session_title).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// disable_feedback_survey (kimi-code 2.3.0, moved from tui.toml): upstream
// default FALSE (survey on), read as `=== true` — so true is written
// explicitly and everything else removes the key.
// ---------------------------------------------------------------------------

describe("disable_feedback_survey", () => {
  it("reads as false when the key is absent (survey on by default)", () => {
    expect(getAgentSettings({}).disable_feedback_survey).toBe(false);
  });

  it("reads only a literal true as disabled", () => {
    expect(
      getAgentSettings({ disable_feedback_survey: true }).disable_feedback_survey
    ).toBe(true);
    expect(
      getAgentSettings({ disable_feedback_survey: false })
        .disable_feedback_survey
    ).toBe(false);
    // Values upstream's `=== true` check would not accept stay "not disabled".
    expect(
      getAgentSettings({ disable_feedback_survey: "true" })
        .disable_feedback_survey
    ).toBe(false);
  });

  it("does not export the key by default", () => {
    const next = setAgentSettings({}, {}) as Record<string, unknown>;
    expect("disable_feedback_survey" in next).toBe(false);
    // An unrelated save must not materialize the key either.
    const unrelated = setAgentSettings({ thinking: { effort: "high" } }, {
      thinking: { effort: "high" },
    }) as Record<string, unknown>;
    expect("disable_feedback_survey" in unrelated).toBe(false);
  });

  it("writes true when the patch disables the survey", () => {
    const next = setAgentSettings({}, {
      disable_feedback_survey: true,
    }) as Record<string, unknown>;
    expect(next.disable_feedback_survey).toBe(true);
  });

  it("removes the key when the patch turns the survey back on", () => {
    const raw = { disable_feedback_survey: false };
    const next = setAgentSettings(raw, {
      disable_feedback_survey: false,
    }) as Record<string, unknown>;
    expect("disable_feedback_survey" in next).toBe(false);
    const unset = setAgentSettings(
      { disable_feedback_survey: true },
      { disable_feedback_survey: false }
    ) as Record<string, unknown>;
    expect("disable_feedback_survey" in unset).toBe(false);
  });

  it("keeps an explicit true on saves that do not touch it", () => {
    const next = setAgentSettings(
      { disable_feedback_survey: true },
      { thinking: { effort: "high" } }
    ) as Record<string, unknown>;
    expect(next.disable_feedback_survey).toBe(true);
  });
});


describe("permission.dangerous_command_guard", () => {
  it("reads as undefined when the key is absent (default on)", () => {
    expect(
      getAgentSettings({}).permission?.dangerous_command_guard
    ).toBeUndefined();
    expect(
      getAgentSettings({ permission: { rules: [] } }).permission
        ?.dangerous_command_guard
    ).toBeUndefined();
  });

  it("reads an explicit true / false", () => {
    expect(
      getAgentSettings({ permission: { dangerous_command_guard: false } })
        .permission?.dangerous_command_guard
    ).toBe(false);
    expect(
      getAgentSettings({ permission: { dangerous_command_guard: true } })
        .permission?.dangerous_command_guard
    ).toBe(true);
  });

  it("writes guard=false even with no rules (section kept)", () => {
    const next = setAgentSettings(
      {},
      { permission: { rules: [], dangerous_command_guard: false } }
    ) as { permission?: Record<string, unknown> };
    expect(next.permission).toEqual({ dangerous_command_guard: false });
  });

  it("writes guard together with rules", () => {
    const rules = [{ decision: "allow" as const, pattern: "Read" }];
    const next = setAgentSettings(
      {},
      { permission: { rules, dangerous_command_guard: true } }
    ) as { permission?: Record<string, unknown> };
    expect(next.permission).toEqual({
      rules,
      dangerous_command_guard: true,
    });
  });

  it("a rules-only update carries the existing guard through", () => {
    const raw = { permission: { dangerous_command_guard: false } };
    const next = setAgentSettings(raw, {
      permission: { rules: [{ decision: "deny" as const, pattern: "Bash" }] },
    }) as { permission?: Record<string, unknown> };
    expect(next.permission?.dangerous_command_guard).toBe(false);
    expect(next.permission?.rules).toHaveLength(1);
  });

  it("omits an empty rules array; keeps an explicit guard on plain saves", () => {
    const raw = { permission: { dangerous_command_guard: true } };
    const off = setAgentSettings(raw, {
      permission: { rules: [], dangerous_command_guard: false },
    }) as { permission?: Record<string, unknown> };
    expect(off.permission).toEqual({ dangerous_command_guard: false });
    expect(off.permission).not.toHaveProperty("rules");
    // An explicit true is materialized on plain saves (harmless, and it
    // documents the state the UI toggle shows).
    const on = setAgentSettings(raw, {}) as {
      permission?: Record<string, unknown>;
    };
    expect(on.permission).toEqual({ dangerous_command_guard: true });
  });
});