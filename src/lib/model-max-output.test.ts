import { describe, expect, it } from "vitest";
import {
  parseMaxOutputInput,
  readMaxOutputSize,
  setMaxOutputSize,
  withMaxOutputSize,
} from "./model-max-output";

const model = (raw_other: unknown) =>
  ({
    alias: "a",
    provider: "p",
    model: "m",
    max_context_size: 0,
    display_name: null,
    raw_other,
  }) as const;

describe("readMaxOutputSize", () => {
  it("reads the key from a model entry's preserved config fields", () => {
    expect(readMaxOutputSize({ max_output_size: 32768 })).toBe(32768);
  });

  it("treats absent / malformed / non-positive values as unset", () => {
    expect(readMaxOutputSize(undefined)).toBeUndefined();
    expect(readMaxOutputSize(null)).toBeUndefined();
    expect(readMaxOutputSize({})).toBeUndefined();
    expect(readMaxOutputSize("32768")).toBeUndefined();
    expect(readMaxOutputSize({ max_output_size: 0 })).toBeUndefined();
    expect(readMaxOutputSize({ max_output_size: -1 })).toBeUndefined();
    expect(readMaxOutputSize({ max_output_size: NaN })).toBeUndefined();
    expect(readMaxOutputSize([1, 2])).toBeUndefined();
  });
});

describe("parseMaxOutputInput", () => {
  it("keeps positive integers", () => {
    expect(parseMaxOutputInput("32768")).toBe(32768);
  });

  it("maps blank / zero / garbage to unset", () => {
    expect(parseMaxOutputInput("")).toBeUndefined();
    expect(parseMaxOutputInput("0")).toBeUndefined();
    expect(parseMaxOutputInput("-5")).toBeUndefined();
    expect(parseMaxOutputInput("abc")).toBeUndefined();
  });
});

describe("setMaxOutputSize", () => {
  it("sets the key while preserving other preserved fields", () => {
    expect(setMaxOutputSize({ support_efforts: ["low"] }, 16384)).toEqual({
      support_efforts: ["low"],
      max_output_size: 16384,
    });
  });

  it("drops the key when the value is unset", () => {
    expect(setMaxOutputSize({ max_output_size: 16384, force: true }, undefined)).toEqual({
      force: true,
    });
  });

  it("starts from an empty object for null / non-object raw_other", () => {
    expect(setMaxOutputSize(null, 1024)).toEqual({ max_output_size: 1024 });
    expect(setMaxOutputSize("junk", 1024)).toEqual({ max_output_size: 1024 });
    expect(setMaxOutputSize({ max_output_size: 1 }, undefined)).toEqual({});
  });
});

describe("withMaxOutputSize", () => {
  it("returns a new model with the override applied", () => {
    const before = model({ max_output_size: 4096 });
    const after = withMaxOutputSize(before, 8192);
    expect(readMaxOutputSize(after.raw_other)).toBe(8192);
    expect(readMaxOutputSize(before.raw_other)).toBe(4096);
    expect(after).not.toBe(before);
  });

  it("clears the override without touching other fields", () => {
    const after = withMaxOutputSize(model({ max_output_size: 4096 }), undefined);
    expect(after.raw_other).toEqual({});
  });
});
