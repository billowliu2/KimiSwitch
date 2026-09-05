import type { ExperimentalEnvStatus, SecondaryModelConfig } from "../types";

/**
 * Helpers for the `[experimental]` and `[secondary_model]` sections of the
 * Kimi Code config.toml. Both live in `config.raw_other` (the pass-through
 * bucket for unknown top-level TOML sections), so these helpers read/write
 * that JSON object directly.
 */

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// [experimental] — experimental feature flags
// ---------------------------------------------------------------------------

export interface ExperimentalFlagDef {
  /** Flag id as stored in config.toml `[experimental]` (e.g. "secondary-model"). */
  id: string;
  /** Single-feature env var that can force the flag (locks the UI toggle). */
  envVar: string;
  /** Feature turned on by default upstream; an absent config key falls back
   *  to this, while an explicit `false` in `[experimental]` still wins. */
  defaultEnabled?: boolean;
}

/** Known experimental flags — mirrors the kimi-code v2 flag registry
 * (the per-feature flag.ts files under packages/agent-core-v2/src:
 * secondary-model, tool-select, persistence_minidb_readmodel, tower,
 * subagent_fork, wait_for, auto_session_title, remote-control,
 * search_worker). `acp-v2` was removed upstream and is dropped here;
 * `file_history` was removed in kimi-code 0.41.0 (turn-level file
 * history is always on, no flag). Keep the env-var list in sync with
 * `get_experimental_env_status` in src-tauri/src/commands.rs. */
export const EXPERIMENTAL_FLAGS: ExperimentalFlagDef[] = [
  {
    id: "secondary-model",
    envVar: "KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL",
    defaultEnabled: true, // on by default since kimi-code 0.40.1
  },
  { id: "tool-select", envVar: "KIMI_CODE_EXPERIMENTAL_TOOL_SELECT" },
  {
    id: "persistence_minidb_readmodel",
    envVar: "KIMI_CODE_EXPERIMENTAL_PERSISTENCE_MINIDB_READMODEL",
    defaultEnabled: true,
  },
  { id: "tower", envVar: "KIMI_CODE_EXPERIMENTAL_TOWER" },
  { id: "subagent_fork", envVar: "KIMI_CODE_EXPERIMENTAL_SUBAGENT_FORK" },
  {
    id: "wait_for",
    envVar: "KIMI_CODE_EXPERIMENTAL_WAIT_FOR",
    defaultEnabled: true,
  },
  {
    id: "auto_session_title",
    envVar: "KIMI_CODE_EXPERIMENTAL_AUTO_SESSION_TITLE",
  },
  { id: "remote-control", envVar: "KIMI_CODE_EXPERIMENTAL_REMOTE_CONTROL" },
  {
    id: "search_worker",
    envVar: "KIMI_CODE_EXPERIMENTAL_SEARCH_WORKER",
    defaultEnabled: true,
  },
];

export const EXPERIMENTAL_MASTER_ENV = "KIMI_CODE_EXPERIMENTAL_FLAG";

/** Whether the master env var is set to a truthy value. Since kimi-code
 *  0.40.1 it only force-ONs flags that have *no* explicit `[experimental]`
 *  entry (an explicit config value — true or false — outranks it, and the
 *  master env can never force a flag off). It locks no UI toggles; only a
 *  flag's own single-feature env var does. */
export function isMasterEnvOn(env: ExperimentalEnvStatus | null): boolean {
  return isTruthyEnv(env?.[EXPERIMENTAL_MASTER_ENV]);
}

/** Whether a flag's value is overridden by its env var (set & non-empty),
 *  locking the config toggle. Kimi Code lets the env var force the flag on
 *  *or* off, so a set env var locks regardless of its truthiness. */
export function isFlagLockedByEnv(
  env: ExperimentalEnvStatus | null,
  flag: ExperimentalFlagDef
): boolean {
  return env !== null && flag.envVar in env;
}

/** The value a locked flag is forced to by its env var. */
export function forcedEnvValue(
  env: ExperimentalEnvStatus | null,
  flag: ExperimentalFlagDef
): boolean {
  return isTruthyEnv(env?.[flag.envVar]);
}

/** Read `[experimental]` from raw_other: `{ flagId: boolean }`. */
export function getExperimentalFlags(rawOther: unknown): Record<string, boolean> {
  const section = asRecord(rawOther)["experimental"];
  const flags = asRecord(section);
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(flags)) {
    out[k] = v === true;
  }
  return out;
}

