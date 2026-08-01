#!/usr/bin/env node
/**
 * Fetch the latest model reference data from models.dev and write:
 *   1. src/lib/models-dev.json      — compact per-model snapshot (frontend)
 *   2. src/lib/models-dev-full.json — provider-grouped full list incl. pricing
 *   3. src/lib/models-dev.last-good.json — local backup of the last success
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
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "src", "lib", "models-dev.json");
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
  // and adds `cost`. A single `last_updated` key is appended for freshness.
  const snapshot = { last_updated: new Date().toISOString().slice(0, 10) };

  // ── full list: provider → { name, models: [...] } incl. pricing ───────────
  // Human-readable complete inventory for price benchmarking / debugging.
  const full = { last_updated: snapshot.last_updated, providers: {} };

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
      snapshot[key] = entry;

      // full-list entry
      providerEntry.models.push({
        id: modelId,
        name: typeof m.name === "string" ? m.name : modelId,
        ...(cost ? { cost } : {}),
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
  const json = JSON.stringify(snapshot, null, 2) + "\n";
  await writeFile(SNAPSHOT, json, "utf8");
  await writeFile(FULL, JSON.stringify(full, null, 2) + "\n", "utf8");
  await writeFile(BACKUP, json, "utf8");

  console.log(`models.dev snapshot: ${modelCount} models -> ${SNAPSHOT}`);
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
