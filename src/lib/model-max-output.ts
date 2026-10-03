import type { Model } from "../types";

/**
 * Helpers for the `max_output_size` model field.
 *
 * kimi-code keeps it in `[models."<alias>"] max_output_size`; it is not a
 * first-class field of Kimi Switch's Rust `Model` struct, so it round-trips
 * through `raw_other` (the pass-through bucket for unknown keys). Absent key =
 * unset = the upstream default applies, so clearing the field removes the key
 * rather than writing 0.
 */

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** Read the override; undefined when absent or malformed (treated as unset). */
export function readMaxOutputSize(rawOther: unknown): number | undefined {
  const value = asRecord(rawOther).max_output_size;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

/** Parse the number input: blank / 0 / NaN mean "unset". */
export function parseMaxOutputInput(text: string): number | undefined {
  const value = parseInt(text, 10);
  if (isNaN(value) || value <= 0) return undefined;
  return value;
}

/**
 * Set (positive value) or drop (undefined) `max_output_size` on a raw_other
 * blob; every other preserved key is kept.
 */
export function setMaxOutputSize(
  rawOther: unknown,
  value: number | undefined,
): Record<string, unknown> {
  const next = { ...asRecord(rawOther) };
  if (value === undefined) {
    delete next.max_output_size;
  } else {
    next.max_output_size = Math.floor(value);
  }
  return next;
}

/** Immutable update of a model entry's max_output_size override. */
export function withMaxOutputSize(
  model: Model,
  value: number | undefined,
): Model {
  return { ...model, raw_other: setMaxOutputSize(model.raw_other, value) };
}