/** Whether a flag is explicitly written in `[experimental]` (true *or* false).
 *  An absent flag falls back to the upstream default (`defaultEnabled`). */
export function isExperimentalFlagSet(rawOther: unknown, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    asRecord(asRecord(rawOther)["experimental"]),
    id
  );
}

/** Set one flag in `[experimental]`. Removing all flags drops the section.
 *  Pass `explicitFalse` when deleting the key would NOT express "off" —
 *  i.e. the flag is on by upstream default (`defaultEnabled`) or the master
 *  env force-ons undefined flags — and write a literal `false` instead,
 *  which outranks both under the kimi-code 0.40.1 priority
 *  (single env > explicit config > master env > default). */
export function setExperimentalFlag(
  rawOther: unknown,
  id: string,
  enabled: boolean,
  opts?: { explicitFalse?: boolean }
): unknown {
  const root = { ...asRecord(rawOther) };
  const flags = { ...getExperimentalFlags(rawOther) };
  if (enabled) {
    flags[id] = true;
  } else if (opts?.explicitFalse) {
    flags[id] = false;
  } else {
    delete flags[id];
  }
  if (Object.keys(flags).length > 0) {
    root.experimental = flags;
  } else {
    delete root.experimental;
  }
  return root;
}

// ---------------------------------------------------------------------------
// [secondary_model] — subagent model pool
// ---------------------------------------------------------------------------

/**
 * Parsed subagent model pool (`[secondary_model]` v2 keys). The currently
 * effective default is `defaultModel ?? model` (v2 pool key first, legacy v1
 * recipe key as fallback).
 */
export interface SubagentModelPool {
  /** v2 pool default (`default_model`). */
  defaultModel?: string;
  /** Legacy v1 recipe key (`model`), kept in sync with `defaultModel`. */
  model?: string;
  /** `[models]` table (alias → description); non-string values dropped. */
  models: Record<string, string>;
  /** Force subagents onto the default alias. */
  force: boolean;
}

/** Known v1 patch fields, dropped when re-picking without a pool so stale
 *  patches are cleaned up. */
const PATCH_FIELDS: ReadonlySet<string> = new Set([
  "default_effort",
  "max_output_size",
  "max_context_size",
]);

/** Read `[secondary_model]` from raw_other; `{}` when absent. */
export function getSecondaryModel(rawOther: unknown): SecondaryModelConfig {
  const section = asRecord(rawOther)["secondary_model"];
  const cfg = asRecord(section);
  const out: SecondaryModelConfig = {};
  if (typeof cfg.default_model === "string" && cfg.default_model !== "")
    out.default_model = cfg.default_model;
  if (typeof cfg.model === "string" && cfg.model !== "") out.model = cfg.model;
  const models = asRecord(cfg.models);
  const pool: Record<string, string> = {};
  for (const [k, v] of Object.entries(models)) {
    if (typeof v === "string") pool[k] = v;
  }
  if (Object.keys(pool).length > 0) out.models = pool;
  if (cfg.force === true) out.force = true;
  if (typeof cfg.default_effort === "string" && cfg.default_effort !== "")
    out.default_effort = cfg.default_effort;
  if (typeof cfg.max_output_size === "number" && cfg.max_output_size > 0)
    out.max_output_size = cfg.max_output_size;
  if (typeof cfg.max_context_size === "number" && cfg.max_context_size > 0)
    out.max_context_size = cfg.max_context_size;
  return out;
}

/** Read the v2 subagent model pool from raw_other; `undefined` when there is
 *  no `[secondary_model]` section or it is empty. The effective default is
 *  `defaultModel ?? model`. */
export function getSubagentModelPool(
  rawOther: unknown
): SubagentModelPool | undefined {
  const section = asRecord(asRecord(rawOther)["secondary_model"]);
  if (Object.keys(section).length === 0) return undefined;
  const models: Record<string, string> = {};
  for (const [k, v] of Object.entries(asRecord(section["models"]))) {
    if (typeof v === "string") models[k] = v;
  }
  const out: SubagentModelPool = { models, force: section["force"] === true };
  if (typeof section["default_model"] === "string" && section["default_model"] !== "")
    out.defaultModel = section["default_model"];
  if (typeof section["model"] === "string" && section["model"] !== "")
    out.model = section["model"];
  return out;
}

