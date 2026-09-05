import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "../i18n";
import { formatAmount, localizeUsageError, planLabel } from "../lib/usage-display";
import type { UsageData, UsageQueryState } from "../hooks/useUsageQuery";

interface UsageFooterProps {
  /** Query state lifted to the provider card via useUsageQuery. Both the
   * compact (card header) and detail (footer) variants read the same state,
   * so a refresh from either updates both. */
  usage: UsageQueryState;
  /** "detail" (default) renders the multi-line footer; "compact" renders a
   * one-line summary + last-updated + refresh button for the card header. */
  variant?: "detail" | "compact";
}

export function UsageFooter({ usage, variant = "detail" }: UsageFooterProps) {
  const { t } = useTranslation();
  const { status, data, error, updatedAt, supported, refresh } = usage;
  const [now, setNow] = useState(() => Date.now());

  // Tick relative times once a minute while showing data.
  useEffect(() => {
    if (status !== "success") return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [status]);

  if (!supported || status === "idle") return null;

  const percentOf = (d: UsageData): number | null => {
    if (d.used != null && d.total != null && d.total > 0)
      return (d.used / d.total) * 100;
    if (d.remaining != null && d.total != null && d.total > 0)
      return (1 - d.remaining / d.total) * 100;
    return null;
  };

  const formatReset = (resetsAt?: string | null): string | null => {
    if (!resetsAt) return null;
    const ms = new Date(resetsAt).getTime() - now;
    if (Number.isNaN(ms)) return null;
    if (ms <= 0) return t("usageResetDone");
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return t("usageResetIn", { time: `${Math.max(mins, 1)}m` });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("usageResetIn", { time: `${hours}h` });
    return t("usageResetIn", { time: `${Math.floor(hours / 24)}d` });
  };

  const formatAgo = (ts: number | null): string | null => {
    if (ts == null) return null;
    const mins = Math.floor((now - ts) / 60_000);
    if (mins < 1) return t("usageUpdatedAgo", { time: "1m" });
    if (mins < 60) return t("usageMinAgo", { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("usageHourAgo", { n: hours });
    return t("usageDayAgo", { n: Math.floor(hours / 24) });
  };

  const refreshBtn = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void refresh(true);
      }}
      disabled={status === "loading"}
      title={t("usageRefresh")}
      aria-label={t("usageRefresh")}
      className="w-6 h-6 flex items-center justify-center rounded text-content-muted hover:text-content-primary hover:bg-hover-2 disabled:opacity-50 transition-colors"
    >
      {status === "loading" ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <RefreshCw className="w-3.5 h-3.5" />
      )}
    </button>
  );

  /** One-line summary of the primary entry (first tier / balance). */
  const compactSummary = (): { icon: string; text: string; color: string } | null => {
    const d = data[0];
    if (!d) return null;
    // A "plan" is a quota tier (used/total, e.g. 5h / weekly limit). Balance
    // entries carry only remaining + unit — their plan_name is a currency /
    // brand label and must render as an amount, not a percentage.
    const isPlan =
      !!d.planName &&
      d.planName !== "NewAPI" &&
      (d.total != null || d.used != null);
    if (d.isValid === false) {
      return { icon: "⚡", text: t("usageInvalidKey"), color: "text-red-500 dark:text-red-400" };
    }
    if (d.planName === "NewAPI" && d.remaining == null && d.total == null) {
      return { icon: "💰", text: `${t("usageBalance")} ∞`, color: "text-green-600 dark:text-green-400" };
    }
    if (isPlan) {
      const pct = percentOf(d);
      const color =
        pct == null
          ? "text-content-muted"
          : pct < 70
            ? "text-green-600 dark:text-green-400"
            : pct < 90
              ? "text-orange-600 dark:text-orange-400"
              : "text-red-500 dark:text-red-400";
      const label = data.length > 1 && d.planName ? `${planLabel(d.planName, t)} ` : "";
      return {
        icon: "⚡",
        text: pct != null ? `${label}${Math.round(pct)}%` : `${label}—`,
        color,
      };
    }
    return {
      icon: "💰",
      text: formatAmount(d.remaining, d.unit),
      color: "text-content-primary",
    };
  };

  if (variant === "compact") {
    if (status === "loading" && data.length === 0) {
      return <div className="h-3.5 w-20 rounded bg-hover-2 animate-pulse" />;
    }
    if (status === "error" && data.length === 0) {
      return (
        <span className="flex items-center gap-1 text-xs text-red-500 dark:text-red-400">
          <span className="truncate max-w-[120px]" title={error ?? t("usageNetworkError")}>
            {error == null ? t("usageNetworkError") : localizeUsageError(error, t)}
          </span>
          {refreshBtn}
        </span>
      );
    }
    const s = compactSummary();
    const ghost = status !== "success";
    const ago = formatAgo(updatedAt);
    return (
      <span className={`flex items-center gap-1.5 text-xs tabular-nums ${ghost ? "opacity-50" : ""}`}>
        {s && (
          <>
            <span aria-hidden="true">{s.icon}</span>
            <span className={`font-medium ${s.color}`}>{s.text}</span>
          </>
        )}
        {ago && <span className="text-content-muted">{ago}</span>}
        {refreshBtn}
      </span>
    );
  }

  // ── detail variant ──
  // Loading with no prior data: skeleton bar.
  if (status === "loading" && data.length === 0) {
    return (
      <div
        className="w-full border-t border-border pt-2 mt-1"
        aria-label={t("usageLoading")}
      >
        <div className="h-3.5 w-2/3 rounded bg-hover-2 animate-pulse" />
      </div>
    );
  }

  if (status === "error" && data.length === 0) {
    const text =
      error == null
        ? t("usageNetworkError")
        : /401|api[ -]?key|invalid key/i.test(error)
          ? t("usageInvalidKey")
          : error
            ? `${t("usageQueryFailed")} · ${localizeUsageError(error, t)}`
            : t("usageQueryFailed");
    return (
      <div className="w-full border-t border-border pt-2 mt-1 flex items-center gap-2 text-xs">
        <span className="text-red-500 dark:text-red-400 truncate" title={text}>
          {text}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void refresh(true);
          }}
          className="ml-auto shrink-0 px-2 py-0.5 rounded border border-red-300 dark:border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          {t("usageRetry")}
        </button>
      </div>
    );
  }

  // success, or error/loading with last-good data (ghost).
  // Compact header already shows the primary entry; detail only adds value
  // when there are multiple tiers (e.g. 5h + weekly) or on error ghost.
  // NOTE: single-tier plans (e.g. only five_hour) must still render — hiding
  // them made kimi-for-coding look like it had no plan quota at all.
  if (data.length === 0 && status === "success") return null;
  const ghost = status !== "success";
  return (
    <div
      className={`w-full border-t border-border pt-2 mt-1 flex flex-col gap-1 text-xs ${
        ghost ? "opacity-50" : ""
      }`}
    >
      {data.map((d, i) => {
        // Same plan-vs-balance rule as compactSummary: balance rows have no
        // quota fields (total/used), so they render as an amount.
        const isPlan =
          !!d.planName &&
          d.planName !== "NewAPI" &&
          (d.total != null || d.used != null);
        const pct = isPlan ? percentOf(d) : null;
        const color =
          pct == null
            ? "text-content-muted"
            : pct < 70
              ? "text-green-600 dark:text-green-400"
              : pct < 90
                ? "text-orange-600 dark:text-orange-400"
                : "text-red-500 dark:text-red-400";
        const resetText = isPlan ? formatReset(d.resetsAt) : null;

        let main: string;
        if (d.isValid === false) {
          main = t("usageInvalidKey");
        } else if (isPlan) {
          const label = data.length > 1 && d.planName ? `${planLabel(d.planName, t)} · ` : "";
          main =
            pct != null
              ? `${label}${Math.round(pct)}% ${t("usageUsed")}`
              : d.remaining != null
                ? `${label}${t("usageRemaining")} ${formatAmount(d.remaining, d.unit)}`
                : label || "—";
        } else {
          main = `${t("usageBalance")} ${formatAmount(d.remaining, d.unit)}`;
        }

        return (
          <div key={i} className="flex items-center gap-1.5 min-w-0">
            <span aria-hidden="true">{isPlan ? "⚡" : "💰"}</span>
            <span
              className={`tabular-nums truncate ${
                d.isValid === false ? "text-red-500 dark:text-red-400" : color
              }`}
              title={main}
            >
              {main}
            </span>
            {resetText && (
              <span className="text-content-muted shrink-0">{resetText}</span>
            )}
          </div>
        );
      })}
      {data.length === 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-content-muted">—</span>
        </div>
      )}
    </div>
  );
}
