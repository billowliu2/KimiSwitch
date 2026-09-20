import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Agent } from "../types";

export interface UsageData {
  planName?: string | null;
  remaining?: number | null;
  total?: number | null;
  used?: number | null;
  unit?: string | null;
  isValid?: boolean | null;
  resetsAt?: string | null;
}

export interface UsageResult {
  success: boolean;
  data?: UsageData[] | null;
  error?: string | null;
}

export type UsageStatus = "idle" | "loading" | "success" | "error";

export interface CacheEntry {
  status: "success" | "error";
  data: UsageData[];
  /** Raw error text from Rust; null = transient failure (invoke rejected). */
  error: string | null;
  updatedAt: number;
}

// Module-level cache shared across mounts: re-entering the list within the
// stale TTL shows the last result without firing new requests. Both the
// compact (card header) and detail (footer) variants read this same cache.
const STALE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

// Simple semaphore: at most MAX_CONCURRENT queries in flight at once.
const MAX_CONCURRENT = 3;
let running = 0;
const waiters: Array<() => void> = [];
async function acquireSlot(): Promise<void> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  running += 1;
}
function releaseSlot(): void {
  running -= 1;
  waiters.shift()?.();
}

export interface UsageQueryState {
  status: UsageStatus;
  data: UsageData[];
  error: string | null | undefined;
  updatedAt: number | null;
  refresh: (force: boolean) => void;
  supported: boolean;
  /** 生效的预警阈值（0/缺失已归一为 undefined）；footer 用它判定单行高亮。 */
  threshold?: number;
  /** 查询成功且任一百分比行 used ≥ threshold。失败/加载中恒为 false， */
  /** 所以失败时保留的上次数据不会被误高亮。 */
  alert: boolean;
}

/**
 * 单行是否触发预警。只判定百分比行（unit === "%"）：余额/钱包等金额行的
 * used 是钱数，与百分比阈值不可比。threshold 缺失或 ≤0（关闭）时恒为 false。
 */
export function isAlertTier(
  d: UsageData,
  threshold?: number | null
): boolean {
  if (threshold == null || threshold <= 0) return false;
  return d.unit === "%" && d.used != null && d.used >= threshold;
}

export function useUsageQuery(
  agent: Agent,
  providerName: string,
  usageKinds?: string[],
  autoIntervalMinutes?: number,
  disabled?: boolean,
  threshold?: number
): UsageQueryState {
  const supported = (usageKinds?.length ?? 0) > 0;
  // Cache key includes the agent so a Kimi Code provider and a Pi provider
  // with the same name do not clobber each other's cached result.
  const cacheKey = `${agent}:${providerName}`;

  const [status, setStatus] = useState<UsageStatus>("idle");
  const [data, setData] = useState<UsageData[]>([]);
  /** undefined = no error; null = network error; string = Rust error text. */
  const [error, setError] = useState<string | null | undefined>(undefined);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // Generation counter: stale responses (unmounted / superseded query) are ignored.
  const genRef = useRef(0);

  const runQuery = useCallback(
    async (forceRefresh: boolean) => {
      if (disabled) return;
      const gen = ++genRef.current;
      setStatus("loading");
      setError(undefined);
      const finish = (entry: CacheEntry) => {
        if (genRef.current !== gen) return;
        cache.set(cacheKey, entry);
        setStatus(entry.status);
        setData(entry.data);
        setError(entry.error);
        setUpdatedAt(entry.updatedAt);
      };
      try {
        await acquireSlot();
        let result: UsageResult;
        try {
          result = await invoke<UsageResult>("query_provider_usage", {
            agent,
            providerName,
            forceRefresh,
          });
        } finally {
          releaseSlot();
        }
        if (genRef.current !== gen) return;
        if (result.success) {
          finish({
            status: "success",
            data: result.data ?? [],
            error: null,
            updatedAt: Date.now(),
          });
        } else {
          // Deterministic failure: keep last good data for ghost display.
          finish({
            status: "error",
            data: cache.get(cacheKey)?.data ?? [],
            error: result.error ?? "",
            updatedAt: Date.now(),
          });
        }
      } catch {
        // Transient failure (network / timeout): invoke rejected.
        finish({
          status: "error",
          data: cache.get(cacheKey)?.data ?? [],
          error: null,
          updatedAt: Date.now(),
        });
      }
    },
    [agent, providerName, cacheKey, disabled]
  );

  // On mount / provider change: serve fresh cache, otherwise query once.
  useEffect(() => {
    if (disabled) {
      // Toggle back off: stop immediately and return to idle so the footer
      // hides; bump gen so an in-flight response is dropped (no stale write).
      genRef.current += 1;
      setStatus("idle");
      setData([]);
      setError(undefined);
      setUpdatedAt(null);
      return;
    }
    if (!supported) return;
    const cached = cache.get(cacheKey);
    if (cached) {
      setStatus(cached.status);
      setData(cached.data);
      setError(cached.error);
      setUpdatedAt(cached.updatedAt);
      if (Date.now() - cached.updatedAt < STALE_TTL_MS) return;
    }
    void runQuery(false);
  }, [supported, cacheKey, runQuery, disabled]);

  // Ignore late responses after unmount.
  useEffect(() => {
    return () => {
      genRef.current += 1;
    };
  }, []);

  // Auto query interval — the hook is called once per provider card and both
  // variants read the same state, so there is no second mount to double-fire.
  useEffect(() => {
    if (!supported || disabled) return;
    const mins = autoIntervalMinutes ?? 0;
    if (mins <= 0) return;
    const id = setInterval(() => void runQuery(false), mins * 60_000);
    return () => clearInterval(id);
  }, [supported, autoIntervalMinutes, runQuery, disabled]);

  // 阈值 0/负数/非有限值一律视为关闭（与配置面板「0 或空 = 关闭」一致）。
  // 每次查询结果写入 data 后此处重新求值，因此刷新后预警自动出现/消除。
  const alertThreshold =
    typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0
      ? threshold
      : undefined;
  const alert =
    status === "success" && data.some((d) => isAlertTier(d, alertThreshold));

  return {
    status,
    data,
    error,
    updatedAt,
    refresh: runQuery,
    supported,
    threshold: alertThreshold,
    alert,
  };
}
