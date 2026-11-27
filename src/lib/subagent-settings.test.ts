import { describe, expect, it } from "vitest";
import {
  EXPERIMENTAL_FLAGS,
  forcedEnvValue,
  getExperimentalFlags,
  getSecondaryModel,
  getSubagentModelPool,
  getDeprecatedSecondaryModelKeys,
  isExperimentalFlagSet,
  isFlagLockedByEnv,
  removeSubagentPoolEntry,
  setExperimentalFlag,
  setSecondaryModelOnly,
  setSubagentDefault,
  setSubagentModelPool,
  upsertSubagentPoolEntry,
  validateSubagentPool,
  type SubagentModelPool,
} from "./subagent-settings";

// ---------------------------------------------------------------------------
// Helpers — drill into the `[secondary_model]` section of the written result
// ---------------------------------------------------------------------------

function rawWith(section: Record<string, unknown>): unknown {
  return { secondary_model: section };
}

function section(raw: unknown): Record<string, unknown> {
  const root = raw as { secondary_model?: unknown };
  const sec = root?.secondary_model;
  return sec && typeof sec === "object" && !Array.isArray(sec)
    ? (sec as Record<string, unknown>)
    : {};
}

function modelsOf(raw: unknown): Record<string, unknown> {
  const m = section(raw)["models"];
  return m && typeof m === "object" && !Array.isArray(m)
    ? (m as Record<string, unknown>)
    : {};
}

// ---------------------------------------------------------------------------
// Reading — four config combinations + effective-default normalization
// ---------------------------------------------------------------------------

describe("getSecondaryModel / getSubagentModelPool", () => {
  it("returns an empty config / undefined pool when the section is absent or empty", () => {
    expect(getSecondaryModel({})).toEqual({});
    expect(getSubagentModelPool({})).toBeUndefined();
    expect(getSubagentModelPool(rawWith({}))).toBeUndefined();
  });

  it("legacy `model` alone forms the effective default", () => {
    const raw = rawWith({ model: "kimi-k2" });
    expect(getSecondaryModel(raw)).toEqual({ model: "kimi-k2" });
    const pool = getSubagentModelPool(raw);
    expect(pool).toEqual({ model: "kimi-k2", models: {} });
    expect(pool?.defaultModel ?? pool?.model).toBe("kimi-k2");
  });

  it("`default_model` alone forms the effective default", () => {
    const raw = rawWith({ default_model: "kimi-k2" });
    expect(getSecondaryModel(raw)).toEqual({ default_model: "kimi-k2" });
    const pool = getSubagentModelPool(raw);
    expect(pool?.defaultModel).toBe("kimi-k2");
    expect(pool?.model).toBeUndefined();
    expect(pool?.defaultModel ?? pool?.model).toBe("kimi-k2");
  });

  it("a divergent `model` + `default_model` resolves the effective default to `default_model`", () => {
    const raw = rawWith({ model: "kimi-k2", default_model: "kimi-k1" });
    expect(getSecondaryModel(raw)).toEqual({
      model: "kimi-k2",
      default_model: "kimi-k1",
    });
    const pool = getSubagentModelPool(raw);
    expect(pool?.model).toBe("kimi-k2");
    expect(pool?.defaultModel).toBe("kimi-k1");
    expect(pool?.defaultModel ?? pool?.model).toBe("kimi-k1");
  });

  it("reads the models table filtering non-string values", () => {
    const raw = rawWith({
      default_model: "kimi-k2",
      models: { "kimi-k2": "Kimi K2", "kimi-k2-thinking": 42, broken: true },
      force: true,
    });
    expect(getSecondaryModel(raw).models).toEqual({ "kimi-k2": "Kimi K2" });
    expect(getSubagentModelPool(raw)).toMatchObject({
      models: { "kimi-k2": "Kimi K2" },
    });
  });

  it("no longer reports `force` or the removed tuning keys, only default_effort", () => {
    const raw = rawWith({
      default_model: "kimi-k2",
      force: true,
      max_output_size: 64000,
      max_context_size: 128000,
      default_effort: "high",
    });
    const cfg = getSecondaryModel(raw);
    expect(cfg).toEqual({ default_model: "kimi-k2", default_effort: "high" });
    const pool = getSubagentModelPool(rawWith({ models: "nope", model: "kimi-k2" }));
    expect(pool?.models).toEqual({});
    expect(pool?.model).toBe("kimi-k2");
  });

  it("reports the deprecated keys in upstream order", () => {
    expect(getDeprecatedSecondaryModelKeys({})).toEqual([]);
    expect(
      getDeprecatedSecondaryModelKeys(
        rawWith({ max_output_size: 1, force: true, default_effort: "high" })
      )
    ).toEqual(["force", "max_output_size"]);
    expect(
      getDeprecatedSecondaryModelKeys(
        rawWith({ off_effort: "off", capabilities: [], adaptive_thinking: true })
      )
    ).toEqual(["capabilities", "adaptive_thinking", "off_effort"]);
  });
});

