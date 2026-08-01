import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";

interface DeviceAuthorization {
  user_code: string;
  device_code: string;
  verification_uri: string | null;
  verification_uri_complete: string | null;
  expires_in: number | null;
  interval: number | null;
}

type PollStatus =
  | { status: "pending"; interval: number }
  | { status: "slow_down"; interval: number }
  | { status: "success" }
  | { status: "expired" }
  | { status: "access_denied" }
  | { status: "timeout" };

interface KimiOAuthDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Kimi device-code sign-in dialog (in-app `kimi login`). */
export function KimiOAuthDialog({ open, onClose }: KimiOAuthDialogProps) {
  const { t } = useTranslation();
  const [auth, setAuth] = useState<DeviceAuthorization | null>(null);
  const [polling, setPolling] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const activeRef = useRef(false);
  const intervalRef = useRef(5);

  // Start a fresh device authorization when the dialog opens.
  useEffect(() => {
    if (!open) return;
    activeRef.current = true;
    setAuth(null);
    setPolling(false);
    setDone(false);
    setError(null);
    setCopied(false);
    intervalRef.current = 5;
    invoke<DeviceAuthorization>("kimi_oauth_start")
      .then((a) => {
        if (!activeRef.current) return;
        setAuth(a);
        if (a.interval && a.interval > 0) intervalRef.current = a.interval;
        setPolling(true);
      })
      .catch((e) => {
        if (!activeRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      activeRef.current = false;
    };
  }, [open]);

  // Poll the token endpoint while the user authorizes in the browser.
  useEffect(() => {
    if (!open || !polling || !auth) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || !activeRef.current) return;
      try {
        const res = await invoke<PollStatus>("kimi_oauth_poll", {
          deviceCode: auth.device_code,
          interval: intervalRef.current,
        });
        if (cancelled) return;
        switch (res.status) {
          case "pending":
          case "slow_down":
            if (res.interval > 0) intervalRef.current = res.interval;
            break;
          case "success":
            setPolling(false);
            setDone(true);
            setTimeout(() => {
              if (activeRef.current) onClose();
            }, 1600);
            return;
          case "expired":
          case "access_denied":
          case "timeout":
            setPolling(false);
            setError(
              res.status === "expired"
                ? t("kimiOAuthExpired")
                : res.status === "access_denied"
                  ? t("kimiOAuthDenied")
                  : t("kimiOAuthTimeout")
            );
            return;
        }
      } catch {
        if (!cancelled) setError(t("kimiOAuthNetworkError"));
      }
      // Schedule the next poll (also on network errors — keep retrying).
      setTimeout(() => {
        if (!cancelled && activeRef.current && polling) void tick();
      }, intervalRef.current * 1000);
    };

    void tick();
    return () => {
      cancelled = true;
    };
    // `polling` and `auth` gate the loop; restart polling explicitly via
    // startPolling when retrying.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, polling, auth]);

  const restart = () => {
    setAuth(null);
    setPolling(false);
    setDone(false);
    setError(null);
    intervalRef.current = 5;
    invoke<DeviceAuthorization>("kimi_oauth_start")
      .then((a) => {
        if (!activeRef.current) return;
        setAuth(a);
        if (a.interval && a.interval > 0) intervalRef.current = a.interval;
        setPolling(true);
      })
      .catch((e) => {
        if (!activeRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  const copyCode = () => {
    if (!auth) return;
    navigator.clipboard.writeText(auth.user_code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Open the authorization page via the Rust-side opener command (bypasses the
  // JS plugin scope, same reliable path the provider website links use);
  // fall back to a new tab when even that fails.
  const openAuthPage = () => {
    if (!auth) return;
    const url = auth.verification_uri_complete || auth.verification_uri;
    if (!url) return;
    invoke("open_external_url", { url }).catch(() => {
      const w = window.open(url, "_blank");
      if (!w) console.error(`failed to open ${url}`);
    });
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-medium text-content-primary">{t("kimiOAuthLogin")}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-content-muted hover:text-content-primary text-lg leading-none"
            aria-label={t("kimiOAuthCancel")}
          >
            ×
          </button>
        </div>

        <div className="space-y-4 p-5">
          {done && (
            <div className="rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-sm px-3 py-2">
              ✓ {t("kimiOAuthSuccess")}
            </div>
          )}

          {error && !done && (
            <div className="rounded-lg bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400 text-sm px-3 py-2">
              {error}
            </div>
          )}

          {auth && !done && (
            <>
              {/* user code + copy */}
              <div className="flex items-center justify-center gap-3">
                <code className="text-2xl font-bold tracking-widest tabular-nums text-content-primary select-all">
                  {auth.user_code}
                </code>
                <button
                  type="button"
                  onClick={copyCode}
                  className="px-2.5 py-1 text-xs rounded border border-border hover:bg-hover-2 text-content-muted transition-colors"
                >
                  {copied ? t("kimiOAuthCodeCopied") : t("kimiOAuthCopyCode")}
                </button>
              </div>

              <button
                type="button"
                onClick={openAuthPage}
                className="w-full px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
              >
                {t("kimiOAuthOpenPage")}
              </button>

              <p className="text-sm text-content-muted text-center">
                {t("kimiOAuthWaiting")}
              </p>
            </>
          )}

          {!auth && !done && (
            <div className="h-3.5 w-2/3 rounded bg-hover-2 animate-pulse mx-auto" />
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {error && !done && (
              <button
                type="button"
                onClick={restart}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-hover-2 transition-colors"
              >
                {t("kimiOAuthRetry")}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={polling}
              className="px-3 py-1.5 text-sm rounded bg-gray-600 text-white hover:bg-gray-500 transition-colors disabled:opacity-50"
            >
              {t("kimiOAuthCancel")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
