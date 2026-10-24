import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import { materializeModelEfforts } from "../lib/thinking-efforts";
import type { Agent, Config } from "../types";

interface UseConfigReturn {
  config: Config | null;
  dirty: boolean;
  error: string | null;
  loading: boolean;
  // Resolves true when the config was actually re-read from disk, false when
  // the load failed (the error is also surfaced via `error`). Callers that
  // discard in-memory state as a consequence of reloading must gate on this:
  // a failed reload leaves the old in-memory config — and whatever it is
  // missing — untouched.
  refresh: (opts?: { silent?: boolean }) => Promise<boolean>;
  save: (opts?: { silent?: boolean }) => Promise<void>;
  updateConfig: (updater: (config: Config) => Config) => void;
}

export function useConfig(agent: Agent): UseConfigReturn {
  const { t } = useTranslation();
  const [config, setConfig] = useState<Config | null>(null);
  const configRef = useRef(config);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const refresh = useCallback(async (opts?: { silent?: boolean }): Promise<boolean> => {
    // silent: skip the loading flip — App returns a bare loading screen while
    // `loading` is true, which would unmount any open panel (and swallow its
    // in-flight async results).
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const loadedConfig = await invoke<Config>("load_agent_config_command", {
        agent,
      });
      setConfig(loadedConfig);
      setDirty(false);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("useConfig refresh failed:", message);
      return false;
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [agent]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateConfig = useCallback((updater: (config: Config) => Config) => {
    // Compute next state synchronously from the ref (always current) and set
    // the ref BEFORE setConfig. Previously the ref was updated inside the
    // setConfig updater, which React 18 defers — so save() reading the ref
    // immediately after would get a stale value.
    const prev = configRef.current;
    if (prev) {
      const next = updater(prev);
      configRef.current = next;
      setConfig(next);
    }
    setDirty(true);
  }, []);

  const save = useCallback(async (opts?: { silent?: boolean }) => {
    const current = configRef.current;
    if (!current) return;
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      // Fill in missing thinking-effort defaults so every saved model carries a
      // `default_effort` the CLI will accept — computed from the resolved tier
      // list, never overwriting a valid stored value.
      const payload =
        agent === "kimi_code" ? materializeModelEfforts(current) : current;
      await invoke("save_agent_config_command", { agent, config: payload });
      await refresh({ silent: opts?.silent });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(raw);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [refresh, t, agent]);

  return {
    config,
    dirty,
    error,
    loading,
    refresh,
    save,
    updateConfig,
  };
}
