import type { RemoteEnvironmentEntry } from "../types";

/**
 * Read-only helper for the `[environments]` section of the Kimi Code
 * config.toml (kimi-code 2.5.0): remote environment declarations — an SSH
 * host, a Docker-compatible container, or a generic launcher command.
 *
 * The section lives in `config.raw_other` (the pass-through bucket for
 * top-level TOML sections this app does not own), so the reader works off that
 * JSON object directly. There is deliberately no writer here: editing remote
 * environments needs its own UI (entry ids, the ssh/docker/command union and
 * the `default` cross-reference all need validation), which is out of scope
 * for the settings panel. Anything written back by the panel is passed through
 * verbatim because `raw_other` is only ever replaced for the sections the panel
 * manages.
 */

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > 0 ? value : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string");
  return out.length > 0 ? out : undefined;
}

function readEntry(value: unknown): RemoteEnvironmentEntry | undefined {
  const raw = asRecord(value);
  const entry: RemoteEnvironmentEntry = {};
  const type = readString(raw.type);
  if (type !== undefined) entry.type = type;
  const host = readString(raw.host);
  if (host !== undefined) entry.host = host;
  const container = readString(raw.container);
  if (container !== undefined) entry.container = container;
  const context = readString(raw.context);
  if (context !== undefined) entry.context = context;
  const command = readString(raw.command);
  if (command !== undefined) entry.command = command;
  const args = readStringArray(raw.args);
  if (args !== undefined) entry.args = args;
  const env = readStringRecord(raw.env);
  if (env !== undefined) entry.env = env;
  const remoteBin = readString(raw.remoteBin);
  if (remoteBin !== undefined) entry.remoteBin = remoteBin;
  const defaultCwd = readString(raw.defaultCwd);
  if (defaultCwd !== undefined) entry.defaultCwd = defaultCwd;
  // An entry with only unknown keys means the section is not a shape we
  // understand — report nothing rather than an empty entry.
  return Object.keys(entry).length > 0 ? entry : undefined;
}

/**
 * Read `[environments]` from `raw_other` as `{ id: entry }`.
 *
 * The reserved `default` key — the environment id a new session binds to — is
 * skipped: it is a string, not an entry, and callers that need it can read
 * `[environments] default` themselves. Returns an empty object when the
 * section is absent or carries no entry we recognize, so callers can treat
 * "no remote environments" and "not configured" the same way.
 */
export function getRemoteEnvironments(
  rawOther: unknown
): Record<string, RemoteEnvironmentEntry> {
  const section = asRecord(asRecord(rawOther)["environments"]);
  const out: Record<string, RemoteEnvironmentEntry> = {};
  for (const [id, value] of Object.entries(section)) {
    if (id === "default") continue;
    const entry = readEntry(value);
    if (entry !== undefined) out[id] = entry;
  }
  return out;
}
