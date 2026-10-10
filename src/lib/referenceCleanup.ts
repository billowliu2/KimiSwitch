/**
 * Keep `[secondary_model]` (the subagent model pool in `raw_other`) free of
 * dangling model-alias references.
 *
 * Model aliases are deleted or re-keyed in several places (provider delete,
 * single-model delete, provider rename). The pool stores aliases as its
 * `models` table keys and as the `default_model` / `model` values — none of
 * those may outlive the alias they point at, or the engine resolves the pool
 * entry to nothing and the zombie key lingers in config.toml forever.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Re-key pool aliases after a provider rename: `aliasMap` maps old alias →
 * new alias. Pool keys keep their descriptions; `default_model` / `model`
 * follow when they referenced a renamed alias. Returns the input reference
 * when nothing changed.
 */
export function rekeySubagentPoolAliases(
  rawOther: unknown,
  aliasMap: Record<string, string>
): unknown {
  if (Object.keys(aliasMap).length === 0) return rawOther;
  const root = asRecord(rawOther);
  const section = asRecord(root.secondary_model);
  if (Object.keys(section).length === 0) return rawOther;

  const models = asRecord(section.models);
  let changed = false;
  const nextModels: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(models)) {
    const mapped = aliasMap[k];
    if (mapped && mapped !== k) {
      nextModels[mapped] = v;
      changed = true;
    } else {
      nextModels[k] = v;
    }
  }

  let nextDefault = section.default_model;
  let nextModel = section.model;
  if (typeof nextDefault === "string" && aliasMap[nextDefault]) {
    nextDefault = aliasMap[nextDefault];
    changed = true;
  }
  if (typeof nextModel === "string" && aliasMap[nextModel]) {
    nextModel = aliasMap[nextModel];
    changed = true;
  }
  if (!changed) return rawOther;

  // Only write a `models` table when the section had one — the implicit
  // single-model form (`{ model: "..." }`) and the force form must not gain
  // an empty `[secondary_model.models]` table, which the engine can never
  // validate (its default must be a key of the table).
  const hadModelsTable = section.models !== undefined;
  const nextSection: Record<string, unknown> = { ...section };
  if (hadModelsTable || Object.keys(nextModels).length > 0) {
    nextSection.models = nextModels;
  }
  if (nextDefault !== section.default_model) nextSection.default_model = nextDefault;
  if (nextModel !== section.model) nextSection.model = nextModel;
  return { ...root, secondary_model: nextSection };
}

/**
 * Remove pool entries pointing at deleted aliases. When the pool's default
 * referenced a deleted alias it falls back to the first remaining key; when
 * the pool becomes empty the whole `[secondary_model]` section is dropped
 * (an empty pool is invalid for the engine — subagents then inherit the
 * primary model). Returns the input reference when nothing changed.
 */
export function purgeSubagentPoolAliases(
  rawOther: unknown,
  removedAliases: Iterable<string>
): unknown {
  const removed = new Set(removedAliases);
  if (removed.size === 0) return rawOther;
  const root = asRecord(rawOther);
  const section = asRecord(root.secondary_model);
  if (Object.keys(section).length === 0) return rawOther;

  const models = asRecord(section.models);
  const kept: Record<string, unknown> = {};
  let removedAny = false;
  for (const [k, v] of Object.entries(models)) {
    if (removed.has(k)) {
      removedAny = true;
    } else {
      kept[k] = v;
    }
  }
  const defaultGone =
    (typeof section.default_model === "string" && removed.has(section.default_model)) ||
    (typeof section.model === "string" && removed.has(section.model));
  if (!removedAny && !defaultGone) return rawOther;

  if (Object.keys(kept).length === 0) {
    const nextRoot: Record<string, unknown> = { ...root };
    delete nextRoot.secondary_model;
    return nextRoot;
  }

  const nextSection: Record<string, unknown> = { ...section, models: kept };
  if (defaultGone) {
    const fallback = Object.keys(kept)[0];
    nextSection.default_model = fallback;
    nextSection.model = fallback;
  }
  return { ...root, secondary_model: nextSection };
}
