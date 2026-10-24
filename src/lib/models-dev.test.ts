import { beforeEach, describe, expect, it } from "vitest";
import { applyModelsDevSnapshot, getModelRef } from "./models-dev";

/**
 * models.dev keys are `<provider>/<model>`; a configured model id may be bare,
 * vendor-prefixed, or even carry our own provider name. The lookup must still
 * resolve, otherwise the thinking-effort column silently degrades to "unknown".
 */
describe("getModelRef", () => {
  beforeEach(() => {
    applyModelsDevSnapshot({
      last_updated: "2026-10-23",
      "commandcode/deepseek/deepseek-v4.1-flash": { efforts: ["low", "high", "max"] },
      "nano-gpt/z-ai/glm-5.3-flash": { efforts: ["high", "max"] },
    });
  });

  it("matches an exact key", () => {
    expect(getModelRef("commandcode/deepseek/deepseek-v4.1-flash")?.efforts).toEqual([
      "low",
      "high",
      "max",
    ]);
  });

  it("matches a bare model id by suffix", () => {
    expect(getModelRef("glm-5.3-flash")?.efforts).toEqual(["high", "max"]);
  });

  it("matches a vendor-prefixed id", () => {
    expect(getModelRef("z-ai/glm-5.3-flash")?.efforts).toEqual(["high", "max"]);
  });

  it("matches when our own provider name prefixes the id", () => {
    expect(getModelRef("commandcode/deepseek-v4.1-flash")?.efforts).toEqual([
      "low",
      "high",
      "max",
    ]);
  });

  it("returns undefined for unknown models", () => {
    expect(getModelRef("no-such-model")).toBeUndefined();
    expect(getModelRef("   ")).toBeUndefined();
  });
});