// ---------------------------------------------------------------------------
// setSecondaryModelOnly — pool-aware pick
// ---------------------------------------------------------------------------

describe("setSecondaryModelOnly", () => {
  it("creates the section when absent", () => {
    const next = setSecondaryModelOnly({}, "kimi-k2");
    expect(section(next)).toEqual({ model: "kimi-k2" });
  });

  it("without a pool: writes only `model`, drops deprecated keys, keeps unknown fields", () => {
    const raw = rawWith({
      model: "old",
      max_output_size: 64000,
      max_context_size: 128000,
      custom_field: "keep",
    });
    const next = setSecondaryModelOnly(raw, "kimi-k2");
    expect(section(next)).toEqual({ model: "kimi-k2", custom_field: "keep" });
  });

  it("without a pool: keeps default_effort, which is still valid", () => {
    const raw = rawWith({ model: "old", default_effort: "high" });
    const next = setSecondaryModelOnly(raw, "kimi-k2");
    expect(section(next)).toEqual({ model: "kimi-k2", default_effort: "high" });
  });

  it("pool via default_model: syncs both keys, adds a missing alias to the table, cleans force", () => {
    const raw = rawWith({
      default_model: "kimi-k1",
      models: { "kimi-k1": "K1" },
      force: true,
      unknown_field: "keep",
    });
    const next = setSecondaryModelOnly(raw, "kimi-k2");
    expect(section(next)).toEqual({
      default_model: "kimi-k2",
      model: "kimi-k2",
      models: { "kimi-k1": "K1", "kimi-k2": "" },
      unknown_field: "keep",
    });
  });

  it("pool via models table: keeps existing descriptions", () => {
    const raw = rawWith({ models: { "kimi-k1": "K1", "kimi-k2": "K2" } });
    const next = setSecondaryModelOnly(raw, "kimi-k2");
    expect(modelsOf(next)).toEqual({ "kimi-k1": "K1", "kimi-k2": "K2" });
    expect(section(next).default_model).toBe("kimi-k2");
    expect(section(next).model).toBe("kimi-k2");
  });

  it("heals a divergent legacy + pool default to the picked alias", () => {
    const raw = rawWith({
      model: "kimi-k1",
      default_model: "kimi-k2",
      models: { "kimi-k1": "K1", "kimi-k2": "K2" },
    });
    const next = setSecondaryModelOnly(raw, "kimi-k1");
    expect(section(next).model).toBe("kimi-k1");
    expect(section(next).default_model).toBe("kimi-k1");
    expect(modelsOf(next)).toEqual({ "kimi-k1": "K1", "kimi-k2": "K2" });
  });

  it("preserves other top-level raw_other sections", () => {
    const raw = {
      experimental: { wait_for: true },
      secondary_model: { model: "kimi-k1" },
    };
    const next = setSecondaryModelOnly(raw, "kimi-k2") as {
      experimental?: unknown;
    };
    expect(next.experimental).toEqual({ wait_for: true });
  });
});

// ---------------------------------------------------------------------------
// Pool mutations — rebuild / upsert / remove / default
// ---------------------------------------------------------------------------

