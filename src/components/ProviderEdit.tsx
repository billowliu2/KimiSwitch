import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { TranslationKey } from "../i18n/zh";
import { findPresetForProvider } from "../config/providerPresets";
import { getDefaultMaxContextSize } from "../lib/model-defaults";
import { capabilitiesFromRef, getModelRef } from "../lib/models-dev";
import { getIconMetadata } from "../icons/extracted/metadata";
import { AgentSettingsPanel } from "./AgentSettingsPanel";
import { KimiOAuthDialog } from "./KimiOAuthDialog";
import { ProviderIcon } from "./ProviderIcon";
import { IconPicker } from "./IconPicker";
import type { Agent, DiscoveredModel, Model, Provider, ProviderType } from "../types";

const KNOWN_CAPABILITIES = [
  "thinking",
  "always_thinking",
  "image_in",
  "video_in",
  "tool_use",
] as const;

const CAPABILITY_LABELS: Record<
  (typeof KNOWN_CAPABILITIES)[number],
  TranslationKey
> = {
  thinking: "capThinking",
  always_thinking: "capAlwaysThinking",
  image_in: "capImageIn",
  video_in: "capVideoIn",
  tool_use: "capToolUse",
};

const PROVIDER_TYPES: ProviderType[] = [
  "openai",
  "openai_responses",
  "anthropic",
  "google-genai",
  "vertexai",
  "kimi",
];

function defaultBaseUrl(agent: Agent, type: ProviderType): string {
  if (agent === "kimi_code") {
    switch (type) {
      case "kimi":
        return "https://api.kimi.com/coding/v1";
      case "openai":
      case "openai_responses":
        return "https://api.openai.com/v1";
      case "google-genai":
        return "https://generativelanguage.googleapis.com";
      case "anthropic":
      case "vertexai":
        return "";
      default:
        return "";
    }
  }
  // Pi defaults
  switch (type) {
    case "kimi":
      return "https://api.moonshot.ai/v1";
    case "openai":
    case "openai_responses":
      return "https://api.openai.com/v1";
    case "google-genai":
      return "https://generativelanguage.googleapis.com";
    case "anthropic":
    case "vertexai":
      return "";
    default:
      return "";
  }
}

interface ProviderEditProps {
  agent: Agent;
  provider: Provider;
  models: Model[];
  defaultModel: string | null;
  rawOther: unknown;
  onRawOtherChange: (nextRawOther: unknown) => void;
  onBack: () => void;
  onChange: (provider: Provider) => void;
  onDelete: () => void;
  onModelChange: (model: Model) => void;
  onModelDelete: (alias: string) => void;
  onModelAdd: () => void;
  onBulkAdd: (models: Model[]) => void;
  onSetDefault: (alias: string) => void;
  onApplyJson: (provider: Provider, models: Model[]) => void;
  onSave: () => void;
}

