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
  /** Extra agent-specific provider fields preserved across edits. */
  raw_other?: unknown;
}

export interface Model {
  alias: string;
  provider: string;
  model: string;
  max_context_size: number;
  display_name: string | null;
  /** Optional model role, e.g. Sonnet/Opus/Fable/Haiku for Claude-style mapping. */
  role?: string | null;
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

/** A model discovered from a provider's API endpoint. */
export interface DiscoveredModel {
  id: string;
  display_name: string | null;
  max_context_size: number | null;
}
