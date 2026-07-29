import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation, type Language } from "../i18n";
import { useTheme, type Theme } from "../hooks/useTheme";
import type { UpdateInfo } from "../hooks/useUpdateCheck";

function formatVersion(version: string): string {
  const v = version.trim();
  return v.startsWith("v") || v.startsWith("V") ? v : `v${v}`;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  updateInfo: UpdateInfo | null;
  checking: boolean;
  onCheckUpdate: () => void;
  lastChecked: number | null;
}

export function SettingsModal({
  open,
  onClose,
  updateInfo,
  checking,
  onCheckUpdate,
  lastChecked,
}: SettingsModalProps) {
  const { t, lang, setLang } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [appVersion, setAppVersion] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      invoke<string>("get_app_version").then(setAppVersion).catch(() => {});
    }
  }, [open]);

  // Listen to download progress events
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    const setupProgress = async () => {
      const un1 = await listen<{ downloaded: number; total: number; progress: number }>(
        "download-progress",
        (event) => {
          setDownloadProgress(event.payload.progress);
        }
      );
      unlisteners.push(() => un1());

      const un2 = await listen<{ path: string }>(
        "download-complete",
        (event) => {
          setDownloadedPath(event.payload.path);
          setDownloadProgress(100);
        }
      );
      unlisteners.push(() => un2());
    };

    setupProgress();

    return () => unlisteners.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleDownload = async () => {
    if (!updateInfo?.downloadUrl) return;
    setDownloadProgress(0);
    setDownloadError(null);
    setDownloadedPath(null);
    try {
      const path = await invoke<string>("download_update", {
        url: updateInfo.downloadUrl,
      });
      setDownloadedPath(path);
      setDownloadProgress(100);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
      setDownloadProgress(null);
    }
  };

  const handleInstall = () => {
    if (!downloadedPath) return;
    invoke("open_installer", { path: downloadedPath }).catch(() => {});
  };

  if (!open) return null;

  const themeOptions: { value: Theme; icon: ReactNode; label: string }[] = [
    {
      value: "light",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ),
      label: t("themeLight"),
    },
    {
      value: "dark",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ),
      label: t("themeDark"),
    },
    {
      value: "auto",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 21h8M12 16v5" />
        </svg>
      ),
      label: t("themeAuto"),
    },
  ];

  const fmtLastChecked = (ts: number | null) => {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-lg font-semibold text-content-primary">
            {t("settingsTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-content-muted hover:bg-hover hover:text-content-primary transition-colors"
            aria-label={t("close")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5 space-y-5">
          {/* Appearance */}
          <section>
            <h3 className="mb-3 text-[11px] uppercase tracking-wider text-content-muted">
              {t("settingsAppearance")}
            </h3>
            <div className="space-y-3">
              {/* Theme */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-content-muted">
                  {t("themeLight")} / {t("themeDark")}
                </span>
                <div className="flex h-8 items-center gap-1 bg-input rounded border border-border p-0.5">
                  {themeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTheme(opt.value)}
                      title={opt.label}
                      className={`flex h-7 items-center gap-1 px-2 text-sm rounded transition-colors ${
                        theme === opt.value
                          ? "bg-blue-600 text-white"
                          : "text-content-muted hover:text-content-primary"
                      }`}
                    >
                      {opt.icon}
                      <span className="hidden sm:inline">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Language */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-content-muted">{t("language")}</span>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as Language)}
                  className="h-8 bg-input border border-border rounded px-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="zh">{t("zh")}</option>
                  <option value="en">{t("en")}</option>
                </select>
              </div>
            </div>
          </section>

          {/* Updates */}
          <section>
            <h3 className="mb-3 text-[11px] uppercase tracking-wider text-content-muted">
              {t("settingsUpdates")}
            </h3>
            <div className="space-y-2 rounded-lg border border-border bg-input p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-content-muted">{t("currentVersion")}</span>
                <span className="font-medium text-content-primary tabular-nums">
                  v{appVersion || "—"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-content-muted">{t("latestVersion")}</span>
                <span className="font-medium text-content-primary tabular-nums">
                  {updateInfo ? formatVersion(updateInfo.latest) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-content-muted">{t("lastChecked")}</span>
                <span className="text-content-muted tabular-nums">
                  {fmtLastChecked(lastChecked)}
                </span>
              </div>
              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCheckUpdate}
                  disabled={checking}
                  className="px-3 py-1.5 text-sm rounded border border-border hover:bg-hover-2 disabled:opacity-50 transition-colors"
                >
                  {checking ? t("checking") : t("checkUpdate")}
                </button>
                {updateInfo?.updateAvailable && downloadProgress === null && !downloadedPath && (
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="px-3 py-1.5 text-sm rounded bg-green-600 text-white hover:bg-green-500 transition-colors"
                  >
                    {t("downloadUpdate")} ↓
                  </button>
                )}
                {downloadedPath && (
                  <button
                    type="button"
                    onClick={handleInstall}
                    className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                  >
                    {t("install")} ⏎
                  </button>
                )}
              </div>
              {/* Download progress bar */}
              {downloadProgress !== null && downloadProgress < 100 && (
                <div className="pt-1">
                  <div className="flex items-center justify-between text-xs text-content-muted mb-1">
                    <span>{t("downloading")}</span>
                    <span className="tabular-nums">{downloadProgress}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-hover">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-150"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                </div>
              )}
              {downloadedPath && (
                <div className="pt-1 text-sm text-green-600 dark:text-green-500">
                  ✓ {t("downloadComplete")}
                </div>
              )}
              {downloadError && (
                <div className="pt-1 text-sm text-red-500">
                  {t("updateCheckFailed")}: {downloadError}
                </div>
              )}
              {updateInfo?.updateAvailable && (
                <div className="pt-1 text-sm text-green-600 dark:text-green-500">
                  ✦ {t("updateAvailable")}: {formatVersion(updateInfo.latest)}
                </div>
              )}
              {updateInfo && !updateInfo.updateAvailable && (
                <div className="pt-1 text-sm text-content-muted">
                  ✓ {t("upToDate")}
                </div>
              )}
            </div>
          </section>

          {/* About */}
          <section>
            <h3 className="mb-3 text-[11px] uppercase tracking-wider text-content-muted">
              {t("settingsAbout")}
            </h3>
            <div className="space-y-1.5 text-sm text-content-muted">
              <div className="font-medium text-content-primary">Kimi Switch</div>
              <div>{t("appDescription")}</div>
              <div className="text-xs text-content-muted">v{appVersion} · MIT License</div>
              <div className="pt-2">
                <span className="text-content-muted">{t("referenceProject")}: </span>
                <button
                  type="button"
                  onClick={() =>
                    openUrl("https://github.com/JochenYang/kimicode-dashboard")
                  }
                  className="text-blue-500 hover:text-blue-400 underline bg-transparent p-0 border-0 cursor-pointer"
                >
                  kimicode-dashboard
                </button>
                <span className="text-content-muted"> (MIT, © JochenYang)</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}
