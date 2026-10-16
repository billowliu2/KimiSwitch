import type { Config, Model, ProviderType } from "../types";

/**
 * Provider types that must have a base_url set in order to function.
 * Anthropic and Vertexai intentionally have no default — they read the
 * agent's CLI environment / SDK defaults, so leaving base_url empty is
 * a valid (and the only) state.
 */
const TYPES_REQUIRING_BASE_URL: ReadonlySet<ProviderType> = new Set<ProviderType>([
  "openai",
  "openai_responses",
  "kimi",
  "google-genai",
]);

export interface ProviderIssue {
  name: string;
  reasons: string[];
}

/**
 * Inspect a config and report any enabled providers that are not ready to
 * use. Used by the save flow to warn the user before persisting an
 * incomplete state to config.toml / SQLite.
 *
 * "Incomplete" means any of:
 *   - missing API key (and not a managed OAuth provider)
 *   - missing base_url for provider types that need one
 *   - zero configured models
 *
 * Disabled providers are skipped — the user explicitly turned them off.
 */
export function validateProviders(
  config: Config,
  modelIndex: Record<string, Model>,
  // The i18n `t` from useTranslation() is strictly typed to its known key
  // union; a generic (key: string) signature is the right shape for a
  // library-style helper that doesn't want to import the project's i18n
  // module directly.
  t: (key: string, vars?: Record<string, unknown>) => string,
  // When set, only inspect this single provider. Used when activating a
  // specific provider: sibling providers merely listed in the config
  // must not block the switch.
  target?: string,
): ProviderIssue[] {
  const issues: ProviderIssue[] = [];
  for (const provider of Object.values(config.providers)) {
    if (target && provider.name !== target) continue;
    if (!provider.enabled) continue;
    const reasons: string[] = [];

    const apiKey = provider.api_key?.trim();
    // kimi-code 2.0.0+: the credential may come from an environment variable
    // instead of a stored key — a provider configured that way is complete.
    const apiKeyEnv = provider.api_key_env?.trim();
    if (!apiKey && !apiKeyEnv && !provider.managed) {
      reasons.push(t("validationNoApiKey"));
    }

    const baseUrl = provider.base_url?.trim();
    if (!baseUrl && TYPES_REQUIRING_BASE_URL.has(provider.provider_type)) {
      reasons.push(t("validationNoBaseUrl"));
    }

    const providerModels = Object.values(modelIndex).filter(
      (m) => m.provider === provider.name,
    );
    if (providerModels.length === 0) {
      reasons.push(t("validationNoModels"));
    } else {
      // A model entry exists but its `model` field may be blank (e.g. the
      // user hit "+ 添加模型" in the edit page and saved before filling
      // in the upstream model id). Those still break the provider.
      const blankAliases = providerModels
        .filter((m) => !m.model || !m.model.trim())
        .map((m) => m.alias);
      if (blankAliases.length > 0) {
        reasons.push(
          t("validationBlankModels", { aliases: blankAliases.join(", ") }),
        );
      }
    }

    if (reasons.length > 0) {
      issues.push({ name: provider.name, reasons });
    }
  }
  return issues;
}

export type ProviderNameIssue = "empty" | "duplicate";

/**
 * Check a single provider name against the names of all OTHER providers.
 * Providers are keyed by name in the config, so a name collision silently
 * overwrites the existing entry — this helper is the shared gate for both
 * the edit-page hint and the write-path rejection.
 *
 * Comparison is a case-sensitive exact match after trimming, on purpose:
 * the name IS the storage key, so `TokenHub` and `tokenhub` are two distinct
 * providers that can coexist. Normalizing (lowercasing, stripping inner
 * whitespace) would reject names the storage layer accepts, and would block
 * users who deliberately keep a case-variant copy of a provider.
 *
 * Returns "empty" for a blank name (checked first — a blank name has no
 * meaningful collision semantics), "duplicate" when `allNames` already holds
 * the trimmed name, and null otherwise.
 */
export function validateProviderName(
  allNames: string[], // names of all OTHER providers (current entry excluded)
  name: string, // the name being validated
): ProviderNameIssue | null {
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if (allNames.some((other) => other.trim() === trimmed)) return "duplicate";
  return null;
}
