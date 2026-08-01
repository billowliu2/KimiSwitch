import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { Agent, Config } from "../types";

interface UseConfigReturn {
  config: Config | null;
  dirty: boolean;
  error: string | null;
  loading: boolean;
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
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

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("useConfig refresh failed:", message);
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
      await invoke("save_agent_config_command", { agent, config: current });
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
