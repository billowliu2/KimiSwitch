/**
 * Thinking-effort capability resolution.
 *
 * kimi-code's `[thinking] effort` is a free-form string (low/medium/high/
 * xhigh/max in practice) that the CLI forwards verbatim to OpenAI-compatible
 * upstreams as `reasoning_effort`. Which tiers a given model accepts is
 * declared per model in config.toml (`[models."<alias>"] support_efforts`);
 * models.dev only carries a boolean `reasoning` flag with no tier list. The
 * two sources are merged here so the UI can grey out tiers the current default
 * model would reject, without ever rejecting a stored value on read.
 */

import type { Model } from "../types";

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
