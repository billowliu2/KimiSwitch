import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  releaseUrl: string;
  downloadUrl: string | null;
}

const THROTTLE_KEY = "kimi-switch-last-update-check";
// Both the throttle window and the periodic re-check run on an 8h cadence:
// long-running sessions still pick up new releases without a restart, and the
// actual backend call is still gated so short windows don't double-fire.
const CHECK_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 hours

export function useUpdateCheck() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(THROTTLE_KEY);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });

  const doCheck = useCallback(async (force: boolean) => {
    if (!force) {
      if (lastChecked && Date.now() - lastChecked < CHECK_INTERVAL_MS) return;
    }
    setChecking(true);
    try {
      const info = await invoke<UpdateInfo>("check_for_update");
      setUpdateInfo(info);
      const now = Date.now();
      setLastChecked(now);
      try {
        localStorage.setItem(THROTTLE_KEY, String(now));
      } catch {
        // ignore
      }
    } catch {
      // silently fail — network errors, parse errors, etc. should not nag
      // the user. They can still trigger a manual check from Settings.
    } finally {
      setChecking(false);
    }
  }, [lastChecked]);

  // Keep a ref to the latest doCheck so the periodic interval doesn't need
  // to be reset on every lastChecked change.
  const doCheckRef = useRef(doCheck);
  useEffect(() => {
    doCheckRef.current = doCheck;
  }, [doCheck]);

  // On mount: throttled auto-check + periodic re-check while the window
  // stays open. Errors are silent (handled inside doCheck).
  useEffect(() => {
    doCheckRef.current(false);
    const interval = setInterval(() => doCheckRef.current(false), CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const checkNow = useCallback(() => doCheck(true), [doCheck]);

  return { updateInfo, checking, checkNow, lastChecked };
}
