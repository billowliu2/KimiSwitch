import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SummaryResult } from "../types/dashboard";

export type DashboardRange = "today" | "yesterday" | "7d" | "30d" | "all";

const RANGE_STORAGE_KEY = "kimi-switch-dashboard-range";

/**
 * Emitted by the backend when the background verification walk found records the
 * fast (disk-cache) path did not have. The payload is empty — the hook only
 * needs to know that a re-fetch is worth making.
 */
const RECORDS_UPDATED_EVENT = "dashboard://records-updated";

const RANGES: readonly DashboardRange[] = ["today", "yesterday", "7d", "30d", "all"];

function readStoredRange(): DashboardRange {
  try {
    const stored = localStorage.getItem(RANGE_STORAGE_KEY) as DashboardRange | null;
    if (stored && (RANGES as readonly string[]).includes(stored)) {
      return stored;
    }
  } catch {
    // ignore
  }
  return "30d";
}

/**
 * Last successful payload per range, kept across mounts so a range switch (and
 * reopening the page) paints instantly from memory and revalidates in the
 * background instead of showing a spinner over data that is already known.
 * Bounded by the five ranges the dashboard offers.
 */
const summaryCache = new Map<DashboardRange, SummaryResult>();

export function useDashboard() {
  const [range, setRange] = useState<DashboardRange>(readStoredRange);

  const [data, setData] = useState<SummaryResult | null>(
    () => summaryCache.get(readStoredRange()) ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Round-trip timing for the last get_summary call (user-perceived lag). */
  const [loadStats, setLoadStats] = useState<{ ms: number } | null>(null);
  // Generation counter: stale responses (superseded range / unmounted) are dropped.
  const genRef = useRef(0);
  // The event handler must call the *current* refresh, not the one captured when
  // the listener was installed, so it reads the callback through a ref.
  const refreshRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  const refresh = useCallback(async (force = false) => {
    const gen = ++genRef.current;
    // Stale-while-revalidate: hand the cached payload for this range to the
    // view before the request goes out, so a range switch is instant and the
    // response only refreshes numbers that are already on screen. `loading` is
    // raised only when there is nothing to show (first load of a range) or when
    // the user asked for a refresh — the button keeps its busy state, the silent
    // revalidation behind a cached range does not.
    const cached = summaryCache.get(range);
    if (cached) setData(cached);
    setLoading(force || !cached);
    setError(null);
    const start = performance.now();
    try {
      const result = await invoke<SummaryResult>("get_summary", {
        range,
        refresh: force,
      });
      if (genRef.current !== gen) return;
      summaryCache.set(range, result);
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

  refreshRef.current = refresh;

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The first load of a session answers from the on-disk snapshot, which can be
  // behind a session written since the app last ran. The backend verifies in the
  // background and signals here when the numbers moved; re-fetching silently
  // (never raising `loading`) keeps the already-drawn dashboard on screen and
  // just corrects it. A silent call still takes a fresh generation, so it cannot
  // be interleaved with a range switch in flight.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen(RECORDS_UPDATED_EVENT, () => {
      refreshRef.current();
    })
      .then((fn) => {
        // The effect may have been torn down before `listen` resolved.
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No event bridge (e.g. a browser build): the dashboard still works,
        // it just will not be corrected mid-session.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

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
