/**
 * Thinking-effort capability resolution.
 *
 * kimi-code's `[thinking] effort` is a free-form string (low/medium/high/
 * xhigh/max in practice) that the CLI forwards verbatim to OpenAI-compatible
 * upstreams as `reasoning_effort`. Which tiers a given model accepts is
 * declared per model in config.toml (`[models."<alias>"] support_efforts`) —
 * that list is what the CLI validates `default_effort` against, so it
 * outranks every other source. models.dev carries the same information in
 * `reasoning_options` (mapped to `efforts` / `off_effort` / `toggle` on
 * `ModelRef`) and only fills in models that declare nothing locally. The
 * sources are merged here so the UI can grey out tiers the current default
 * model would reject, without ever rejecting a stored value on read.
 */

import type { Config, Model } from "../types";
import { capabilitiesFromRef, getModelRef, type ModelRef } from "./models-dev";

export const THINKING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingEffort = (typeof THINKING_EFFORTS)[number];

/** Why a tier is blocked, or (for undeclared models) merely unverified. */
export type EffortNote =
  | { kind: "thinkingUnsupported" }
  | { kind: "tierUnsupported"; supported: string[] }
  | { kind: "tierUndeclared" };

export interface EffortAvailability {
  /** Whether the tier can be picked. */
  enabled: boolean;
  /** Advisory message — set for blocked tiers and for unverified ones. */
  note?: EffortNote;
}

export interface ThinkingEffortSupport {
  /** False only when the model is known not to support thinking at all. */
  thinkingSupported: boolean;
  /** Declared tiers, or null when nothing is known about the model. */
  declared: string[] | null;
  levels: Record<ThinkingEffort, EffortAvailability>;
}

/** Tiers offered unverified when a model declares nothing at all. */
const ALWAYS_OFFERED = new Set<string>(["low", "medium", "high"]);

/**
 * Normalize a `support_efforts` value into a comparable list, or null when the
 * key is absent / malformed (treating it as "unknown", not "none supported").
 */
export function normalizeSupportEfforts(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const tiers = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return tiers.length > 0 ? tiers : null;
}

/** Read `support_efforts` from a model entry's preserved config.toml fields. */
export function readSupportEfforts(model: Model | undefined): string[] | null {
  if (!model) return null;
  const raw = model.raw_other;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return normalizeSupportEfforts(
    (raw as Record<string, unknown>).support_efforts
  );
}

function buildLevels(
  resolve: (effort: ThinkingEffort) => EffortAvailability
): Record<ThinkingEffort, EffortAvailability> {
  const levels = {} as Record<ThinkingEffort, EffortAvailability>;
  for (const effort of THINKING_EFFORTS) levels[effort] = resolve(effort);
  return levels;
}

/**
 * Resolve per-tier availability from the two capability sources, in priority
 * order:
 *  1. `supportEfforts` declared → tiers follow the list exactly.
 *  2. models.dev `reasoning === false` → the whole thinking area is off.
 *  3. Nothing known → low/medium/high are offered plain, max/xhigh stay
 *     selectable but carry a "not declared" note (upstream may reject them).
 */
export function resolveThinkingEffortSupport(input: {
  supportEfforts?: unknown;
  reasoning?: boolean;
}): ThinkingEffortSupport {
  const declared = normalizeSupportEfforts(input.supportEfforts);
  if (declared) {
    const supported = new Set(declared.map((t) => t.toLowerCase()));
    return {
      thinkingSupported: true,
      declared,
      levels: buildLevels((effort) =>
        supported.has(effort)
          ? { enabled: true }
          : {
              enabled: false,
              note: { kind: "tierUnsupported", supported: declared },
            }
      ),
    };
  }
  if (input.reasoning === false) {
    return {
      thinkingSupported: false,
      declared: null,
      levels: buildLevels(() => ({
        enabled: false,
        note: { kind: "thinkingUnsupported" },
      })),
    };
  }
  return {
    thinkingSupported: true,
    declared: null,
    levels: buildLevels((effort) =>
      ALWAYS_OFFERED.has(effort)
        ? { enabled: true }
        : { enabled: true, note: { kind: "tierUndeclared" } }
    ),
  };
}

// ---------------------------------------------------------------------------
// Per-model effort defaults
//
// `[models."<alias>"]` entries carry two thinking keys: `support_efforts`
// (the accepted tier list) and `default_effort` (the tier the CLI starts
// with). Both round-trip through `raw_other` because the Rust `Model` struct
// does not model them. The helpers below seed those keys from the resolved
// tier list — the model's own `support_efforts`, else models.dev reference
// data — keeping `default_effort` inside the list the CLI validates.
// ---------------------------------------------------------------------------

/** Tier the UI prefers whenever a model offers it. */
export const PREFERRED_EFFORT = "high";

/** Tier strength ordering; labels we don't know rank below every known tier. */
export const TIER_RANK: Record<string, number> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

