import { useEffect, useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import { getDefaultMaxContextSize } from "../lib/model-defaults";
import { AgentSettingsPanel } from "./AgentSettingsPanel";
import type { Agent, DiscoveredModel, Model, Provider, ProviderType } from "../types";

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

  useEffect(() => {
    const def = defaultBaseUrl(agent, provider.provider_type);
    if (!def) return;
    if (!provider.base_url) {
      onChange({ ...provider, base_url: def });
    }
  }, [provider.provider_type, agent]);

  return (
    <div className="h-full flex flex-col bg-[#0f0f11]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2a2e] bg-[#16161a]">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-[#252529] focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
      <div className="flex items-center gap-1 px-4 border-b border-[#2a2a2e] bg-[#16161a]">
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
                : "border-transparent text-gray-400 hover:text-[#e5e5e7]"
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
            <section className="bg-[#16161a] border border-[#2a2a2e] rounded-xl p-5">
              <h3 className="font-medium mb-4 text-[#e5e5e7]">{t("basicInfo")}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor={nameId} className="block text-sm text-gray-400 mb-1.5">
                    {t("providerName")}
                  </label>
                  <input
                    id={nameId}
                    className="w-full bg-[#1f1f23] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={provider.name}
                    onChange={(e) => onChange({ ...provider, name: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={noteId} className="block text-sm text-gray-400 mb-1.5">
                    {t("note")}
                  </label>
                  <input
                    id={noteId}
                    className="w-full bg-[#1f1f23] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={provider.note || ""}
                    placeholder={t("notePlaceholder")}
                    onChange={(e) =>
                      onChange({ ...provider, note: e.target.value || null })
                    }
                  />
                </div>
                <div className="col-span-1 md:col-span-2">
                  <label htmlFor={officialUrlId} className="block text-sm text-gray-400 mb-1.5">
                    {t("officialUrl")}
                  </label>
                  <input
                    id={officialUrlId}
                    className="w-full bg-[#1f1f23] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
                    className="w-4 h-4 rounded border-[#2a2a2e] bg-[#1f1f23] text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="managed" className="text-sm text-gray-400">
                    {t("managedProvider")}
                  </label>
                </div>
              </div>
            </section>

            {/* API settings */}
            <section className="bg-[#16161a] border border-[#2a2a2e] rounded-xl p-5">
              <h3 className="font-medium mb-4 text-[#e5e5e7]">{t("apiSettings")}</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1.5">
                      {t("apiFormat")}
                    </label>
                    <select
                      className="w-full bg-[#1f1f23] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
                    </select>
                  </div>
                </div>

                {!provider.managed && (
                  <div>
                    <label htmlFor={apiKeyId} className="block text-sm text-gray-400 mb-1.5">
                      {t("apiKey")}
                    </label>
                    <div className="relative">
                      <input
                        id={apiKeyId}
                        type={showApiKey ? "text" : "password"}
                        className="w-full bg-[#1f1f23] border border-[#2a2a2e] rounded-lg px-3 py-2 pr-10 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={provider.api_key || ""}
                        onChange={(e) =>
                          onChange({ ...provider, api_key: e.target.value || null })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs px-1"
                      >
                        {showApiKey ? t("hide") : t("show")}
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor={baseUrlId} className="block text-sm text-gray-400 mb-1.5">
                    {t("requestUrl")}
                  </label>
                  <input
                    id={baseUrlId}
                    className="w-full bg-[#1f1f23] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={provider.base_url || ""}
                    placeholder={defaultBaseUrl(agent, provider.provider_type)}
                    onChange={(e) =>
                      onChange({ ...provider, base_url: e.target.value || null })
                    }
                  />
                  <div className="mt-2 text-xs text-orange-400/80 bg-orange-900/20 border border-orange-500/20 rounded-lg px-3 py-2">
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
    const toAdd: Model[] = [];
    for (const dm of discovered) {
      if (!selected.has(dm.id)) continue;
      const alias = dm.id.replace(/[^a-zA-Z0-9_-]/g, "-");
      const max_context_size = dm.max_context_size ?? getDefaultMaxContextSize(dm.id);
      toAdd.push({
        alias,
        provider: provider.name,
        model: dm.id,
        max_context_size,
        display_name: dm.display_name,
        role: null,
        supports_1m: max_context_size >= 1_000_000,
        capabilities: [],
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
          <h3 className="font-medium text-[#e5e5e7]">{t("modelMapping")}</h3>
          <p className="text-xs text-gray-500 mt-1">{t("modelMappingDesc")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onModelAdd}
            className="px-3 py-1.5 text-sm border border-[#2a2a2e] rounded hover:bg-[#252529] focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
        <div className="bg-[#16161a] border border-[#2a2a2e] rounded-xl p-4 space-y-3">
          <div className="text-sm font-medium">
            {t("discoveredModels", { count: discovered.length })}
          </div>
          <div className="max-h-48 overflow-auto space-y-1">
            {discovered.map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-2 text-sm cursor-pointer hover:bg-[#1f1f23] p-1.5 rounded"
              >
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={() => toggleSelect(m.id)}
                />
                <span className="font-mono text-xs text-gray-300">{m.id}</span>
                {m.display_name && (
                  <span className="text-gray-500">({m.display_name})</span>
                )}
              </label>
            ))}
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

      <div className="bg-[#16161a] border border-[#2a2a2e] rounded-xl overflow-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-[#1f1f23] text-gray-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t("modelRole")}</th>
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
          <tbody className="divide-y divide-[#2a2a2e]">
            {models.map((m) => (
              <tr key={m.alias} className="hover:bg-[#1c1c20]">
                <td className="px-4 py-2">
                  <input
                    className="w-full bg-transparent border border-[#2a2a2e] rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={m.role || ""}
                    placeholder={m.alias}
                    onChange={(e) =>
                      onModelChange({
                        ...m,
                        role: e.target.value || null,
                      })
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    className="w-full bg-transparent border border-[#2a2a2e] rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={m.display_name || ""}
                    onChange={(e) =>
                      onModelChange({
                        ...m,
                        display_name: e.target.value || null,
                      })
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    className="w-full bg-transparent border border-[#2a2a2e] rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
                    className="w-full bg-transparent border border-[#2a2a2e] rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
                    className="w-4 h-4 rounded border-[#2a2a2e] bg-[#1f1f23] text-blue-600 focus:ring-blue-500"
                  />
                </td>
                {agent === "kimi_code" && (
                  <td className="px-4 py-2">
                    <input
                      className="w-full bg-transparent border border-[#2a2a2e] rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      value={(m.capabilities || []).join(", ")}
                      placeholder="thinking, image_in"
                      onChange={(e) =>
                        onModelChange({
                          ...m,
                          capabilities: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
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
                        ? "bg-green-900/30 text-green-400 border-green-500/30"
                        : "border-[#2a2a2e] text-gray-400 hover:bg-[#252529]"
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
          <div className="text-center py-8 text-gray-500 text-sm">
            {t("noModelMappings")}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onModelAdd}
        className="px-4 py-2 border border-[#2a2a2e] rounded-lg hover:bg-[#252529] text-sm"
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
        <h3 className="font-medium text-[#e5e5e7]">{t("configJson")}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{t("readOnlyPreview")}</span>
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
        className="flex-1 min-h-[40vh] bg-[#16161a] border border-[#2a2a2e] rounded-xl p-4 overflow-auto text-xs font-mono text-green-400 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
