import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useConfig } from "./hooks/useConfig";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { ProviderList } from "./components/ProviderList";
import { ProviderEdit } from "./components/ProviderEdit";
import { DashboardPage } from "./components/dashboard/DashboardPage";
import { SessionsPage } from "./components/sessions/SessionsPage";
import { SettingsModal } from "./components/SettingsModal";
import { useTranslation } from "./i18n";
import { getDefaultMaxContextSize } from "./lib/model-defaults";
import { getModelRef } from "./lib/models-dev";
import type { Agent, Model, Provider } from "./types";

const AGENT_STORAGE_KEY = "kimi-switch-agent";

function getProviderDefaultModel(provider: Provider): string | null {
  const raw = provider.raw_other as Record<string, unknown> | undefined;
  const value = raw?.default_model;
  return typeof value === "string" ? value : null;
}

function setProviderDefaultModel(provider: Provider, alias: string | null): Provider {
  const raw = (provider.raw_other as Record<string, unknown> | undefined) ?? {};
  if (alias) {
    return { ...provider, raw_other: { ...raw, default_model: alias } };
  }
  const { default_model: _, ...rest } = raw;
  return { ...provider, raw_other: rest };
}

function findFirstModelForProvider(models: Record<string, Model>, providerName: string): string | null {
  for (const [key, m] of Object.entries(models)) {
    if (m.provider === providerName) {
      return key;
    }
  }
  return null;
}

function getInitialAgent(): Agent {
  try {
    const stored = localStorage.getItem(AGENT_STORAGE_KEY) as Agent | null;
    if (stored === "kimi_code") return stored;
  } catch {
    // ignore
  }
  return "kimi_code";
}

