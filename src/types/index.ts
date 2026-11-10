export type Agent = "kimi_code" | "pi";

export type ProviderType =
  | "kimi"
  | "anthropic"
  | "openai"
  | "openai_responses"
  | "google-genai"
  | "vertexai"
  /** Any other string the CLI writes — preserved verbatim on round-trip. */
  | (string & {});

export interface Provider {
  name: string;
  provider_type: ProviderType;
  base_url: string | null;
  api_key: string | null;
  /**
   * Name of the process environment variable holding the credential
   * (kimi-code 2.0.0+). Mutually exclusive with `api_key` upstream — the
   * export writes only one of the two. Only the variable *name* is stored.
   */
  api_key_env?: string | null;
  env: Record<string, string>;
  /** Optional note / remark for the provider. */
  note?: string | null;
  /** Optional official website URL. */
  official_url?: string | null;
  /** Managed/OAuth providers skip credential validation. */
  managed?: boolean;
  /** Whether the provider is enabled/activated. */
  enabled?: boolean;
  /** Whether this provider is the currently active one for Kimi Code. */
  active?: boolean;
  /** Manually selected brand icon key (from extracted icons). */
  icon?: string | null;
  /** Custom icon color; falls back to icon metadata defaultColor. */
  icon_color?: string | null;
  /**
   * Usage query kinds (e.g. "balance:deepseek", "plan:kimi_coding").
   * Merged in by the Rust side on load (SQLite settings / base_url detect)
   * and persisted back to SQLite on save; never written to config.toml.
   */
  usageKinds?: string[];
  /**
   * Usage query configuration edited via the "配置用量查询" panel.
   * Same persistence as usageKinds (SQLite settings, never config.toml).
   */
  usageConfig?: UsageConfig;
  /** Extra agent-specific provider fields preserved across edits. */
  raw_other?: unknown;
}

export interface Model {
  alias: string;
  provider: string;
  model: string;
  max_context_size: number;
  display_name: string | null;
  /** Whether the model declares extended context / thinking support. */
  supports_1m?: boolean;
  /** Agent-specific capability flags (e.g. Kimi Code `capabilities`). */
  capabilities?: string[];
  /** Extra agent-specific model fields preserved across edits. */
  raw_other?: unknown;
}

export interface Config {
  default_model: string | null;
  providers: Record<string, Provider>;
  models: Record<string, Model>;
  raw_other?: unknown;
  /**
   * Top-level section keys captured at import time by the Rust side.
   * Export drops only baseline keys absent from raw_other (sections the
   * user removed in the UI); CLI-added sections are preserved.
   */
  imported_section_keys?: string[];
  /**
   * Provider names captured in the `[providers]` table at import time by the
   * Rust side. Export drops only baseline names absent from the UI's provider
   * table (providers the user removed); CLI-added providers are preserved.
   */
  imported_provider_names?: string[];
  /**
   * Model aliases captured in the `[models]` table at import time by the Rust
   * side. Export drops only baseline aliases absent from the UI's model table;
   * CLI-added models are preserved.
   */
  imported_model_aliases?: string[];
}

/**
 * Usage query configuration (mirrors the Rust `UsageConfig`, camelCase).
 * "auto" = query kinds from usageKinds/host detect; "newapi" = query a
 * NewAPI/OneAPI gateway with accessToken + userId; "sub2api" = query a
 * Sub2API (Wei-Shaw/sub2api) gateway, reusing the inference API key.
 */
export interface UsageConfig {
  enabled: boolean;
  templateType: "auto" | "newapi" | "sub2api";
  baseUrl?: string;
  /** NewAPI web-console access token (NOT the sk- inference key). */
  accessToken?: string;
  /** NewAPI user id, sent as the New-Api-User header. */
  userId?: string;
  /** Auto query interval in minutes; 0/undefined = manual refresh only. */
  autoQueryIntervalMinutes?: number;
  /** Per-request timeout in seconds; 0/undefined = default (8s). */
  timeoutSeconds?: number;
  /** 用量预警阈值（百分比 0-100）；0/undefined = 关闭预警。
   *  判定见 src/hooks/useUsageQuery.ts 的 isAlertTier()。 */
  threshold?: number;
}

/** A model discovered from a provider's API endpoint. */
export interface DiscoveredModel {
  id: string;
  display_name: string | null;
  max_context_size: number | null;
}

