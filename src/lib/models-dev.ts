import snapshot from "./models-dev.json";

/**
 * Compact per-model reference data from models.dev
 * (see scripts/fetch-models-dev.mjs).
 */
export interface ModelRef {
  name?: string;
  context?: number;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  image?: boolean;
  video?: boolean;
}

const data: Record<string, ModelRef> = snapshot;

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
