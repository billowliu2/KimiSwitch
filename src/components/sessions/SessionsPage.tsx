import { useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSessions } from "../../hooks/useSessions";
import { fmtInt, fmtTime } from "../../lib/dashboard-format";
import { useTranslation } from "../../i18n";
import type { SessionRow, WorkspaceRow } from "../../types/sessions";

function fmtBytes(n: number): string {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function parseTime(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function rowKey(row: SessionRow): string {
  return `${row.workspaceId}/${row.id}`;
}

type ConfirmState =
  | { mode: "one"; row: SessionRow }
  | { mode: "bulk"; rows: SessionRow[] }
  | { mode: "workspace"; workspace: WorkspaceRow }
  | null;

type PreviewState = {
  loading: boolean;
  error: string | null;
  messages: { role: string; time: number | null; text: string }[];
  truncated: boolean;
  row: SessionRow;
} | null;

export function SessionsPage() {
  const { t, lang } = useTranslation();
  const locale = lang === "zh" ? "zh" : "en";
  const {
    status,
    setStatus,
    workspace,
    setWorkspace,
    data,
    loading,
    error,
    setError,
    refresh,
    archiveSession,
    unarchiveSession,
    deleteSession,
    deleteWorkspace,
    getPreview,
  } = useSessions();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewState>(null);

  const workspaces = data?.workspaces ?? [];
  const sessions = data?.sessions ?? [];

  const workspaceMap = useMemo(() => {
    const m = new Map<string, WorkspaceRow>();
    for (const w of workspaces) m.set(w.id, w);
    return m;
  }, [workspaces]);

  const allKeys = useMemo(() => sessions.map(rowKey), [sessions]);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = allKeys.some((k) => selected.has(k)) && !allSelected;

  const toggleSelect = (row: SessionRow) => {
    const key = rowKey(row);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allKeys));
  };

  const onArchive = async (row: SessionRow) => {
    const key = rowKey(row);
    setBusyId(key);
    try {
      await archiveSession(row.workspaceId, row.id);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onUnarchive = async (row: SessionRow) => {
    const key = rowKey(row);
    setBusyId(key);
    try {
      await unarchiveSession(row.workspaceId, row.id);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const openPreview = async (row: SessionRow) => {
    setPreview({
      loading: true,
      error: null,
      messages: [],
      truncated: false,
      row,
    });
    try {
      const res = await getPreview(row.workspaceId, row.id, row.status);
      setPreview({
        loading: false,
        error: null,
        messages: res.messages,
        truncated: res.truncated,
        row,
      });
    } catch (e) {
      setPreview({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
        messages: [],
        truncated: false,
        row,
      });
    }
  };

  const bulkArchive = async () => {
    const rows = sessions.filter((s) => selected.has(rowKey(s)) && s.status === "active");
    for (const row of rows) {
      try {
        await archiveSession(row.workspaceId, row.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        break;
      }
    }
    setSelected(new Set());
  };

  const bulkUnarchive = async () => {
    const rows = sessions.filter((s) => selected.has(rowKey(s)) && s.status === "archived");
    for (const row of rows) {
      try {
        await unarchiveSession(row.workspaceId, row.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        break;
      }
    }
    setSelected(new Set());
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.mode === "one") {
        await deleteSession(confirm.row.workspaceId, confirm.row.id, confirm.row.status);
      } else if (confirm.mode === "bulk") {
        for (const row of confirm.rows) {
          await deleteSession(row.workspaceId, row.id, row.status);
        }
      } else if (confirm.mode === "workspace") {
        await deleteWorkspace(confirm.workspace.id);
        if (workspace === confirm.workspace.id) setWorkspace("all");
      }
      setConfirm(null);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmBusy(false);
    }
  };

  const totalSessions = workspaces.reduce(
    (a, w) => a + (w.activeCount || 0) + (w.archivedCount || 0),
    0
  );

  return (
    <div className="flex h-full flex-col overflow-hidden p-4 space-y-3">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-content-primary">{t("sessionsTitle")}</h2>
          <p className="mt-1 max-w-[60ch] text-sm text-content-muted">{t("sessionsSubtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded border border-border hover:bg-hover-2 disabled:opacity-50"
        >
          {loading ? t("refreshing") : t("refresh")}
        </button>
      </div>

      {error && (
        <div className="shrink-0 rounded-lg border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[260px_1fr]">
        {/* Workspace rail */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-panel">
          <div className="shrink-0 border-b border-border px-4 py-2.5">
            <div className="text-sm font-medium text-content-primary">{t("workspaces")}</div>
            <div className="text-xs text-content-muted mt-0.5">{t("workspaceIsolatedHint")}</div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-2 overflow-hidden">
            <button
              type="button"
              onClick={() => setWorkspace("all")}
              className={`flex w-full shrink-0 items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                workspace === "all"
                  ? "bg-blue-600/20 text-content-primary"
                  : "text-content-muted hover:bg-input hover:text-content-primary"
              }`}
            >
              <span>{t("allWorkspaces")}</span>
              <span className="text-xs tabular-nums">{fmtInt(totalSessions, locale)}</span>
            </button>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto mt-1">
              {workspaces.map((w) => {
                const total = (w.activeCount || 0) + (w.archivedCount || 0);
                const isEmpty = total === 0 || w.empty;
                return (
                  <div
                    key={w.id}
                    className={`group flex items-start gap-1 rounded-md ${
                      workspace === w.id ? "bg-blue-600/20" : "hover:bg-input"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setWorkspace(w.id)}
                      className={`flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left ${
                        workspace === w.id ? "text-content-primary" : "text-content-muted group-hover:text-content-primary"
                      }`}
                      title={w.root || w.id}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{w.name || w.id}</span>
                        <span className="shrink-0 text-[11px] tabular-nums">
                          {isEmpty ? (
                            <span className="rounded border border-border px-1.5 py-0 text-[10px] text-content-muted">
                              {t("emptyWorkspace")}
                            </span>
                          ) : (
                            <>
                              {w.activeCount || 0}
                              {w.archivedCount ? `/${w.archivedCount}` : ""}
                            </>
                          )}
                        </span>
                      </div>
                      {w.root && (
                        <span className="truncate font-mono text-[10px] opacity-70">{w.root}</span>
                      )}
                    </button>
                    {isEmpty && (
                      <button
                        type="button"
                        className="mt-1 mr-1 h-7 w-7 shrink-0 rounded text-red-400/80 opacity-70 hover:bg-red-900/30 hover:text-red-300 group-hover:opacity-100"
                        title={t("deleteWorkspace")}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirm({ mode: "workspace", workspace: w });
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              {!workspaces.length && !loading && (
                <div className="px-3 py-6 text-center text-xs text-content-muted">{t("noSessions")}</div>
              )}
            </div>
          </div>
        </div>

        {/* Sessions table */}
        <div className="flex min-h-0 flex-col space-y-3 overflow-hidden">
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center bg-input border border-border rounded p-0.5">
              {(
                [
                  ["active", t("statusActive")],
                  ["archived", t("statusArchived")],
                  ["all", t("statusAll")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setStatus(value);
                    setSelected(new Set());
                  }}
                  className={`px-3 py-1 text-sm rounded transition-colors ${
                    status === value
                      ? "bg-blue-600 text-white"
                      : "text-content-muted hover:text-content-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {sessions.length > 0 && (
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="px-2 py-1 text-xs text-content-muted hover:text-content-primary"
                >
                  {allSelected ? t("deselectAll") : t("selectAll")}
                </button>
              )}
              {selected.size > 0 && (
                <>
                  <span className="text-xs text-content-muted">
                    {t("selectedCount", { n: String(selected.size) })}
                  </span>
                  {status !== "archived" && (
                    <button
                      type="button"
                      onClick={bulkArchive}
                      className="px-2 py-1 text-xs rounded border border-border hover:bg-hover-2"
                    >
                      {t("archive")}
                    </button>
                  )}
                  {status !== "active" && (
                    <button
                      type="button"
                      onClick={bulkUnarchive}
                      className="px-2 py-1 text-xs rounded border border-border hover:bg-hover-2"
                    >
                      {t("unarchive")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const rows = sessions.filter((s) => selected.has(rowKey(s)));
                      if (rows.length) setConfirm({ mode: "bulk", rows });
                    }}
                    className="px-2 py-1 text-xs rounded border border-red-500/30 text-red-300 hover:bg-red-900/20"
                  >
                    {t("delete")}
                  </button>
                </>
              )}
              <select
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                className="bg-input border border-border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none max-w-[200px]"
              >
                <option value="all">{t("allWorkspaces")}</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name || w.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-panel">
            <div className="shrink-0 border-b border-border px-4 py-2.5">
              <div className="text-sm font-medium text-content-primary">
                {workspace === "all"
                  ? t("allWorkspaces")
                  : workspaceMap.get(workspace)?.name || workspace}
              </div>
              <div className="text-xs text-content-muted mt-0.5">
                {t("sessionsInView", { n: String(sessions.length) })}
                {workspace !== "all" ? ` · ${t("isolatedToWorkspace")}` : ""}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-panel text-left text-content-muted border-b border-border">
                  <tr>
                    <th className="w-10 px-3 py-2 font-normal">
                      <input
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected;
                        }}
                        type="checkbox"
                        className="h-4 w-4 accent-blue-600"
                        checked={allSelected}
                        disabled={!sessions.length}
                        onChange={toggleSelectAll}
                        aria-label={t("selectAll")}
                      />
                    </th>
                    <th className="px-2 py-2 font-normal">{t("sessionTitle")}</th>
                    <th className="px-2 py-2 font-normal">{t("workspace")}</th>
                    <th className="px-2 py-2 font-normal">{t("status")}</th>
                    <th className="px-2 py-2 font-normal text-right">{t("size")}</th>
                    <th className="px-2 py-2 font-normal">{t("updated")}</th>
                    <th className="px-2 py-2 font-normal text-right">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-content-muted">
                        {loading ? t("scanning") : t("noSessions")}
                      </td>
                    </tr>
                  ) : (
                    sessions.map((row) => {
                      const key = rowKey(row);
                      const ws = workspaceMap.get(row.workspaceId);
                      const busy = busyId === key;
                      return (
                        <tr
                          key={key}
                          className="border-b border-border/50 hover:bg-hover"
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-blue-600"
                              checked={selected.has(key)}
                              onChange={() => toggleSelect(row)}
                            />
                          </td>
                          <td className="px-2 py-2 max-w-[280px]">
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <button
                                type="button"
                                className="truncate text-left font-medium text-content-primary hover:text-blue-400 hover:underline"
                                title={row.title || t("openPreview")}
                                onClick={() => openPreview(row)}
                              >
                                {row.title || row.id}
                              </button>
                              <span className="truncate font-mono text-[10px] text-content-muted" title={row.id}>
                                {row.id}
                              </span>
                              {row.workDir && (
                                <span
                                  className="truncate font-mono text-[10px] text-content-muted/80"
                                  title={row.workDir}
                                >
                                  {row.workDir}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-2 max-w-[160px]">
                            <span className="truncate text-sm text-content-muted">
                              {ws?.name || row.workspaceId}
                            </span>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {row.status === "archived" ? (
                              <span className="rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-xs">
                                {t("statusArchived")}
                              </span>
                            ) : (
                              <span className="rounded-md bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-xs">
                                {t("statusActive")}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-content-muted">
                            {fmtBytes(row.bytes)}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap tabular-nums text-content-muted">
                            {fmtTime(parseTime(row.updatedAt), locale)}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              {row.status === "active" ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => onArchive(row)}
                                  title={t("archive")}
                                  className="px-2 py-1 text-xs rounded border border-border hover:bg-hover-2 disabled:opacity-50"
                                >
                                  {t("archive")}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => onUnarchive(row)}
                                  title={t("unarchive")}
                                  className="px-2 py-1 text-xs rounded border border-border hover:bg-hover-2 disabled:opacity-50"
                                >
                                  {t("unarchive")}
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirm({ mode: "one", row })}
                                title={t("delete")}
                                className="px-2 py-1 text-xs rounded border border-red-500/30 text-red-300 hover:bg-red-900/20 disabled:opacity-50"
                              >
                                {t("delete")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Attribution */}
      <div className="text-xs text-content-muted pb-2">
        {data?.home && <>{data.home}</>}
        <br />
        会话管理功能基于{" "}
        <button
          type="button"
          onClick={() => openUrl("https://github.com/JochenYang/kimicode-dashboard")}
          className="text-blue-500 hover:text-blue-400 underline bg-transparent p-0 border-0 cursor-pointer"
        >
          kimicode-dashboard
        </button>{" "}
        （MIT，© JochenYang）移植
      </div>

      {/* Confirm dialog */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-panel shadow-xl">
            <div className="space-y-3 p-5">
              <h3 className="text-base font-semibold text-content-primary">
                {confirm.mode === "bulk"
                  ? t("confirmBulkTitle")
                  : confirm.mode === "workspace"
                    ? t("confirmDeleteWorkspaceTitle")
                    : t("confirmDeleteTitle")}
              </h3>
              <p className="text-sm text-content-muted">
                {confirm.mode === "bulk"
                  ? t("confirmBulkDelete", { n: String(confirm.rows.length) })
                  : confirm.mode === "workspace"
                    ? t("confirmDeleteWorkspace")
                    : t("confirmDeleteSession")}
              </p>
              {confirm.mode === "one" && (
                <div className="rounded-md border border-border bg-input px-3 py-2.5">
                  <div className="truncate text-sm font-medium">
                    {confirm.row.title || confirm.row.id}
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px] text-content-muted">
                    {confirm.row.id}
                  </div>
                </div>
              )}
              {confirm.mode === "bulk" && (
                <div className="rounded-md border border-border bg-input px-3 py-2.5 text-sm text-content-muted">
                  {t("selectedCount", { n: String(confirm.rows.length) })}
                </div>
              )}
              {confirm.mode === "workspace" && (
                <div className="rounded-md border border-border bg-input px-3 py-2.5">
                  <div className="truncate text-sm font-medium">
                    {confirm.workspace.name || confirm.workspace.id}
                  </div>
                  {confirm.workspace.root && (
                    <div className="mt-1 break-all font-mono text-[11px] text-content-muted">
                      {confirm.workspace.root}
                    </div>
                  )}
                  <div className="mt-1 font-mono text-[11px] text-content-muted">
                    {confirm.workspace.id}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border bg-footer px-5 py-3">
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => setConfirm(null)}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-hover-2 disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                onClick={runConfirm}
                className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
              >
                {confirmBusy
                  ? t("refreshing")
                  : confirm.mode === "workspace"
                    ? t("deleteWorkspace")
                    : t("deleteForever")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview dialog */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex w-full max-w-2xl max-h-[min(80vh,36rem)] flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-xl">
            <div className="shrink-0 space-y-2 border-b border-border p-5">
              <h3 className="text-base font-semibold text-content-primary">{t("previewTitle")}</h3>
              <p className="text-sm text-content-muted">{t("previewHint")}</p>
              <div className="text-xs text-content-muted">
                <div className="truncate font-medium text-content-primary">
                  {preview.row.title || preview.row.id}
                </div>
                <div className="mt-0.5 break-all font-mono opacity-80">{preview.row.id}</div>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {preview.loading && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-content-muted">
                  <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                  {t("scanning")}
                </div>
              )}
              {preview.error && (
                <div className="rounded-md border border-red-500/40 bg-red-900/20 px-3 py-2 text-sm text-red-300">
                  {preview.error}
                </div>
              )}
              {!preview.loading && !preview.error && !preview.messages.length && (
                <div className="py-10 text-center text-sm text-content-muted">{t("previewEmpty")}</div>
              )}
              {preview.messages.map((m, i) => {
                const roleLabel =
                  m.role === "user"
                    ? t("roleUser")
                    : m.role === "assistant"
                      ? t("roleAssistant")
                      : m.role === "system"
                        ? t("roleSystem")
                        : m.role;
                return (
                  <PreviewMessageCard
                    key={`${m.role}-${i}`}
                    role={m.role}
                    roleLabel={roleLabel}
                    time={m.time}
                    text={m.text}
                    locale={locale}
                  />
                );
              })}
              {preview.truncated && (
                <div className="text-center text-xs text-content-muted">{t("previewTruncated")}</div>
              )}
            </div>
            <div className="shrink-0 flex justify-end border-t border-border bg-footer px-5 py-3">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-hover-2"
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Per-message card with 500-char collapse + expand toggle.
// Renders long texts lazily — prevents huge <pre> blocks from bloating the DOM.
const PREVIEW_TEXT_LIMIT = 500;

function PreviewMessageCard({
  role,
  roleLabel,
  time,
  text,
  locale,
}: {
  role: string;
  roleLabel: string;
  time: number | null;
  text: string;
  locale: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > PREVIEW_TEXT_LIMIT;
  const visible = expanded || !isLong ? text : text.slice(0, PREVIEW_TEXT_LIMIT);

  return (
    <div
      className={`rounded-lg border border-border px-3 py-2.5 ${
        role === "user"
          ? "bg-blue-600/10"
          : role === "assistant"
            ? "bg-input"
            : "bg-panel"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-content-muted">
        <span className="font-medium text-content-primary">{roleLabel}</span>
        {time ? (
          <span className="tabular-nums">{fmtTime(time, locale)}</span>
        ) : null}
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-content-primary">
        {visible}
        {!expanded && isLong && (
          <span className="text-content-muted"> …</span>
        )}
      </pre>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-blue-400 hover:text-blue-300 hover:underline"
        >
          {expanded
            ? `收起 · ${text.length.toLocaleString()} 字符`
            : `展开全文 · ${text.length.toLocaleString()} 字符`}
        </button>
      )}
    </div>
  );
}