export interface ModelEfforts {
  /** Accepted tiers, or null when nothing is known about the model. */
  tiers: string[] | null;
  /** The "off" tier value when the model has an explicit thinking-off switch. */
  offEffort?: string;
  thinkingSupported: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function rankOf(tier: string): number {
  return TIER_RANK[tier.trim().toLowerCase()] ?? -1;
}

function sameTier(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Tiers for a model, in priority order: the model's own
 * `raw_other.support_efforts` (the list the CLI actually validates
 * `default_effort` against), then models.dev `reasoning_options`
 * (`ModelRef.efforts`) for models that declare nothing locally, then
 * "unknown" (null) — which never disables anything.
 */
export function resolveModelEfforts(
  model: Model,
  ref?: ModelRef | undefined
): ModelEfforts {
  const tiers =
    readSupportEfforts(model) ?? normalizeSupportEfforts(ref?.efforts);
  const off = ref?.off_effort;
  const offEffort =
    typeof off === "string" && off.trim().length > 0 ? off : undefined;
  const capabilities = Array.isArray(model.capabilities) ? model.capabilities : [];
  // Only an explicit models.dev `reasoning: false` with no contradicting
  // local signal counts as "no thinking"; unknown stays supported.
  const thinkingSupported = !(
    tiers === null &&
    ref?.reasoning === false &&
    !capabilities.includes("thinking") &&
    !capabilities.includes("always_thinking")
  );
  return { tiers, offEffort, thinkingSupported };
}

/** Read `default_effort` from a model entry's preserved config.toml fields. */
export function readDefaultEffort(model: Model): string | undefined {
  const value = asRecord(model.raw_other).default_effort;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The tier to default to: `high` when offered, otherwise the strongest known
 * tier (ties go to the later entry, so a curated list wins over a guess).
 */
export function resolveDefaultTier(
  tiers: string[] | null | undefined
): string | undefined {
  if (!tiers || tiers.length === 0) return undefined;
  let best: string | undefined;
  let bestRank = Number.NEGATIVE_INFINITY;
  for (const raw of tiers) {
    if (typeof raw !== "string") continue;
    const tier = raw.trim();
    if (!tier) continue;
    if (tier.toLowerCase() === PREFERRED_EFFORT) return tier;
    const rank = rankOf(tier);
    if (rank >= bestRank) {
      best = tier;
      bestRank = rank;
    }
  }
  return best;
}

/** Keep the stored tier when the model still offers it, else the best tier. */
export function effectiveDefaultEffort(
  tiers: string[] | null,
  stored?: string
): string | undefined {
  if (!tiers || tiers.length === 0) return undefined;
  if (typeof stored === "string" && stored.trim().length > 0) {
    const match = tiers.some((t) => typeof t === "string" && sameTier(t, stored));
    if (match) return stored;
  }
  return resolveDefaultTier(tiers);
}

/**
 * Write `default_effort`; also records `support_efforts` when the model had
 * none, so the CLI and the UI agree on the accepted list. Every other
 * preserved key is kept.
 */
export function setModelEffort(
  model: Model,
  effort: string,
  tiers: string[] | null
): Model {
  const raw_other = { ...asRecord(model.raw_other) };
  raw_other.default_effort = effort;
  const hasTiers = normalizeSupportEfforts(raw_other.support_efforts) !== null;
  if (tiers && tiers.length > 0 && !hasTiers) {
    raw_other.support_efforts = [...tiers];
  }
  return { ...model, raw_other };
}

/**
 * Fill in a missing (or no-longer-valid) `default_effort` from the resolved
 * tiers. Models with a valid stored value, or with no tiers at all, are
 * returned unchanged — running this twice is a no-op.
 */
export function seedModelEffort(
  model: Model,
  ref?: ModelRef | undefined
): Model {
  const { tiers } = resolveModelEfforts(model, ref);
  if (!tiers) return model;
  const stored = readDefaultEffort(model);
  const storedSupported =
    stored !== undefined &&
    tiers.some((t) => typeof t === "string" && sameTier(t, stored));
  if (storedSupported) return model;
  const tier = resolveDefaultTier(tiers);
  if (!tier) return model;
  return setModelEffort(model, tier, tiers);
}

/**
 * Seed both capabilities (when the entry declares none) and the effort
 * default from models.dev reference data.
 */
export function seedModelFromReference(
  model: Model,
  ref?: ModelRef | undefined
): Model {
  let next = model;
  const capabilities = Array.isArray(model.capabilities) ? model.capabilities : [];
  if (capabilities.length === 0 && ref) {
    const derived = capabilitiesFromRef(ref);
    if (derived.length > 0) next = { ...model, capabilities: derived };
  }
  return seedModelEffort(next, ref);
}

/**
 * Seed effort defaults for every model in a config, leaving all other fields
 * untouched. Returns the config itself when nothing needed changing.
 */
export function materializeModelEfforts(config: Config): Config {
  const models: Record<string, Model> = {};
  let changed = false;
  for (const [alias, model] of Object.entries(config.models)) {
    const next = seedModelEffort(model, getModelRef(model.model));
    if (next !== model) changed = true;
    models[alias] = next;
  }
  return changed ? { ...config, models } : config;
}