export function ProviderEdit({
  agent,
  provider,
  models,
  defaultModel,
  rawOther,
  onRawOtherChange,
  onBack,
  onChange,
  onDelete,
  onModelChange,
  onModelDelete,
  onModelAdd,
  onBulkAdd,
  onSetDefault,
  onApplyJson,
  onSave,
}: ProviderEditProps) {
  const { t } = useTranslation();
  const nameId = useId();
  const noteId = useId();
  const officialUrlId = useId();
  const apiKeyId = useId();
  const baseUrlId = useId();

  const [activeTab, setActiveTab] = useState<"basic" | "models" | "json">("basic");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [kimiOAuthOpen, setKimiOAuthOpen] = useState(false);

  // Preset this provider was created from (if any) — provides the
  // "Get API Key" / referral links shown under the key input.
  const preset = findPresetForProvider(provider);

  useEffect(() => {
    const def = defaultBaseUrl(agent, provider.provider_type);
    if (!def) return;
    if (!provider.base_url) {
      onChange({ ...provider, base_url: def });
    }
  }, [provider.provider_type, agent]);

  return (
    <div className="h-full flex flex-col bg-app">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-panel">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-hover-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        >
          ← {t("back")}
        </button>
        <h2 className="font-semibold text-lg">{t("editProvider")}</h2>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onSave}
          className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded focus:ring-2 focus:ring-green-500 focus:outline-none"
        >
          {t("saveConfig")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="px-3 py-1.5 text-sm border border-red-500/30 rounded hover:bg-red-900/30 text-red-400 focus:ring-2 focus:ring-red-500 focus:outline-none"
        >
          {t("delete")}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 border-b border-border bg-panel">
        {[
          { key: "basic", label: t("basicInfo") },
          { key: "models", label: t("modelMapping") },
          { key: "json", label: t("configJson") },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none ${
              activeTab === tab.key
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-content-muted hover:text-content-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === "basic" && (
          <div className="space-y-6">
            {/* Basic info */}
            <section className="bg-panel border border-border rounded-xl p-5">
              <h3 className="font-medium mb-4 text-content-primary">{t("basicInfo")}</h3>

              {/* Icon selector */}
              <div className="flex flex-col items-center gap-2 mb-5">
                <button
                  type="button"
                  onClick={() => setShowIconPicker(true)}
                  className="w-20 h-20 p-3 rounded-xl border-2 border-border hover:border-blue-500 transition-colors cursor-pointer flex items-center justify-center focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  title={provider.icon ? t("clickToChangeIcon") : t("clickToSelectIcon")}
                >
                  <ProviderIcon
                    name={provider.name}
                    icon={provider.icon}
                    color={provider.icon_color}
                    size={48}
                  />
                </button>
                {provider.icon && (
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ ...provider, icon: null, icon_color: null })
                    }
                    className="text-xs text-content-muted hover:text-content-primary underline"
                  >
                    {t("clearIcon")}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor={nameId} className="block text-sm text-content-muted mb-1.5">
                    {t("providerName")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id={nameId}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={provider.name}
                    onChange={(e) => onChange({ ...provider, name: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={noteId} className="block text-sm text-content-muted mb-1.5">
                    {t("note")}
                  </label>
                  <input
                    id={noteId}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={provider.note || ""}
                    placeholder={t("notePlaceholder")}
                    onChange={(e) =>
                      onChange({ ...provider, note: e.target.value || null })
                    }
                  />
                </div>
                <div className="col-span-1 md:col-span-2">
                  <label htmlFor={officialUrlId} className="block text-sm text-content-muted mb-1.5">
                    {t("officialUrl")}
                  </label>
                  <input
                    id={officialUrlId}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={provider.official_url || ""}
                    onChange={(e) =>
                      onChange({ ...provider, official_url: e.target.value || null })
                    }
                  />
                </div>
                <div className="col-span-1 md:col-span-2 flex items-center gap-2">
                  <input
                    id="managed"
                    type="checkbox"
                    checked={provider.managed || false}
                    onChange={(e) =>
                      onChange({ ...provider, managed: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-border bg-input text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="managed" className="text-sm text-content-muted">
                    {t("managedProvider")}
                  </label>
                </div>
                {provider.managed && (
                  <div className="col-span-1 md:col-span-2">
                    <button
                      type="button"
                      onClick={() => setKimiOAuthOpen(true)}
                      className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                    >
                      {t("kimiOAuthLogin")}
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* API settings */}
            <section className="bg-panel border border-border rounded-xl p-5">
              <h3 className="font-medium mb-4 text-content-primary">{t("apiSettings")}</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-content-muted mb-1.5">
                      {t("apiFormat")}
                    </label>
                    <select
                      className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={provider.provider_type}
                      onChange={(e) =>
                        onChange({ ...provider, provider_type: e.target.value as ProviderType })
                      }
                    >
                      {PROVIDER_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                      {!PROVIDER_TYPES.includes(provider.provider_type) && (
                        <option value={provider.provider_type}>
                          {t("apiFormatUnknown", { type: provider.provider_type })}
                        </option>
                      )}
                    </select>
                  </div>
                </div>

                {!provider.managed && (
                  <div>
                    <label htmlFor={apiKeyId} className="block text-sm text-content-muted mb-1.5">
                      {t("apiKey")} <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        id={apiKeyId}
                        type={showApiKey ? "text" : "password"}
                        className="w-full bg-input border border-border rounded-lg px-3 py-2 pr-10 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={provider.api_key || ""}
                        onChange={(e) =>
                          onChange({ ...provider, api_key: e.target.value || null })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-content-muted hover:text-content-primary text-xs px-1"
                      >
                        {showApiKey ? t("hide") : t("show")}
                      </button>
                    </div>
                    {(() => {
                      const linkUrl = preset?.apiKeyUrl ?? provider.official_url ?? null;
                      if (!linkUrl) return null;
                      return (
                        <div className="mt-1.5 flex items-center gap-4 text-xs">
                          <button
                            type="button"
                            onClick={() =>
                              invoke("open_external_url", { url: linkUrl }).catch(() => {})
                            }
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {preset?.apiKeyUrl ? t("getApiKeyLink") : t("officialUrl")}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div>
                  <label htmlFor={baseUrlId} className="block text-sm text-content-muted mb-1.5">
                    {t("requestUrl")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id={baseUrlId}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={provider.base_url || ""}
                    placeholder={defaultBaseUrl(agent, provider.provider_type)}
                    onChange={(e) =>
                      onChange({ ...provider, base_url: e.target.value || null })
                    }
                  />
                  <div className="mt-2 text-xs text-orange-600/80 dark:text-orange-600 dark:text-orange-400/80 bg-orange-100 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-500/20 rounded-lg px-3 py-2">
                    {t("baseUrlHint", { type: provider.provider_type })}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === "models" && (
          <>
            <ModelMapping
              agent={agent}
              provider={provider}
              models={models}
              defaultModel={defaultModel}
              onModelChange={onModelChange}
              onModelDelete={onModelDelete}
              onModelAdd={onModelAdd}
              onBulkAdd={onBulkAdd}
              onSetDefault={onSetDefault}
            />
            {agent === "kimi_code" && (
              <AgentSettingsPanel
                rawOther={rawOther}
                onChange={onRawOtherChange}
              />
            )}
          </>
        )}

        {activeTab === "json" && (
          <JsonPreview
            provider={provider}
            models={models}
            onApply={onApplyJson}
          />
        )}
      </div>

      {showIconPicker &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setShowIconPicker(false)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="w-full max-w-4xl rounded-xl border border-border bg-panel shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                <h2 className="text-lg font-semibold text-content-primary">
                  {t("selectIcon")}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowIconPicker(false)}
                  className="rounded-md p-1 text-content-muted hover:bg-hover hover:text-content-primary transition-colors"
                  aria-label={t("close")}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-5">
                <IconPicker
                  value={provider.icon}
                  onValueChange={(iconName) => {
                    const meta = getIconMetadata(iconName);
                    onChange({
                      ...provider,
                      icon: iconName,
                      icon_color: meta?.defaultColor ?? null,
                    });
                    setShowIconPicker(false);
                  }}
                />
              </div>
            </div>
          </div>,
          document.body
        )}

      <KimiOAuthDialog
        open={kimiOAuthOpen}
        onClose={() => setKimiOAuthOpen(false)}
      />
    </div>
  );
}

function ModelMapping({
  agent,
  provider,
  models,
  defaultModel,
  onModelChange,
  onModelDelete,
  onModelAdd,
  onBulkAdd,
  onSetDefault,
}: {
  agent: Agent;
  provider: Provider;
  models: Model[];
  defaultModel: string | null;
  onModelChange: (model: Model) => void;
  onModelDelete: (alias: string) => void;
  onModelAdd: () => void;
  onBulkAdd: (models: Model[]) => void;
  onSetDefault: (alias: string) => void;
}) {
  const { t } = useTranslation();
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredModel[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [fetchThinking, setFetchThinking] = useState(true);

  const handleDiscover = async () => {
    setDiscovering(true);
    setDiscoverError(null);
    setDiscovered(null);
    setSelected(new Set());
    try {
      const result = await invoke<DiscoveredModel[]>("list_provider_models", {
        provider,
      });
      setDiscovered(result);
      // Auto-select models that already exist in the current provider's list
      const existingIds = new Set(models.filter((m) => m.model).map((m) => m.model));
      setSelected(new Set(result.filter((dm) => existingIds.has(dm.id)).map((dm) => dm.id)));
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscovering(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddSelected = () => {
    if (!discovered || selected.size === 0) return;
    const existingIds = new Set(models.filter((m) => m.model).map((m) => m.model));
    const toAdd: Model[] = [];
    for (const dm of discovered) {
      if (!selected.has(dm.id)) continue;
      if (existingIds.has(dm.id)) continue; // skip models already in this provider
      const safeProvider = provider.name.replace(/\//g, "-");
      const safeModelId = dm.id.replace(/\//g, "-");
      const alias = `${safeProvider}/${safeModelId}`;
      const ref = getModelRef(dm.id);
      // Priority: API-provided value > models.dev reference > regex fallback
      const max_context_size =
        dm.max_context_size ?? ref?.context ?? getDefaultMaxContextSize(dm.id);
      toAdd.push({
        alias,
        provider: provider.name,
        model: dm.id,
        max_context_size,
        display_name: dm.display_name ?? ref?.name ?? null,
        supports_1m: max_context_size >= 1_000_000,
        // Reference data wins when available; otherwise keep the old
        // fetchThinking-checkbox behavior as the fallback.
        capabilities: ref
          ? capabilitiesFromRef(ref)
          : fetchThinking
            ? ["thinking"]
            : [],
      });
    }
    onBulkAdd(toAdd);
    setDiscovered(null);
    setSelected(new Set());
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-content-primary">{t("modelMapping")}</h3>
          <p className="text-xs text-content-muted mt-1">{t("modelMappingDesc")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onModelAdd}
            className="px-3 py-1.5 text-sm border border-border rounded hover:bg-hover-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {t("oneClickSetup")}
          </button>
          <button
            type="button"
            onClick={handleDiscover}
            disabled={discovering || provider.managed}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {discovering ? t("fetchingModels") : t("fetchModels")}
          </button>
        </div>
      </div>

      {discoverError && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-500/20 p-3 rounded-lg">
          {discoverError}
        </div>
      )}

      {discovered && (
        <div className="bg-panel border border-border rounded-xl p-4 space-y-3">
          <div className="text-sm font-medium">
            {t("discoveredModels", { count: discovered.length })}
          </div>
          <label className="flex items-center gap-2 text-sm text-content-primary cursor-pointer">
            <input
              type="checkbox"
              checked={fetchThinking}
              onChange={(e) => setFetchThinking(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-input text-blue-600 focus:ring-blue-500"
            />
            {t("fetchEnableThinking")}
          </label>
          <div className="max-h-48 overflow-auto space-y-1">
            {discovered.map((m) => {
              const exists = models.some((mm) => mm.model === m.id);
              return (
              <label
                key={m.id}
                className="flex items-center gap-2 text-sm cursor-pointer hover:bg-input p-1.5 rounded"
              >
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={() => toggleSelect(m.id)}
                />
                <span className="font-mono text-xs text-content-primary">{m.id}</span>
                {m.display_name && (
                  <span className="text-content-muted">({m.display_name})</span>
                )}
                {exists && (
                  <span className="ml-auto text-[10px] text-emerald-500 shrink-0">{t("alreadyAdded")}</span>
                )}
              </label>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleAddSelected}
            disabled={selected.size === 0}
            className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded"
          >
            {t("addSelected")} {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>
      )}

      <div className="bg-panel border border-border rounded-xl overflow-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-input text-content-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t("displayName")}</th>
              <th className="text-left px-4 py-3 font-medium">{t("actualModel")}</th>
              <th className="text-left px-4 py-3 font-medium w-28">{t("contextSize")}</th>
              <th className="text-center px-4 py-3 font-medium w-28">{t("supports1M")}</th>
              {agent === "kimi_code" && (
                <th className="text-left px-4 py-3 font-medium">{t("capabilities")}</th>
              )}
              <th className="text-center px-4 py-3 font-medium w-32">{t("default")}</th>
              <th className="text-center px-4 py-3 font-medium w-20">{t("operation")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {models.map((m) => (
              <tr key={m.alias} className="hover:bg-hover">
                <td className="px-4 py-2">
                  <span className="text-sm text-content-muted">
                    {m.model ? `${m.model}[${m.provider}]` : m.alias}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <input
                    className="w-full bg-transparent border border-border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={m.model}
                    onChange={(e) =>
                      onModelChange({ ...m, model: e.target.value })
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    step={1024}
                    className="w-full bg-transparent border border-border rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={m.max_context_size}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10);
                      onModelChange({
                        ...m,
                        max_context_size: isNaN(value) ? 0 : value,
                      });
                    }}
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={m.supports_1m || false}
                    onChange={(e) =>
                      onModelChange({
                        ...m,
                        supports_1m: e.target.checked,
                      })
                    }
                    className="w-4 h-4 rounded border-border bg-input text-blue-600 focus:ring-blue-500"
                  />
                </td>
                {agent === "kimi_code" && (
                  <td className="px-4 py-2">
                    <CapabilitiesCell
                      capabilities={m.capabilities || []}
                      nativeImage={getModelRef(m.model)?.image === true}
                      onChange={(next) =>
                        onModelChange({ ...m, capabilities: next })
                      }
                    />
                  </td>
                )}
                <td className="px-4 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => onSetDefault(m.alias)}
                    className={`text-xs px-2 py-1 rounded border ${
                      defaultModel === m.alias
                        ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 border-green-300 dark:border-green-500/30"
                        : "border-border text-content-muted hover:bg-hover-2"
                    }`}
                  >
                    {defaultModel === m.alias ? t("isDefault") : t("setDefault")}
                  </button>
                </td>
                <td className="px-4 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(t("deleteModelConfirm", { alias: m.alias }))) {
                        onModelDelete(m.alias);
                      }
                    }}
                    className="text-red-400 hover:text-red-300 text-sm"
                  >
                    {t("delete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {models.length === 0 && (
          <div className="text-center py-8 text-content-muted text-sm">
            {t("noModelMappings")}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onModelAdd}
        className="px-4 py-2 border border-border rounded-lg hover:bg-hover-2 text-sm"
      >
        {t("addModelMapping")}
      </button>
    </div>
  );
}

function JsonPreview({
  provider,
  models,
  onApply,
}: {
  provider: Provider;
  models: Model[];
  onApply: (provider: Provider, models: Model[]) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(() =>
    JSON.stringify({ provider, models }, null, 2)
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(JSON.stringify({ provider, models }, null, 2));
    setError(null);
  }, [provider, models]);

  const handleApply = () => {
    try {
      const parsed = JSON.parse(text);
      if (!parsed.provider || typeof parsed.provider !== "object") {
        throw new Error("missing provider object");
      }
      if (!Array.isArray(parsed.models)) {
        throw new Error("models must be an array");
      }
      onApply(parsed.provider as Provider, parsed.models as Model[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-content-primary">{t("configJson")}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-content-muted">{t("readOnlyPreview")}</span>
          <button
            type="button"
            onClick={handleApply}
            className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {t("apply")}
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-2 text-red-400 text-sm bg-red-900/20 border border-red-500/20 p-2 rounded">
          {t("invalidJson", { message: error })}
        </div>
      )}
      <textarea
        className="flex-1 min-h-[40vh] bg-panel border border-border rounded-xl p-4 overflow-auto text-xs font-mono text-green-600 dark:text-green-400 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}

function CapabilitiesCell({
  capabilities,
  onChange,
  nativeImage,
}: {
  capabilities: string[];
  onChange: (next: string[]) => void;
  /** 模型本身是否原生支持图像输入（models.dev `image` 能力）。原生多模态
   *  模型无需 kimi-eyes 插件，提示不展示。 */
  nativeImage?: boolean;
}) {
  const { t } = useTranslation();

  const toggle = (cap: string, on: boolean) => {
    if (on) {
      onChange([...capabilities.filter((c) => c !== cap), cap]);
    } else {
      onChange(capabilities.filter((c) => c !== cap));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {/* `thinking` 与 `image_in`（识图）可手动编辑；其余能力
          (always_thinking / video_in / tool_use) 仍由 models.dev 自动派生，
          保存时照常写入 config.toml。 */}
      {KNOWN_CAPABILITIES.filter(
        (cap) => cap === "thinking" || cap === "image_in",
      ).map((cap) => (
        <label
          key={cap}
          className="flex items-center gap-1 text-xs text-content-muted cursor-pointer"
        >
          <input
            type="checkbox"
            checked={capabilities.includes(cap)}
            onChange={(e) => toggle(cap, e.target.checked)}
            className="w-3.5 h-3.5 rounded border-border bg-input text-blue-600 focus:ring-blue-500"
          />
          {t(CAPABILITY_LABELS[cap])}
        </label>
      ))}
      {capabilities.includes("image_in") && !nativeImage && (
        <span className="w-full text-[11px] text-content-muted">
          {t("capImageInHint")}
        </span>
      )}
    </div>
  );
}
