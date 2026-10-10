import { describe, expect, it } from "vitest";
import {
  copyModelsOnProviderDuplicate,
  rekeyModelsOnProviderRename,
} from "./providerRename";
import type { Model } from "../types";

function model(alias: string, provider: string): Model {
  return {
    alias,
    provider,
    model: alias.slice(provider.length + 1),
    max_context_size: 512000,
    display_name: null,
  };
}

describe("rekeyModelsOnProviderRename", () => {
  it("re-keys aliases and provider when a provider is renamed (opencode-go-copy scenario)", () => {
    const models = {
      "opencode-go-copy/deepseek-v4-flash": model("opencode-go-copy/deepseek-v4-flash", "opencode-go-copy"),
      "opencode-go-copy/deepseek-v4.1-flash": model("opencode-go-copy/deepseek-v4.1-flash", "opencode-go-copy"),
      "opencode-go/longcat-2.5-preview-free": model("opencode-go/longcat-2.5-preview-free", "opencode-go"),
      "other/m1": model("other/m1", "other"),
    };

    const { models: next, aliasMap } = rekeyModelsOnProviderRename(models, "opencode-go-copy", "opencode-go");

    expect(Object.keys(next).sort()).toEqual([
      "opencode-go/deepseek-v4-flash",
      "opencode-go/deepseek-v4.1-flash",
      "opencode-go/longcat-2.5-preview-free",
      "other/m1",
    ]);
    expect(next["opencode-go/deepseek-v4-flash"].provider).toBe("opencode-go");
    expect(next["opencode-go/deepseek-v4-flash"].model).toBe("deepseek-v4-flash");
    expect(aliasMap).toEqual({
      "opencode-go-copy/deepseek-v4-flash": "opencode-go/deepseek-v4-flash",
      "opencode-go-copy/deepseek-v4.1-flash": "opencode-go/deepseek-v4.1-flash",
    });
    // Untouched providers stay identical.
    expect(next["opencode-go/longcat-2.5-preview-free"]).toBe(models["opencode-go/longcat-2.5-preview-free"]);
    expect(next["other/m1"]).toBe(models["other/m1"]);
  });

  it("fully re-prefixes non-standard aliases missing the old `<name>/` prefix", () => {
    const models = { "legacy-k3": model("legacy-k3", "kimi-code") };
    const { models: next } = rekeyModelsOnProviderRename(models, "kimi-code", "renamed");
    expect(Object.keys(next)).toEqual(["renamed/legacy-k3"]);
    expect(next["renamed/legacy-k3"].provider).toBe("renamed");
  });

  it("leaves other providers' models alone when renaming", () => {
    const models = { "a/m1": model("a/m1", "a"), "b/m1": model("b/m1", "b") };
    const { models: next, aliasMap } = rekeyModelsOnProviderRename(models, "a", "c");
    expect(Object.keys(next).sort()).toEqual(["b/m1", "c/m1"]);
    expect(aliasMap).toEqual({ "a/m1": "c/m1" });
  });

  it("suffixes instead of overwriting when the renamed alias collides (rename into an occupied name)", () => {
    // Renaming provider `a` to `b` while `b` already has b/m1 — the re-keyed
    // entry must not silently swallow b's model.
    const models = {
      "a/m1": model("a/m1", "a"),
      "b/m1": model("b/m1", "b"),
    };
    const { models: next, aliasMap } = rekeyModelsOnProviderRename(models, "a", "b");
    expect(next["b/m1"].model).toBe("m1"); // b's original survives
    expect(next["b/m1-2"].provider).toBe("b"); // a's model re-keyed with suffix
    expect(aliasMap).toEqual({ "a/m1": "b/m1-2" });
    expect(Object.keys(next).sort()).toEqual(["b/m1", "b/m1-2"]);
  });

  it("suffixes when a legacy bare alias collides with the standard alias after rename", () => {
    // Pre-v0.6 data: bare alias `k3` (no provider prefix) and `kimi/k3` both
    // belong to `kimi`; both re-key to `x/k3`.
    const models = {
      k3: { ...model("k3", "kimi"), model: "k3" },
      "kimi/k3": model("kimi/k3", "kimi"),
    };
    const { models: next, aliasMap } = rekeyModelsOnProviderRename(models, "kimi", "x");
    expect(Object.keys(next).sort()).toEqual(["x/k3", "x/k3-2"]);
    expect(next["x/k3"]).toBeDefined();
    expect(next["x/k3-2"]).toBeDefined();
    // Both old keys are mapped; the pool re-key consumes the map, so every
    // entry lands on a distinct target.
    expect(Object.values(aliasMap).sort()).toEqual(["x/k3", "x/k3-2"]);
  });
});

describe("copyModelsOnProviderDuplicate", () => {
  it("clones the provider's models and KEEPS the source (copy, not move)", () => {
    const models = {
      "opencode-go/longcat": model("opencode-go/longcat", "opencode-go"),
      "other/m1": model("other/m1", "other"),
    };
    const next = copyModelsOnProviderDuplicate(models, "opencode-go", "opencode-go-copy");
    expect(Object.keys(next).sort()).toEqual([
      "opencode-go-copy/longcat",
      "opencode-go/longcat",
      "other/m1",
    ]);
    expect(next["opencode-go/longcat"].provider).toBe("opencode-go");
    expect(next["opencode-go-copy/longcat"].provider).toBe("opencode-go-copy");
  });

  it("fully re-prefixes non-standard aliases and suffixes collisions", () => {
    const models = {
      "legacy-k3": { ...model("legacy-k3", "kimi"), model: "k3" },
      "dupe/legacy-k3": model("dupe/legacy-k3", "other"),
    };
    const next = copyModelsOnProviderDuplicate(models, "kimi", "dupe");
    // `dupe/legacy-k3` is taken → the clone gets a suffix.
    expect(Object.keys(next).sort()).toEqual([
      "dupe/legacy-k3",
      "dupe/legacy-k3-2",
      "legacy-k3",
    ]);
  });
});
