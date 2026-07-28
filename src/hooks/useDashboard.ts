import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SummaryResult } from "../types/dashboard";

export type DashboardRange = "today" | "7d" | "30d" | "all";

const RANGE_STORAGE_KEY = "kimi-switch-dashboard-range";

export function useDashboard() {
  const [range, setRange] = useState<DashboardRange>(() => {
    try {
      const stored = localStorage.getItem(RANGE_STORAGE_KEY) as DashboardRange | null;
      if (stored === "today" || stored === "7d" || stored === "30d" || stored === "all") {
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<SummaryResult>("get_summary", { range });
      setData(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const changeRange = useCallback((next: DashboardRange) => {
    setRange(next);
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  return { range, changeRange, data, loading, error, refresh };
}
