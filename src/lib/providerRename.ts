import type { Model } from "../types";
import { modelProvider, setModelProvider } from "./model-effective";

export interface ProviderRenameResult {
  models: Record<string, Model>;
  /** old alias → new alias (collision-deduped), for callers fixing alias references. */
  aliasMap: Record<string, string>;
}

function rekeyedAlias(alias: string, oldName: string, newName: string): string {
  const prefix = `${oldName}/`;
  return alias.startsWith(prefix)
    ? newName + alias.slice(oldName.length)
    : `${newName}/${alias}`;
}

/**
 * Re-key a provider's model aliases after the provider is renamed so the
 * `<provider>/<model>` prefix tracks the new name. Only patching
 * `m.provider` (the old behaviour) left stale prefixes like
 * `opencode-go-copy/...` pointing at the renamed provider — zombie aliases
 * that the UI then re-saved to config.toml and SQLite forever.
 *
 * Collision-safe: a target alias that is already taken (renaming into an
 * existing provider's name, or a legacy bare alias colliding with a standard
 * `<name>/<model>` one — both map to the same new key) gets a `-2`/`-3`
 * suffix instead of silently overwriting the other entry. Non-standard
 * aliases without the `<oldName>/` prefix fall back to a full re-prefix.
 */
export function rekeyModelsOnProviderRename(
  models: Record<string, Model>,
  oldName: string,
  newName: string
): ProviderRenameResult {
  const next: Record<string, Model> = {};
  const toRename: Array<[string, Model]> = [];
  for (const [key, m] of Object.entries(models)) {
    // Ownership is judged on the *effective* model provider (`provider_id`
    // for v2 models, legacy `provider` for the rest), so a renamed provider
    // re-keys models that v2 identity points at.
    if (modelProvider(m) === oldName) toRename.push([key, m]);
    else next[key] = m;
  }
  const aliasMap: Record<string, string> = {};
  for (const [key, m] of toRename) {
    const base = rekeyedAlias(key, oldName, newName);
    let target = base;
    let n = 2;
    while (target in next) {
      target = `${base}-${n}`;
      n++;
    }
    // Write the new provider through the active identity field: `provider_id`
    // for v2 models (never the legacy field), `provider` for legacy ones.
    // The value is trimmed so it can be set to the empty string (v2 identity
    // writes must not fall back to the legacy field).
    next[target] = {
      ...setModelProvider(m, newName),
      alias: target,
    };
    aliasMap[key] = target;
  }
  return { models: next, aliasMap };
}

/**
 * Clone a provider's models under the duplicate's name — COPY semantics:
 * the source provider keeps its models (unlike rekeyModelsOnProviderRename,
 * which moves them). Collisions with any existing alias get a `-2`/`-3`
 * suffix.
 */
export function copyModelsOnProviderDuplicate(
  models: Record<string, Model>,
  oldName: string,
  newName: string
): Record<string, Model> {
  const next = { ...models };
  for (const [key, m] of Object.entries(models)) {
    // Ownership judged on the effective provider (see rekeyModelsOnProviderRename).
    if (modelProvider(m) !== oldName) continue;
    const base = rekeyedAlias(key, oldName, newName);
    let target = base;
    let n = 2;
    while (target in next) {
      target = `${base}-${n}`;
      n++;
    }
    // The copy is re-owned through the active identity field; the source is
    // left untouched (`next` already holds it under its original key).
    next[target] = {
      ...setModelProvider(m, newName),
      alias: target,
    };
  }
  return next;
}
