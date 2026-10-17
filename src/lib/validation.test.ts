import { describe, expect, it } from "vitest";
import { findTrimDuplicateProviderNames, validateProviderName } from "./validation";
import type { Provider } from "../types";

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
