import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "../i18n";
import type { Agent } from "../types";

interface UsageData {
  planName?: string | null;
  remaining?: number | null;
  total?: number | null;
  used?: number | null;
  unit?: string | null;
  isValid?: boolean | null;
  resetsAt?: string | null;
}

interface UsageResult {
  success: boolean;
  data?: UsageData[] | null;
  error?: string | null;
}

type UsageStatus = "idle" | "loading" | "success" | "error";

interface CacheEntry {
  status: "success" | "error";
  data: UsageData[];
  /** Raw error text from Rust; null = transient failure (invoke rejected). */
  error: string | null;
  updatedAt: number;
}

// Module-level cache shared across mounts: re-entering the list within the
// stale TTL shows the last result without firing new requests.
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

interface UsageFooterProps {
  agent: Agent;
  providerName: string;
  usageKinds?: string[];
}

export function UsageFooter({ agent, providerName, usageKinds }: UsageFooterProps) {
  const { t } = useTranslation();
  const supported = (usageKinds?.length ?? 0) > 0;
  // Cache key includes the agent so a Kimi Code provider and a Pi provider
  // with the same name do not clobber each other's cached result.
  const cacheKey = `${agent}:${providerName}`;

  const [status, setStatus] = useState<UsageStatus>("idle");
  const [data, setData] = useState<UsageData[]>([]);
  /** undefined = no error; null = network error; string = Rust error text. */
  const [error, setError] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
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

  // Tick the reset countdown once a minute while showing data.
  useEffect(() => {
    if (status !== "success") return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [status]);

  if (!supported || status === "idle") return null;

  const percentOf = (d: UsageData): number | null => {
    if (d.used != null && d.total != null && d.total > 0)
      return (d.used / d.total) * 100;
    if (d.remaining != null && d.total != null && d.total > 0)
      return (1 - d.remaining / d.total) * 100;
    return null;
  };

  const formatAmount = (
    value: number | null | undefined,
    unit?: string | null
  ): string => {
    if (value == null) return "—";
    const symbol =
      unit === "CNY" ? "¥" : unit === "USD" ? "$" : unit ? `${unit} ` : "";
    const num = Number.isInteger(value) ? String(value) : value.toFixed(2);
    return `${symbol}${num}`;
  };

  const formatReset = (resetsAt?: string | null): string | null => {
    if (!resetsAt) return null;
    const ms = new Date(resetsAt).getTime() - now;
    if (Number.isNaN(ms)) return null;
    if (ms <= 0) return t("usageResetDone");
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return t("usageResetIn", { time: `${Math.max(mins, 1)}m` });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("usageResetIn", { time: `${hours}h` });
    return t("usageResetIn", { time: `${Math.floor(hours / 24)}d` });
  };

  const refreshBtn = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void runQuery(true);
      }}
      disabled={status === "loading"}
      title={t("usageRefresh")}
      aria-label={t("usageRefresh")}
      className="ml-auto w-6 h-6 flex items-center justify-center rounded text-content-muted hover:text-content-primary hover:bg-hover-2 disabled:opacity-50 transition-colors"
    >
      {status === "loading" ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <RefreshCw className="w-3.5 h-3.5" />
      )}
    </button>
  );

  // Loading with no prior data: skeleton bar.
  if (status === "loading" && data.length === 0) {
    return (
      <div
        className="w-full border-t border-border pt-2 mt-1"
        aria-label={t("usageLoading")}
      >
        <div className="h-3.5 w-2/3 rounded bg-hover-2 animate-pulse" />
      </div>
    );
  }

  if (status === "error" && data.length === 0) {
    const text =
      error == null
        ? t("usageNetworkError")
        : /401|api[ -]?key|invalid key/i.test(error)
          ? t("usageInvalidKey")
          : error
            ? `${t("usageQueryFailed")} · ${error}`
            : t("usageQueryFailed");
    return (
      <div className="w-full border-t border-border pt-2 mt-1 flex items-center gap-2 text-xs">
        <span className="text-red-500 dark:text-red-400 truncate" title={text}>
          {text}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void runQuery(true);
          }}
          className="ml-auto shrink-0 px-2 py-0.5 rounded border border-red-300 dark:border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          {t("usageRetry")}
        </button>
      </div>
    );
  }

  // success, or error/loading with last-good data (ghost).
  const ghost = status !== "success";
  return (
    <div
      className={`w-full border-t border-border pt-2 mt-1 flex flex-col gap-1 text-xs ${
        ghost ? "opacity-50" : ""
      }`}
    >
      {data.map((d, i) => {
        const isPlan = !!d.planName;
        const pct = isPlan ? percentOf(d) : null;
        const color =
          pct == null
            ? "text-content-muted"
            : pct < 70
              ? "text-green-600 dark:text-green-400"
              : pct < 90
                ? "text-orange-600 dark:text-orange-400"
                : "text-red-500 dark:text-red-400";
        const resetText = isPlan ? formatReset(d.resetsAt) : null;

        let main: string;
        if (d.isValid === false) {
          main = t("usageInvalidKey");
        } else if (isPlan) {
          const label = data.length > 1 && d.planName ? `${d.planName} · ` : "";
          main =
            pct != null
              ? `${label}${Math.round(pct)}% ${t("usageUsed")}`
              : d.remaining != null
                ? `${label}${t("usageRemaining")} ${formatAmount(d.remaining, d.unit)}`
                : label || "—";
        } else {
          main = `${t("usageBalance")} ${formatAmount(d.remaining, d.unit)}`;
        }

        return (
          <div key={i} className="flex items-center gap-1.5 min-w-0">
            <span aria-hidden="true">{isPlan ? "⚡" : "💰"}</span>
            <span
              className={`tabular-nums truncate ${
                d.isValid === false ? "text-red-500 dark:text-red-400" : color
              }`}
              title={main}
            >
              {main}
            </span>
            {resetText && (
              <span className="text-content-muted shrink-0">{resetText}</span>
            )}
            {i === data.length - 1 && refreshBtn}
          </div>
        );
      })}
      {data.length === 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-content-muted">—</span>
          {refreshBtn}
        </div>
      )}
    </div>
  );
}