/**
 * Write `[secondary_model]` picking the given alias as the subagent model.
 *
 * Pool-aware: when a pool exists (`models` table or `default_model` present)
 * the alias becomes the v2 default (added to the `models` table with an empty
 * description when missing) and the legacy `model` key is synced; the rest of
 * the section — `force`, patch fields, unknown fields — is preserved. This
 * keeps usage records keyed on the real model alias instead of the
 * synthesized `__secondary__` derived entry.
 *
 * Without a pool the legacy single-model form is written: only `model`, with
 * the known patch fields (`default_effort`, `max_output_size`,
 * `max_context_size`) dropped so stale patches are cleaned up when the model
 * is re-picked; unknown fields are preserved.
 */
export function setSecondaryModelOnly(
  rawOther: unknown,
  alias: string
): unknown {
  const root = { ...asRecord(rawOther) };
  const section = asRecord(asRecord(rawOther)["secondary_model"]);
  const next: Record<string, unknown> = {};
  const hasPool =
    section["models"] !== undefined || section["default_model"] !== undefined;
  if (hasPool) {
    for (const [k, v] of Object.entries(section)) next[k] = v;
    next.default_model = alias;
    next.model = alias;
    const models: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(asRecord(next.models))) models[k] = v;
    if (!(alias in models)) models[alias] = "";
    next.models = models;
  } else {
    for (const [k, v] of Object.entries(section)) {
      if (!PATCH_FIELDS.has(k)) next[k] = v;
    }
    next.model = alias;
  }
  root.secondary_model = next;
  return root;
}

/**
 * Rebuild the subagent model pool atomically. `default_model` and `model` are
 * written with the same value — the effective default, `defaultModel ?? model`
 * — plus the `models` table and `force`; unknown fields in the section are
 * preserved. An empty `models` table is omitted: the engine requires
 * `default_model` to be a key of the table, so an empty table can never be
 * valid, and omitting it keeps the implicit single-entry form.
 */
export function setSubagentModelPool(
  rawOther: unknown,
  pool: SubagentModelPool
): unknown {
  const root = { ...asRecord(rawOther) };
  const section = asRecord(asRecord(rawOther)["secondary_model"]);
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(section)) next[k] = v;
  const effective = pool.defaultModel ?? pool.model;
  if (effective) {
    next.default_model = effective;
    next.model = effective;
  } else {
    delete next.default_model;
    delete next.model;
  }
  if (Object.keys(pool.models).length > 0) {
    next.models = { ...pool.models };
  } else {
    delete next.models;
  }
  next.force = pool.force === true;
  root.secondary_model = next;
  return root;
}

/** Add or update one alias in the pool `models` table. When the section is
 *  the implicit single-entry form (a `default_model`/`model` but no table),
 *  the effective default is materialized into the table first — otherwise the
 *  new table would fail the engine rule "default_model must be a pool key".
 *  The rest of the section (force, unknown fields) is preserved untouched. */
export function upsertSubagentPoolEntry(
  rawOther: unknown,
  alias: string,
  description: string
): unknown {
  const root = { ...asRecord(rawOther) };
  const section = asRecord(asRecord(rawOther)["secondary_model"]);
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(section)) next[k] = v;
  const models: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(asRecord(next.models))) models[k] = v;
  const effectiveDefault =
    typeof next.default_model === "string" && next.default_model !== ""
      ? next.default_model
      : typeof next.model === "string" && next.model !== ""
        ? next.model
        : undefined;
  if (effectiveDefault !== undefined && !(effectiveDefault in models)) {
    models[effectiveDefault] = "";
  }
  models[alias] = description;
  next.models = models;
  if (effectiveDefault !== undefined) {
    next.default_model = effectiveDefault;
    next.model = effectiveDefault;
  }
  root.secondary_model = next;
  return root;
}

/**
 * Remove one alias from the pool `models` table. If it was the default, the
 * default falls back to the first remaining key (`default_model` and `model`
 * are both synced). Removing the last entry drops the `models` table and
 * leaves `default_model`/`model` in place — the implicit single-entry pool.
 */
export function removeSubagentPoolEntry(
  rawOther: unknown,
  alias: string
): unknown {
  const root = { ...asRecord(rawOther) };
  const section = asRecord(asRecord(rawOther)["secondary_model"]);
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(section)) next[k] = v;
  const models: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(asRecord(next.models))) {
    if (k !== alias) models[k] = v;
  }
  const remaining = Object.keys(models);
  if (remaining.length === 0) {
    delete next.models;
  } else {
    next.models = models;
    if (next.default_model === alias) {
      next.default_model = remaining[0];
      next.model = remaining[0];
    }
  }
  root.secondary_model = next;
  return root;
}

