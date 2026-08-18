export type Agent = "kimi_code" | "pi";

export type ProviderType =
  | "kimi"
  | "anthropic"
  | "openai"
  | "openai_responses"
  | "google-genai"
  | "vertexai";

export interface Provider {
  name: string;
  provider_type: ProviderType;
  base_url: string | null;
  api_key: string | null;
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
}

/**
 * Usage query configuration (mirrors the Rust `UsageConfig`, camelCase).
 * "auto" = query kinds from usageKinds/host detect; "newapi" = query a
 * NewAPI/OneAPI gateway with accessToken + userId.
 */
export interface UsageConfig {
  enabled: boolean;
  templateType: "auto" | "newapi";
  baseUrl?: string;
  /** NewAPI web-console access token (NOT the sk- inference key). */
  accessToken?: string;
  /** NewAPI user id, sent as the New-Api-User header. */
  userId?: string;
  /** Auto query interval in minutes; 0/undefined = manual refresh only. */
  autoQueryIntervalMinutes?: number;
  /** Per-request timeout in seconds; 0/undefined = default (8s). */
  timeoutSeconds?: number;
}

/** A model discovered from a provider's API endpoint. */
export interface DiscoveredModel {
  id: string;
  display_name: string | null;
  max_context_size: number | null;
}

export interface ThinkingConfig {
  enabled?: boolean;
  effort?: "low" | "medium" | "high" | "max";
  keep?: "all" | false | 0 | "no" | "off" | "none" | null;
}

export interface LoopControlConfig {
  /** v2 engine key (kimi-code 0.33+): `max_retries_per_step` was renamed. */
  max_attempts_per_step?: number;
  /** v2 engine key (kimi-code 0.33+): `max_steps_per_run` was renamed. */
  max_steps_per_turn?: number;
  /** Legacy v1 key — written in sync so KIMI_CODE_LEGACY_FLAG=1 still works. */
  max_retries_per_step?: number;
  reserved_context_size?: number;
}

export interface BackgroundConfig {
  max_running_tasks?: number;
  keep_alive_on_exit?: boolean;
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
  background?: BackgroundConfig;
  permission?: { rules?: PermissionRule[] };
  hooks?: Hook[];
}

/**
 * Kimi Code `[secondary_model]` section of config.toml: the subagent model
 * pool (experimental feature).
 *
 * v2 engine (default) reads the pool keys: `default_model` + `[models]` table
 * (alias → description) + `force`. `model` is ignored by the v2 validator when
 * pool keys are present, but is kept in sync with `default_model` so the v1
 * engine (KIMI_CODE_LEGACY_FLAG=1) resolves the same alias.
 *
 * v1 engine reads only the recipe key `model` plus the patch fields; pool keys
 * are ignored by it. Pool resolution order: `models` table → `default_model` →
 * `model`.
 */
export interface SecondaryModelConfig {
  /** v2: default subagent alias in the pool (a key of `models`). */
  default_model?: string;
  /** v2: alias → description table for the subagent model pool. */
  models?: Record<string, string>;
  /** v2: force subagents onto the default alias (excludes `models`). */
  force?: boolean;
  /** Legacy v1 recipe key — written in sync so KIMI_CODE_LEGACY_FLAG=1 works. */
  model?: string;
  /** v1 patch fields, applied on top of the referenced entry (v1 only). */
  default_effort?: string;
  max_output_size?: number;
  max_context_size?: number;
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
  /** "official" | "curated" | anything else → community. */
  tier: string;
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