export interface ThinkingConfig {
  enabled?: boolean;
  /**
   * Effort tier, forwarded verbatim to OpenAI-compatible upstreams as
   * `reasoning_effort`. Upstream accepts a free-form string; the UI offers
   * low/medium/high/max/xhigh and derives per-model support from
   * `[models."<alias>"] support_efforts`.
   */
  effort?: string;
  /**
   * Keep thinking content. The legacy off values (`false`, `0`, "no", "none",
   * `null`) are read-compatible — old configs may carry them; the UI
   * normalizes them to `"off"` and the serialization path never emits a
   * boolean (upstream engines only accept string off values).
   */
  keep?: "all" | false | 0 | "no" | "off" | "none" | null;
}

export interface LoopControlConfig {
  /** v2 engine key (kimi-code 0.33+): `max_retries_per_step` was renamed. */
  max_attempts_per_step?: number;
  /** v2 engine key (kimi-code 0.33+): `max_steps_per_run` was renamed. */
  max_steps_per_turn?: number;
  /** Legacy v1 key — read fallback only; written/kept only when
   *  KIMI_CODE_LEGACY_FLAG=1 (v1 engine compat). v2 saves strip it. */
  max_retries_per_step?: number;
  reserved_context_size?: number;
  /** Retry budget for context compaction (kimi-code 0.43.0+). Absent/0 = the
   *  key is not written and upstream's default (5) applies. */
  compaction_max_attempts?: number;
}

/**
 * Top-level `[task]` section (kimi-code 2.4.0 renamed it from `[background]`,
 * which upstream still accepts as a legacy alias). Upstream
 * (`resolveAgentTaskConfig`) merges the two sections field by field with
 * `[task]` winning; `getAgentSettings` mirrors that merge so the UI shows the
 * values the CLI actually applies, and `setAgentSettings` writes `[task]`
 * only, migrating `[background]` into it and dropping the legacy section.
 *
 * Keys we do not model still survive a save: the read path spreads the raw
 * section and the write path spreads the read result back out, so unknown
 * (and future) keys round-trip verbatim instead of being dropped.
 */
export interface TaskConfig {
  /** Max concurrently running background tasks; also caps Tower workers and
   *  reviewers (256 combined when unset everywhere). */
  max_running_tasks?: number;
  /** Keep still-running background tasks when the session closes. Default
   *  false. In print mode it only serves as the `print_background_mode`
   *  fallback (`true` ≡ "drain"). */
  keep_alive_on_exit?: boolean;
  /** A foreground `Bash` command that exceeds its timeout moves to the
   *  background instead of being killed. Default true. */
  bash_auto_background_on_timeout?: boolean;
  /** Default timeout (seconds) for background `Bash` tasks; 0 means no
   *  timeout at all (print mode defaults to 0). Explicit per-call timeouts
   *  are unaffected. Upstream default 600. */
  bash_task_timeout_s?: number;
  /** Grace period (ms) after a stop request before the task is force-killed.
   *  Upstream default 5000. */
  kill_grace_period_ms?: number;
  /** print mode only (`kimi -p`): what happens to pending background tasks
   *  when the main agent finishes. "exit" quits immediately, "drain" waits for
   *  the final state without feeding results back, "steer" turns each finished
   *  task into a synthetic message that keeps the turn going (default). */
  print_background_mode?: "exit" | "drain" | "steer";
  /** print mode only: wall-clock ceiling (seconds) for the wait/steer loop.
   *  Upstream default ~2147483 (near-unlimited). */
  print_wait_ceiling_s?: number;
  /** print mode only: cap on steered turns triggered by background tasks, so
   *  the steer loop cannot run away. Upstream default 100000. */
  print_max_turns?: number;
}

/** Former name of {@link TaskConfig}; kept so out-of-tree call sites and any
 *  older code that imports `BackgroundConfig` keep compiling. */
export type BackgroundConfig = TaskConfig;

/** Top-level `[workspace]` section (kimi-code 2.5.0, upstream #4517). */
export interface WorkspaceConfig {
  /** Require a trust confirmation the first time an untrusted workspace is
   *  opened. Default true: only an explicit false is written, and false makes
   *  every workspace count as trusted — project-level MCP servers and other
   *  trust-gated project config then load without confirmation. It does not
   *  change permission modes, tool approvals, or the dangerous-command guard.
   *  KIMI_CODE_TRUST_WORKSPACE=1 remains an independent per-process override. */
  require_trust?: boolean;
}

/** Top-level `[database]` section (session index / global search store). */
export interface DatabaseConfig {
  /** Build the global full-text search index and expose
   *  `POST /api/v1/search`. Default false since kimi-code 2.5.0 (it used to
   *  be on), so only an explicit true is written. When off, no session scan
   *  and no search worker runs and the endpoint reports the index as
   *  unavailable. Env KIMI_CODE_GLOBAL_SEARCH outranks this key. */
  global_search?: boolean;
}

