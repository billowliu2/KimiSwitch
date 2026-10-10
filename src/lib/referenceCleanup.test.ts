import { describe, expect, it } from "vitest";
import { purgeSubagentPoolAliases, rekeySubagentPoolAliases } from "./referenceCleanup";

const rawWithPool = {
  thinking: { enabled: true },
  secondary_model: {
    default_model: "opencode-go/longcat-2.5-preview-free",
    model: "opencode-go/longcat-2.5-preview-free",
    models: {
      "TokenHub/deepseek-v4.1-flash": "",
      "opencode-go/longcat-2.5-preview-free": "",
      "opencode-go/mimo-v2.6-flash": "",
      "opencode-go-copy/deepseek-v4-flash": "route to deepseek",
    },
    force: false,
  },
  services: { moonshot_fetch: { api_key: "" } },
};

describe("rekeySubagentPoolAliases", () => {
  it("re-keys pool keys and defaults when the provider is renamed", () => {
    const next = rekeySubagentPoolAliases(rawWithPool, {
      "opencode-go-copy/deepseek-v4-flash": "opencode-go/deepseek-v4-flash",
    }) as typeof rawWithPool;

    const section = next.secondary_model as Record<string, any>;
    expect(Object.keys(section.models).sort()).toEqual([
      "TokenHub/deepseek-v4.1-flash",
      "opencode-go/deepseek-v4-flash",
      "opencode-go/longcat-2.5-preview-free",
      "opencode-go/mimo-v2.6-flash",
    ]);
    // Descriptions survive the re-key.
    expect(section.models["opencode-go/deepseek-v4-flash"]).toBe("route to deepseek");
    // Untouched defaults stay put.
    expect(section.default_model).toBe("opencode-go/longcat-2.5-preview-free");
    // Unrelated sections are preserved.
    expect(next.thinking).toEqual({ enabled: true });
  });

  it("follows the default when it referenced a renamed alias", () => {
    const raw = {
      secondary_model: {
        default_model: "old/m1",
        model: "old/m1",
        models: { "old/m1": "" },
      },
    };
    const next = rekeySubagentPoolAliases(raw, { "old/m1": "new/m1" }) as any;
    expect(next.secondary_model.default_model).toBe("new/m1");
    expect(next.secondary_model.model).toBe("new/m1");
    expect(Object.keys(next.secondary_model.models)).toEqual(["new/m1"]);
  });

  it("returns the same reference when nothing matches", () => {
    expect(rekeySubagentPoolAliases(rawWithPool, { "a/b": "c/d" })).toBe(rawWithPool);
  });

  it("never injects an empty models table into the implicit single-model form", () => {
    // `{ model: "old/m1" }` with no pool table: re-keying the default must
    // not add `[secondary_model.models]` — an empty table is invalid for the
    // engine (its default has to be a key of the table).
    const raw = { secondary_model: { model: "old/m1" } };
    const next = rekeySubagentPoolAliases(raw, { "old/m1": "new/m1" }) as any;
    expect(next.secondary_model).toEqual({ model: "new/m1" });
    expect(next.secondary_model.models).toBeUndefined();
  });

  it("never injects a models table into the force form", () => {
    const raw = { secondary_model: { force: true, default_model: "old/m1", model: "old/m1" } };
    const next = rekeySubagentPoolAliases(raw, { "old/m1": "new/m1" }) as any;
    expect(next.secondary_model).toEqual({
      force: true,
      default_model: "new/m1",
      model: "new/m1",
    });
    expect(next.secondary_model.models).toBeUndefined();
  });
});

describe("purgeSubagentPoolAliases", () => {
  it("removes deleted aliases and keeps the rest of the section intact", () => {
    const next = purgeSubagentPoolAliases(rawWithPool, [
      "opencode-go-copy/deepseek-v4-flash",
    ]) as typeof rawWithPool;
    const section = next.secondary_model as Record<string, any>;
    expect(Object.keys(section.models).sort()).toEqual([
      "TokenHub/deepseek-v4.1-flash",
      "opencode-go/longcat-2.5-preview-free",
      "opencode-go/mimo-v2.6-flash",
    ]);
    expect(section.default_model).toBe("opencode-go/longcat-2.5-preview-free");
    expect(section.force).toBe(false);
    expect(next.thinking).toEqual({ enabled: true });
  });

  it("falls back to the first remaining key when the default was purged", () => {
    const next = purgeSubagentPoolAliases(rawWithPool, [
      "opencode-go/longcat-2.5-preview-free",
    ]) as any;
    const section = next.secondary_model;
    expect(section.models).not.toHaveProperty("opencode-go/longcat-2.5-preview-free");
    expect(section.default_model).toBe("TokenHub/deepseek-v4.1-flash");
    expect(section.model).toBe("TokenHub/deepseek-v4.1-flash");
  });

  it("drops the whole section when the pool becomes empty", () => {
    const raw = {
      thinking: { enabled: true },
      secondary_model: {
        default_model: "p/m",
        model: "p/m",
        models: { "p/m": "" },
      },
    };
    const next = purgeSubagentPoolAliases(raw, ["p/m"]) as any;
    expect(next).not.toHaveProperty("secondary_model");
    expect(next.thinking).toEqual({ enabled: true });
  });

  it("returns the same reference when no pool entry is affected", () => {
    expect(purgeSubagentPoolAliases(rawWithPool, ["other/m9"])).toBe(rawWithPool);
  });
});