describe("pool mutations", () => {
  it("setSubagentModelPool rebuilds with dual-written default (effective wins) and drops force", () => {
    const raw = rawWith({ model: "stale", force: true, custom: "keep" });
    const next = setSubagentModelPool(raw, {
      defaultModel: "kimi-k2",
      model: "kimi-k1", // divergent — effective default (`defaultModel`) wins
      models: { "kimi-k2": "K2" },
    });
    expect(section(next)).toEqual({
      default_model: "kimi-k2",
      model: "kimi-k2",
      models: { "kimi-k2": "K2" },
      custom: "keep",
    });
  });

  it("setSubagentModelPool omits the models table when the pool has no entries", () => {
    const next = setSubagentModelPool(rawWith({}), {
      defaultModel: "kimi-k2",
      models: {},
    });
    expect(section(next)).toEqual({
      default_model: "kimi-k2",
      model: "kimi-k2",
    });
  });

  it("setSubagentModelPool is idempotent", () => {
    const pool: SubagentModelPool = {
      defaultModel: "kimi-k2",
      models: { "kimi-k2": "K2" },
    };
    const once = setSubagentModelPool(rawWith({ custom: "keep" }), pool);
    const twice = setSubagentModelPool(once, pool);
    expect(once).toEqual(twice);
  });

  it("upsertSubagentPoolEntry adds and updates aliases, preserving the rest", () => {
    const raw = rawWith({
      default_model: "kimi-k1",
      models: { "kimi-k1": "K1" },
    });
    const added = upsertSubagentPoolEntry(raw, "kimi-k2", "K2");
    expect(modelsOf(added)).toEqual({ "kimi-k1": "K1", "kimi-k2": "K2" });
    const updated = upsertSubagentPoolEntry(added, "kimi-k2", "K2 thinking");
    expect(modelsOf(updated)).toEqual({
      "kimi-k1": "K1",
      "kimi-k2": "K2 thinking",
    });
    expect(section(updated).default_model).toBe("kimi-k1");
  });

  it("upsertSubagentPoolEntry materializes the implicit default into a new table", () => {
    // Implicit single-entry form (default_model set, no models table): adding a
    // second alias must pull the default into the table, otherwise the result
    // violates "default_model must be a pool key" (rule 3) and gets rejected.
    const raw = rawWith({ default_model: "kimi-k1" });
    const added = upsertSubagentPoolEntry(raw, "kimi-k2", "");
    expect(modelsOf(added)).toEqual({ "kimi-k1": "", "kimi-k2": "" });
    expect(section(added).default_model).toBe("kimi-k1");
    const pool = getSubagentModelPool(added);
    expect(pool).toBeDefined();
    expect(
      validateSubagentPool(pool!, ["kimi-k1", "kimi-k2"]),
    ).toEqual([]);
  });

  it("upsertSubagentPoolEntry upgrades a legacy `model`-only section to a valid pool", () => {
    const raw = rawWith({ model: "kimi-k1" });
    const added = upsertSubagentPoolEntry(raw, "kimi-k2", "K2");
    expect(modelsOf(added)).toEqual({ "kimi-k1": "", "kimi-k2": "K2" });
    expect(section(added).default_model).toBe("kimi-k1");
    expect(section(added).model).toBe("kimi-k1");
    const pool = getSubagentModelPool(added);
    expect(validateSubagentPool(pool!, ["kimi-k1", "kimi-k2"])).toEqual([]);
  });

  it("removeSubagentPoolEntry keeps the default when removing a non-default alias", () => {
    const raw = rawWith({
      default_model: "kimi-k1",
      model: "kimi-k1",
      models: { "kimi-k1": "K1", "kimi-k2": "K2", "kimi-k3": "K3" },
    });
    const next = removeSubagentPoolEntry(raw, "kimi-k3");
    expect(modelsOf(next)).toEqual({ "kimi-k1": "K1", "kimi-k2": "K2" });
    expect(section(next).default_model).toBe("kimi-k1");
    expect(section(next).model).toBe("kimi-k1");
  });

  it("removeSubagentPoolEntry falls the default back to the first remaining key", () => {
    const raw = rawWith({
      default_model: "kimi-k1",
      model: "kimi-k1",
      models: { "kimi-k1": "K1", "kimi-k2": "K2" },
    });
    const next = removeSubagentPoolEntry(raw, "kimi-k1");
    expect(modelsOf(next)).toEqual({ "kimi-k2": "K2" });
    expect(section(next).default_model).toBe("kimi-k2");
    expect(section(next).model).toBe("kimi-k2");
  });

  it("removeSubagentPoolEntry collapses an emptied pool to the implicit form", () => {
    const raw = rawWith({
      default_model: "kimi-k1",
      model: "kimi-k1",
      models: { "kimi-k1": "K1" },
    });
    const next = removeSubagentPoolEntry(raw, "kimi-k1");
    const sec = section(next);
    expect(sec).not.toHaveProperty("models");
    expect(sec.default_model).toBe("kimi-k1");
    expect(sec.model).toBe("kimi-k1");
  });

  it("setSubagentDefault syncs both keys and adds a missing alias with an empty description", () => {
    const raw = rawWith({ models: { "kimi-k2": "K2" } });
    const next = setSubagentDefault(raw, "kimi-k1");
    expect(section(next).default_model).toBe("kimi-k1");
    expect(section(next).model).toBe("kimi-k1");
    expect(modelsOf(next)).toEqual({ "kimi-k2": "K2", "kimi-k1": "" });
  });
});

