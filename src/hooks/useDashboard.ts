import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SummaryResult } from "../types/dashboard";

export type DashboardRange = "today" | "yesterday" | "7d" | "30d" | "all";

const RANGE_STORAGE_KEY = "kimi-switch-dashboard-range";

export function useDashboard() {
  const [range, setRange] = useState<DashboardRange>(() => {
    try {
      const stored = localStorage.getItem(RANGE_STORAGE_KEY) as DashboardRange | null;
      if (stored === "today" || stored === "yesterday" || stored === "7d" || stored === "30d" || stored === "all") {
        return stored;
      }
    } catch {
      // ignore
    }
    return "30d";
  });

  const [data, setData] = useState<SummaryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Round-trip timing for the last get_summary call (user-perceived lag). */
  const [loadStats, setLoadStats] = useState<{ ms: number } | null>(null);
  // Generation counter: stale responses (superseded range / unmounted) are dropped.
  const genRef = useRef(0);

  const refresh = useCallback(async (force = false) => {
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const result = await invoke<SummaryResult>("get_summary", {
        range,
        refresh: force,
      });
      if (genRef.current !== gen) return;
      setData(result);
      setLoadStats({ ms: Math.round(performance.now() - start) });
    } catch (err) {
      if (genRef.current !== gen) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      if (genRef.current === gen) setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Ignore late responses after unmount.
  useEffect(() => {
    return () => {
      genRef.current += 1;
    };
  }, []);

  const changeRange = useCallback((next: DashboardRange) => {
    setRange(next);
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  return { range, changeRange, data, loading, error, refresh, loadStats };
}
