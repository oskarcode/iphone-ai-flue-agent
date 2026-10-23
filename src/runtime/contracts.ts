import type { GithubRepository } from "../tools/github-repository.ts";
import type { VisualExplainer } from "../lib/visual-session.ts";

export const PERSONAL_OWNER = "personal";
export const SESSION_ID = /^[a-zA-Z0-9_-]{8,100}$/;
export type SessionMetadata = {
  id: string;
  owner: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  type: "general" | "repository" | "visual";
  archived: boolean;
  pinned: boolean;
  private: boolean;
  repository?: GithubRepository;
  visual?: VisualExplainer;
  legacy?: {
    runtime: "flue";
    id: string;
    importedAt: string;
    complete: boolean;
    messageCount?: number;
    recordCount?: number;
  };
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};
export type Source = {
  id: string;
  title: string;
  createdAt: string;
  private: boolean;
  hash: string;
  content: string;
};
export type Note = {
  id: string;
  text: string;
  entryId: string;
  createdAt: string;
  private: boolean;
};
export type Approval = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "executing" | "done" | "uncertain" | "rejected";
  result?: unknown;
  createdAt: string;
};
export type SessionSnapshot = {
  metadata: SessionMetadata;
  messages: Message[];
  partial: string;
  busy: boolean;
  error?: string;
  sources: Omit<Source, "content">[];
  notes: Note[];
  approvals: Approval[];
  nextCursor?: string;
};
export type DirectoryItem = Omit<SessionMetadata, "repository" | "visual"> & {
  repository?: string;
};
export function directoryItem(metadata: SessionMetadata): DirectoryItem {
  const { repository, visual: _visual, ...rest } = metadata;
  return {
    ...rest,
    ...(repository ? { repository: repository.fullName } : {}),
  };
}
export async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
