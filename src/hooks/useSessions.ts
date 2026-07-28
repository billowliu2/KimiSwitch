import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ActionResponse,
  PreviewResult,
  SessionStatusFilter,
  SessionsResult,
} from "../types/sessions";

export function useSessions() {
  const [status, setStatus] = useState<SessionStatusFilter>("active");
  const [workspace, setWorkspace] = useState<string>("all");
  const [data, setData] = useState<SessionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<SessionsResult>("list_sessions", {
        status,
        workspace: workspace === "all" ? null : workspace,
      });
      setData(result);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [status, workspace]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const archiveSession = useCallback(
    async (workspaceId: string, sessionId: string) => {
      await invoke<ActionResponse>("archive_session", { workspaceId, sessionId });
      await refresh();
    },
    [refresh]
  );

  const unarchiveSession = useCallback(
    async (workspaceId: string, sessionId: string) => {
      await invoke<ActionResponse>("unarchive_session", {
        workspaceId,
        sessionId,
      });
      await refresh();
    },
    [refresh]
  );

  const deleteSession = useCallback(
    async (workspaceId: string, sessionId: string, sessionStatus?: string) => {
      await invoke<ActionResponse>("delete_session", {
        workspaceId,
        sessionId,
        status: sessionStatus ?? null,
      });
      await refresh();
    },
    [refresh]
  );

  const deleteWorkspace = useCallback(
    async (workspaceId: string) => {
      await invoke<ActionResponse>("delete_workspace", {
        workspaceId,
        confirm: true,
      });
      await refresh();
    },
    [refresh]
  );

  const getPreview = useCallback(
    async (workspaceId: string, sessionId: string, sessionStatus?: string) => {
      return invoke<PreviewResult>("get_session_preview", {
        workspaceId,
        sessionId,
        status: sessionStatus ?? null,
      });
    },
    []
  );

  return {
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
  };
}
