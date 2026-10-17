import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useConfig } from "./hooks/useConfig";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { ProviderList } from "./components/ProviderList";
import { ProviderEdit } from "./components/ProviderEdit";
import { SubagentSettingsPage } from "./components/SubagentSettingsPage";
import { DashboardPage } from "./components/dashboard/DashboardPage";
import { SessionsPage } from "./components/sessions/SessionsPage";
import { PluginMarketplacePage } from "./components/plugins/PluginMarketplacePage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { UsageConfigModal } from "./components/UsageConfigModal";
import { PresetPickerModal } from "./components/PresetPickerModal";
import { useTranslation } from "./i18n";
import { getDefaultMaxContextSize } from "./lib/model-defaults";
import { getModelRef, modelsDevReady, onModelsDevReady } from "./lib/models-dev";
import {
  presetToProviderAndModels,
  type ProviderPreset,
} from "./config/providerPresets";
import { findTrimDuplicateProviderNames, validateProviders } from "./lib/validation";
import {
  copyModelsOnProviderDuplicate,
  rekeyModelsOnProviderRename,
} from "./lib/providerRename";
import {
  purgeSubagentPoolAliases,
  rekeySubagentPoolAliases,
} from "./lib/referenceCleanup";
import type { Agent, Model, Provider, UsageConfig } from "./types";

const AGENT_STORAGE_KEY = "kimi-switch-agent";

