import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  InstalledPluginInfo,
  PluginMarketplaceResult,
} from "../../types";

/**
 * Plugin marketplace data + mutations. All backend IPC for the plugin
 * marketplace is concentrated here so the page stays thin and the switch
 * to a live backend is a drop-in change.
 *
 * IPC contract (Rust, camelCase args):
 *   get_plugin_marketplace(homeOverride?, refresh?)  → PluginMarketplaceResult
 *   list_installed_plugins(homeOverride?)            → InstalledPluginInfo[]
 *   install_plugin(homeOverride?, source, expectedId?) → InstalledPluginInfo
 *   set_plugin_enabled(homeOverride?, id, enabled)   → void
 *   remove_plugin(homeOverride?, id)                 → void
 * Like the existing pages, homeOverride is never passed (Rust side defaults).
 */
export function usePlugins() {
  const [catalog, setCatalog] = useState<PluginMarketplaceResult | null>(null);
  const [installed, setInstalled] = useState<InstalledPluginInfo[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [installedLoading, setInstalledLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [installedError, setInstalledError] = useState<string | null>(null);

  const loadCatalog = useCallback(async (refresh = false) => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const result = await invoke<PluginMarketplaceResult>(
        "get_plugin_marketplace",
        { refresh }
      );
      setCatalog(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCatalogError(msg);
      return null;
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const loadInstalled = useCallback(async () => {
    setInstalledLoading(true);
    setInstalledError(null);
    try {
      const result = await invoke<InstalledPluginInfo[]>(
        "list_installed_plugins",
        {}
      );
      setInstalled(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInstalledError(msg);
      return null;
    } finally {
      setInstalledLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog(false);
    void loadInstalled();
  }, [loadCatalog, loadInstalled]);

  const installPlugin = useCallback(
    async (source: string, expectedId?: string) => {
      return invoke<InstalledPluginInfo>("install_plugin", {
        source,
        expectedId,
      });
    },
    []
  );

  const setPluginEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      await invoke("set_plugin_enabled", { id, enabled });
    },
    []
  );

  const removePlugin = useCallback(async (id: string) => {
    await invoke("remove_plugin", { id });
  }, []);

  return {
    catalog,
    installed,
    catalogLoading,
    installedLoading,
    catalogError,
    installedError,
    loadCatalog,
    loadInstalled,
    installPlugin,
    setPluginEnabled,
    removePlugin,
  };
}
