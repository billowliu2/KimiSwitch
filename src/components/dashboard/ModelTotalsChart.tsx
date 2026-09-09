import { useTranslation } from "../../i18n";
import { useCurrency } from "../../hooks/useCurrency";
import { fmtInt, fmtPct, fmtTokens } from "../../lib/dashboard-format";
import { modelColor } from "./DailyBars";
import type { ModelRow } from "../../types/dashboard";

interface ModelTotalsChartProps {
  /** Provider-agnostic model totals, pre-sorted by totalTokens desc. */
  rows: ModelRow[];
}

/** Horizontal ranked bars: one row per bare model name, providers merged. */
export function ModelTotalsChart({ rows }: ModelTotalsChartProps) {
  const { t } = useTranslation();
  const { money } = useCurrency();

  if (!rows.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-content-muted">
        {t("noData")}
      </div>
    );
  }

  const max = Math.max(...rows.map((m) => m.totalTokens || 0), 1);

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto">
      {rows.map((m, i) => {
        const color = i < 10 ? modelColor(i) : "#6b7280";
        const name = m.isSecondary ? t("subagentModel") : m.modelDisplay || m.model;
        const tooltip = [
          name,
          `${t("kpiRequests")}: ${fmtInt(m.requests)}`,
          `${t("totalTokens")}: ${fmtInt(m.totalTokens)}`,
          `${t("colCacheHit")}: ${fmtPct(m.cacheHitRate)}`,
          `${t("cost")}: ${money(m.costUsd)}`,
        ].join("\n");

        return (
          <div
            key={m.model}
            title={tooltip}
            className="group flex items-center gap-2 rounded px-1 py-1 cursor-help hover:bg-hover"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="w-40 shrink-0 truncate text-xs text-content-primary">
              {name}
              {m.costEstimated && (
                <span className="ml-1 text-[10px] text-yellow-600">({t("estimate")})</span>
              )}
            </span>
            <div className="flex h-4 flex-1 items-center overflow-hidden rounded-sm bg-hover-2/50">
              <div
                className="h-full rounded-sm transition-[width] group-hover:opacity-85"
                style={{
                  width: `${Math.max(2, (m.totalTokens / max) * 100)}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-xs text-content-muted">
              {fmtTokens(m.totalTokens)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
