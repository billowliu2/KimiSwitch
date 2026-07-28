import { useEffect } from "react";
import { useTranslation } from "../../i18n";
import { fmtPct, fmtTokens, fmtUsd } from "../../lib/dashboard-format";
import type { DailyRow } from "../../types/dashboard";
import { modelColor } from "./DailyBars";

interface DailyDetailModalProps {
  day: DailyRow;
  /** model name → colour hex */
  colorMap: Record<string, string>;
  onClose: () => void;
}

function shortModel(model: string): string {
  const bare = model.includes("/") ? model.split("/").pop()! : model;
  return bare;
}

export function DailyDetailModal({ day, colorMap, onClose }: DailyDetailModalProps) {
  const { t } = useTranslation();

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock background scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const total = day.totalTokens || 1;
  const segments = Object.entries(day.byModel || {})
    .map(([model, tokens]) => ({
      model,
      tokens,
      pct: (tokens / total) * 100,
      color: colorMap[model] || "#6b7280",
    }))
    .sort((a, b) => b.tokens - a.tokens);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={day.date}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-[#2a2a2e] bg-[#16161a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#2a2a2e] px-5 py-3.5">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-500">
              {t("dayDetail")}
            </div>
            <div className="mt-0.5 text-lg font-semibold text-[#e5e5e7]">
              {day.date}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md p-1 text-gray-500 hover:bg-[#2a2a2e] hover:text-gray-200 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Day summary chips */}
        <div className="grid grid-cols-2 gap-2 px-5 py-3 sm:grid-cols-4">
          <SummaryChip
            label={t("totalTokens")}
            value={fmtTokens(day.totalTokens)}
            tone="default"
          />
          <SummaryChip
            label={t("cost")}
            value={fmtUsd(day.costUsd)}
            tone="orange"
          />
          <SummaryChip
            label={t("requests")}
            value={Math.round(day.requests).toLocaleString()}
            tone="blue"
          />
          <SummaryChip
            label={t("cacheHitRate")}
            value={fmtPct(day.cacheHitRate)}
            tone="green"
          />
        </div>

        {/* Per-model breakdown */}
        <div className="px-5 pb-4">
          <div className="mb-2 text-[11px] uppercase tracking-wider text-gray-500">
            {t("modelDistribution")} · {segments.length}
          </div>
          {segments.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-500">
              {t("noData")}
            </div>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {segments.map((s, i) => (
                <div key={s.model} className="flex items-center gap-3 text-sm">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: modelColor(i) }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className="truncate text-[#e5e5e7]"
                        title={s.model}
                      >
                        {shortModel(s.model)}
                      </span>
                      <span className="shrink-0 text-xs text-gray-400 tabular-nums">
                        {fmtTokens(s.tokens)}{" "}
                        <span className="text-gray-500">
                          · {s.pct.toFixed(1)}%
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#2a2a2e]">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max(2, s.pct)}%`,
                          backgroundColor: modelColor(i),
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-[#2a2a2e] px-5 py-2 text-[11px] text-gray-500">
          {t("modalEscHint")}
        </div>
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "default" | "orange" | "blue" | "green";
}) {
  const valueClass =
    tone === "orange"
      ? "text-orange-400"
      : tone === "blue"
        ? "text-blue-400"
        : tone === "green"
          ? "text-emerald-400"
          : "text-[#e5e5e7]";
  return (
    <div className="rounded-md bg-[#1c1c20] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}