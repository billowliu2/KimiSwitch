import { describe, expect, it } from "vitest";
import type { Model } from "../types";
import {
  effectiveModel,
  isModelFieldOverridden,
  modelProvider,
  modelWireName,
  setModelProvider,
  setModelWireName,
} from "./model-effective";

const base: Model = {
  alias: "direct",
  provider: "legacy-provider",
  provider_id: "aws",
  model: "legacy-model",
  name: "anthropic.claude-sonnet",
  aliases: ["fast"],
  max_context_size: 200000,
  display_name: "Base",
  capabilities: ["thinking"],
  raw_other: {
    max_output_size: 8192,
    default_effort: "medium",
    overrides: {
      max_context_size: 100000,
      display_name: "Effective",
      capabilities: ["image_in"],
      max_output_size: 4096,
      default_effort: "high",
    },
  },
};

describe("KimiCode 2.8 model identity", () => {
  it("uses nullish identity precedence and edits the active identity field", () => {
    expect(modelProvider(base)).toBe("aws");
    expect(modelWireName(base)).toBe("anthropic.claude-sonnet");
    expect(modelProvider({ ...base, provider_id: "" })).toBe("");
    expect(setModelProvider(base, "next").provider_id).toBe("next");
    expect(setModelWireName(base, "next").name).toBe("next");
  });

  it("does not fall back to legacy when the v2 name is blank", () => {
    expect(modelWireName({ ...base, name: "" })).toBe("");
    expect(modelWireName({ ...base, name: "  " })).toBe("  ");
  });

  it("writes the edited v2 field through the setters, including blank values", () => {
    expect(setModelProvider(base, "").provider_id).toBe("");
    expect(setModelWireName(base, "").name).toBe("");
    // The original legacy fields are untouched by editing the v2 field.
    expect(setModelProvider(base, "next").provider).toBe("legacy-provider");
    expect(setModelWireName(base, "next").model).toBe("legacy-model");
  });

  it("edits the legacy field when the model has only legacy identity", () => {
    const legacy = {
      ...base,
      provider_id: null,
      name: null,
      provider: "legacy-provider",
      model: "legacy-model",
    };
    expect(modelProvider(legacy)).toBe("legacy-provider");
    expect(modelWireName(legacy)).toBe("legacy-model");
    expect(setModelProvider(legacy, "next").provider).toBe("next");
    expect(setModelWireName(legacy, "next").model).toBe("next");
  });

  it("exposes effective overrides without rewriting the base identity", () => {
    const effective = effectiveModel(base);
    expect(effective.max_context_size).toBe(100000);
    expect(effective.display_name).toBe("Effective");
    expect(effective.capabilities).toEqual(["image_in"]);
    expect(effective.raw_other).toMatchObject({
      max_output_size: 4096,
      default_effort: "high",
    });
    expect(isModelFieldOverridden(base, "max_context_size")).toBe(true);
    expect(base.max_context_size).toBe(200000);
  });
});