import { useState, type ReactNode } from "react";
import { useDashboard, type DashboardRange } from "../../hooks/useDashboard";
import { useTranslation } from "../../i18n";
import { fmtInt, fmtPct, fmtTime, fmtTokens, fmtUsd } from "../../lib/dashboard-format";
import { DailyBars } from "./DailyBars";
import { Heatmap } from "./Heatmap";
import { TrendLineChart } from "./TrendLineChart";

const RANGES: DashboardRange[] = ["today", "7d", "30d", "all"];

function Card({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col rounded-xl border border-border bg-panel ${className ?? ""}`}>
      <div className="border-b border-border px-4 py-2.5 flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-content-primary">{title}</h3>
        {subtitle && <span className="text-xs text-content-muted">{subtitle}</span>}
      </div>
      <div className="flex flex-1 flex-col p-4">{children}</div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <div className="text-[11px] text-content-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold text-content-primary tracking-tight">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-content-muted">{sub}</div>}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { range, changeRange, data, loading, error, refresh } = useDashboard();
  const [showAllModels, setShowAllModels] = useState(false);
  const [recentPage, setRecentPage] = useState(1);
  const [trendTab, setTrendTab] = useState<"daily" | "model" | "provider">("daily");

  const RANGE_LABELS: Record<DashboardRange, string> = {
    today: t("rangeToday"),
    "7d": t("range7d"),
    "30d": t("range30d"),
    all: t("rangeAll"),
  };

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center text-content-muted">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 mb-2">{t("dashLoadFailed")}</div>
          <div className="text-sm text-content-muted">{error}</div>
          <button
            onClick={() => refresh(true)}
            className="mt-4 px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const totals = data.stats.totals;
  const daily = data.stats.daily;
  const models = data.stats.models;
  const recent = data.stats.recent;
  const heatmap = data.heatmap;
  const rangeTotals = data.rangeTotals;
  const visibleModels = showAllModels ? models : models.slice(0, 8);

  // Recent pagination
  const RECENT_PAGE_SIZE = 30;
  const recentTotal = data.stats.recentTotal;
  const recentTotalPages = Math.max(1, Math.ceil(recent.length / RECENT_PAGE_SIZE));
  const recentCurrentPage = Math.min(recentPage, recentTotalPages);
  const recentStart = (recentCurrentPage - 1) * RECENT_PAGE_SIZE;
  const recentPageRows = recent.slice(recentStart, recentStart + RECENT_PAGE_SIZE);

  // Ordered model names for chart colour mapping
  const modelNames = models.map((m) => m.model);
  const trendDaily = daily.length > 30 ? daily.slice(-30) : daily;
  const providerTotals: Record<string, number> = {};
  for (const d of trendDaily) {
    for (const [p, tok] of Object.entries(d.byProvider || {})) {
      providerTotals[p] = (providerTotals[p] || 0) + tok;
    }
  }
  const providerNames = Object.entries(providerTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);

  const kpiItems = [
    { label: t("kpiRequests"), value: fmtInt(totals.requests) },
    { label: t("kpiInputOther"), value: fmtTokens(totals.inputOther), sub: fmtInt(totals.inputOther) },
    { label: t("kpiOutput"), value: fmtTokens(totals.output), sub: fmtInt(totals.output) },
    { label: t("kpiCacheRead"), value: fmtTokens(totals.inputCacheRead), sub: fmtInt(totals.inputCacheRead) },
    { label: t("kpiCacheCreation"), value: fmtTokens(totals.inputCacheCreation), sub: fmtInt(totals.inputCacheCreation) },
    { label: t("kpiCacheHit"), value: fmtPct(totals.cacheHitRate) },
    { label: t("totalTokens"), value: fmtTokens(totals.totalTokens), sub: fmtInt(totals.totalTokens) },
    { label: t("kpiCost"), value: fmtUsd(totals.costUsd) },
  ];

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Range tabs + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center bg-input border border-border rounded p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => changeRange(r)}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                range === r
                  ? "bg-blue-600 text-white"
                  : "text-content-muted hover:text-content-primary"
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => refresh(true)}
          disabled={loading}
          className="px-3 py-1.5 text-sm border border-border rounded hover:bg-hover-2 text-content-muted hover:text-content-primary disabled:opacity-50"
        >
          {loading ? t("refreshing") : `↻ ${t("refresh")}`}
        </button>
      </div>

      {/* Range overview cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {RANGES.map((r) => {
          const tot = rangeTotals[r];
          if (!tot) return null;
          const active = range === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => changeRange(r)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                active
                  ? "border-blue-500/50 ring-1 ring-blue-500/30 bg-blue-900/10"
                  : "border-border bg-panel hover:border-strong hover:bg-hover"
              }`}
            >
              <div className="text-xs text-content-muted">{RANGE_LABELS[r]}</div>
              <div className="mt-1 text-lg font-semibold text-content-primary tracking-tight">
                {fmtTokens(tot.totalTokens)}
              </div>
              <div className="mt-1 text-[11px] text-content-muted">
                {fmtInt(tot.requests)} {t("unitTimes")} · {fmtUsd(tot.costUsd)} · {fmtPct(tot.cacheHitRate)}
              </div>
            </button>
          );
        })}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {kpiItems.map((item) => (
          <KpiCard key={item.label} label={item.label} value={item.value} sub={item.sub} />
        ))}
      </div>

      {/* Heatmap — full row */}
      <Card title={t("cardHeatmap")} subtitle={t("cardHeatmapSub")}>
        <Heatmap heatmap={heatmap} />
      </Card>

      {/* Usage-trend tabs + Model table side by side */}
      <div className="grid items-stretch gap-4 lg:grid-cols-[1.2fr_1fr]">
        {/* Usage-trend tab container */}
        <div className="flex flex-col rounded-xl border border-border bg-panel">
          {/* Tab bar header */}
          <div className="flex items-end justify-between border-b border-border px-2">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setTrendTab("daily")}
                className={`px-3 py-2 -mb-px border-b-2 text-sm font-medium transition-colors ${
                  trendTab === "daily"
                    ? "border-blue-500 text-content-primary"
                    : "border-transparent text-content-muted hover:text-content-primary"
                }`}
              >
                {t("tabDailyTrend")}
              </button>
              <button
                type="button"
                onClick={() => setTrendTab("model")}
                className={`px-3 py-2 -mb-px border-b-2 text-sm font-medium transition-colors ${
                  trendTab === "model"
                    ? "border-blue-500 text-content-primary"
                    : "border-transparent text-content-muted hover:text-content-primary"
                }`}
              >
                {t("tabModelTrend")}
              </button>
              <button
                type="button"
                onClick={() => setTrendTab("provider")}
                className={`px-3 py-2 -mb-px border-b-2 text-sm font-medium transition-colors ${
                  trendTab === "provider"
                    ? "border-blue-500 text-content-primary"
                    : "border-transparent text-content-muted hover:text-content-primary"
                }`}
              >
                {t("tabProviderTrend")}
              </button>
            </div>
            <span className="pb-2 text-xs text-content-muted">
              {trendTab === "daily"
                ? t("trendLineSub", { n: trendDaily.length })
                : daily.length > 30
                  ? t("cardDailyTrendSubCapped", { n: daily.length })
                  : t("cardDailyTrendSub", { n: daily.length })}
            </span>
          </div>
          {/* Active tab content */}
          <div className="flex flex-1 flex-col p-4">
            {trendTab === "daily" ? (
              <div className="flex-1 min-h-[240px]">
                <TrendLineChart daily={trendDaily} />
              </div>
            ) : (
              <div className="flex-1 min-h-[240px]">
                <DailyBars
                  daily={trendDaily}
                  dimension={trendTab}
                  names={trendTab === "model" ? modelNames : providerNames}
                  unknownProviderLabel={t("providerUnknown")}
                />
              </div>
            )}
          </div>
        </div>

        <Card title={t("cardModelUsage")} subtitle={t("cardModelUsageSub", { n: models.length })}>
          {models.length === 0 ? (
            <div className="py-8 text-center text-sm text-content-muted">{t("noData")}</div>
          ) : (
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 bg-panel">
                  <tr className="text-left text-xs text-content-muted border-b border-border">
                    <th className="pb-2 pr-3 font-normal">{t("colModel")}</th>
                    <th className="pb-2 pr-3 font-normal text-right">{t("requests")}</th>
                    <th className="pb-2 pr-3 font-normal text-right">{t("colTokens")}</th>
                    <th className="pb-2 pr-3 font-normal text-right">{t("colCacheHit")}</th>
                    <th className="pb-2 font-normal text-right">{t("cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleModels.map((m) => (
                    <tr
                      key={m.model}
                      className="border-b border-border hover:bg-hover"
                    >
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                            style={{
                              backgroundColor:
                                models.indexOf(m) < 10
                                  ? ["#3b82f6","#22c55e","#f97316","#a855f7","#ec4899","#eab308","#06b6d4","#f43f5e","#84cc16","#8b5cf6"][models.indexOf(m)]
                                  : "#6b7280",
                            }}
                          />
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-content-primary whitespace-nowrap truncate">{m.modelDisplay || m.model}</span>
                            {m.costEstimated && (
                              <span className="text-[10px] text-yellow-600 shrink-0">({t("estimate")})</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right text-content-muted">{fmtInt(m.requests)}</td>
                      <td className="py-2 pr-3 text-right text-content-muted">{fmtTokens(m.totalTokens)}</td>
                      <td className="py-2 pr-3 text-right text-content-muted">{fmtPct(m.cacheHitRate)}</td>
                      <td className="py-2 text-right text-orange-600 dark:text-orange-400">{fmtUsd(m.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {models.length > 8 && (
                <button
                  type="button"
                  onClick={() => setShowAllModels(!showAllModels)}
                  className="mt-3 text-sm text-blue-500 hover:text-blue-400"
                >
                  {showAllModels ? t("collapse") : t("expandAll", { n: models.length })}
                </button>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Recent requests */}
      <Card
        title={t("cardRecent")}
        subtitle={
          recentTotal > recent.length
            ? t("cardRecentCapped", { n: recent.length, m: recentTotal })
            : t("cardRecentCount", { n: recent.length })
        }
      >
        {recent.length === 0 ? (
          <div className="py-8 text-center text-sm text-content-muted">{t("noData")}</div>
        ) : (
          <>
            <div className="overflow-auto max-h-[860px]">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 bg-panel">
                  <tr className="text-left text-xs text-content-muted border-b border-border">
                    <th className="pb-2 pr-4 font-normal">{t("colTime")}</th>
                    <th className="pb-2 pr-4 font-normal">{t("colModel")}</th>
                    <th className="pb-2 pr-4 font-normal text-right">{t("colInput")}</th>
                    <th className="pb-2 pr-4 font-normal text-right">{t("colOutput")}</th>
                    <th className="pb-2 pr-4 font-normal text-right">{t("colCacheRead")}</th>
                    <th className="pb-2 font-normal text-right">{t("cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPageRows.map((r, i) => (
                    <tr key={recentStart + i} className="border-b border-border hover:bg-hover">
                      <td className="py-1.5 pr-4 text-content-muted whitespace-nowrap">
                        {fmtTime(r.time)}
                      </td>
                      <td className="py-1.5 pr-4 text-content-primary">{r.modelDisplay || r.model}</td>
                      <td className="py-1.5 pr-4 text-right text-content-muted">{fmtTokens(r.inputOther)}</td>
                      <td className="py-1.5 pr-4 text-right text-content-muted">{fmtTokens(r.output)}</td>
                      <td className="py-1.5 pr-4 text-right text-content-muted">{fmtTokens(r.inputCacheRead)}</td>
                      <td className="py-1.5 text-right text-orange-600 dark:text-orange-400">{fmtUsd(r.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2 text-xs text-content-muted">
              <span>
                {t("paginationPage", { x: recentCurrentPage, y: recentTotalPages })} ·{" "}
                {t("paginationRange", {
                  x: recentStart + 1,
                  y: Math.min(recentStart + RECENT_PAGE_SIZE, recent.length),
                })}{" "}
                · {t("paginationPerPage", { n: RECENT_PAGE_SIZE })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={recentCurrentPage <= 1}
                  onClick={() => setRecentPage(1)}
                  className="px-2 py-1 rounded border border-border hover:bg-hover-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={t("pageFirst")}
                >
                  «
                </button>
                <button
                  type="button"
                  disabled={recentCurrentPage <= 1}
                  onClick={() => setRecentPage((p) => Math.max(1, p - 1))}
                  className="px-2 py-1 rounded border border-border hover:bg-hover-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={t("pagePrev")}
                >
                  ‹
                </button>
                <button
                  type="button"
                  disabled={recentCurrentPage >= recentTotalPages}
                  onClick={() => setRecentPage((p) => Math.min(recentTotalPages, p + 1))}
                  className="px-2 py-1 rounded border border-border hover:bg-hover-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={t("pageNext")}
                >
                  ›
                </button>
                <button
                  type="button"
                  disabled={recentCurrentPage >= recentTotalPages}
                  onClick={() => setRecentPage(recentTotalPages)}
                  className="px-2 py-1 rounded border border-border hover:bg-hover-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={t("pageLast")}
                >
                  »
                </button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Footer — meta at the end of the content flow */}
      <div className="text-xs text-content-muted pb-2">
        <div>
          {t("footerScanned", { n: data.meta.filesScanned, m: fmtInt(data.meta.recordCount) })} ·{" "}
          {data.meta.home}
        </div>
      </div>
    </div>
  );
}
