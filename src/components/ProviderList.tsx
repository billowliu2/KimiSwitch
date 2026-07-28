import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Pencil, Copy, Activity, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "../i18n";
import { ProviderIcon } from "./ProviderIcon";
import type { Agent, Model, Provider } from "../types";

interface ConnectivityResult {
  ok: boolean;
  latencyMs: number;
  statusCode?: number | null;
  error?: string | null;
}

interface TestState {
  status: "testing" | "ok" | "fail";
  latency?: number;
  error?: string;
}

interface ProviderListProps {
  providers: Provider[];
  defaultModel: string | null;
  models: Record<string, Model>;
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
  onDuplicate: (name: string) => void;
  onAdd: () => void;
  onSwitchProvider: (name: string) => void;
  agent: Agent;
}

const iconBtn =
  "w-8 h-8 flex items-center justify-center rounded border border-border text-content-muted hover:text-content-primary hover:bg-hover-2 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-colors";

export function ProviderList({
  providers,
  defaultModel,
  models,
  onEdit,
  onDelete,
  onDuplicate,
  onAdd,
  onSwitchProvider,
  agent,
}: ProviderListProps) {
  const { t } = useTranslation();
  const [testState, setTestState] = useState<Record<string, TestState>>({});

  const handleTest = async (provider: Provider) => {
    setTestState((s) => ({ ...s, [provider.name]: { status: "testing" } }));
    try {
      const result = await invoke<ConnectivityResult>("test_connectivity", { provider });
      setTestState((s) => ({
        ...s,
        [provider.name]: {
          status: result.ok ? "ok" : "fail",
          latency: result.latencyMs,
          error: result.error ?? undefined,
        },
      }));
    } catch (e) {
      setTestState((s) => ({
        ...s,
        [provider.name]: {
          status: "fail",
          error: e instanceof Error ? e.message : String(e),
        },
      }));
    }
    // auto-clear the inline result after a few seconds
    setTimeout(() => {
      setTestState((s) => {
        const next = { ...s };
        delete next[provider.name];
        return next;
      });
    }, 6000);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="font-medium text-content-primary">{t("providers")}</h2>
        <button
          type="button"
          onClick={onAdd}
          title={t("addProvider")}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-orange-500 hover:bg-orange-600 text-white shadow-lg focus:ring-2 focus:ring-orange-400 focus:outline-none transition-colors"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {providers.length === 0 ? (
          <div className="text-center py-12 text-content-muted">
            <div className="text-4xl mb-3 opacity-30">⊘</div>
            <div>{t("noProviders")}</div>
            <button
              type="button"
              onClick={onAdd}
              className="mt-4 w-12 h-12 rounded-full bg-orange-500 hover:bg-orange-600 text-white shadow-lg flex items-center justify-center mx-auto"
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 w-full">
            {providers.map((provider) => {
              const providerModels = Object.values(models).filter(
                (m) => m.provider === provider.name
              );
              const defaultModelName = defaultModel
                ? models[defaultModel]?.model || models[defaultModel]?.display_name || defaultModel
                : null;
              const isActive = provider.active === true;
              const ts = testState[provider.name];

              return (
                <div
                  key={provider.name}
                  className={`group relative flex items-center gap-4 p-4 rounded-xl border transition-colors cursor-pointer w-full ${
                    isActive
                      ? "bg-green-50 dark:bg-green-900/10 border-green-300 dark:border-green-500/30 hover:border-green-400 dark:border-green-500/50 hover:bg-green-100 dark:bg-green-900/20"
                      : "bg-panel border-border hover:border-strong hover:bg-hover"
                  }`}
                  onClick={() => onEdit(provider.name)}
                >
                  <ProviderIcon
                    name={provider.name}
                    icon={provider.icon}
                    color={provider.icon_color}
                    size={44}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-content-primary truncate">
                        {provider.name}
                      </h3>
                      {isActive && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 border border-green-300 dark:border-green-500/30">
                          {t("inUse")}
                        </span>
                      )}
                      {provider.note && (
                        <span className="text-xs text-content-muted truncate max-w-[200px]">
                          {provider.note}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-sm text-content-muted flex-wrap">
                      <span className="font-mono text-xs">
                        {provider.official_url || provider.base_url || t("noUrl")}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-hover-2 text-content-muted border border-border">
                        {provider.provider_type}
                      </span>
                      <span className="text-xs">
                        {t("modelCount", { count: providerModels.length })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center flex-wrap justify-end gap-2">
                    {defaultModel &&
                      models[defaultModel]?.provider === provider.name && (
                        <span className="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 border border-green-300 dark:border-green-500/20">
                          {t("defaultModel", { name: defaultModelName ?? "" })}
                        </span>
                      )}
                    {/* inline connectivity test result */}
                    {ts && ts.status !== "testing" && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border tabular-nums ${
                          ts.status === "ok"
                            ? ts.latency && ts.latency > 6000
                              ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-500/30"
                              : "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 border-green-300 dark:border-green-500/30"
                            : "bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400 border-red-300 dark:border-red-500/30"
                        }`}
                        title={
                          ts.status === "fail"
                            ? ts.error || t("connectivityFail", { name: provider.name, error: "" })
                            : ts.latency && ts.latency > 6000
                              ? t("connectivitySlow", { name: provider.name, latency: ts.latency ?? 0 })
                              : t("connectivityOk", { name: provider.name, latency: ts.latency ?? 0 })
                        }
                      >
                        {ts.status === "ok" ? `${ts.latency}ms` : "✕"}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSwitchProvider(provider.name);
                      }}
                      className={`px-3 py-1.5 text-sm rounded focus:ring-2 focus:outline-none ${
                        isActive
                          ? "bg-green-600 hover:bg-green-700 text-white focus:ring-green-500"
                          : "bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500"
                      }`}
                    >
                      {isActive ? t("inUse") : t("switchTo")}
                    </button>
                    {agent === "kimi_code" && (
                      <span
                        className="text-sm text-content-muted hover:text-content-primary cursor-help select-none"
                        title={t("switchReloadHint")}
                        aria-label={t("switchReloadHint")}
                      >
                        ⓘ
                      </span>
                    )}

                    {/* icon button group */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(provider.name);
                      }}
                      title={t("edit")}
                      className={iconBtn}
                      aria-label={t("edit")}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicate(provider.name);
                      }}
                      title={t("copyProvider")}
                      className={iconBtn}
                      aria-label={t("copyProvider")}
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTest(provider);
                      }}
                      disabled={ts?.status === "testing"}
                      title={t("testConnectivity")}
                      className={`${iconBtn} disabled:opacity-50`}
                      aria-label={t("testConnectivity")}
                    >
                      {ts?.status === "testing" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Activity className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(provider.name);
                      }}
                      title={t("delete")}
                      className={`${iconBtn} hover:text-red-400 hover:border-red-500/30 hover:bg-red-900/20`}
                      aria-label={t("delete")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
