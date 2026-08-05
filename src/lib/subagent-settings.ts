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
}

/** Known experimental flags (Kimi Code v1 + v2 registries, merged). */
export const EXPERIMENTAL_FLAGS: ExperimentalFlagDef[] = [
  { id: "secondary-model", envVar: "KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL" },
  { id: "tool-select", envVar: "KIMI_CODE_EXPERIMENTAL_TOOL_SELECT" },
  { id: "acp-v2", envVar: "KIMI_CODE_EXPERIMENTAL_ACP_V2" },
  {
    id: "persistence_minidb_readmodel",
    envVar: "KIMI_CODE_EXPERIMENTAL_PERSISTENCE_MINIDB_READMODEL",
  },
];

export const EXPERIMENTAL_MASTER_ENV = "KIMI_CODE_EXPERIMENTAL_FLAG";

/** Whether the master env var is set to a truthy value (locks every flag on). */
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

/** Set one flag in `[experimental]`. Removing all flags drops the section. */
export function setExperimentalFlag(
  rawOther: unknown,
  id: string,
  enabled: boolean
): unknown {
  const root = { ...asRecord(rawOther) };
  const flags = { ...getExperimentalFlags(rawOther) };
  if (enabled) {
    flags[id] = true;
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
// [secondary_model] — subagent secondary model
// ---------------------------------------------------------------------------

/** Read `[secondary_model]` from raw_other; `{}` when absent. */
export function getSecondaryModel(rawOther: unknown): SecondaryModelConfig {
  const section = asRecord(rawOther)["secondary_model"];
  const cfg = asRecord(section);
  const out: SecondaryModelConfig = {};
  if (typeof cfg.model === "string" && cfg.model !== "") out.model = cfg.model;
  if (typeof cfg.default_effort === "string" && cfg.default_effort !== "")
    out.default_effort = cfg.default_effort;
  if (typeof cfg.max_output_size === "number" && cfg.max_output_size > 0)
    out.max_output_size = cfg.max_output_size;
  if (typeof cfg.max_context_size === "number" && cfg.max_context_size > 0)
    out.max_context_size = cfg.max_context_size;
  return out;
}

/**
 * Write `[secondary_model]` with only the `model` field — no patch fields.
 * Subagents then bind the pointed model entry directly and inherit its
 * settings (context size, capabilities, effort fallback), which also keeps
 * usage records keyed on the real model alias instead of the synthesized
 * `__secondary__` derived entry. Unknown fields already present in the
 * section are preserved; the known patch fields (`default_effort`,
 * `max_output_size`, `max_context_size`) are dropped so stale patches are
 * cleaned up when the model is re-picked.
 */
export function setSecondaryModelOnly(
  rawOther: unknown,
  alias: string
): unknown {
  const root = { ...asRecord(rawOther) };
  const section = asRecord(asRecord(rawOther)["secondary_model"]);
  const next: Record<string, unknown> = { model: alias };
  const knownFields: ReadonlySet<string> = new Set([
    "model",
    "default_effort",
    "max_output_size",
    "max_context_size",
  ]);
  for (const [k, v] of Object.entries(section)) {
    if (!knownFields.has(k)) next[k] = v;
  }
  root.secondary_model = next;
  return root;
}

/** Remove `[secondary_model]` entirely (the "not configured" option). */
export function clearSecondaryModel(rawOther: unknown): unknown {
  const root = { ...asRecord(rawOther) };
  delete root.secondary_model;
  return root;
}
