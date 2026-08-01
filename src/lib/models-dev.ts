/**
 * Compact per-model reference data from models.dev
 * (see scripts/fetch-models-dev.mjs).
 *
 * The snapshot (~1.3 MB JSON) is NOT bundled into the main chunk anymore:
 * parsing a 1.3 MB JSON literal at startup blocks first paint. It is served
 * as a static asset (`/models-dev.json`) and loaded once in the background.
 * `getModelRef` stays synchronous and returns undefined until the index is
 * ready — callers already fall back to defaults — and `modelsDevReady()`
 * lets the app re-render once the index arrives.
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

let byLowerKey: Record<string, ModelRef> | null = null;
let readyListeners: Array<() => void> = [];

function buildIndex(raw: Record<string, unknown>) {
  const data: Record<string, ModelRef> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key !== "last_updated" && value && typeof value === "object") {
      data[key] = value as ModelRef;
    }
  }
  // models.dev keys are "<lab>/<model>" and may be mixed-case (e.g.
  // "minimax/MiniMax-M3"), while provider APIs return bare model ids
  // (e.g. "kimi-k2.5"). Index lowercase for tolerant matching.
  const lower: Record<string, ModelRef> = {};
  for (const [key, value] of Object.entries(data)) {
    lower[key.toLowerCase()] = value;
  }
  return lower;
}

let loadPromise: Promise<void> | null = null;

export function modelsDevReady(): Promise<void> {
  if (!loadPromise) {
    loadPromise = fetch(`${import.meta.env.BASE_URL}models-dev.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`models-dev.json HTTP ${r.status}`);
        return r.json() as Promise<Record<string, unknown>>;
      })
      .then((raw) => {
        byLowerKey = buildIndex(raw);
        const listeners = readyListeners;
        readyListeners = [];
        for (const cb of listeners) cb();
      })
      .catch((err) => {
        // A failed load is permanent for this session: fall back to defaults.
        byLowerKey = {};
        loadPromise = null; // allow one retry next time
        console.warn("models-dev.json load failed:", err);
      });
  }
  return loadPromise;
}

/** Register a callback invoked once the models.dev index is ready. */
export function onModelsDevReady(cb: () => void): void {
  if (byLowerKey) {
    cb();
    return;
  }
  readyListeners.push(cb);
}

/**
 * Look up reference data for a provider model id.
 * Matches exact key first, then any "<lab>/<id>" suffix.
 * Returns undefined when nothing matches — callers fall back to
 * getDefaultMaxContextSize / manual capabilities.
 */
export function getModelRef(modelId: string): ModelRef | undefined {
  const id = modelId.trim().toLowerCase();
  if (!id || !byLowerKey) return undefined;
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
