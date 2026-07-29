#!/usr/bin/env node
/**
 * Fetch the latest model reference data from models.dev and write a compact
 * snapshot to src/lib/models-dev.json.
 *
 * Run manually (`npm run fetch-models-dev`) or automatically before builds
 * (`prebuild`). Requires network access to models.dev.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://models.dev/models.json";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "src", "lib", "models-dev.json");

const res = await fetch(SOURCE_URL, {
  headers: { Accept: "application/json" },
  signal: AbortSignal.timeout(30_000),
});
if (!res.ok) {
  throw new Error(`GET ${SOURCE_URL} returned HTTP ${res.status}`);
}

/** @type {Record<string, any>} */
const raw = await res.json();

// Keep only the fields the app needs; the raw file carries benchmarks,
// descriptions, etc. that would bloat the bundle.
const snapshot = {};
for (const [key, m] of Object.entries(raw)) {
  if (!m || typeof m !== "object") continue;
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
  snapshot[key] = entry;
}

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

console.log(
  `models-dev snapshot: ${Object.keys(snapshot).length} models -> ${OUTPUT}`,
);
