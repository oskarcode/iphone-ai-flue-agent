// Type-only imports describe retained evidence without loading clients in the browser bundle.
import type { GithubRepository } from "../tools/github-repository.ts";
import type { VisualExplainer } from "../lib/visual-session.ts";

// Access admission is the boundary for this single workspace; IDs are locators, never bearer credentials.
export const PERSONAL_OWNER = "personal";
export const SESSION_ID = /^[a-zA-Z0-9_-]{8,100}$/;
/** Canonical session identity, lifecycle flags, repository pin and current artifact preview. */
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
/** Sanitized visible entry; reasoning and tool traces are not UI messages. */
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};
/** Exact retained evidence with timestamp/privacy and SHA-256, stored independently of model context. */
export type Source = {
  id: string;
  title: string;
  createdAt: string;
  private: boolean;
  hash: string;
  content: string;
};
/** User-edited memory linked to a real entry in this session. */
export type Note = {
  id: string;
  text: string;
  entryId: string;
  createdAt: string;
  private: boolean;
};
/** Server-owned proposal state machine; uncertain means inspect GitHub before any repeat. */
export type Approval = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "executing" | "done" | "uncertain" | "rejected";
  result?: unknown;
  createdAt: string;
};
/** Allowlisted operational progress only: never raw reasoning, arguments, results or provider errors. */
export type ActivityStep = {
  id: string;
  label: string;
  status: "queued" | "running" | "done" | "error" | "interrupted";
  at: string;
};
/** One Pi input submission, associated with its committed user entry when placed. */
export type TurnActivity = {
  id: string;
  entryId?: string;
  status: "queued" | "running" | "done" | "interrupted";
  steps: ActivityStep[];
  truncated?: boolean;
};
/** Browser transport shape: recent visible history, live partial text and source metadata (not source bodies). */
export type SessionSnapshot = {
  metadata: SessionMetadata;
  messages: Message[];
  activity?: TurnActivity[];
  partial: string;
  busy: boolean;
  error?: string;
  sources: Omit<Source, "content">[];
  notes: Note[];
  approvals: Approval[];
  nextCursor?: string;
};
/** Rebuildable Library projection, intentionally smaller than canonical session metadata. */
export type DirectoryItem = Omit<SessionMetadata, "repository" | "visual"> & {
  repository?: string;
};
/** Input: canonical session metadata. Output: lightweight directory metadata.
 * What this function does: omits visual bodies and reduces repository context to its name for the Library.
 */
export function directoryItem(metadata: SessionMetadata): DirectoryItem {
  const { repository, visual: _visual, ...rest } = metadata;
  return {
    ...rest,
    ...(repository ? { repository: repository.fullName } : {}),
  };
}
/** Input: retained text. Output: hexadecimal SHA-256 digest.
 * What this function does: fingerprints evidence and retry payloads; this is integrity metadata, not encryption.
 */
export async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
