import { useEffect } from "react";
import { useTranslation } from "../../i18n";
import { fmtPct, fmtTokens, fmtUsd } from "../../lib/dashboard-format";
import type { DailyRow } from "../../types/dashboard";
import { modelColor } from "./DailyBars";

type TrendDimension = "model" | "provider";

interface DailyDetailModalProps {
  day: DailyRow;
  dimension: TrendDimension;
  /** active-dimension name → colour hex (models in model tab, providers in provider tab) */
  colorMap: Record<string, string>;
  unknownProviderLabel: string;
  onClose: () => void;
}

function shortModel(model: string): string {
  const bare = model.includes("/") ? model.split("/").pop()! : model;
  return bare;
}

export function DailyDetailModal({ day, dimension, colorMap, unknownProviderLabel, onClose }: DailyDetailModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const total = day.totalTokens || 1;
  const isProvider = dimension === "provider";

  // Flat per-model breakdown (model tab)
  const modelSegments = Object.entries(day.byModel || {})
    .map(([model, tokens]) => ({
      model,
      tokens,
      pct: (tokens / total) * 100,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  // Two-level provider → model breakdown (provider tab)
  const providerGroups = Object.entries(day.byProviderModel || {})
    .map(([prov, models]) => {
      const provTotal = Object.values(models).reduce((a, b) => a + b, 0);
      const modelList = Object.entries(models)
        .map(([model, tokens]) => ({ model, tokens }))
        .sort((a, b) => b.tokens - a.tokens);
      return {
        provider: prov,
        displayProvider: prov === "unknown" ? unknownProviderLabel : prov,
        total: provTotal,
        pct: (provTotal / total) * 100,
        color: colorMap[prov] || "#6b7280",
        models: modelList,
      };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={day.date}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border px-5 py-3.5">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-content-muted">
              {t("dayDetail")}
            </div>
            <div className="mt-0.5 text-lg font-semibold text-content-primary">
              {day.date}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md p-1 text-content-muted hover:bg-border hover:text-content-primary transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Day summary chips */}
        <div className="grid grid-cols-2 gap-2 px-5 py-3 sm:grid-cols-4">
          <SummaryChip label={t("totalTokens")} value={fmtTokens(day.totalTokens)} tone="default" />
          <SummaryChip label={t("cost")} value={fmtUsd(day.costUsd)} tone="orange" />
          <SummaryChip label={t("requests")} value={Math.round(day.requests).toLocaleString()} tone="blue" />
          <SummaryChip label={t("cacheHitRate")} value={fmtPct(day.cacheHitRate)} tone="green" />
        </div>

        {/* Breakdown — flat by model, or two-level by provider → model */}
        <div className="px-5 pb-4">
          {isProvider ? (
            <>
              <div className="mb-2 text-[11px] uppercase tracking-wider text-content-muted">
                {t("providerDistribution")} · {providerGroups.length}
              </div>
              {providerGroups.length === 0 ? (
                <div className="py-6 text-center text-sm text-content-muted">{t("noData")}</div>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {providerGroups.map((p) => (
                    <div key={p.provider}>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-content-primary" title={p.provider}>{p.displayProvider}</span>
                            <span className="shrink-0 text-xs text-content-muted tabular-nums">
                              {fmtTokens(p.total)} <span className="text-content-muted">· {p.pct.toFixed(1)}%</span>
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(2, p.pct)}%`, backgroundColor: p.color }} />
                          </div>
                        </div>
                      </div>
                      <div className="mt-1 ml-5 space-y-0.5">
                        {p.models.map((m) => (
                          <div key={m.model} className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="truncate text-content-muted" title={m.model}>{shortModel(m.model)}</span>
                            <span className="shrink-0 text-content-muted tabular-nums">{fmtTokens(m.tokens)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mb-2 text-[11px] uppercase tracking-wider text-content-muted">
                {t("modelDistribution")} · {modelSegments.length}
              </div>
              {modelSegments.length === 0 ? (
                <div className="py-6 text-center text-sm text-content-muted">{t("noData")}</div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {modelSegments.map((s, i) => (
                    <div key={s.model} className="flex items-center gap-3 text-sm">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: modelColor(i) }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-content-primary" title={s.model}>{shortModel(s.model)}</span>
                          <span className="shrink-0 text-xs text-content-muted tabular-nums">
                            {fmtTokens(s.tokens)} <span className="text-content-muted">· {s.pct.toFixed(1)}%</span>
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, s.pct)}%`, backgroundColor: modelColor(i) }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-5 py-2 text-[11px] text-content-muted">
          {t("modalEscHint")}
        </div>
      </div>
    </div>
  );
}

function SummaryChip({ label, value, tone }: { label: string; value: string; tone: "default" | "orange" | "blue" | "green" }) {
  const valueClass =
    tone === "orange" ? "text-orange-600 dark:text-orange-400"
    : tone === "blue" ? "text-blue-400"
    : tone === "green" ? "text-emerald-600 dark:text-emerald-400"
    : "text-content-primary";
  return (
    <div className="rounded-md bg-hover px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-content-muted">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}
