import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  releaseUrl: string;
  downloadUrl: string | null;
}

const THROTTLE_KEY = "kimi-switch-last-update-check";
const THROTTLE_MS = 24 * 60 * 60 * 1000; // 24 hours

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
      if (lastChecked && Date.now() - lastChecked < THROTTLE_MS) return;
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
      // silently fail — user can retry from Settings
    } finally {
      setChecking(false);
    }
  }, [lastChecked]);

  // On mount: throttled auto-check
  useEffect(() => {
    doCheck(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkNow = useCallback(() => doCheck(true), [doCheck]);

  return { updateInfo, checking, checkNow, lastChecked };
}