// ---------------------------------------------------------------------------
// Deprecated keys — cleaned on write instead of round-tripped
// ---------------------------------------------------------------------------

describe("deprecated [secondary_model] keys", () => {
  const deprecatedSection = {
    default_model: "kimi-k1",
    models: { "kimi-k1": "K1" },
    force: true,
    max_output_size: 64000,
    max_context_size: 128000,
    capabilities: ["thinking"],
    default_effort: "high",
    custom: "keep",
  };

  it("every write path drops them and keeps default_effort plus unknown keys", () => {
    const expected = {
      default_model: "kimi-k1",
      model: "kimi-k1",
      models: { "kimi-k1": "K1" },
      default_effort: "high",
      custom: "keep",
    };
    expect(section(setSecondaryModelOnly(rawWith(deprecatedSection), "kimi-k1"))).toEqual(
      expected
    );
    expect(
      section(
        setSubagentModelPool(rawWith(deprecatedSection), {
          defaultModel: "kimi-k1",
          models: { "kimi-k1": "K1" },
        })
      )
    ).toEqual(expected);
    expect(section(setSubagentDefault(rawWith(deprecatedSection), "kimi-k1"))).toEqual(
      expected
    );
    expect(
      section(upsertSubagentPoolEntry(rawWith(deprecatedSection), "kimi-k1", "K1"))
    ).toEqual(expected);
    // Removing the only entry leaves the implicit single-entry form behind.
    // `model` is not synthesized here — this write only un-lists the entry.
    expect(
      section(removeSubagentPoolEntry(rawWith(deprecatedSection), "kimi-k1"))
    ).toEqual({
      default_model: "kimi-k1",
      default_effort: "high",
      custom: "keep",
    });
  });

  it("a write adds nothing but the synced legacy `model` key to a clean section", () => {
    const clean = rawWith({
      default_model: "kimi-k1",
      models: { "kimi-k1": "K1" },
      default_effort: "high",
    });
    // `model` is always dual-written so a v1 engine resolves the same alias;
    // no deprecated key is introduced or resurrected.
    expect(section(setSubagentDefault(clean, "kimi-k1"))).toEqual({
      default_model: "kimi-k1",
      model: "kimi-k1",
      models: { "kimi-k1": "K1" },
      default_effort: "high",
    });
  });
});

// ---------------------------------------------------------------------------
// validateSubagentPool — mirror of the remaining engine rules
// ---------------------------------------------------------------------------

describe("validateSubagentPool", () => {
  const aliases = ["kimi-k1", "kimi-k2", "kimi-k3"];

  const pool = (p: Partial<SubagentModelPool>): SubagentModelPool => ({
    models: {},
    ...p,
  });

  it("accepts a valid pool", () => {
    expect(
      validateSubagentPool(
        pool({
          defaultModel: "kimi-k2",
          models: { "kimi-k2": "K2", "kimi-k3": "K3" },
        }),
        aliases
      )
    ).toEqual([]);
  });

  it("accepts the implicit single-entry form when the model resolves", () => {
    expect(validateSubagentPool(pool({ model: "kimi-k2" }), aliases)).toEqual([]);
  });

  it("flags `primary` as a reserved pool key", () => {
    const byDefault = validateSubagentPool(pool({ defaultModel: "primary" }), aliases);
    expect(byDefault).toContainEqual({
      key: "primaryReserved",
      params: { alias: "primary" },
    });
    const byEntry = validateSubagentPool(
      pool({ defaultModel: "kimi-k1", models: { primary: "" } }),
      aliases
    );
    expect(byEntry).toContainEqual({
      key: "primaryReserved",
      params: { alias: "primary" },
    });
  });

  it("requires `default_model` when the models table exists", () => {
    // Strict mirror of the engine: a `model` fallback does not satisfy the
    // `default_model` requirement once a `models` table is present.
    expect(
      validateSubagentPool(
        pool({ model: "kimi-k2", models: { "kimi-k2": "K2" } }),
        aliases
      )
    ).toEqual([{ key: "defaultRequired" }]);
  });

  it("flags a default that is not a key of the pool table", () => {
    const errors = validateSubagentPool(
      pool({ defaultModel: "kimi-k3", models: { "kimi-k2": "K2" } }),
      aliases
    );
    expect(errors).toContainEqual({
      key: "defaultNotInPool",
      params: { alias: "kimi-k3" },
    });
  });

  it("flags pool keys that do not resolve in the [models] registry", () => {
    const errors = validateSubagentPool(
      pool({ defaultModel: "kimi-k2", models: { "kimi-k2": "K2", ghost: "?" } }),
      aliases
    );
    expect(errors).toContainEqual({
      key: "aliasNotInModels",
      params: { alias: "ghost" },
    });
    // the implicit single-entry default is checked against the registry too
    const implicit = validateSubagentPool(pool({ model: "ghost" }), aliases);
    expect(implicit).toContainEqual({
      key: "aliasNotInModels",
      params: { alias: "ghost" },
    });
  });
});

