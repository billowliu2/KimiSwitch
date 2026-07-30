import { useMemo, useState, type MouseEvent } from "react";
import { useTranslation } from "../../i18n";
import { fmtTokens } from "../../lib/dashboard-format";
import type { DailyRow } from "../../types/dashboard";

interface TrendLineChartProps {
  /** Per-day totals, already capped to the desired window by the caller. */
  daily: DailyRow[];
}

const W = 800;
const H = 130;
const PAD_L = 56;
const PAD_R = 56;
const PAD_T = 10;
const PAD_B = 22;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

const COLOR_TOKENS = "#3b82f6"; // blue
const COLOR_CACHE = "#22c55e"; // green
const COLOR_REQUESTS = "#f97316"; // orange

/** Human-friendly token count for axis labels (K / M / B). */
function fmtTokenAxis(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(Math.round(value));
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const norm = value / base;
  let nice: number;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

export function TrendLineChart({ daily }: TrendLineChartProps) {
  const { t } = useTranslation();
  const [showRequests, setShowRequests] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const maxTokens = useMemo(() => {
    if (!daily?.length) return 1;
    return niceMax(Math.max(...daily.map((d) => d.totalTokens || 0), 1));
  }, [daily]);

  const maxRequests = useMemo(() => {
    if (!daily?.length) return 1;
    return niceMax(Math.max(...daily.map((d) => d.requests || 0), 1));
  }, [daily]);

  const n = daily?.length ?? 0;
  const stepX = n > 1 ? PLOT_W / (n - 1) : PLOT_W;

  const pointX = (i: number) => (n > 1 ? PAD_L + i * stepX : PAD_L + PLOT_W / 2);
  const pointYTokens = (v: number) => PAD_T + PLOT_H - (v / maxTokens) * PLOT_H;
  // Cache hit rate is a fraction 0-1 (see fmtPct); map onto the right 0-100% axis.
  const pointYCache = (v: number) => PAD_T + PLOT_H - Math.max(0, Math.min(1, v)) * PLOT_H;
  const pointYReq = (v: number) => PAD_T + PLOT_H - (v / maxRequests) * PLOT_H;

  const pathTokens = useMemo(() => {
    if (!daily?.length) return "";
    return daily
      .map((d, i) => `${i === 0 ? "M" : "L"} ${pointX(i)} ${pointYTokens(d.totalTokens || 0)}`)
      .join(" ");
  }, [daily, maxTokens]);

  const pathCache = useMemo(() => {
    if (!daily?.length) return "";
    return daily
      .map((d, i) => `${i === 0 ? "M" : "L"} ${pointX(i)} ${pointYCache(d.cacheHitRate || 0)}`)
      .join(" ");
  }, [daily]);

  const pathRequests = useMemo(() => {
    if (!daily?.length) return "";
    return daily
      .map((d, i) => `${i === 0 ? "M" : "L"} ${pointX(i)} ${pointYReq(d.requests || 0)}`)
      .join(" ");
  }, [daily, maxRequests]);

  const areaTokens = useMemo(() => {
    if (!daily?.length) return "";
    const lastX = pointX(daily.length - 1);
    return (
      pathTokens +
      ` L ${lastX} ${PAD_T + PLOT_H} L ${PAD_L} ${PAD_T + PLOT_H} Z`
    );
  }, [pathTokens, daily]);

  // X-axis ticks: show every ~5 days (plus the first and last) to avoid overlap.
  const xTicks = useMemo(() => {
    if (!daily?.length) return [];
    if (n <= 6) return daily.map((_, i) => i);
    const step = Math.max(1, Math.round(n / 6));
    const set = new Set<number>([0, n - 1]);
    for (let i = step; i < n - 1; i += step) set.add(i);
    return Array.from(set).sort((a, b) => a - b);
  }, [daily, n]);

  // Hover handling
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!daily?.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = W / rect.width;
    const x = (e.clientX - rect.left) * scale - PAD_L;
    if (x < 0 || x > PLOT_W) {
      setHoverIndex(null);
      return;
    }
    const idx = Math.max(0, Math.min(n - 1, Math.round(x / stepX)));
    setHoverIndex(idx);
  };

  const onLeave = () => setHoverIndex(null);

  if (!daily?.length) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-content-muted">
        {t("trendLineNoData")}
      </div>
    );
  }

  const hover = hoverIndex != null ? daily[hoverIndex] : null;

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Legend + toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-content-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLOR_TOKENS }} />
            {t("trendLineLegendTokens")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLOR_CACHE }} />
            {t("trendLineLegendCacheHit")}
          </span>
          {showRequests && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLOR_REQUESTS }} />
              {t("trendLineLegendRequests")}
            </span>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-content-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showRequests}
            onChange={(e) => setShowRequests(e.target.checked)}
            className="h-3 w-3 accent-blue-500"
          />
          {t("trendLineShowRequests")}
        </label>
      </div>

      {/* Chart */}
      <div className="relative flex-1 min-h-0">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-full"
          preserveAspectRatio="none"
          onMouseMove={onMove}
          onMouseLeave={onLeave}
        >
          {/* Gradient definitions */}
          <defs>
            <linearGradient id="tokenAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR_TOKENS} stopOpacity="0.28" />
              <stop offset="100%" stopColor={COLOR_TOKENS} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Y-axis grid lines only (labels rendered as HTML overlay below) */}
          {[0, 0.25, 0.5, 0.75, 1].map((p) => {
            const y = PAD_T + PLOT_H * (1 - p);
            return (
              <line
                key={p}
                x1={PAD_L}
                y1={y}
                x2={W - PAD_R}
                y2={y}
                stroke="currentColor"
                className="text-border"
                strokeWidth={1}
                strokeDasharray={p === 0 ? "" : "2 3"}
                opacity={p === 0 ? 0.9 : 0.4}
              />
            );
          })}

          {/* Area fill for tokens */}
          <path d={areaTokens} fill="url(#tokenAreaGrad)" />

          {/* Tokens line (area + line) */}
          <path
            d={pathTokens}
            fill="none"
            stroke={COLOR_TOKENS}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Cache hit line */}
          <path
            d={pathCache}
            fill="none"
            stroke={COLOR_CACHE}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Requests line (optional) */}
          {showRequests && (
            <path
              d={pathRequests}
              fill="none"
              stroke={COLOR_REQUESTS}
              strokeWidth={1.25}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Hover crosshair + dot */}
          {hover && (
            <g pointerEvents="none">
              <line
                x1={pointX(hoverIndex!)}
                y1={PAD_T}
                x2={pointX(hoverIndex!)}
                y2={PAD_T + PLOT_H}
                stroke="currentColor"
                className="text-content-muted"
                strokeWidth={1}
                strokeDasharray="2 2"
                opacity={0.5}
              />
              <circle
                cx={pointX(hoverIndex!)}
                cy={pointYTokens(hover.totalTokens || 0)}
                r={3.5}
                fill={COLOR_TOKENS}
                stroke="currentColor"
                className="text-panel"
                strokeWidth={1.5}
              />
              <circle
                cx={pointX(hoverIndex!)}
                cy={pointYCache(hover.cacheHitRate || 0)}
                r={3}
                fill={COLOR_CACHE}
                stroke="currentColor"
                className="text-panel"
                strokeWidth={1.5}
              />
              {showRequests && (
                <circle
                  cx={pointX(hoverIndex!)}
                  cy={pointYReq(hover.requests || 0)}
                  r={2.5}
                  fill={COLOR_REQUESTS}
                  stroke="currentColor"
                  className="text-panel"
                  strokeWidth={1.5}
                />
              )}
            </g>
          )}
        </svg>

        {/* Axis labels as HTML overlay (avoids SVG preserveAspectRatio="none" font distortion) */}
        {/* Left Y-axis (tokens) */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const top = ((PAD_T + PLOT_H * (1 - p)) / H) * 100;
          return (
            <span
              key={`yl-${p}`}
              className="pointer-events-none absolute text-[10px] leading-none text-content-muted"
              style={{
                left: 0,
                top: `${top}%`,
                width: `${((PAD_L - 4) / W) * 100}%`,
                textAlign: "right",
                transform: "translateY(-50%)",
              }}
            >
              {fmtTokenAxis(maxTokens * p)}
            </span>
          );
        })}
        {/* Right Y-axis (cache hit %) */}
        {[0, 0.5, 1].map((p) => {
          const top = ((PAD_T + PLOT_H * (1 - p)) / H) * 100;
          return (
            <span
              key={`yr-${p}`}
              className="pointer-events-none absolute text-[10px] leading-none text-content-muted"
              style={{
                right: 0,
                top: `${top}%`,
                width: `${((PAD_R - 4) / W) * 100}%`,
                textAlign: "left",
                transform: "translateY(-50%)",
              }}
            >
              {Math.round(p * 100)}%
            </span>
          );
        })}
        {/* X-axis labels */}
        {xTicks.map((i) => (
          <span
            key={`x-${i}`}
            className="pointer-events-none absolute text-[10px] leading-none text-content-muted"
            style={{
              left: `${(pointX(i) / W) * 100}%`,
              bottom: 0,
              transform: "translateX(-50%)",
            }}
          >
            {daily[i].date.slice(5)}
          </span>
        ))}

        {/* Tooltip (HTML overlay for readability) */}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11px] text-content-primary shadow-xl"
            style={{
              left: `${(pointX(hoverIndex!) / W) * 100}%`,
              top: 4,
              transform: hoverIndex! > n / 2 ? "translateX(-100%)" : "translateX(8px)",
            }}
          >
            <div className="font-medium">{hover.date}</div>
            <div className="text-content-muted">
              {t("trendLineLegendTokens")}: <span className="tabular-nums">{fmtTokens(hover.totalTokens)}</span>
            </div>
            <div className="text-content-muted">
              {t("trendLineLegendCacheHit")}: <span className="tabular-nums">{(hover.cacheHitRate * 100).toFixed(1)}%</span>
            </div>
            {showRequests && (
              <div className="text-content-muted">
                {t("trendLineLegendRequests")}: <span className="tabular-nums">{fmtInt(hover.requests)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
