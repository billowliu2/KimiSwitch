import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Eye, EyeOff, Loader2, Play } from "lucide-react";
import { useTranslation } from "../i18n";
import type { TranslationKey } from "../i18n/zh";
import { localizeUsageError, planLabel } from "../lib/usage-display";
import type { Agent, Provider, UsageConfig } from "../types";

interface UsageResult {
  success: boolean;
  data?: Array<{
    planName?: string | null;
    remaining?: number | null;
    total?: number | null;
    used?: number | null;
    unit?: string | null;
  }> | null;
  error?: string | null;
}

interface UsageConfigModalProps {
  open: boolean;
  agent: Agent;
  provider: Provider;
  onClose: () => void;
  /** Persist the edited config (goes through updateConfig → silent save).
   *  Awaited by the panel's test query so the backend sees the same config. */
  onSave: (providerName: string, config: UsageConfig) => Promise<void> | void;
}

const TEMPLATES: ReadonlyArray<{
  id: "auto" | "newapi";
  labelKey: TranslationKey;
  hintKey: TranslationKey;
}> = [
  { id: "auto", labelKey: "usageTemplateAuto", hintKey: "usageAutoDetectHint" },
  { id: "newapi", labelKey: "usageTemplateNewapi", hintKey: "usageNewapiHint" },
];

function defaultConfig(provider: Provider): UsageConfig {
  return (
    provider.usageConfig ?? {
      enabled: true,
      templateType: "auto",
      baseUrl: provider.base_url ?? undefined,
      autoQueryIntervalMinutes: 0,
    }
  );
}

/** cc-switch FullScreenPanel 行为：焦点在输入框/文本域时 ESC 不关闭面板。 */
function isTextEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable
  );
}