type View =
  | "list"
  | "edit"
  | "subagent"
  | "dashboard"
  | "sessions"
  | "plugins"
  | "settings";

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

  const [view, setView] = useState<View>("list");
  const [editingProvider, setEditingProvider] = useState<string>("");
  const [loadTimeout, setLoadTimeout] = useState(false);
  const [switchMessage, setSwitchMessage] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<"general" | "global" | "advanced">(
    "general",
  );
  const [showPresetPicker, setShowPresetPicker] = useState(false);
  /** Provider whose usage-config panel is open; null = closed. */
  const [usageConfigProvider, setUsageConfigProvider] = useState<string | null>(null);
  // Provider names that have been added to the in-memory config but not
  // yet committed via save(). Pressing "back" in the edit form for one of
  // these drops it silently (no confirm); all other dirty navigation
  // keeps the existing unsavedConfirm flow.
  const [pendingNewProviders, setPendingNewProviders] = useState<Set<string>>(
    () => new Set(),
  );
  // Providers an earlier name collision overwrote in memory, keyed by the
  // provider name the colliding entry squatted on, held so they can be put
  // back. A non-empty map means the in-memory config is missing entries, so
  // trySave and the usage-config save hard-block on it; the rename / delete /
  // JSON-apply paths restore whatever they free. Multiple slots are possible
  // (rename A→B, then rename C→D without resolving the first) — a single slot
  // would drop the older victim on the floor.
  const displacedRef = useRef<Map<string, Provider>>(new Map());

  // Put every stashed provider back whose key is free again (mutates the map
  // it is given, and drops the restored slots). Must run AFTER a rename has
  // moved the edited entry off the squatted key: while the edited entry still
  // holds it, the key is present and nothing can be restored. Running it also
  // empties the restored slots, so a second collision in a row can stash its
  // own victim.
  const restoreDisplaced = useCallback(
    (providers: Record<string, Provider>) => {
      const stash = displacedRef.current;
      for (const [key, provider] of [...stash]) {
        if (!Object.hasOwn(providers, key)) {
          providers[key] = provider;
          stash.delete(key);
        }
      }
    },
    [],
  );

  // The reasons a config must not reach disk at all, shared by every write
  // path (trySave for whole-config saves, handleSaveUsageConfig for the
  // usage panel's silent save). Both describe a config that loses data the
  // moment it is persisted, so there is nothing here for the user to confirm.
  // Returns the alert message, or null when nothing blocks the save.
  const hardBlockMessage = useCallback((): string | null => {
    if (!config) return null;
    if (displacedRef.current.size > 0) {
      return t("saveBlockedDisplaced");
    }
    const blankNames = Object.keys(config.providers).filter(
      (key) => key.trim() === ""
    );
    if (blankNames.length > 0) {
      // JSON.stringify keeps a blank name readable in the message — joining
      // the raw keys renders as nothing after the colon.
      return t("saveBlockedNameConflict", {
        names: blankNames.map((k) => JSON.stringify(k)).join(", "),
      });
    }
    // Names that collide once trimmed ("TokenHub" vs "TokenHub ") are
    // invisible to the blank-name check above and to the edit page's per-name
    // hint (which excludes the entry being edited), but both are on disk and
    // the edit page paints both red with no way out. Block them here.
    const trimDuplicates = findTrimDuplicateProviderNames(config.providers);
    if (trimDuplicates.length > 0) {
      return t("saveBlockedNameConflict", {
        names: trimDuplicates.map((k) => JSON.stringify(k)).join(", "),
      });
    }
    return null;
  }, [config, t]);

  // Every "abandon the in-memory config" path goes through here. The reload
  // brings back the on-disk truth, which includes whatever a collision
  // displaced, so the stash is obsolete once the reload has actually
  // returned. Clearing it only on a *successful* reload keeps a failed one
  // (config unchanged, still collided) from looking clean to trySave.
  const reloadFromDisk = useCallback(async () => {
    if (await refresh()) {
      displacedRef.current.clear();
    }
  }, [refresh]);

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

  // Load the models.dev index in the background (not in the main bundle)
  // and re-render once it lands so context/capability columns fill in.
  const [, forceModelsDevReady] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    onModelsDevReady(forceModelsDevReady);
    void modelsDevReady();
  }, []);

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
  // Returns `true` when the config was actually persisted, `false` when a
  // hard block (see hardBlockMessage) or the validation confirm stopped it
  // — callers can react to this to roll back in-memory mutations made before
  // the save.
  const trySave = useCallback(
    async (target?: string): Promise<boolean> => {
      if (!config) return false;
      if (dirty) {
        const blocked = hardBlockMessage();
        if (blocked) {
          alert(blocked);
          return false;
        }
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
    [config, dirty, hardBlockMessage, save, t],
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
          void reloadFromDisk();
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
  }, [trySave, reloadFromDisk, dirty, t, agent]);

  // "Add provider" opens the preset picker; the empty form is reachable via
  // the picker's "+ custom config" entry (handleAddCustomProvider).
  const handleAddProvider = () => {
    if (!config) return;
    setShowPresetPicker(true);
  };

  const handleAddCustomProvider = () => {
    if (!config) return;
    setShowPresetPicker(false);
    // Counting alone can land on a taken name (delete `provider-2`, add:
    // `provider-3` may already exist), and that collision would silently
    // overwrite an existing provider before the user types anything.
    let n = providers.length + 1;
    let name = `provider-${n}`;
    while (Object.hasOwn(config.providers, name)) {
      n++;
      name = `provider-${n}`;
    }
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
      const oldKey = oldEntry ? oldEntry[0] : editingProvider;
      // Judged against the pre-change map: the name this write lands on is
      // exactly the entry the overwrite below would destroy without a trace.
      const displacedKey =
        provider.name !== oldKey && Object.hasOwn(cfg.providers, provider.name)
          ? provider.name
          : null;
      // Both branches assign `next`; the initial value is only there so
      // TypeScript can infer its type.
      let next = cfg;
      if (oldEntry && oldEntry[0] !== provider.name) {
        delete providers[oldEntry[0]];
        // Re-key this provider's model aliases so the `<provider>/<model>`
        // prefix tracks the new name (see rekeyModelsOnProviderRename).
        const { models, aliasMap } = rekeyModelsOnProviderRename(
          cfg.models,
          editingProvider,
          provider.name
        );
        // The provider's remembered default model and the global default
        // model are stored as aliases and must follow the re-key.
        const remembered = getProviderDefaultModel(provider);
        providers[provider.name] =
          remembered && aliasMap[remembered]
            ? setProviderDefaultModel(provider, aliasMap[remembered])
            : provider;
        let default_model = cfg.default_model;
        if (default_model && aliasMap[default_model]) {
          default_model = aliasMap[default_model];
        }
        // The subagent pool references model aliases as its keys and
        // defaults; they must follow the re-key or they turn into zombie
        // pool entries.
        const raw_other = rekeySubagentPoolAliases(cfg.raw_other, aliasMap);
        setEditingProvider(provider.name);
        next = { ...cfg, providers, models, default_model, raw_other };
      } else {
        providers[provider.name] = provider;
        next = { ...cfg, providers };
      }
      // Put back every entry an earlier collision displaced whose key is free
      // again. This must run AFTER the rename above moved the edited provider
      // off that key: while the edited entry still holds it, the key is
      // present in `providers` and nothing can be restored. Running it before
      // the stashing below also drops the restored slots, so a second
      // collision in a row can stash its own victim instead of being skipped.
      restoreDisplaced(providers);
      // Stash whatever this write is about to overwrite. The write itself
      // still goes through: the name input is controlled and reports every
      // keystroke, so rejecting a colliding one would make the text jump back
      // as the user types. Keeping the loss out of config.toml is trySave's
      // job, not the input's.
      //
      // One slot per squatted name, and the first snapshot wins: re-colliding
      // on the same name overwrites that slot's squatter again, so the
      // original victim — the only copy of it — must not be replaced.
      if (displacedKey && !displacedRef.current.has(displacedKey)) {
        displacedRef.current.set(displacedKey, cfg.providers[displacedKey]);
      }
      return next;
    });
  };

  const handleDeleteProvider = (name: string) => {
    if (!confirm(t("deleteProviderConfirm", { name }))) return;
    updateConfig((cfg) => {
      const providers = { ...cfg.providers };
      delete providers[name];
      // The stash holds providers an earlier collision overwrote in memory.
      // Deleting frees the keys they were squatting on, so they can go back
      // instead of staying stranded — a stranded stash blocks every later
      // save until the user discards.
      restoreDisplaced(providers);
      const models = { ...cfg.models };
      const removedAliases: string[] = [];
      for (const key of Object.keys(models)) {
        if (models[key].provider === name) {
          removedAliases.push(key);
          delete models[key];
        }
      }
      // Everything keyed on the deleted aliases must go with them: the
      // global default model and the subagent pool entries / pool default.
      const default_model =
        cfg.default_model && removedAliases.includes(cfg.default_model)
          ? null
          : cfg.default_model;
      const raw_other = purgeSubagentPoolAliases(cfg.raw_other, removedAliases);
      return { ...cfg, providers, models, default_model, raw_other };
    });
    if (editingProvider === name) {
      setEditingProvider("");
      setView("list");
    }
  };

  const handleSaveUsageConfig = (name: string, usageConfig: UsageConfig) => {
    updateConfig((cfg) => {
      const target = cfg.providers[name];
      if (!target) return cfg;
      return {
        ...cfg,
        providers: {
          ...cfg.providers,
          [name]: { ...target, usageConfig },
        },
      };
    });
    // Same hard blocks as trySave: this save is silent (no loading screen, no
    // completeness confirm), but "silent" must not mean "unchecked" — a
    // collided or blank-named config would otherwise reach disk through the
    // usage panel, which the whole-config save path refuses to do.
    //
    // Returns without throwing on purpose: the panel's test flow awaits this
    // and would report a rejection as a network error.
    const blocked = hardBlockMessage();
    if (blocked) {
      alert(blocked);
      return Promise.resolve();
    }
    // Silent save: a normal save flips App to its loading screen, which
    // unmounts this panel and swallows the in-flight test query's result.
    // Returned so the panel's test can await persistence before querying.
    return save({ silent: true });
  };

  const handleDuplicateProvider = async (name: string) => {
    if (!config) return;
    const src = config.providers[name];
    if (!src) return;
    // Resolved outside the updater so the toast below can name the entry that
    // was actually created (`-copy-2` and up when `-copy` is taken). The
    // closure's config is the same map the updater starts from.
    let newName = `${name}-copy`;
    let n = 2;
    while (config.providers[newName]) {
      newName = `${name}-copy-${n}`;
      n++;
    }
    updateConfig((cfg) => {
      const source = cfg.providers[name];
      if (!source) return cfg;
      // Clone the provider (deactivated, clear its remembered default model
      // since the model aliases will be re-keyed to the new name below).
      const copied = setProviderDefaultModel(
        { ...source, name: newName, active: false },
        null
      );
      const providers = { ...cfg.providers, [newName]: copied };
      // Clone the provider's models under the duplicate's name — COPY
      // semantics: the source keeps its models (a rekey would move them).
      const models = copyModelsOnProviderDuplicate(cfg.models, name, newName);
      return { ...cfg, providers, models };
    });
    // No immediate save: the copy lives in memory only, like every other
    // edit. Abandoning (back → discard) must leave the config unchanged;
    // the copy persists when the user saves (Ctrl+S / footer / switch).
    setSwitchMessage(t("copiedProvider", { name: newName }));
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
      await reloadFromDisk();
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
      await reloadFromDisk();
    } else if (dirty) {
      // Real edits to a previously-saved provider — keep the existing
      // unsaved-changes confirm so the user doesn't lose work by accident.
      if (!confirm(t("unsavedConfirm"))) return;
      await reloadFromDisk();
    }
    setView("list");
  };

  const handleApplyProviderJson = (provider: Provider, models: Model[]) => {
    if (!config) return;
    // Source-level rejection: applying is a single deliberate action, so
    // refusing here leaves both the panel and the config untouched (unlike
    // the name input, which takes every keystroke and stashes the loss).
    if (provider.name.trim() === "") {
      alert(t("validationNameEmpty"));
      return;
    }
    if (provider.name !== editingProvider && Object.hasOwn(config.providers, provider.name)) {
      alert(t("applyJsonNameConflict"));
      return;
    }
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
        while (Object.hasOwn(updatedModels, alias)) {
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
      if (default_model && !Object.hasOwn(updatedModels, default_model)) {
        default_model = null;
      }

      // Pool entries pointing at aliases that disappeared in this apply
      // (provider renamed, models dropped) must not survive as zombies.
      const removedAliases = Object.keys(cfg.models).filter(
        (key) =>
          cfg.models[key].provider === oldName &&
          !Object.hasOwn(updatedModels, key)
      );
      const raw_other = purgeSubagentPoolAliases(cfg.raw_other, removedAliases);

      // Remember this provider's default model preference so it survives
      // provider switches.
      const updatedProvider = providers[provider.name];
      if (updatedProvider && default_model && updatedModels[default_model]?.provider === provider.name) {
        providers[provider.name] = setProviderDefaultModel(updatedProvider, default_model);
      }

      // Applying JSON is another way to move the edited entry off a name it
      // squatted on, so the same restore applies: without it a stash left
      // over from an earlier collision would be stranded, and every later
      // save hard-blocked forever (the panel cannot be left with the stash
      // intact — reloading clears it only via an explicit discard).
      restoreDisplaced(providers);

      return { ...cfg, providers, models: updatedModels, default_model, raw_other };
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
              onClick={() => void reloadFromDisk()}
            >
              {t("retry")}
            </button>
          </div>
        )}
      </div>
    );
  }

  const currentProvider = config.providers[editingProvider];

  // Top-bar navigation guard. Only an *unresolved* collision blocks it: the
  // stash is the one state the user can only fix from the provider edit page
  // (rename away, delete the squatter, or discard), so wandering off to the
  // dashboard leaves a config that refuses every save. Plain unsaved edits
  // deliberately keep navigating — that flow is unchanged.
  const guardedSetView = (next: View, prepare?: () => void) => {
    if (displacedRef.current.size > 0) {
      alert(t("saveBlockedDisplaced"));
      return;
    }
    prepare?.();
    setView(next);
  };

  return (
    <div className="flex flex-col h-full bg-app text-content-primary">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-panel">
        <div className="flex items-center bg-input border border-border rounded p-0.5">
          <button
            type="button"
            onClick={() => guardedSetView("list")}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              view === "list" || view === "edit" || view === "subagent"
                ? "bg-blue-600 text-white"
                : "text-content-muted hover:text-content-primary"
            }`}
          >
            {t("providers")}
          </button>
          <button
            type="button"
            onClick={() => guardedSetView("dashboard")}
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
            onClick={() => guardedSetView("sessions")}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              view === "sessions"
                ? "bg-blue-600 text-white"
                : "text-content-muted hover:text-content-primary"
            }`}
          >
            {t("sessions")}
          </button>
          <button
            type="button"
            onClick={() => guardedSetView("settings", () => setSettingsTab("advanced"))}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              view === "settings" && settingsTab === "advanced"
                ? "bg-blue-600 text-white"
                : "text-content-muted hover:text-content-primary"
            }`}
          >
            {t("subagentSettings")}
          </button>
          {/* 插件市场功能尚未成熟，导航入口暂时隐藏；页面代码保留，
              恢复时把下面的按钮加回即可（view/渲染分支均未移除）。
          <button
            type="button"
            onClick={() => setView("plugins")}
            ...
          </button>
          */}
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
            onClick={() => guardedSetView("settings", () => setSettingsTab("global"))}
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
        ) : view === "plugins" ? (
          <PluginMarketplacePage />
        ) : view === "settings" ? (
          <SettingsPage
            activeTab={settingsTab}
            onTabChange={setSettingsTab}
            updateInfo={updateInfo}
            checking={checking}
            onCheckUpdate={checkNow}
            lastChecked={lastChecked}
            rawOther={config.raw_other}
            models={config.models}
            defaultModel={config.default_model}
            onRawOtherChange={(nextRawOther) =>
              updateConfig((cfg) => ({ ...cfg, raw_other: nextRawOther }))
            }
          />
        ) : view === "subagent" ? (
          <SubagentSettingsPage
            rawOther={config.raw_other}
            models={config.models}
            defaultModel={config.default_model}
            onChange={(nextRawOther) =>
              updateConfig((cfg) => ({ ...cfg, raw_other: nextRawOther }))
            }
            onBack={() => setView("list")}
          />
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
            onConfigureUsage={(name) => setUsageConfigProvider(name)}
            agent={agent}
          />
        ) : currentProvider ? (
          // `nameConflict` is read from the displaced-entry stash during
          // render: the collision write happens inside updateConfig's
          // updater, which fills the stash before React re-renders, so this
          // pass already sees the new value (same precedent as
          // setEditingProvider inside that updater). Only the entry that is
          // currently squatting on a stashed name gets the red border —
          // another slot elsewhere in the table is not this form's problem.
          <ProviderEdit
            agent={agent}
            provider={currentProvider}
            allProviderNames={Object.keys(config.providers).filter(
              (k) => k !== editingProvider
            )}
            nameConflict={displacedRef.current.has(editingProvider)}
            models={Object.values(config.models).filter(
              (m) => m.provider === currentProvider.name
            )}
            defaultModel={config.default_model}
            onBack={handleEditBack}
            onChange={handleUpdateProvider}
            onDelete={() => handleDeleteProvider(currentProvider.name)}
            onModelChange={(model) => {
              updateConfig((cfg) => {
                const models = { ...cfg.models };
                // Auto-fix the placeholder alias from onModelAdd: once the
                // real model id is filled in, rename "<provider>/新模型" (and
                // the mid-typing "<provider>/<prefix>" states) to
                // "<provider>/<model-id>" so the CLI records usage under the
                // real model name instead of the placeholder.
                let effective = model;
                const safeProvider = model.provider.replace(/\//g, "-");
                const prefix = `${safeProvider}/`;
                const modelId = model.model.trim();
                const tail = model.alias.startsWith(prefix)
                  ? model.alias.slice(prefix.length)
                  : "";
                const targetAlias = `${prefix}${modelId}`;
                if (
                  modelId !== "" &&
                  model.alias !== targetAlias &&
                  (tail === "新模型" ||
                    tail.startsWith("新模型-") ||
                    (tail !== "" && modelId.startsWith(tail))) &&
                  !Object.hasOwn(models, targetAlias)
                ) {
                  effective = { ...model, alias: targetAlias };
                  delete models[model.alias];
                }
                const existingKeys = Object.keys(models).filter(
                  (k) => models[k].provider === currentProvider.name
                );
                const oldKey = existingKeys.find((k) =>
                  effective.alias === k ? true : models[k].alias === effective.alias
                );
                if (oldKey && oldKey !== effective.alias) {
                  delete models[oldKey];
                }
                models[effective.alias] = effective;
                let default_model = cfg.default_model;
                if (default_model === oldKey) default_model = effective.alias;
                else if (effective !== model && default_model === model.alias)
                  default_model = effective.alias;
                // Pool entries keyed on the discarded alias (placeholder or
                // replaced old key) must follow the rename or they dangle.
                const poolAliasMap: Record<string, string> = {};
                if (effective !== model) poolAliasMap[model.alias] = effective.alias;
                if (oldKey && oldKey !== effective.alias)
                  poolAliasMap[oldKey] = effective.alias;
                const raw_other = rekeySubagentPoolAliases(cfg.raw_other, poolAliasMap);
                return { ...cfg, models, default_model, raw_other };
              });
            }}
            onModelDelete={(alias) => {
              updateConfig((cfg) => {
                const models = { ...cfg.models };
                delete models[alias];
                // Pool entries keyed on the deleted alias must not survive.
                const raw_other = purgeSubagentPoolAliases(cfg.raw_other, [alias]);
                return {
                  ...cfg,
                  models,
                  raw_other,
                  default_model:
                    cfg.default_model === alias ? null : cfg.default_model,
                };
              });
            }}
            onModelAdd={() => {
              const safeProvider = currentProvider.name.replace(/\//g, "-");
              updateConfig((cfg) => {
                // Deduplicate the placeholder key: a second "add model" click
                // while the previous placeholder is still unedited must not
                // silently overwrite it.
                let alias = `${safeProvider}/新模型`;
                let n = 1;
                while (Object.hasOwn(cfg.models, alias)) {
                  alias = `${safeProvider}/新模型-${++n}`;
                }
                return {
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
                };
              });
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
                  while (Object.hasOwn(updated, alias)) {
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

      {view !== "dashboard" && view !== "sessions" && view !== "plugins" && (
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
              void reloadFromDisk();
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

      <PresetPickerModal
        open={showPresetPicker}
        onClose={() => setShowPresetPicker(false)}
        onSelect={handleSelectPreset}
        onCustom={handleAddCustomProvider}
      />

      {usageConfigProvider && config.providers[usageConfigProvider] && (
        <UsageConfigModal
          open={usageConfigProvider != null}
          agent={agent}
          provider={config.providers[usageConfigProvider]}
          onClose={() => setUsageConfigProvider(null)}
          onSave={handleSaveUsageConfig}
        />
      )}
    </div>
  );
}