export default function App() {
  const { t, lang, setLang } = useTranslation();
  const { updateInfo, checking, checkNow, lastChecked } = useUpdateCheck();
  const [agent] = useState<Agent>(getInitialAgent);
  const {
    config,
    dirty,
    error,
    loading,
    refresh,
    save,
    updateConfig,
  } = useConfig(agent);

  const [view, setView] = useState<"list" | "edit" | "dashboard" | "sessions">("list");
  const [editingProvider, setEditingProvider] = useState<string>("");
  const [loadTimeout, setLoadTimeout] = useState(false);
  const [switchMessage, setSwitchMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);


  useEffect(() => {
    if (!loading) {
      setLoadTimeout(false);
      return;
    }
    const timer = setTimeout(() => setLoadTimeout(true), 5000);
    return () => clearTimeout(timer);
  }, [loading]);

  // Keyboard shortcuts: Ctrl+S save, Ctrl+R reload, Ctrl+O open config dir
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case "s":
        case "S":
          e.preventDefault();
          save();
          break;
        case "r":
        case "R":
          e.preventDefault();
          if (dirty && !confirm(t("unsavedConfirm"))) return;
          refresh();
          break;
        case "o":
        case "O":
          e.preventDefault();
          invoke("open_agent_config_dir", { agent }).catch((err) =>
            alert(err instanceof Error ? err.message : String(err))
          );
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save, refresh, dirty, t, agent]);

  // Update window title to reflect unsaved changes.
  useEffect(() => {
    const app = getCurrentWindow();
    const prefix = dirty ? "* " : "";
    app.setTitle(`${prefix}${t("appTitle")}`);
  }, [dirty, t]);

  // Warn before closing the window when there are unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    invoke("debug_log", {
      message: `App mounted. agent=${agent} loading=${loading} config=${config ? Object.keys(config.providers).length + " providers" : "null"}`,
    }).catch(() => {});
  }, [loading, config, agent]);

  const providers = useMemo(
    () => (config ? Object.values(config.providers) : []),
    [config]
  );

  const handleAddProvider = () => {
    if (!config) return;
    const name = `provider-${providers.length + 1}`;
    const defaultType = agent === "kimi_code" ? "kimi" : "openai";
    updateConfig((cfg) => ({
      ...cfg,
      providers: {
        ...cfg.providers,
        [name]: {
          name,
          provider_type: defaultType,
          base_url: null,
          api_key: null,
          env: {},
          note: null,
          official_url: null,
          managed: false,
          enabled: true,
        },
      },
    }));
    setEditingProvider(name);
    setView("edit");
  };

  const handleUpdateProvider = (provider: Provider) => {
    updateConfig((cfg) => {
      const providers = { ...cfg.providers };
      const oldEntry = Object.entries(providers).find(
        ([, p]) => p.name === editingProvider
      );
      if (oldEntry && oldEntry[0] !== provider.name) {
        delete providers[oldEntry[0]];
        const models = { ...cfg.models };
        for (const key of Object.keys(models)) {
          if (models[key].provider === editingProvider) {
            models[key] = { ...models[key], provider: provider.name };
          }
        }
        providers[provider.name] = provider;
        setEditingProvider(provider.name);
        return { ...cfg, providers, models };
      }
      providers[provider.name] = provider;
      return { ...cfg, providers };
    });
  };

  const handleDeleteProvider = (name: string) => {
    if (!confirm(t("deleteProviderConfirm", { name }))) return;
    updateConfig((cfg) => {
      const providers = { ...cfg.providers };
      delete providers[name];
      const models = { ...cfg.models };
      for (const key of Object.keys(models)) {
        if (models[key].provider === name) {
          delete models[key];
        }
      }
      return { ...cfg, providers, models };
    });
    if (editingProvider === name) {
      setEditingProvider("");
      setView("list");
    }
  };

  const handleSetDefaultModel = (alias: string) => {
    updateConfig((cfg) => {
      const model = cfg.models[alias];
      if (!model) return cfg;
      const provider = cfg.providers[model.provider];
      if (!provider) return cfg;
      const providers = {
        ...cfg.providers,
        [provider.name]: setProviderDefaultModel(provider, alias),
      };
      return { ...cfg, providers, default_model: alias };
    });
  };

  const handleSwitchProvider = async (name: string) => {
    updateConfig((cfg) => {
      const target = cfg.providers[name];
      if (!target) return cfg;

      // Find the currently active provider so we can remember its default
      // model before switching away.
      let activeProviderName: string | null = null;
      for (const [key, p] of Object.entries(cfg.providers)) {
        if (p.active) {
          activeProviderName = key;
          break;
        }
      }

      // Rebuild providers with the selected one moved to the front so it is
      // visually prioritised. All others are deactivated.
      const providers: Record<string, Provider> = {};
      providers[name] = { ...target, active: true };

      // Remember the old active provider's current default model (if it
      // belongs to that provider) so switching back later restores the user's
      // choice.
      if (activeProviderName && activeProviderName !== name && cfg.default_model) {
        const oldActive = cfg.providers[activeProviderName];
        if (oldActive && cfg.models[cfg.default_model]?.provider === activeProviderName) {
          providers[activeProviderName] = setProviderDefaultModel(
            { ...oldActive, active: false },
            cfg.default_model
          );
        }
      }

      // Add remaining providers (skip selected and old-active if already added).
      for (const [key, p] of Object.entries(cfg.providers)) {
        if (key === name) continue;
        if (providers[key]) continue;
        providers[key] = { ...p, active: false };
      }

      // Prefer the target provider's remembered default model; fall back to
      // its first model when there is no saved preference or it is invalid.
      let default_model = getProviderDefaultModel(target);
      if (!default_model || cfg.models[default_model]?.provider !== name) {
        default_model = findFirstModelForProvider(cfg.models, name);
      }

      return { ...cfg, providers, default_model };
    });

    // Persist the full config to Kimi Switch's SQLite and activate the selected provider.
    await save();
    await invoke("activate_agent_config_command", { agent });

    // /reload is an interactive Kimi Code TUI command with no CLI equivalent,
    // so we copy it to the clipboard as a convenience.
    try {
      await navigator.clipboard.writeText("/reload");
      setSwitchMessage(t("reloadCopiedHint"));
      setTimeout(() => setSwitchMessage(null), 4000);
    } catch {
      // Clipboard may be unavailable; ignore silently.
    }
  };

  const handleApplyProviderJson = (provider: Provider, models: Model[]) => {
    updateConfig((cfg) => {
      const providers = { ...cfg.providers };
      const oldName = editingProvider;
      if (oldName && oldName !== provider.name) {
        delete providers[oldName];
      }
      providers[provider.name] = provider;

      const updatedModels = { ...cfg.models };
      // Remove existing models for this provider.
      for (const key of Object.keys(updatedModels)) {
        if (updatedModels[key].provider === oldName) {
          delete updatedModels[key];
        }
      }
      // Add updated models, ensuring aliases are unique.
      for (const m of models) {
        let alias = m.alias;
        let n = 1;
        while (alias in updatedModels) {
          alias = `${m.alias}-${n}`;
          n++;
        }
        updatedModels[alias] = {
          ...m,
          alias,
          provider: provider.name,
          max_context_size:
            m.max_context_size ??
            getModelRef(m.model)?.context ??
            getDefaultMaxContextSize(m.model),
        };
      }

      let default_model = cfg.default_model;
      if (default_model && !(default_model in updatedModels)) {
        default_model = null;
      }

      // Remember this provider's default model preference so it survives
      // provider switches.
      const updatedProvider = providers[provider.name];
      if (updatedProvider && default_model && updatedModels[default_model]?.provider === provider.name) {
        providers[provider.name] = setProviderDefaultModel(updatedProvider, default_model);
      }

      return { ...cfg, providers, models: updatedModels, default_model };
    });
    if (provider.name !== editingProvider) {
      setEditingProvider(provider.name);
    }
  };

  if (loading || !config) {
    return (
      <div className="p-4 space-y-2 text-content-primary">
        <div>{t("loading")}</div>
        {loadTimeout && (
          <div className="text-sm text-orange-600 dark:text-orange-400">{t("loadTimeout")}</div>
        )}
        {error && (
          <div className="text-sm text-red-400 bg-red-900/20 p-2 rounded">
            <div className="font-semibold">{t("loadFailed")}</div>
            <div>{error}</div>
            <button
              type="button"
              className="mt-2 px-2 py-1 border border-red-400/30 rounded hover:bg-red-900/30"
              onClick={refresh}
            >
              {t("retry")}
            </button>
          </div>
        )}
      </div>
    );
  }

  const currentProvider = config.providers[editingProvider];

  return (
    <div className="flex flex-col h-full bg-app text-content-primary">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-panel">
        <div className="flex items-center bg-input border border-border rounded p-0.5">
          <button
            type="button"
            onClick={() => setView("list")}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              view === "list" || view === "edit"
                ? "bg-blue-600 text-white"
                : "text-content-muted hover:text-content-primary"
            }`}
          >
            {t("providers")}
          </button>
          <button
            type="button"
            onClick={() => setView("dashboard")}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              view === "dashboard"
                ? "bg-blue-600 text-white"
                : "text-content-muted hover:text-content-primary"
            }`}
          >
            {t("dashboard")}
          </button>
          <button
            type="button"
            onClick={() => setView("sessions")}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              view === "sessions"
                ? "bg-blue-600 text-white"
                : "text-content-muted hover:text-content-primary"
            }`}
          >
            {t("sessions")}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* Language */}
          <select
            className="bg-input border border-border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            value={lang}
            onChange={(e) => setLang(e.target.value as typeof lang)}
            title={t("language")}
          >
            <option value="zh">{t("zh")}</option>
            <option value="en">{t("en")}</option>
          </select>
          {/* Settings gear */}
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            title={t("settings")}
            className="relative p-1.5 rounded border border-border hover:bg-hover-2 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-content-muted">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {updateInfo?.updateAvailable && (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 ring-1 ring-panel" />
            )}
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="bg-red-900/20 text-red-400 p-2 text-sm border-b border-red-500/20">
          {error}
        </div>
      )}

      {switchMessage && (
        <div className="bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400 p-2 text-sm border-b border-green-300 dark:border-green-500/20 text-center">
          {switchMessage}
        </div>
      )}

      <main className="flex-1 overflow-hidden relative">
        {view === "dashboard" ? (
          <DashboardPage />
        ) : view === "sessions" ? (
          <SessionsPage />
        ) : view === "list" ? (
          <ProviderList
            providers={providers}
            defaultModel={config.default_model}
            models={config.models}
            onEdit={(name) => {
              setEditingProvider(name);
              setView("edit");
            }}
            onDelete={handleDeleteProvider}
            onAdd={handleAddProvider}
            onSwitchProvider={handleSwitchProvider}
            agent={agent}
          />
        ) : currentProvider ? (
          <ProviderEdit
            agent={agent}
            provider={currentProvider}
            models={Object.values(config.models).filter(
              (m) => m.provider === currentProvider.name
            )}
            defaultModel={config.default_model}
            rawOther={config.raw_other}
            onRawOtherChange={(nextRawOther) =>
              updateConfig((cfg) => ({ ...cfg, raw_other: nextRawOther }))
            }
            onBack={() => setView("list")}
            onChange={handleUpdateProvider}
            onDelete={() => handleDeleteProvider(currentProvider.name)}
            onModelChange={(model) => {
              updateConfig((cfg) => {
                const models = { ...cfg.models };
                const existingKeys = Object.keys(models).filter(
                  (k) => models[k].provider === currentProvider.name
                );
                const oldKey = existingKeys.find((k) =>
                  model.alias === k ? true : models[k].alias === model.alias
                );
                if (oldKey && oldKey !== model.alias) {
                  delete models[oldKey];
                }
                models[model.alias] = model;
                let default_model = cfg.default_model;
                if (default_model === oldKey) default_model = model.alias;
                return { ...cfg, models, default_model };
              });
            }}
            onModelDelete={(alias) => {
              updateConfig((cfg) => {
                const models = { ...cfg.models };
                delete models[alias];
                return {
                  ...cfg,
                  models,
                  default_model:
                    cfg.default_model === alias ? null : cfg.default_model,
                };
              });
            }}
            onModelAdd={() => {
              const safeProvider = currentProvider.name.replace(/\//g, "-");
              const alias = `${safeProvider}/新模型`;
              updateConfig((cfg) => ({
                ...cfg,
                models: {
                  ...cfg.models,
                  [alias]: {
                    alias,
                    provider: currentProvider.name,
                    model: "",
                    max_context_size: getDefaultMaxContextSize(alias),
                    display_name: null,
                    supports_1m: false,
                    capabilities: agent === "kimi_code" ? ["thinking"] : [],
                  },
                },
              }));
            }}
            onBulkAdd={(models) => {
              updateConfig((cfg) => {
                const updated = { ...cfg.models };
                for (const m of models) {
                  let alias = m.alias;
                  let n = 1;
                  while (alias in updated) {
                    alias = `${m.alias}-${n}`;
                    n++;
                  }
                  updated[alias] = { ...m, alias };
                }
                return { ...cfg, models: updated };
              });
            }}
            onSetDefault={handleSetDefaultModel}
            onApplyJson={handleApplyProviderJson}
            onSave={save}
          />
        ) : (
          <div className="p-8 text-center text-content-muted">
            <div>{t("providerNotFound")}</div>
            <button
              type="button"
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              onClick={() => setView("list")}
            >
              {t("backToList")}
            </button>
          </div>
        )}
      </main>

      {view !== "dashboard" && view !== "sessions" && (
      <footer className="flex items-center justify-between px-4 py-2 border-t border-border bg-panel text-sm">
        <div className="flex items-center gap-2 min-w-0">
          {dirty && (
            <span className="text-orange-600 dark:text-orange-400 truncate">● {t("unsavedChanges")}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || loading}
            className={`px-3 py-1.5 text-sm rounded focus:ring-2 focus:outline-none disabled:opacity-50 ${
              dirty
                ? "bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500"
                : "border border-border hover:bg-hover-2 focus:ring-blue-500"
            }`}
          >
            {dirty ? `● ${t("saveConfig")}` : t("saveConfig")}
          </button>
          <button
            type="button"
            onClick={() => {
              if (dirty && !confirm(t("unsavedConfirm"))) {
                return;
              }
              refresh();
            }}
            disabled={loading}
            className="px-3 py-1.5 text-sm border border-border rounded hover:bg-hover-2 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50"
          >
            {t("reloadConfig")}
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await invoke("open_agent_config_dir", { agent });
              } catch (err) {
                alert(err instanceof Error ? err.message : String(err));
              }
            }}
            className="px-3 py-1.5 text-sm border border-border rounded hover:bg-hover-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {t("openConfigDir")}
          </button>
        </div>
      </footer>
      )}

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        updateInfo={updateInfo}
        checking={checking}
        onCheckUpdate={checkNow}
        lastChecked={lastChecked}
      />
    </div>
  );
}
