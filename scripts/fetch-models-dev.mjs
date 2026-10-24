#!/usr/bin/env node
/**
 * Fetch the latest model reference data from models.dev and write:
 *   1. src/lib/models-dev.json      — compact per-model snapshot; embedded
 *                                     into the Rust binary by dashboard.rs
 *                                     (include_str!) and loaded by the
 *                                     frontend as fallback
 *   2. public/models-dev.json       — the same snapshot as a static asset;
 *                                     this is what the frontend actually
 *                                     serves at runtime (must stay in sync
 *                                     with #1 — they serve different halves
 *                                     of the app)
 *   3. src/lib/models-dev-full.json — provider-grouped full list incl. pricing
 *   4. src/lib/models-dev.last-good.json — local backup of the last success
 *
 * The data source is https://models.dev/api.json (176 providers; each model
 * carries `cost` = { input, output, cache_read?, cache_write? } in $/M tokens).
 * Note: https://models.dev/models.json does NOT include pricing — use api.json.
 *
 * Offline behaviour: when models.dev is unreachable, the script keeps using
 * the local snapshot (the committed src/lib/models-dev.json) so builds always
 * carry the last known prices. If that file is missing, it restores from the
 * last-good backup.
 *
 * Run manually (`npm run fetch-models-dev`) or automatically before builds
 * (`prebuild` / `pretauri`). Requires network access to models.dev.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── proxy bootstrap ─────────────────────────────────────────────────────────
// Node's fetch only honors HTTP(S)_PROXY when NODE_USE_ENV_PROXY=1 is set at
// startup. On proxied networks (e.g. git http.proxy), re-exec ourselves with
// the flag so `npm run fetch-models-dev` works without manual env.
const proxyEnv =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;
let proxy = proxyEnv;
if (!proxy) {
  try {
    const g = spawnSync("git", ["config", "--get", "http.proxy"], {
      encoding: "utf8",
    });
    if (g.status === 0 && g.stdout.trim()) proxy = g.stdout.trim();
  } catch {
    /* no git / no proxy — direct connection */
  }
}
if (proxy && process.env.NODE_USE_ENV_PROXY !== "1") {
  const r = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_USE_ENV_PROXY: "1",
        HTTPS_PROXY: proxy,
        HTTP_PROXY: proxy,
      },
    },
  );
  process.exit(r.status ?? 1);
}

const SOURCE_URL = "https://models.dev/api.json";
/**
 * Compact-snapshot schema version, written into both generated files.
 * v1 = no stamp; v2 = per-model `efforts` / `off_effort` / `toggle` parsed
 * from `reasoning_options`. models_dev.rs refuses a runtime-synced copy
 * (~/.kimi-switch/models-dev.json) whose stamp is missing or older, so a stale
 * v1 copy cannot shadow the newer built-in snapshot; the settings page's
 * "sync now" rewrites it in the current format.
 * MUST match SNAPSHOT_SCHEMA_VERSION in src-tauri/src/models_dev.rs.
 */
const SCHEMA_VERSION = 2;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "src", "lib", "models-dev.json");
// Static-asset copy served to the frontend (see header — must equal SNAPSHOT).
const SNAPSHOT_PUBLIC = join(ROOT, "public", "models-dev.json");
const FULL = join(ROOT, "src", "lib", "models-dev-full.json");
// Local backup of the last successful snapshot. Not committed to git (see
// .gitignore); the committed models-dev.json itself is the versioned fallback.
const BACKUP = join(ROOT, "src", "lib", "models-dev.last-good.json");

