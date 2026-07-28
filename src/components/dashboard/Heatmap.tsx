import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../../i18n";
import { fmtPct, fmtTokens, fmtUsd } from "../../lib/dashboard-format";
import type { HeatmapCell, HeatmapData } from "../../types/dashboard";

interface HeatmapProps {
  heatmap: HeatmapData;
}

const LEVEL_BG = [
  "bg-[#1a1a1e]", // 0 — empty / no usage
  "bg-emerald-900/55",
  "bg-emerald-700/65",
  "bg-emerald-500/85",
  "bg-emerald-400",
];

const DOW_LABELS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const DOW_LABELS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CELL = 12; // px
const GAP = 3; // px
const LABEL_W = 28; // dow label column width

interface HoverState {
  cell: HeatmapCell;
  x: number; // viewport coords
  y: number;
}

export function Heatmap({ heatmap }: HeatmapProps) {
  const { t, lang } = useTranslation();
  const cells = heatmap?.cells || [];
  const monthLabels = heatmap?.monthLabels || [];

  const dowLabels = lang === "zh" ? DOW_LABELS_ZH : DOW_LABELS_EN;

  const weekCount = useMemo(() => {
    if (!cells.length) return 0;
    return Math.max(...cells.map((c) => c.weekIndex)) + 1;
  }, [cells]);

  const grid = useMemo(() => {
    const cols: (HeatmapCell | null)[][] = Array.from(
      { length: weekCount },
      () => Array(7).fill(null)
    );
    for (const c of cells) {
      if (c.weekIndex >= 0 && c.weekIndex < weekCount) {
        cols[c.weekIndex][c.dow] = c;
      }
    }
    return cols;
  }, [cells, weekCount]);

  // Tooltip state with 120ms enter delay, matching reference (delayDuration=120)
  const [hover, setHover] = useState<HoverState | null>(null);
  const enterTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (enterTimer.current) window.clearTimeout(enterTimer.current);
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    };
  }, []);

  const showTooltip = (cell: HeatmapCell, e?: MouseEvent) => {
    if (leaveTimer.current) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    enterTimer.current = window.setTimeout(() => {
      if (e) {
        setHover({ cell, x: e.clientX, y: e.clientY });
      } else {
        // Keyboard focus path — fall back to last known position
        setHover((prev) => (prev ? { ...prev, cell } : { cell, x: 0, y: 0 }));
      }
    }, 120);
  };

  const moveTooltip = (cell: HeatmapCell, e: MouseEvent) => {
    if (hover && hover.cell.date === cell.date) {
      setHover({ cell, x: e.clientX, y: e.clientY });
    }
  };

  const showTooltipFromFocus = (cell: HeatmapCell) => showTooltip(cell);

  const hideTooltip = () => {
    if (enterTimer.current) {
      window.clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    leaveTimer.current = window.setTimeout(() => {
      setHover(null);
    }, 60);
  };

  if (!cells.length) {
    return (
      <div className="flex h-28 items-center justify-center text-sm text-gray-500">
        {t("noData")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Fixed-size year strip, centered; scrolls horizontally only when the card is narrower than the strip */}
      <div className="overflow-x-auto pb-1">
        <div
          className="mx-auto w-fit"
          style={{ minWidth: LABEL_W + weekCount * (CELL + GAP) }}
        >
          {/* month labels */}
          <div
            className="mb-1 grid"
            style={{
              gridTemplateColumns: `${LABEL_W}px repeat(${weekCount}, ${CELL}px)`,
              columnGap: GAP,
            }}
          >
            <div />
            {Array.from({ length: weekCount }, (_, wi) => {
              const label = monthLabels.find((m) => m.weekIndex === wi);
              return (
                <div
                  key={wi}
                  className="text-[10px] leading-none text-gray-500 whitespace-nowrap overflow-visible"
                >
                  {label ? label.label : ""}
                </div>
              );
            })}
          </div>

          <div className="flex" style={{ gap: GAP }}>
            {/* dow labels */}
            <div
              className="flex flex-col pr-0"
              style={{ width: LABEL_W, gap: GAP }}
            >
              {dowLabels.map((d, i) => (
                <div
                  key={d}
                  className={`flex items-center text-[10px] text-gray-500 ${
                    i % 2 === 1 ? "opacity-100" : "opacity-0"
                  }`}
                  style={{ height: CELL }}
                >
                  {d}
                </div>
              ))}
            </div>

            {/* cells */}
            <div className="flex" style={{ gap: GAP }}>
              {grid.map((week, wi) => (
                <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
                  {week.map((cell, di) => {
                    if (!cell) {
                      return (
                        <div
                          key={`${wi}-${di}`}
                          className="rounded-[3px] bg-transparent"
                          style={{ width: CELL, height: CELL }}
                        />
                      );
                    }
                    const level = cell.level ?? 0;
                    return (
                      <button
                        key={cell.date}
                        type="button"
                        aria-label={cell.date}
                        onMouseEnter={(e) => showTooltip(cell, e)}
                        onMouseMove={(e) => moveTooltip(cell, e)}
                        onMouseLeave={hideTooltip}
                        onFocus={() => showTooltipFromFocus(cell)}
                        onBlur={hideTooltip}
                        className={`rounded-[3px] ring-1 ring-inset ring-white/5 transition-transform hover:scale-[1.35] focus:scale-[1.35] outline-none ${LEVEL_BG[level] || LEVEL_BG[0]}`}
                        style={{ width: CELL, height: CELL }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-[11px] text-gray-500">
        <span>
          {heatmap.start} → {heatmap.end}
        </span>
        <div className="flex items-center gap-1.5">
          <span>{t("heatLess")}</span>
          {[0, 1, 2, 3, 4].map((lv) => (
            <div
              key={lv}
              className={`h-3 w-3 rounded-[3px] ring-1 ring-inset ring-white/5 ${LEVEL_BG[lv]}`}
            />
          ))}
          <span>{t("heatMore")}</span>
        </div>
      </div>

      {hover &&
        createPortal(
          <HeatmapTooltip state={hover} />,
          document.body
        )}
    </div>
  );
}

function HeatmapTooltip({ state }: { state: HoverState }) {
  const { t } = useTranslation();
  const { cell, x, y } = state;
  // Position above the cursor with a small offset; flip below if too close to top.
  const offset = 14;
  const style: React.CSSProperties = {
    position: "fixed",
    top: y - offset,
    left: x,
    transform: "translate(-50%, -100%)",
    zIndex: 9999,
    pointerEvents: "none",
  };
  return (
    <div
      style={style}
      className="rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-100 shadow-xl"
      role="tooltip"
    >
      <div className="font-medium text-gray-50">{cell.date}</div>
      <div className="text-gray-400">
        {fmtTokens(cell.totalTokens)} · {fmtUsd(cell.costUsd)} ·{" "}
        {fmtInt(cell.requests)} {t("requests")}
      </div>
      <div className="text-gray-400">
        {t("cacheHitRate")}: {fmtPct(cell.cacheHitRate)}
      </div>
    </div>
  );
}

// Local int formatter (same style as DailyBars in this project)
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}