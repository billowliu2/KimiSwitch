import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./useKimiCodeVersion";

describe("isNewerVersion", () => {
  it("同版本不算有更新", () => {
    expect(isNewerVersion("2.0.2", "2.0.2")).toBe(false);
    expect(isNewerVersion("v2.0.2", "2.0.2")).toBe(false);
  });

  it("按 major/minor/patch 逐段比较", () => {
    expect(isNewerVersion("2.0.2", "2.0.1")).toBe(true);
    expect(isNewerVersion("2.1.0", "2.0.9")).toBe(true);
    expect(isNewerVersion("3.0.0", "2.99.99")).toBe(true);
    expect(isNewerVersion("2.0.1", "2.0.2")).toBe(false);
    expect(isNewerVersion("1.9.9", "2.0.0")).toBe(false);
  });

  it("忽略 v 前缀与预发布后缀", () => {
    expect(isNewerVersion("v0.44.0-beta.1", "0.43.1")).toBe(true);
    expect(isNewerVersion("0.43.1", "0.43.1-rc.2")).toBe(false);
  });

  it("缺位补 0，无法解析时不显示更新", () => {
    expect(isNewerVersion("2.1", "2.0.9")).toBe(true);
    expect(isNewerVersion("abc", "2.0.1")).toBe(false);
    expect(isNewerVersion("2.0.2", "abc")).toBe(false);
  });
});
