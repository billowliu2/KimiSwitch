import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../i18n";
import { fmtPct, fmtTokens, fmtUsd } from "../../lib/dashboard-format";
import type { DailyRow } from "../../types/dashboard";
import { DailyDetailModal } from "./DailyDetailModal";

interface DailyBarsProps {
  daily: DailyRow[];
  /** Ordered model names for the colour palette & legend */
  modelNames: string[];
}

/** Deterministic colour palette — one hue per model index */
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

export function DailyBars({ daily, modelNames }: DailyBarsProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<DailyRow | null>(null);

  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    modelNames.forEach((m, i) => {
      map[m] = modelColor(i);
    });
    return map;
  }, [modelNames]);

  if (!daily?.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-500">
        {t("noData")}
      </div>
    );
  }

  const max = Math.max(...daily.map((d) => d.totalTokens || 0), 1);

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {modelNames.map((m) => (
          <span key={m} className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: colorMap[m] }}
            />
            {shortModel(m)}
          </span>
        ))}
      </div>

      {/* Bars */}
      <div className="flex h-52 items-end gap-1 overflow-x-auto px-0.5 pb-1">
        {daily.map((d) => {
          const h = Math.max(4, Math.round(((d.totalTokens || 0) / max) * 170));
          const total = d.totalTokens || 1;

          // Build stacked segments sorted by token count (largest at bottom)
          const segments = Object.entries(d.byModel || {})
            .map(([model, tokens]) => ({
              model,
              tokens,
              color: colorMap[model] || "#6b7280",
              height: Math.max(1, Math.round((tokens / total) * h)),
            }))
            .sort((a, b) => b.tokens - a.tokens);

          const tooltipLines = [
            d.date,
            `总 Token: ${fmtTokens(d.totalTokens)} · ${fmtUsd(d.costUsd)} · hit ${fmtPct(d.cacheHitRate)}`,
            ...segments.map(
              (s) => `${shortModel(s.model)}: ${fmtTokens(s.tokens)}`
            ),
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
                    key={s.model}
                    className="w-full transition-opacity group-hover:opacity-80"
                    style={{
                      height: s.height,
                      backgroundColor: s.color,
                    }}
                  />
                ))}
              </div>
              <span className="whitespace-nowrap text-[10px] text-gray-500">
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
            colorMap={colorMap}
            onClose={() => setSelected(null)}
          />,
          document.body
        )}
    </div>
  );
}