/** Keep only the numeric cost fields the app bills with. */
function pickCost(cost) {
  if (!cost || typeof cost !== "object") return undefined;
  const out = {};
  for (const k of ["input", "output", "cache_read", "cache_write"]) {
    if (typeof cost[k] === "number") out[k] = cost[k];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parse models.dev `reasoning_options` into the fields the app reads.
 *
 * Shape: an array whose elements are either `{type:"effort",values:[...]}`
 * (strings = tiers; `"none"` or `null` = an explicit "off" tier) or
 * `{type:"toggle"}` (the model has a thinking on/off switch).
 * Returns undefined when nothing usable is found — an absent key means
 * "unknown", never "no tiers".
 */
function pickReasoningOptions(m) {
  const options = m?.reasoning_options;
  if (!Array.isArray(options)) return undefined;
  const efforts = [];
  const seen = new Set();
  let off = false;
  let toggle = false;
  for (const opt of options) {
    if (!opt || typeof opt !== "object") continue;
    const type = typeof opt.type === "string" ? opt.type.toLowerCase() : "";
    if (type === "toggle") {
      toggle = true;
      continue;
    }
    if (type !== "effort" || !Array.isArray(opt.values)) continue;
    for (const value of opt.values) {
      // A null entry is the "off" tier spelled without a label.
      if (value === null) {
        off = true;
        continue;
      }
      if (typeof value !== "string") continue;
      const tier = value.trim();
      if (!tier) continue;
      if (tier.toLowerCase() === "none") {
        off = true;
        continue;
      }
      if (seen.has(tier)) continue;
      seen.add(tier);
      efforts.push(tier);
    }
  }
  const out = {};
  if (efforts.length > 0) out.efforts = efforts;
  if (off) out.off_effort = "none";
  if (toggle) out.toggle = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

async function main() {
  const res = await fetch(SOURCE_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  /** @type {Record<string, any>} */
  const raw = await res.json();

  // ── snapshot: "<provider>/<model>" → compact fields (frontend) ────────────
  // Keeps the shape callers already consume (getModelRef / capabilitiesFromRef)
  // and adds `cost`. The `schema_version` / `last_updated` scalars head the
  // file; both sides skip non-object entries when indexing.
  const snapshot = {
    schema_version: SCHEMA_VERSION,
    last_updated: new Date().toISOString().slice(0, 10),
  };

  // ── full list: provider → { name, models: [...] } incl. pricing ───────────
  // Human-readable complete inventory for price benchmarking / debugging.
  const full = {
    schema_version: SCHEMA_VERSION,
    last_updated: snapshot.last_updated,
    providers: {},
  };

  let modelCount = 0;
  for (const [providerId, provider] of Object.entries(raw)) {
    if (!provider || typeof provider !== "object") continue;
    const models = provider.models;
    if (!models || typeof models !== "object") continue;

    const providerEntry = {
      id: providerId,
      name: typeof provider.name === "string" ? provider.name : providerId,
      models: [],
    };

    for (const [modelId, m] of Object.entries(models)) {
      if (!m || typeof m !== "object") continue;
      const key = `${providerId}/${modelId}`;

      // snapshot entry
      const entry = {};
      if (typeof m.name === "string") entry.name = m.name;
      // context 0 means "not applicable" (image/audio models) — treat as missing
      // so callers fall back to regex defaults instead of storing 0.
      if (typeof m.limit?.context === "number" && m.limit.context > 0) {
        entry.context = m.limit.context;
      }
      // Max output tokens — the reference value behind the max_output_size
      // column (model mapping table).
      if (typeof m.limit?.output === "number" && m.limit.output > 0) {
        entry.output = m.limit.output;
      }
      if (m.reasoning === true) entry.reasoning = true;
      if (m.tool_call === true) entry.tool_call = true;
      if (m.structured_output === true) entry.structured_output = true;
      const input = m.modalities?.input;
      if (Array.isArray(input)) {
        if (input.includes("image")) entry.image = true;
        if (input.includes("video")) entry.video = true;
      }
      const cost = pickCost(m.cost);
      if (cost) entry.cost = cost;
      // Thinking tiers / off switch / toggle — see pickReasoningOptions.
      const reasoningOptions = pickReasoningOptions(m);
      if (reasoningOptions) Object.assign(entry, reasoningOptions);
      snapshot[key] = entry;

      // full-list entry
      providerEntry.models.push({
        id: modelId,
        name: typeof m.name === "string" ? m.name : modelId,
        ...(cost ? { cost } : {}),
        ...(reasoningOptions ?? {}),
        ...(typeof m.limit?.context === "number" && m.limit.context > 0
          ? { context: m.limit.context }
          : {}),
        ...(typeof m.limit?.input === "number" && m.limit.input > 0
          ? { input_limit: m.limit.input }
          : {}),
        ...(typeof m.limit?.output === "number" && m.limit.output > 0
          ? { output_limit: m.limit.output }
          : {}),
        ...(m.reasoning === true ? { reasoning: true } : {}),
        ...(m.tool_call === true ? { tool_call: true } : {}),
        ...(m.structured_output === true ? { structured_output: true } : {}),
        ...(Array.isArray(input) && input.includes("image")
          ? { image: true }
          : {}),
        ...(Array.isArray(input) && input.includes("video")
          ? { video: true }
          : {}),
      });
      modelCount += 1;
    }

    if (providerEntry.models.length > 0) {
      full.providers[providerId] = providerEntry;
    }
  }

  await mkdir(dirname(SNAPSHOT), { recursive: true });
  await mkdir(dirname(SNAPSHOT_PUBLIC), { recursive: true });
  const json = JSON.stringify(snapshot, null, 2) + "\n";
  await writeFile(SNAPSHOT, json, "utf8");
  await writeFile(SNAPSHOT_PUBLIC, json, "utf8");
  await writeFile(FULL, JSON.stringify(full, null, 2) + "\n", "utf8");
  await writeFile(BACKUP, json, "utf8");

  console.log(`models.dev snapshot: ${modelCount} models -> ${SNAPSHOT}`);
  console.log(`models.dev static asset: -> ${SNAPSHOT_PUBLIC}`);
  console.log(
    `models.dev full list: ${Object.keys(full.providers).length} providers -> ${FULL}`,
  );
}

main().catch(async (err) => {
  // Offline fallback: builds must keep using the last known prices.
  try {
    const existing = await readFile(SNAPSHOT, "utf8");
    const stamp = JSON.parse(existing).last_updated ?? "unknown";
    console.warn(
      `[fetch-models-dev] models.dev unreachable (${err.message}); ` +
        `using local snapshot (last synced ${stamp})`,
    );
  } catch {
    try {
      const backup = await readFile(BACKUP, "utf8");
      await writeFile(SNAPSHOT, backup, "utf8");
      console.warn(
        "[fetch-models-dev] models.dev unreachable; restored models-dev.json from last-good backup",
      );
    } catch {
      console.error(
        "[fetch-models-dev] models.dev unreachable and no local snapshot found; " +
          "run online once to generate src/lib/models-dev.json",
      );
      process.exit(1);
    }
  }
});