/** Set the pool default alias, syncing `default_model` and `model`; the alias
 *  is added to the `models` table with an empty description when missing. */
export function setSubagentDefault(
  rawOther: unknown,
  alias: string
): unknown {
  const root = { ...asRecord(rawOther) };
  const section = asRecord(asRecord(rawOther)["secondary_model"]);
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(section)) next[k] = v;
  const models: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(asRecord(next.models))) models[k] = v;
  if (!(alias in models)) models[alias] = "";
  next.models = models;
  next.default_model = alias;
  next.model = alias;
  root.secondary_model = next;
  return root;
}

/**
 * Set the `force` flag. Turning force on drops the `models` table — `force`
 * and the pool table are mutually exclusive per the engine (the implicit
 * `default_model`/`model` form stays); turning it off leaves the table
 * untouched. Everything else in the section is preserved.
 */
export function setSubagentForce(
  rawOther: unknown,
  force: boolean
): unknown {
  const root = { ...asRecord(rawOther) };
  const section = asRecord(asRecord(rawOther)["secondary_model"]);
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(section)) {
    if (force && k === "models") continue;
    next[k] = v;
  }
  next.force = force;
  root.secondary_model = next;
  return root;
}

/** Keys of validation errors, mirroring the kimi-code engine checks. */
export type ValidationErrorKey =
  | "primaryReserved"
  | "defaultRequired"
  | "defaultNotInPool"
  | "aliasNotInModels"
  | "forceRequiresDefault"
  | "forceExcludesModels";

/** A pool validation error; `params` carries the offending alias. */
export interface PoolValidationError {
  key: ValidationErrorKey;
  params?: Record<string, string>;
}

/**
 * Mirror the kimi-code engine validation for the subagent model pool
 * (violations fail the kimi session with CONFIG_INVALID):
 * 1. `"primary"` is reserved and cannot be a pool key;
 * 2. a `models` table requires `default_model`;
 * 3. `default_model` must be a key of the `models` table;
 * 4. every pool key must resolve in the top-level `[models]` registry;
 * 5. `force` requires a default (`default_model` or the `model` fallback);
 * 6. `force` and a `models` table are mutually exclusive.
 *
 * `availableAliases` is the set of top-level `[models]` aliases. A pool
 * without a `models` table is the implicit single-entry form: only the
 * effective default is checked against the registry.
 */
export function validateSubagentPool(
  pool: SubagentModelPool,
  availableAliases: string[]
): PoolValidationError[] {
  const errors: PoolValidationError[] = [];
  const { defaultModel, model, models, force } = pool;
  const effectiveDefault = defaultModel ?? model;
  const poolKeys = Object.keys(models);
  const hasPoolTable = poolKeys.length > 0;
  const registry = new Set(availableAliases);

  const aliasError = (alias: string) => {
    if (alias !== "primary" && !registry.has(alias)) {
      errors.push({ key: "aliasNotInModels", params: { alias } });
    }
  };

  // Rule 1: "primary" is reserved as a pool key.
  if (effectiveDefault === "primary") {
    errors.push({ key: "primaryReserved", params: { alias: "primary" } });
  }
  for (const key of poolKeys) {
    if (key === "primary") {
      errors.push({ key: "primaryReserved", params: { alias: key } });
    }
  }

  // Rule 2: a `models` table requires `default_model`.
  if (hasPoolTable && !defaultModel) {
    errors.push({ key: "defaultRequired" });
  }

  // Rule 3: `default_model` must be a key of the `models` table.
  if (hasPoolTable && defaultModel && !(defaultModel in models)) {
    errors.push({ key: "defaultNotInPool", params: { alias: defaultModel } });
  }

  // Rule 4: every pool key must resolve in the `[models]` registry.
  for (const key of poolKeys) aliasError(key);
  if (!hasPoolTable && effectiveDefault) aliasError(effectiveDefault);

  // Rule 5: `force` requires a default (`default_model` or `model` fallback).
  if (force && !effectiveDefault) {
    errors.push({ key: "forceRequiresDefault" });
  }

  // Rule 6: `force` and a `models` table are mutually exclusive.
  if (force && hasPoolTable) {
    errors.push({ key: "forceExcludesModels" });
  }

  return errors;
}

/** Remove `[secondary_model]` entirely (the "not configured" option). */
export function clearSecondaryModel(rawOther: unknown): unknown {
  const root = { ...asRecord(rawOther) };
  delete root.secondary_model;
  return root;
}
