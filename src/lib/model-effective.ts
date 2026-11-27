import type { Model } from "../types";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function modelProvider(model: Model): string {
  return model.provider_id ?? model.provider;
}

export function modelWireName(model: Model): string {
  return model.name ?? model.model;
}

export function setModelProvider(model: Model, value: string): Model {
  return model.provider_id != null
    ? { ...model, provider_id: value }
    : { ...model, provider: value };
}

export function setModelWireName(model: Model, value: string): Model {
  return model.name != null
    ? { ...model, name: value }
    : { ...model, model: value };
}

export function effectiveModel(model: Model): Model {
  const raw = record(model.raw_other);
  const overrides = record(raw.overrides);
  return {
    ...model,
    max_context_size:
      typeof overrides.max_context_size === "number"
        ? overrides.max_context_size
        : model.max_context_size,
    display_name:
      typeof overrides.display_name === "string"
        ? overrides.display_name
        : model.display_name,
    capabilities: Array.isArray(overrides.capabilities)
      ? overrides.capabilities.filter((v): v is string => typeof v === "string")
      : model.capabilities,
    raw_other: { ...raw, ...overrides },
  };
}

export function isModelFieldOverridden(model: Model, key: string): boolean {
  return Object.hasOwn(record(record(model.raw_other).overrides), key);
}