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
}

export function useUsageQuery(
  agent: Agent,
  providerName: string,
  usageKinds?: string[],
  autoIntervalMinutes?: number
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
      const gen = ++genRef.current;
      setStatus("loading");
      setError(undefined);
      const finish = (entry: CacheEntry) => {
        cache.set(cacheKey, entry);
        if (genRef.current !== gen) return;
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
    [agent, providerName, cacheKey]
  );

  // On mount / provider change: serve fresh cache, otherwise query once.
  useEffect(() => {
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
  }, [supported, cacheKey, runQuery]);

  // Ignore late responses after unmount.
  useEffect(() => {
    return () => {
      genRef.current += 1;
    };
  }, []);

  // Auto query interval — the hook is called once per provider card and both
  // variants read the same state, so there is no second mount to double-fire.
  useEffect(() => {
    if (!supported) return;
    const mins = autoIntervalMinutes ?? 0;
    if (mins <= 0) return;
    const id = setInterval(() => void runQuery(false), mins * 60_000);
    return () => clearInterval(id);
  }, [supported, autoIntervalMinutes, runQuery]);

  return {
    status,
    data,
    error,
    updatedAt,
    refresh: runQuery,
    supported,
  };
}
