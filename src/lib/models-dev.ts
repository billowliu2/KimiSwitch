import snapshot from "./models-dev.json";

/**
 * Compact per-model reference data from models.dev
 * (see scripts/fetch-models-dev.mjs).
 */
export interface ModelCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface ModelRef {
  name?: string;
  context?: number;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  image?: boolean;
  video?: boolean;
  /** $/M tokens from models.dev (added by fetch-models-dev.mjs). */
  cost?: ModelCost;
}

const raw = snapshot as Record<string, unknown>;

// Drop the "last_updated" metadata key; the rest is "<provider>/<model>".
const data: Record<string, ModelRef> = {};
for (const [key, value] of Object.entries(raw)) {
  if (key !== "last_updated" && value && typeof value === "object") {
    data[key] = value as ModelRef;
  }
}

// models.dev keys are "<lab>/<model>" and may be mixed-case (e.g.
// "minimax/MiniMax-M3"), while provider APIs return bare model ids
// (e.g. "kimi-k2.5"). Index lowercase for tolerant matching.
const byLowerKey: Record<string, ModelRef> = {};
for (const [key, value] of Object.entries(data)) {
  byLowerKey[key.toLowerCase()] = value;
}

/**
 * Look up reference data for a provider model id.
 * Matches exact key first, then any "<lab>/<id>" suffix.
 * Returns undefined when nothing matches — callers fall back to
 * getDefaultMaxContextSize / manual capabilities.
 */
export function getModelRef(modelId: string): ModelRef | undefined {
  const id = modelId.trim().toLowerCase();
  if (!id) return undefined;
  const exact = byLowerKey[id];
  if (exact) return exact;
  const suffix = `/${id}`;
  for (const [key, value] of Object.entries(byLowerKey)) {
    if (key.endsWith(suffix)) return value;
  }
  return undefined;
}

/**
 * Map reference data to Kimi Code capability flags.
 * Multimodal (image_in/video_in) comes from models.dev input modalities;
 * always_thinking cannot be derived and stays manual.
 */
export function capabilitiesFromRef(ref: ModelRef): string[] {
  const caps: string[] = [];
  if (ref.reasoning) caps.push("thinking");
  if (ref.tool_call) caps.push("tool_use");
  if (ref.image) caps.push("image_in");
  if (ref.video) caps.push("video_in");
  return caps;
}
