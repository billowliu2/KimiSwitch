import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useConfig } from "./hooks/useConfig";
import { ProviderList } from "./components/ProviderList";
import { ProviderEdit } from "./components/ProviderEdit";
import { useTranslation } from "./i18n";
import type { Agent, Model, Provider } from "./types";

const AGENT_STORAGE_KEY = "pi-switch-agent";

const AGENTS: { key: Agent; label: string }[] = [
  { key: "kimi_code", label: "Kimi Code" },
  { key: "pi", label: "Pi" },
];

function getInitialAgent(): Agent {
  try {
    const stored = localStorage.getItem(AGENT_STORAGE_KEY) as Agent | null;
    if (stored === "kimi_code" || stored === "pi") return stored;
  } catch {
    // ignore
  }
  return "pi";
}

export default function App() {
  const { t, lang, setLang } = useTranslation();
  const [agent, setAgentState] = useState<Agent>(getInitialAgent);
  const {
    config,
    dirty,
    error,
    loading,
    refresh,
    save,
    updateConfig,
  } = useConfig(agent);

  const [view, setView] = useState<"list" | "edit">("list");
  const [editingProvider, setEditingProvider] = useState<string>("");
  const [loadTimeout, setLoadTimeout] = useState(false);

  const setAgent = (next: Agent) => {
    setAgentState(next);
    try {
      localStorage.setItem(AGENT_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    setView("list");
    setEditingProvider("");
  };

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
    updateConfig((cfg) => ({ ...cfg, default_model: alias }));
  };

  const handleSwitchProvider = async (name: string) => {
    updateConfig((cfg) => {
      const target = cfg.providers[name];
      if (!target || target.managed) return cfg;

      const isKimiNative = (p: Provider) => p.managed === true;

      // Mark the selected provider as active and deactivate other custom providers.
      // Kimi native providers are left untouched. No provider/model records are deleted.
      const providers: Record<string, Provider> = {};
      for (const [key, p] of Object.entries(cfg.providers)) {
        providers[key] = { ...p, active: isKimiNative(p) ? undefined : key === name };
      }

      // Set default model to the first model of the selected provider.
      let default_model: string | null = null;
      for (const [key, m] of Object.entries(cfg.models)) {
        if (m.provider === name) {
          default_model = key;
          break;
        }
      }

      return { ...cfg, providers, default_model };
    });

    // Persist the full config to Pi Switch's SQLite and activate the selected provider.
    await save();
    await invoke("activate_agent_config_command", { agent });
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
        updatedModels[alias] = { ...m, alias, provider: provider.name };
      }

      let default_model = cfg.default_model;
      if (default_model && !(default_model in updatedModels)) {
        default_model = null;
      }

      return { ...cfg, providers, models: updatedModels, default_model };
    });
    if (provider.name !== editingProvider) {
      setEditingProvider(provider.name);
    }
  };

  if (loading || !config) {
    return (
      <div className="p-4 space-y-2 text-[#e5e5e7]">
        <div>{t("loading")}</div>
        {loadTimeout && (
          <div className="text-sm text-orange-400">{t("loadTimeout")}</div>
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
    <div className="flex flex-col h-full bg-[#0f0f11] text-[#e5e5e7]">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#2a2a2e] bg-[#16161a]">
        <div className="flex items-center bg-[#1f1f23] border border-[#2a2a2e] rounded p-0.5">
          {AGENTS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setAgent(key)}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                agent === key
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-[#e5e5e7]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="bg-[#1f1f23] border border-[#2a2a2e] rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            value={lang}
            onChange={(e) => setLang(e.target.value as typeof lang)}
            title={t("language")}
          >
            <option value="zh">{t("zh")}</option>
            <option value="en">{t("en")}</option>
          </select>
        </div>
      </header>

      {error && (
        <div role="alert" className="bg-red-900/20 text-red-400 p-2 text-sm border-b border-red-500/20">
          {error}
        </div>
      )}

      <main className="flex-1 overflow-hidden relative">
        {view === "list" ? (
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
              const providerModels = Object.values(config.models).filter(
                (m) => m.provider === currentProvider.name
              );
              const alias = `${currentProvider.name}-${providerModels.length + 1}`;
              updateConfig((cfg) => ({
                ...cfg,
                models: {
                  ...cfg.models,
                  [alias]: {
                    alias,
                    provider: currentProvider.name,
                    model: "",
                    max_context_size: 128000,
                    display_name: null,
                    role: null,
                    supports_1m: false,
                    capabilities: [],
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
          <div className="p-8 text-center text-gray-400">
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

      <footer className="flex items-center justify-between px-4 py-2 border-t border-[#2a2a2e] bg-[#16161a] text-sm">
        <div className="flex items-center gap-2 min-w-0">
          {dirty && (
            <span className="text-orange-400 truncate">● {t("unsavedChanges")}</span>
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
                : "border border-[#2a2a2e] hover:bg-[#252529] focus:ring-blue-500"
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
            className="px-3 py-1.5 text-sm border border-[#2a2a2e] rounded hover:bg-[#252529] focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50"
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
            className="px-3 py-1.5 text-sm border border-[#2a2a2e] rounded hover:bg-[#252529] focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {t("openConfigDir")}
          </button>
        </div>
      </footer>
    </div>
  );
}
