// Session management types — match Rust structs in dashboard.rs (camelCase serde)

export interface WorkspaceRow {
  id: string;
  name: string;
  root: string | null;
  createdAt: string | null;
  lastOpenedAt: string | null;
  activeCount: number;
  archivedCount: number;
  empty: boolean;
}

export interface SessionRow {
  id: string;
  workspaceId: string;
  status: "active" | "archived" | string;
  title: string | null;
  workDir: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  bytes: number;
  files: number;
}

export interface SessionsResult {
  home: string;
  archiveRoot: string;
  workspaces: WorkspaceRow[];
  sessions: SessionRow[];
}

export interface ActionResponse {
  ok: boolean;
  workspaceId: string;
  sessionId: string;
  status?: string | null;
  path?: string | null;
  deleted?: boolean | null;
}

export interface PreviewMessage {
  role: string;
  time: number | null;
  text: string;
}

export interface PreviewResult {
  workspaceId: string;
  sessionId: string;
  status: string;
  title: string | null;
  workDir: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  messageCount: number;
  truncated: boolean;
  messages: PreviewMessage[];
}

export type SessionStatusFilter = "active" | "archived" | "all";
