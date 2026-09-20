import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** kimi-code 与本应用的适配状态（Rust 侧基线表决定）。 */
export type KimiCodeStatus =
  | "current"
  | "outdated"
  | "partial"
  | "unknown"
  | "not_installed";

export interface KimiCodeVersionInfo {
  /** 本机安装的 kimi-code 版本；未安装 / 检测失败为 null。 */
  installed: string | null;
  /** 上游最新 release tag（已去掉 v 前缀）；查询失败为 null。 */
  latest: string | null;
  status: KimiCodeStatus;
}

const THROTTLE_KEY = "kimi-switch-last-kc-version-check";
// 与 useUpdateCheck 一致：节流窗口与定时复查同为 8h，长时间挂着的窗口也能
// 自动拿到新版本，同时避免短时间反复触发后端调用。
const CHECK_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 hours

/** 解析 major.minor.patch 三元组；缺位补 0，无法解析返回 null。 */
function versionTriple(version: string): [number, number, number] | null {
  const core = version.trim().replace(/^[vV]/, "").split(/[-+]/)[0];
  const nums = core.split(".").slice(0, 3).map((p) => Number.parseInt(p.trim(), 10));
  if (nums.length === 0 || nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  while (nums.length < 3) nums.push(0);
  return [nums[0], nums[1], nums[2]];
}

/** latest 是否严格高于 installed（用于决定是否显示 releases 链接）。 */
export function isNewerVersion(latest: string, installed: string): boolean {
  const l = versionTriple(latest);
  const i = versionTriple(installed);
  if (!l || !i) return false;
  for (let k = 0; k < 3; k += 1) {
    if (l[k] !== i[k]) return l[k] > i[k];
  }
  return false;
}

/**
 * 读取「本机 kimi-code 版本 / 上游最新版 / 适配状态」，模式与 useUpdateCheck
 * 相同：挂载时按 8h 节流自动查一次，之后定时复查，checkNow 强制刷新。
 */
export function useKimiCodeVersion() {
  const [info, setInfo] = useState<KimiCodeVersionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(THROTTLE_KEY);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });

  const doCheck = useCallback(
    async (force: boolean) => {
      if (!force) {
        if (lastChecked && Date.now() - lastChecked < CHECK_INTERVAL_MS) return;
      }
      setChecking(true);
      try {
        const next = await invoke<KimiCodeVersionInfo>("get_kimi_code_version_info");
        setInfo(next);
        const now = Date.now();
        setLastChecked(now);
        try {
          localStorage.setItem(THROTTLE_KEY, String(now));
        } catch {
          // ignore
        }
      } catch {
        // 静默失败：检测不到 kimi / 网络不通都不该打扰用户，手动检查仍可用。
      } finally {
        setChecking(false);
      }
    },
    [lastChecked]
  );

  // 定时器不随 lastChecked 重建，所以用 ref 持有最新的 doCheck。
  const doCheckRef = useRef(doCheck);
  useEffect(() => {
    doCheckRef.current = doCheck;
  }, [doCheck]);

  useEffect(() => {
    doCheckRef.current(false);
    const interval = setInterval(() => doCheckRef.current(false), CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const checkNow = useCallback(() => doCheck(true), [doCheck]);

  return { info, checking, checkNow, lastChecked };
}
