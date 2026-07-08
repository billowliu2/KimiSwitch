import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { Agent, Config } from "../types";

interface UseConfigReturn {
  config: Config | null;
  dirty: boolean;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  save: () => Promise<void>;
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

  const refresh = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [agent]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateConfig = useCallback((updater: (config: Config) => Config) => {
    setConfig((prev) => {
      const next = prev ? updater(prev) : prev;
      configRef.current = next;
      return next;
    });
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    const current = configRef.current;
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("save_agent_config_command", { agent, config: current });
      await refresh();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(raw);
    } finally {
      setLoading(false);
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
