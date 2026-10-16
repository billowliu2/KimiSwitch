import { describe, expect, it } from "vitest";
import { validateProviderName } from "./validation";

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