export function UsageConfigModal({ open, agent, provider, onClose, onSave }: UsageConfigModalProps) {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<UsageConfig>(() => defaultConfig(provider));
  const [showToken, setShowToken] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);

  // Re-seed when switching provider or reopening.
  useEffect(() => {
    if (open) {
      setCfg(defaultConfig(provider));
      setTestResult(null);
      setTestOk(null);
      setShowToken(false);
      setShowApiKey(false);
    }
  }, [open, provider.name]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTextEditableTarget(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const isManaged = provider.managed === true;
  const detectedKinds = useMemo(() => provider.usageKinds ?? [], [provider.usageKinds]);

  if (!open) return null;

  const handleSave = () => {
    void onSave(provider.name, {
      ...cfg,
      templateType: isManaged ? "auto" : cfg.templateType,
    });
    onClose();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestOk(null);

    // 短路：自动模板 + 无识别类型 → 不发请求，直接给出本地化提示 + 切换入口。
    // managed 供应商除外：它们走 OAuth 查询，与 detectedKinds 无关。
    if (!isManaged && cfg.templateType === "auto" && detectedKinds.length === 0) {
      setTestOk(false);
      setTestResult(t("usageUnsupportedProvider"));
      setTesting(false);
      return;
    }

    try {
      // Persist first (awaited) so the backend query sees the same config
      // the user is testing.
      await onSave(provider.name, cfg);
      const result = await invoke<UsageResult>("query_provider_usage", {
        agent,
        providerName: provider.name,
        forceRefresh: true,
      });
      if (result.success) {
        setTestOk(true);
        const summary = (result.data ?? [])
          .map((d) => {
            const parts: string[] = [];
            if (d.planName) parts.push(planLabel(d.planName, t));
            if (d.remaining != null) parts.push(`${t("usageRemaining")} ${d.remaining}${d.unit ?? ""}`);
            if (d.used != null && d.total != null && d.total > 0)
              parts.push(`${Math.round((d.used / d.total) * 100)}%`);
            return parts.join(" ");
          })
          .filter(Boolean)
          .join(", ");
        setTestResult(summary || t("usageQueryOk"));
      } else {
        setTestOk(false);
        setTestResult(result.error ? localizeUsageError(result.error, t) : t("usageQueryFailed"));
      }
    } catch {
      setTestOk(false);
      // Transient failure (network/timeout) — same label as the card footer.
      setTestResult(t("usageNetworkError"));
    } finally {
      setTesting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col bg-app text-content-primary">
      {/* header */}
      <div className="h-16 shrink-0 flex items-center gap-4 px-6 border-b border-border">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("usageBack")}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-content-muted hover:text-content-primary hover:bg-hover-2 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-semibold">
          {t("usageConfigTitle", { name: provider.name })}
        </h2>
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
          {/* enable toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-hover/40 px-4 py-3">
            <span className="text-sm text-content-primary">{t("usageEnable")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={cfg.enabled}
              onClick={() => setCfg({ ...cfg, enabled: !cfg.enabled })}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                cfg.enabled ? "bg-blue-600" : "bg-hover-2"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  cfg.enabled ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </div>

          {cfg.enabled && (
            <>
              {/* template picker */}
              <div className="rounded-lg border border-border px-4 py-4 space-y-3">
                <label className="block text-sm font-medium text-content-primary">{t("usageTemplate")}</label>
                {isManaged ? (
                  <div className="text-sm text-content-muted rounded-lg border border-border bg-hover/40 px-4 py-3">
                    {t("usageOAuthManagedHint")}
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 flex-wrap">
                      {TEMPLATES.map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => setCfg({ ...cfg, templateType: tpl.id })}
                          className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                            cfg.templateType === tpl.id
                              ? "bg-blue-600 text-white border-blue-600"
                              : "border-border text-content-primary hover:bg-hover-2"
                          }`}
                        >
                          {t(tpl.labelKey)}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-content-muted">
                      {cfg.templateType === "newapi"
                        ? t("usageNewapiHint")
                        : t("usageAutoDetectHint")}
                    </p>
                  </>
                )}

                {/* supported variables (read-only, cc-switch 风格) */}
                <div className="pt-1 space-y-1.5">
                  <span className="block text-xs text-content-muted">{t("usageSupportedVars")}</span>
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="text-blue-500">{"{{baseUrl}}"}</span>
                    <span className="text-content-muted">=</span>
                    <span className="text-content-primary break-all">
                      {cfg.templateType === "newapi"
                        ? cfg.baseUrl || provider.base_url || "-"
                        : provider.base_url || "-"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="text-blue-500">{"{{apiKey}}"}</span>
                    <span className="text-content-muted">=</span>
                    <span className="text-content-primary break-all">
                      {provider.api_key
                        ? showApiKey
                          ? provider.api_key
                          : "••••••••"
                        : "-"}
                    </span>
                    {provider.api_key && (
                      <button
                        type="button"
                        onClick={() => setShowApiKey((v) => !v)}
                        className="text-content-muted hover:text-content-primary"
                      >
                        {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* auto-detect: show resolved kinds as read-only chips */}
                {!isManaged && cfg.templateType === "auto" && (
                  <div className="space-y-2">
                    <label className="block text-sm text-content-muted">{t("usageDetectedKinds")}</label>
                    {detectedKinds.length === 0 ? (
                      <div className="rounded-lg border border-amber-300/40 bg-amber-50/40 dark:bg-amber-500/10 px-3 py-2.5 space-y-2">
                        <p className="text-xs text-content-primary">{t("usageNoKindsHint")}</p>
                        <button
                          type="button"
                          onClick={() => setCfg({ ...cfg, templateType: "newapi" })}
                          className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                        >
                          {t("usageSwitchToNewapi")}
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2 flex-wrap">
                        {detectedKinds.map((k) => (
                          <span
                            key={k}
                            className="text-xs px-2 py-0.5 rounded-full bg-hover-2 text-content-muted border border-border font-mono"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* newapi creds */}
                {!isManaged && cfg.templateType === "newapi" && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-content-muted mb-1.5">{t("usageBaseUrl")}</label>
                      <input
                        type="text"
                        className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={cfg.baseUrl ?? ""}
                        placeholder={provider.base_url ?? "https://your-newapi-site.com"}
                        onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value || undefined })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-content-muted mb-1.5">
                        {t("usageAccessToken")} <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showToken ? "text" : "password"}
                          className="w-full bg-input border border-border rounded-lg px-3 py-2 pr-10 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          value={cfg.accessToken ?? ""}
                          placeholder={t("usageAccessTokenPlaceholder")}
                          onChange={(e) => setCfg({ ...cfg, accessToken: e.target.value || undefined })}
                        />
                        <button
                          type="button"
                          onClick={() => setShowToken((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-content-muted hover:text-content-primary"
                        >
                          {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-content-muted">{t("usageAccessTokenHint")}</p>
                    </div>
                    <div>
                      <label className="block text-sm text-content-muted mb-1.5">
                        {t("usageUserId")} <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={cfg.userId ?? ""}
                        placeholder={t("usageUserIdPlaceholder")}
                        onChange={(e) => setCfg({ ...cfg, userId: e.target.value || undefined })}
                      />
                      <p className="mt-1 text-xs text-content-muted">{t("usageUserIdHint")}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* timeout + auto query interval */}
              <div className="rounded-lg border border-border px-4 py-4 grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm text-content-muted mb-1.5">{t("usageTimeout")}</label>
                  <input
                    type="number"
                    min={0}
                    className="w-32 bg-input border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={cfg.timeoutSeconds ?? 0}
                    onChange={(e) => {
                      const n = Math.max(0, parseInt(e.target.value, 10) || 0);
                      setCfg({ ...cfg, timeoutSeconds: n });
                    }}
                  />
                  <p className="mt-1 text-xs text-content-muted">{t("usageTimeoutHint")}</p>
                </div>
                <div>
                  <label className="block text-sm text-content-muted mb-1.5">{t("usageAutoInterval")}</label>
                  <input
                    type="number"
                    min={0}
                    className="w-32 bg-input border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={cfg.autoQueryIntervalMinutes ?? 0}
                    onChange={(e) => {
                      const n = Math.max(0, parseInt(e.target.value, 10) || 0);
                      setCfg({ ...cfg, autoQueryIntervalMinutes: n });
                    }}
                  />
                  <p className="mt-1 text-xs text-content-muted">{t("usageAutoIntervalHint")}</p>
                </div>
              </div>
            </>
          )}

          {/* test result - sticky bottom inside scroll container so it's always visible above the footer */}
        </div>
        {testResult && (
          <div className="sticky bottom-0">
            <div className="max-w-3xl mx-auto px-6 pb-6">
              <div
                className={`text-sm rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm ${
                  testOk
                    ? "border-green-300 dark:border-green-500/30 bg-green-50/95 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                    : "border-red-300 dark:border-red-500/30 bg-red-50/95 dark:bg-red-900/30 text-red-600 dark:text-red-300"
                }`}
              >
                {testResult}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* footer */}
      <div className="shrink-0 border-t border-border">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !cfg.enabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-content-primary hover:bg-hover-2 disabled:opacity-50 transition-colors"
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {t("usageTestQuery")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg border border-border text-content-primary hover:bg-hover-2 transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            {t("saveConfig")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