// ---------------------------------------------------------------------------
// [experimental] — flag registry (kimi-code 0.42.0) + write semantics
// ---------------------------------------------------------------------------

describe("experimental flag registry", () => {
  it("mirrors the 2.8.1 v2 registry (6 flags)", () => {
    expect(EXPERIMENTAL_FLAGS.map((f) => f.id)).toEqual([
      "wait_for",
      "worktree",
      "auto_review",
      "notify_user",
      "tower",
      "prompt_prediction",
    ]);
    // wait_for is on by default upstream; every other flag is opt-in.
    const byId = (id: string) => EXPERIMENTAL_FLAGS.find((f) => f.id === id)!;
    expect(byId("wait_for").defaultEnabled).toBe(true);
    for (const id of ["worktree", "auto_review", "notify_user", "tower", "prompt_prediction"]) {
      expect(byId(id).defaultEnabled).toBeUndefined();
    }
    // Removed upstream: file_history (0.41.0, turn-level file history is
    // always on), auto_session_title (0.43.0, graduated — AI session titles
    // are always on, #3749), tool-select and subagent_fork (2.8.x — no flag
    // left upstream), plus secondary-model / persistence_minidb_readmodel /
    // remote-control / search_worker (0.42.0 — promoted or moved to dedicated
    // config, the minidb read-model now lives under [database]), so the
    // adapter must not mirror them either.
    for (const id of [
      "file_history",
      "auto_session_title",
      "secondary-model",
      "persistence_minidb_readmodel",
      "remote-control",
      "search_worker",
      "tool-select",
      "subagent_fork",
    ]) {
      expect(EXPERIMENTAL_FLAGS.some((f) => f.id === id)).toBe(false);
    }
  });

  it("notify_user is opt-in: no upstream default, own env var", () => {
    const flag = EXPERIMENTAL_FLAGS.find((f) => f.id === "notify_user");
    expect(flag?.envVar).toBe("KIMI_CODE_EXPERIMENTAL_NOTIFY_USER");
    expect(flag?.defaultEnabled).toBeUndefined();
  });

  it("notify_user is locked by its env var and forced to the env value", () => {
    const flag = EXPERIMENTAL_FLAGS.find((f) => f.id === "notify_user")!;
    expect(isFlagLockedByEnv({}, flag)).toBe(false);
    // A set env var locks the toggle even when it is falsy — it can force
    // the flag on *or* off.
    expect(isFlagLockedByEnv({ [flag.envVar]: "0" }, flag)).toBe(true);
    expect(forcedEnvValue({ [flag.envVar]: "0" }, flag)).toBe(false);
    expect(forcedEnvValue({ [flag.envVar]: "true" }, flag)).toBe(true);
  });
});

describe("setExperimentalFlag", () => {
  const rawExp = (section: Record<string, unknown>) => ({
    experimental: section,
  });

  it("enabling writes true; disabling a default-off flag deletes the key", () => {
    const on = setExperimentalFlag({}, "worktree", true) as {
      experimental: Record<string, unknown>;
    };
    expect(on.experimental["worktree"]).toBe(true);
    const off = setExperimentalFlag(on, "worktree", false) as Record<
      string,
      unknown
    >;
    expect(off).not.toHaveProperty("experimental"); // empty section dropped
  });

  it("disabling a default-on flag with explicitFalse writes a literal false", () => {
    const next = setExperimentalFlag(
      rawExp({ wait_for: true }),
      "wait_for",
      false,
      { explicitFalse: true }
    ) as { experimental: Record<string, unknown> };
    expect(next.experimental.wait_for).toBe(false);
    expect(isExperimentalFlagSet(next, "wait_for")).toBe(true);
    expect(getExperimentalFlags(next).wait_for).toBe(false);
  });

  it("an explicit false coexists with other flags and keeps the section", () => {
    const next = setExperimentalFlag(
      rawExp({ wait_for: false }),
      "tower",
      true,
      { explicitFalse: true }
    ) as { experimental: Record<string, unknown> };
    expect(next.experimental).toEqual({
      wait_for: false,
      tower: true,
    });
  });
});