/** Top-level `[mcp]` section, reconnect backoff subset (kimi-code 2.4.0,
 *  upstream #4283). Auto-reconnect covers workspace-level MCP servers only. */
export interface McpConfig {
  /** Wait before the first reconnect attempt after a failed/unexpected
   *  disconnect; doubles after every further failure. Upstream default 5000.
   *  Env KIMI_MCP_RECONNECT_INITIAL_DELAY_MS outranks it. */
  reconnect_initial_delay_ms?: number;
  /** Upper bound (ms) for the reconnect backoff. Upstream default 300000.
   *  Env KIMI_MCP_RECONNECT_MAX_DELAY_MS outranks it. */
  reconnect_max_delay_ms?: number;
}

/** Top-level `[read]` section: the `Read` tool's character budget. */
export interface ReadConfig {
  /** Max characters a single `Read` call may request (body + line numbers +
   *  status line). Upstream default 100000, lowered from 500000 in 2.4.1. A
   *  call also stops once its estimated token count reaches a quarter of this
   *  value (1 token per non-ASCII char, 1 per 4 ASCII chars), so CJK-heavy
   *  text returns fewer characters per call. */
  max_chars?: number;
  /** Budget used when the call does not pass `max_chars`; clamped to
   *  `max_chars`. Upstream default 100000. */
  default_max_chars?: number;
}

/** Top-level `[watch]` section (kimi-code 2.0.1+). The key was added in
 *  2.0.1 and its default flipped to off in 2.0.2, so an absent key reads as
 *  disabled. `KIMI_CODE_WATCH` overrides the config value at runtime. */
export interface WatchConfig {
  enabled?: boolean;
}

export interface PermissionRule {
  decision?: "allow" | "deny" | "ask";
  scope?: string;
  pattern?: string;
  reason?: string;
}

export interface Hook {
  event?: string;
  matcher?: string;
  command?: string;
  timeout?: number;
}

export interface AgentSettings {
  thinking?: ThinkingConfig;
  loop_control?: LoopControlConfig;
  /** `[task]` (formerly `[background]`) — merged legacy view, see TaskConfig.
   *  Writes always target `[task]`; the legacy `[background]` section is
   *  migrated into it and removed on save. */
  task?: TaskConfig;
  /** Top-level `[watch]` section (kimi-code 2.0.1+). */
  watch?: WatchConfig;
  /** Top-level `[workspace]` section (kimi-code 2.5.0). */
  workspace?: WorkspaceConfig;
  /** Top-level `[database]` section. */
  database?: DatabaseConfig;
  /** Top-level `[mcp]` section (reconnect backoff subset). */
  mcp?: McpConfig;
  /** Top-level `[read]` section. */
  read?: ReadConfig;
  /** Top-level config.toml key (kimi-code #3962): let clients auto-generate
   *  session titles. Default true; only an explicit false disables. */
  auto_session_title?: boolean;
  /** Top-level config.toml key (kimi-code #3995): repeat-breaker for
   *  consecutively repeated identical tool calls. Default true; env
   *  KIMI_CODE_REPEAT_BREAKER outranks this config. */
  repeat_breaker?: boolean;
  /** Top-level config.toml key (kimi-code 2.3.0, moved here from tui.toml):
   *  turn off the session-end rating / feedback survey. Upstream default is
   *  false — the survey is on — and the consumer reads it as `=== true`, so
   *  only an explicit true is ever written to the config. */
  disable_feedback_survey?: boolean;
  permission?: {
    rules?: PermissionRule[];
    /** kimi-code `[permission]` key. Default true when the key is
     *  absent: since 0.41.0 the guard only gates Manual/YOLO modes —
     *  dangerous commands (rm -rf, shutdown, dd of=, …) and commands
     *  that cannot be statically analyzed force a prompt, while Auto
     *  (never-ask) mode no longer intercepts them; false restores the
     *  previous behavior. Env KIMI_CODE_DANGEROUS_COMMAND_GUARD (literal
     *  "true"/"false" only) outranks this config. */
    dangerous_command_guard?: boolean;
  };
  hooks?: Hook[];
}

