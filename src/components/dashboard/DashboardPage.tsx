import { useState, type ReactNode } from "react";
import { useDashboard, type DashboardRange } from "../../hooks/useDashboard";
import { fmtInt, fmtPct, fmtTime, fmtTokens, fmtUsd } from "../../lib/dashboard-format";
import { DailyBars } from "./DailyBars";
import { Heatmap } from "./Heatmap";

const RANGES: { value: DashboardRange; label: string }[] = [
  { value: "today", label: "今天" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "all", label: "全部" },
];

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#2a2a2e] bg-[#16161a]">
      <div className="border-b border-[#2a2a2e] px-4 py-2.5 flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-[#e5e5e7]">{title}</h3>
        {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#2a2a2e] bg-[#16161a] p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[#e5e5e7] tracking-tight">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}

export function DashboardPage() {
  const { range, changeRange, data, loading, error, refresh } = useDashboard();
  const [showAllModels, setShowAllModels] = useState(false);
  const [recentPage, setRecentPage] = useState(1);

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 mb-2">加载失败</div>
          <div className="text-sm text-gray-500">{error}</div>
          <button
            onClick={() => refresh()}
            className="mt-4 px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            重试
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

  const kpiItems = [
    { label: "请求数", value: fmtInt(totals.requests) },
    { label: "非缓存输入", value: fmtTokens(totals.inputOther), sub: fmtInt(totals.inputOther) },
    { label: "输出", value: fmtTokens(totals.output), sub: fmtInt(totals.output) },
    { label: "缓存读", value: fmtTokens(totals.inputCacheRead), sub: fmtInt(totals.inputCacheRead) },
    { label: "缓存创建", value: fmtTokens(totals.inputCacheCreation), sub: fmtInt(totals.inputCacheCreation) },
    { label: "缓存命中", value: fmtPct(totals.cacheHitRate) },
    { label: "总 Token", value: fmtTokens(totals.totalTokens), sub: fmtInt(totals.totalTokens) },
    { label: "预估费用", value: fmtUsd(totals.costUsd) },
  ];

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Range tabs + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center bg-[#1f1f23] border border-[#2a2a2e] rounded p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => changeRange(r.value)}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                range === r.value
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-[#e5e5e7]"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="px-3 py-1.5 text-sm border border-[#2a2a2e] rounded hover:bg-[#252529] text-gray-400 hover:text-[#e5e5e7] disabled:opacity-50"
        >
          {loading ? "刷新中…" : "↻ 刷新"}
        </button>
      </div>

      {/* Range overview cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {RANGES.map((r) => {
          const tot = rangeTotals[r.value];
          if (!tot) return null;
          const active = range === r.value;
          return (
            <button
              key={r.value}
              type="button"
              onClick={() => changeRange(r.value)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                active
                  ? "border-blue-500/50 ring-1 ring-blue-500/30 bg-blue-900/10"
                  : "border-[#2a2a2e] bg-[#16161a] hover:border-[#3a3a42] hover:bg-[#1c1c20]"
              }`}
            >
              <div className="text-xs text-gray-500">{r.label}</div>
              <div className="mt-1 text-lg font-semibold text-[#e5e5e7] tracking-tight">
                {fmtTokens(tot.totalTokens)}
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                {fmtInt(tot.requests)} 次 · {fmtUsd(tot.costUsd)} · {fmtPct(tot.cacheHitRate)}
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

      {/* Heatmap — full-year strip, fixed-size cells, centered */}
      <Card title="全年热力图" subtitle="按 Token 量着色">
        <Heatmap heatmap={heatmap} />
      </Card>

      {/* Charts + Model side table */}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card
          title="每日用量趋势"
          subtitle={
            daily.length > 30
              ? `近 30 天 · 共 ${daily.length} 天`
              : `按模型着色 · ${daily.length} 天`
          }
        >
          <DailyBars
            daily={daily.length > 30 ? daily.slice(-30) : daily}
            modelNames={modelNames}
          />
        </Card>

        <Card title="模型用量" subtitle={`${models.length} 个模型`}>
          {models.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">暂无数据</div>
          ) : (
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#16161a]">
                  <tr className="text-left text-xs text-gray-500 border-b border-[#2a2a2e]">
                    <th className="pb-2 pr-3 font-normal">模型</th>
                    <th className="pb-2 pr-3 font-normal text-right">请求</th>
                    <th className="pb-2 pr-3 font-normal text-right">Token</th>
                    <th className="pb-2 pr-3 font-normal text-right">缓存命中</th>
                    <th className="pb-2 font-normal text-right">费用</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleModels.map((m) => (
                    <tr
                      key={m.model}
                      className="border-b border-[#2a2a2e]/50 hover:bg-[#1c1c20]"
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
                          <div className="min-w-0">
                            <div className="text-[#e5e5e7] truncate">{m.modelDisplay || m.model}</div>
                            {m.costEstimated && (
                              <span className="text-[10px] text-yellow-600">估算</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right text-gray-400">{fmtInt(m.requests)}</td>
                      <td className="py-2 pr-3 text-right text-gray-400">{fmtTokens(m.totalTokens)}</td>
                      <td className="py-2 pr-3 text-right text-gray-400">{fmtPct(m.cacheHitRate)}</td>
                      <td className="py-2 text-right text-orange-400">{fmtUsd(m.costUsd)}</td>
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
                  {showAllModels ? "收起" : `展开全部 (${models.length})`}
                </button>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Recent requests */}
      <Card
        title="最近请求"
        subtitle={
          recentTotal > recent.length
            ? `显示前 ${recent.length} / ${fmtInt(recentTotal)} 条`
            : `${recent.length} 条`
        }
      >
        {recent.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">暂无数据</div>
        ) : (
          <>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#16161a]">
                  <tr className="text-left text-xs text-gray-500 border-b border-[#2a2a2e]">
                    <th className="pb-2 pr-4 font-normal">时间</th>
                    <th className="pb-2 pr-4 font-normal">模型</th>
                    <th className="pb-2 pr-4 font-normal text-right">输入</th>
                    <th className="pb-2 pr-4 font-normal text-right">输出</th>
                    <th className="pb-2 pr-4 font-normal text-right">缓存读</th>
                    <th className="pb-2 font-normal text-right">费用</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPageRows.map((r, i) => (
                    <tr key={recentStart + i} className="border-b border-[#2a2a2e]/50 hover:bg-[#1c1c20]">
                      <td className="py-1.5 pr-4 text-gray-500 whitespace-nowrap">
                        {fmtTime(r.time)}
                      </td>
                      <td className="py-1.5 pr-4 text-[#e5e5e7]">{r.modelDisplay || r.model}</td>
                      <td className="py-1.5 pr-4 text-right text-gray-400">{fmtTokens(r.inputOther)}</td>
                      <td className="py-1.5 pr-4 text-right text-gray-400">{fmtTokens(r.output)}</td>
                      <td className="py-1.5 pr-4 text-right text-gray-400">{fmtTokens(r.inputCacheRead)}</td>
                      <td className="py-1.5 text-right text-orange-400">{fmtUsd(r.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#2a2a2e] pt-2 text-xs text-gray-500">
              <span>
                第 {fmtInt(recentCurrentPage)} / {fmtInt(recentTotalPages)} 页 ·{" "}
                {fmtInt(recentStart + 1)}–{fmtInt(Math.min(recentStart + RECENT_PAGE_SIZE, recent.length))} 条 ·{" "}
                每页 {RECENT_PAGE_SIZE} 条
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={recentCurrentPage <= 1}
                  onClick={() => setRecentPage(1)}
                  className="px-2 py-1 rounded border border-[#2a2a2e] hover:bg-[#252529] disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="首页"
                >
                  «
                </button>
                <button
                  type="button"
                  disabled={recentCurrentPage <= 1}
                  onClick={() => setRecentPage((p) => Math.max(1, p - 1))}
                  className="px-2 py-1 rounded border border-[#2a2a2e] hover:bg-[#252529] disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="上一页"
                >
                  ‹
                </button>
                <button
                  type="button"
                  disabled={recentCurrentPage >= recentTotalPages}
                  onClick={() => setRecentPage((p) => Math.min(recentTotalPages, p + 1))}
                  className="px-2 py-1 rounded border border-[#2a2a2e] hover:bg-[#252529] disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="下一页"
                >
                  ›
                </button>
                <button
                  type="button"
                  disabled={recentCurrentPage >= recentTotalPages}
                  onClick={() => setRecentPage(recentTotalPages)}
                  className="px-2 py-1 rounded border border-[#2a2a2e] hover:bg-[#252529] disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="末页"
                >
                  »
                </button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Attribution footer */}
      <div className="text-xs text-gray-500 pb-2">
        扫描 {data.meta.filesScanned} 个文件 · {fmtInt(data.meta.recordCount)} 条记录 ·{" "}
        {data.meta.home}
        <br />
        仪表盘功能基于{" "}
        <a
          href="https://github.com/JochenYang/kimicode-dashboard"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-400 underline"
        >
          kimicode-dashboard
        </a>{" "}
        （MIT，© JochenYang）移植
      </div>
    </div>
  );
}
