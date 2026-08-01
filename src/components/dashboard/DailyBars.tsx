import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../i18n";
import { useCurrency } from "../../hooks/useCurrency";
import { fmtPct, fmtTokens } from "../../lib/dashboard-format";
import type { DailyRow } from "../../types/dashboard";
import { DailyDetailModal } from "./DailyDetailModal";

type TrendDimension = "model" | "provider";

interface DailyBarsProps {
  daily: DailyRow[];
  /** Which per-day breakdown to render */
  dimension: TrendDimension;
  /** Ordered names for the active dimension (colour palette & legend) */
  names: string[];
  /** Label for the unresolved-provider bucket */
  unknownProviderLabel: string;
}

/** Deterministic colour palette — one hue per index */
const PALETTE = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f97316", // orange
  "#a855f7", // purple
  "#ec4899", // pink
  "#eab308", // yellow
  "#06b6d4", // cyan
  "#f43f5e", // rose
  "#84cc16", // lime
  "#8b5cf6", // violet
];

export function modelColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

/** Short display name for a raw model id */
function shortModel(model: string): string {
  const bare = model.includes("/") ? model.split("/").pop()! : model;
  return bare;
}

export function DailyBars({ daily, dimension, names, unknownProviderLabel }: DailyBarsProps) {
  const { t } = useTranslation();
  const { money } = useCurrency();
  const [selected, setSelected] = useState<DailyRow | null>(null);

  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    names.forEach((m, i) => {
      map[m] = modelColor(i);
    });
    return map;
  }, [names]);

  const displayName = (key: string): string => {
    if (dimension === "provider") {
      return key === "unknown" ? unknownProviderLabel : key;
    }
    return shortModel(key);
  };

  if (!daily?.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-content-muted">
        {t("noData")}
      </div>
    );
  }

  const max = Math.max(...daily.map((d) => d.totalTokens || 0), 1);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {names.map((m) => (
          <span key={m} className="flex items-center gap-1.5 text-[11px] text-content-muted">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: colorMap[m] }}
            />
            {displayName(m)}
          </span>
        ))}
      </div>

      {/* Bars */}
      <div className="flex min-h-[180px] flex-1 items-end gap-1 overflow-x-auto px-0.5 pb-1">
        {daily.map((d) => {
          const h = Math.max(4, Math.round(((d.totalTokens || 0) / max) * 170));
          const total = d.totalTokens || 1;

          const breakdown = dimension === "provider" ? d.byProvider : d.byModel;
          const segments = Object.entries(breakdown || {})
            .map(([key, tokens]) => ({
              key,
              tokens,
              color: colorMap[key] || "#6b7280",
              height: Math.max(1, Math.round((tokens / total) * h)),
            }))
            .sort((a, b) => b.tokens - a.tokens);

          const tooltipLines = [
            d.date,
            `${t("totalTokens")}: ${fmtTokens(d.totalTokens)} · ${money(d.costUsd)} · ${t("colCacheHit")} ${fmtPct(d.cacheHitRate)}`,
            ...segments.map((s) => `${displayName(s.key)}: ${fmtTokens(s.tokens)}`),
            "",
            t("doubleClickHint"),
          ].join("\n");

          return (
            <button
              key={d.date}
              type="button"
              title={tooltipLines}
              onDoubleClick={() => setSelected(d)}
              className="group flex min-w-[18px] flex-1 flex-col items-center gap-1.5 border-0 bg-transparent p-0 cursor-help"
            >
              <div
                className="w-full flex flex-col-reverse rounded-t-md rounded-b-sm overflow-hidden transition-transform group-hover:scale-105 group-active:scale-95"
                style={{ height: h }}
              >
                {segments.map((s) => (
                  <div
                    key={s.key}
                    className="w-full transition-opacity group-hover:opacity-80"
                    style={{
                      height: s.height,
                      backgroundColor: s.color,
                    }}
                  />
                ))}
              </div>
              <span className="whitespace-nowrap text-[10px] text-content-muted">
                {d.date.slice(5)}
              </span>
            </button>
          );
        })}
      </div>

      {selected &&
        createPortal(
          <DailyDetailModal
            day={selected}
            dimension={dimension}
            colorMap={colorMap}
            unknownProviderLabel={unknownProviderLabel}
            onClose={() => setSelected(null)}
          />,
          document.body
        )}
    </div>
  );
}
