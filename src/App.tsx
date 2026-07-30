import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useConfig } from "./hooks/useConfig";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { ProviderList } from "./components/ProviderList";
import { ProviderEdit } from "./components/ProviderEdit";
import { DashboardPage } from "./components/dashboard/DashboardPage";
import { SessionsPage } from "./components/sessions/SessionsPage";
import { SettingsModal } from "./components/SettingsModal";
import { PresetPickerModal } from "./components/PresetPickerModal";
import { useTranslation } from "./i18n";
import { getDefaultMaxContextSize } from "./lib/model-defaults";
import { getModelRef } from "./lib/models-dev";
import {
  presetToProviderAndModels,
  type ProviderPreset,
} from "./config/providerPresets";
import { validateProviders } from "./lib/validation";
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
  const [showPresetPicker, setShowPresetPicker] = useState(false);
  // Provider names that have been added to the in-memory config but not
  // yet committed via save(). Pressing "back" in the edit form for one of
  // these drops it silently (no confirm); all other dirty navigation
  // keeps the existing unsavedConfirm flow.
  const [pendingNewProviders, setPendingNewProviders] = useState<Set<string>>(
    () => new Set(),
  );


  useEffect(() => {
    if (!loading) {
      setLoadTimeout(false);
      return;
    }
    const timer = setTimeout(() => setLoadTimeout(true), 5000);
    return () => clearTimeout(timer);
  }, [loading]);

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

  // trySave calls validateProviders, which takes a library-style
  // `(key: string) => string`; useTranslation's `t` is strictly typed to
  // the project's i18n key union, so we relax it locally for the call.
  const tGeneric = t as unknown as (
    key: string,
    vars?: Record<string, unknown>,
  ) => string;
  // Wraps `save` with a completeness check. Three flavours of caller:
  //   1. Whole-config save (Ctrl+S, footer button, ProviderEdit onSave):
  //      no `target` → validate every enabled provider, show a confirm
  //      dialog listing the incomplete ones.
  //   2. Switching a specific provider as active: `target` is the
  //      provider being switched to — only that one needs to be
  //      complete; sibling providers being merely listed in the config
  //      must not block the switch.
  //   3. Programmatic auto-saves (duplicate) call `save` directly with
  //      no validation — duplicates inherit completeness from their
  //      source.
  // Returns `true` when the config was actually persisted, `false` when
  // the user cancelled the validation confirm (callers can react to this
  // to roll back in-memory mutations made before the save).
  const trySave = useCallback(
    async (target?: string): Promise<boolean> => {
      if (!config) return false;
      if (dirty) {
        const issues = validateProviders(config, config.models, tGeneric, target);
        if (issues.length > 0) {
          const summary = issues
            .map((i) => `• ${i.name}: ${i.reasons.join("; ")}`)
            .join("\n");
          if (!confirm(t("saveValidationConfirm", { details: summary }))) {
            return false;
          }
        }
      }
      await save();
      // Successful save: clear the "in-memory only" markers — every
      // provider is now on disk.
      setPendingNewProviders(new Set());
      return true;
    },
    [config, dirty, save, t],
  );

  // Keyboard shortcuts: Ctrl+S save, Ctrl+R reload, Ctrl+O open config dir
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case "s":
        case "S":
          e.preventDefault();
          void trySave();
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
  }, [trySave, refresh, dirty, t, agent]);

  // "Add provider" opens the preset picker; the empty form is reachable via
  // the picker's "+ custom config" entry (handleAddCustomProvider).
  const handleAddProvider = () => {
    if (!config) return;
    setShowPresetPicker(true);
  };

  const handleAddCustomProvider = () => {
    if (!config) return;
    setShowPresetPicker(false);
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
    // Mark as in-memory only — never persisted until the user explicitly
    // saves a complete config. Pressing "back" in the edit form will
    // silently drop this entry.
    setPendingNewProviders((prev) => new Set([...prev, name]));
    setEditingProvider(name);
    setView("edit");
  };

  const handleSelectPreset = async (preset: ProviderPreset) => {
    if (!config) return;
    setShowPresetPicker(false);
    const { provider, models, defaultModel } = presetToProviderAndModels(preset, {
      existingProviderNames: new Set(Object.keys(config.providers)),
      existingModelAliases: new Set(Object.keys(config.models)),
    });
    updateConfig((cfg) => {
      const providers = { ...cfg.providers, [provider.name]: provider };
      const updatedModels = { ...cfg.models };
      for (const m of models) {
        updatedModels[m.alias] = m;
      }
      return {
        ...cfg,
        providers,
        models: updatedModels,
        default_model: defaultModel || cfg.default_model,
      };
    });
    // Do NOT auto-save: a freshly-picked preset is intentionally
    // incomplete (no api_key yet). The user lands in the edit form
    // next; if they fill the key and save, validation passes and the
    // config lands on disk. If they back out without saving, the
    // in-memory additions are discarded on the next refresh — config.toml
    // never receives a half-configured provider.
    setPendingNewProviders((prev) => new Set([...prev, provider.name]));
    setEditingProvider(provider.name);
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

  const handleDuplicateProvider = async (name: string) => {
    updateConfig((cfg) => {
      const src = cfg.providers[name];
      if (!src) return cfg;
      let newName = `${name}-copy`;
      let n = 2;
      while (cfg.providers[newName]) {
        newName = `${name}-copy-${n}`;
        n++;
      }
      // Clone the provider (deactivated, clear its remembered default model
      // since the model aliases will be re-keyed to the new name below).
      const copied = setProviderDefaultModel(
        { ...src, name: newName, active: false },
        null
      );
      const providers = { ...cfg.providers, [newName]: copied };
      // Re-key this provider's models to the new provider name so the copy
      // has its own independent model set.
      const models = { ...cfg.models };
      for (const [alias, m] of Object.entries(cfg.models)) {
        if (m.provider === name) {
          // The model belongs to this provider by `m.provider === name`. To
          // re-key it under the new provider, we want a `newName/...`
          // alias. The original code assumed `alias` is exactly
          // `${name}/${modelId}` and used `alias.slice(name.length)`; that
          // breaks for legacy / non-standard aliases (e.g. `kimi-k3` from
          // pre-v0.6 data) which would produce `newName-k3` — missing the
          // `/` separator and pointing at the wrong model. Use an explicit
          // prefix check and fall back to a full re-prefix.
          const prefix = `${name}/`;
          const newAlias = alias.startsWith(prefix)
            ? newName + alias.slice(name.length)
            : `${newName}/${alias}`;
          models[newAlias] = { ...m, alias: newAlias, provider: newName };
        }
      }
      return { ...cfg, providers, models };
    });
    await save();
    setSwitchMessage(t("copiedProvider", { name: `${name}-copy` }));
    setTimeout(() => setSwitchMessage(null), 3000);
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
    const saved = await trySave(name);
    if (!saved) {
      // Validation was cancelled: undo the in-memory switch by reloading
      // the on-disk state, and skip the activation + /reload nudge.
      await refresh();
      return;
    }
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

  const handleEditBack = async () => {
    const target = editingProvider;
    if (target && pendingNewProviders.has(target)) {
      // This provider was added in-memory (via preset or "+ custom config")
      // but never committed. Drop it silently — no confirm — and reload
      // from disk so the list reflects the on-disk truth.
      setPendingNewProviders((prev) => {
        const next = new Set(prev);
        next.delete(target);
        return next;
      });
      await refresh();
    } else if (dirty) {
      // Real edits to a previously-saved provider — keep the existing
      // unsaved-changes confirm so the user doesn't lose work by accident.
      if (!confirm(t("unsavedConfirm"))) return;
      await refresh();
    }
    setView("list");
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
            onDuplicate={handleDuplicateProvider}
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
            onBack={handleEditBack}
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
                  // Skip if this model id already exists for the same provider
                  const dup = Object.values(updated).some(
                    (mm) => mm.provider === m.provider && mm.model === m.model && m.model !== ""
                  );
                  if (dup) continue;
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
            onSave={trySave}
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
            onClick={() => { void trySave(); }}
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

      <PresetPickerModal
        open={showPresetPicker}
        onClose={() => setShowPresetPicker(false)}
        onSelect={handleSelectPreset}
        onCustom={handleAddCustomProvider}
      />
    </div>
  );
}
