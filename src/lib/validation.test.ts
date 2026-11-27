import { describe, expect, it } from "vitest";
import {
  findTrimDuplicateProviderNames,
  validateProviderName,
  validateProviders,
} from "./validation";
import type { Config, Model, Provider } from "../types";

/** Minimal provider entry — `findTrimDuplicateProviderNames` only reads keys. */
function provider(name: string): Provider {
  return {
    name,
    provider_type: "openai",
    base_url: null,
    api_key: null,
    env: {},
  };
}

function enabledProvider(name: string): Provider {
  return { ...provider(name), api_key: "sk-test", enabled: true, base_url: "https://x" };
}

function model(alias: string, over: Partial<Model> = {}): Model {
  return {
    alias,
    provider: "",
    model: "",
    max_context_size: 200000,
    display_name: null,
    ...over,
  };
}

function mapOf(...names: string[]): Record<string, Provider> {
  return Object.fromEntries(names.map((name) => [name, provider(name)]));
}

describe("validateProviderName", () => {
  it("reports an empty name, including a whitespace-only one", () => {
    expect(validateProviderName(["TokenHub"], "")).toBe("empty");
    expect(validateProviderName(["TokenHub"], "   ")).toBe("empty");
    expect(validateProviderName([], "")).toBe("empty");
  });

  it("reports a duplicate when another provider already holds the name", () => {
    expect(validateProviderName(["TokenHub", "other"], "TokenHub")).toBe("duplicate");
  });

  it("treats case-different names as distinct (case-sensitive exact match)", () => {
    expect(validateProviderName(["TokenHub"], "tokenhub")).toBe(null);
    expect(validateProviderName(["tokenhub"], "TokenHub")).toBe(null);
  });

  it("trims the candidate name before comparing", () => {
    expect(validateProviderName(["TokenHub"], " TokenHub ")).toBe("duplicate");
  });

  it("trims the existing names before comparing", () => {
    expect(validateProviderName([" Foo "], "Foo")).toBe("duplicate");
  });

  it("accepts a unique name", () => {
    expect(validateProviderName(["TokenHub", "other"], "TokenHub-2")).toBe(null);
    expect(validateProviderName([], "TokenHub")).toBe(null);
  });

  it("prefers 'empty' over 'duplicate' for a blank name", () => {
    expect(validateProviderName(["   "], "   ")).toBe("empty");
  });
});

describe("findTrimDuplicateProviderNames", () => {
  it("returns nothing when every name is distinct", () => {
    expect(findTrimDuplicateProviderNames(mapOf("TokenHub", "other", "third"))).toEqual(
      [],
    );
    expect(findTrimDuplicateProviderNames({})).toEqual([]);
  });

  it("flags a pair that only differs by surrounding whitespace", () => {
    expect(findTrimDuplicateProviderNames(mapOf("TokenHub", "TokenHub "))).toEqual([
      "TokenHub",
      "TokenHub ",
    ]);
    expect(findTrimDuplicateProviderNames(mapOf(" TokenHub", "TokenHub  "))).toEqual([
      " TokenHub",
      "TokenHub  ",
    ]);
  });

  it("reports every member of every colliding group, sorted", () => {
    expect(
      findTrimDuplicateProviderNames(mapOf("b", " b", "b ", "a", "a ", "solo")),
    ).toEqual([" b", "a", "a ", "b", "b "]);
  });

  it("does not treat case-different names as duplicates", () => {
    expect(findTrimDuplicateProviderNames(mapOf("TokenHub", "tokenhub"))).toEqual([]);
  });

  it("ignores blank names (reported by the empty-name gate instead)", () => {
    expect(findTrimDuplicateProviderNames(mapOf("", "   ", "TokenHub"))).toEqual([]);
    // A blank name must not drag a real name into the duplicate set either.
    expect(findTrimDuplicateProviderNames(mapOf("TokenHub", "  "))).toEqual([]);
  });
});

describe("validateProviders — kimi-code 2.8 v2 identity", () => {
  const t = (key: string) => key;

  /**
   * A valid v2 identity model: it is owned by `aws` and has a non-empty wire
   * name through `name` while the legacy `provider`/`model` fields are empty.
   */
  const v2Model = model("aws/sonnet", {
    provider_id: "aws",
    name: "anthropic.claude-sonnet",
    capabilities: ["thinking"],
  });

  function configFor(models: Record<string, Model>): Config {
    return {
      default_model: null,
      providers: {
        aws: enabledProvider("aws"),
        other: enabledProvider("other"),
      },
      models,
    };
  }

  it("counts a valid v2 model as a model for its provider (legacy fields empty)", () => {
    const issues = validateProviders(configFor({ "aws/sonnet": v2Model }), {
      "aws/sonnet": v2Model,
    }, t);
    expect(issues.map((i) => i.name)).not.toContain("aws");
    expect(issues.map((i) => i.name)).toContain("other");
    expect(
      issues.find((i) => i.name === "other")?.reasons
    ).toContain("validationNoModels");
  });

  it("does not report a valid v2 model as blank (its wire name is non-empty)", () => {
    const issues = validateProviders(configFor({ "aws/sonnet": v2Model }), {
      "aws/sonnet": v2Model,
    }, t);
    const aws = issues.find((i) => i.name === "aws");
    expect(aws).toBeUndefined();
  });

  it("reports a v2 model whose wire name (trimmed) is blank", () => {
    const models = { "aws/blank": model("aws/blank", { provider_id: "aws", name: "  " }) };
    const issues = validateProviders(configFor(models), models, t);
    const aws = issues.find((i) => i.name === "aws");
    expect(aws).toBeDefined();
    expect(aws!.reasons).toContain("validationBlankModels");
  });

  it("reports a model with an empty legacy name and no v2 name", () => {
    const models = { "aws/blank": model("aws/blank", { provider_id: "aws", name: null, model: "" }) };
    const issues = validateProviders(configFor(models), models, t);
    const aws = issues.find((i) => i.name === "aws");
    expect(aws).toBeDefined();
    expect(aws!.reasons).toContain("validationBlankModels");
  });
});