/**
 * Kimi Code `[secondary_model]` section of config.toml: the subagent model
 * pool.
 *
 * kimi-code 2.5.0 (#4418) narrowed what this section means. Subagents run only
 * on the listed entries; `primary` is no longer an implicit choice (it is
 * reserved for Tower spawn), and a single-entry pool — or a lone
 * `default_model` — pins every spawn without offering a `model` parameter.
 *
 * `force` and the model-tuning overrides (`max_context_size`, `max_output_size`,
 * `capabilities`, `display_name`, …) are removed: a lone `default_model`
 * already pins every subagent, and subagents bind the `[models]` entry as
 * configured, so tuning belongs on `[models.<alias>]`. A leftover key is
 * ignored by the engine with a warning; `subagent-settings.ts` drops them on
 * the next write (see `getDeprecatedSecondaryModelKeys`).
 *
 * `model` is the legacy v1 recipe key, kept in sync with `default_model` so a
 * v1 engine resolves the same alias. Pool resolution order: `models` table →
 * `default_model` → `model`.
 */
export interface SecondaryModelConfig {
  /** v2: default subagent alias in the pool (a key of `models`). */
  default_model?: string;
  /** v2: alias → description table for the subagent model pool. */
  models?: Record<string, string>;
  /** Legacy v1 recipe key — written in sync so a v1 engine resolves it. */
  model?: string;
  /** Section-level Thinking tier for every spawned subagent; outranks the
   *  bound model's own `default_effort`. Still valid. */
  default_effort?: string;
}

/**
 * One entry of the top-level `[environments]` section (kimi-code 2.5.0):
 * a remote environment declaration — SSH host, Docker-compatible container,
 * or a generic launcher command. Read-only for now; see
 * `src/lib/environments.ts` (`getRemoteEnvironments`) for the reader.
 *
 * Upstream validates the section as a three-way union (`ssh`, `docker`,
 * `command`) and every branch is strict, so the fields below are the union of
 * the three shapes rather than one entry's full set. The `command` branch
 * carries no `type` at all, which is why it is optional here.
 */
export interface RemoteEnvironmentEntry {
  /** "ssh" | "docker"; command entries omit it entirely. */
  type?: "ssh" | "docker" | (string & {});
  /** SSH host (ssh entries). `~/.ssh/config` still applies. */
  host?: string;
  /** Running container name or id (docker entries). */
  container?: string;
  /** Docker context, e.g. "orbstack" (docker entries). */
  context?: string;
  /** Launcher executable (command entries). */
  command?: string;
  /** Launcher args (command entries); `<remoteBin> exec-server` is appended
   *  unless the args already invoke exec-server. */
  args?: string[];
  /** Env vars for the local launcher process (command entries); they do not
   *  propagate into the target environment. */
  env?: Record<string, string>;
  /** Path of the `kimi` binary on the target environment. */
  remoteBin?: string;
  /** Prefilled working directory for a session bound to this environment. */
  defaultCwd?: string;
}

/** Values of experimental env vars that are currently set (non-empty). */
export type ExperimentalEnvStatus = Record<string, string>;

/**
 * A plugin installed under the kimi-code plugin directory
 * (mirrors the Rust `InstalledPluginInfo`, camelCase via serde).
 */
export interface InstalledPluginInfo {
  id: string;
  root: string;
  source: string;
  enabled: boolean;
  version: string | null;
  installedAt: string | null;
  updatedAt: string | null;
  /** Whether the plugin came from the marketplace catalog (vs. manual install). */
  isMarketplace: boolean;
}

/** One entry of the plugin marketplace catalog (mirrors Rust `MarketplaceEntry`). */
export interface MarketplaceEntry {
  id: string;
  displayName: string;
  version: string | null;
  description: string | null;
  keywords: string[];
  homepage: string | null;
  /** "official" | "curated". Derived from `distribution.category` since
   *  kimi-code 2.5.0 (legacy catalogs still carry a flat `tier`). */
  tier: string;
  /** Raw `distribution.category` ("official" | "third_party") when the catalog
   *  declares one; null for legacy catalogs without a `distribution` block. */
  category: string | null;
  /** Clients the plugin supports ("desktop" | "cli"); empty means "any". */
  clients: string[];
  /** Platforms the plugin supports ("macos" | "windows" | "linux" | "cloud");
   *  empty means "any". */
  platforms: string[];
  /** Install source (URL / path) passed to `install_plugin`. */
  source: string;
  /** Non-null → must be installed inside kimi-code via /plugins, not here. */
  capabilityId: string | null;
  installed: InstalledPluginInfo | null;
  updateAvailable: boolean;
}

/** Result of `get_plugin_marketplace` (mirrors Rust `PluginMarketplaceResult`). */
export interface PluginMarketplaceResult {
  fetchedAt: string;
  fromCache: boolean;
  entries: MarketplaceEntry[];
}
