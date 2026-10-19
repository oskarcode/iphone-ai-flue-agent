import type { LearningGuide, LearningSessionMetadata } from './learning-session.ts';

export const LEARNING_ARCHIVE_NAME = 'learning-archive';
export const MAX_ARCHIVE_SESSIONS = 200;
export const MAX_EVENT_PAYLOAD_CHARACTERS = 40_000;

export type LearningArchiveEventType = 'created' | 'assistant_turn' | 'guide_published' | 'followup' | 'share_draft' | 'issue_created' | 'file_change_created' | 'public_deleted' | 'expired' | 'failed';

export type LearningArchiveSessionSummary = {
  id: string;
  repository: string;
  repositoryUrl: string;
  defaultBranch: string;
  commitSha: string;
  createdAt: string;
  expiresAt: string;
  status: string;
  title?: string;
  subtitle?: string;
  issueCount: number;
  lastEventAt: string;
  publicDeletedAt?: string;
};

export type LearningArchiveEvent = {
  id: number;
  sessionId: string;
  type: LearningArchiveEventType;
  createdAt: string;
  payload: unknown;
};

export type LearningArchiveSessionDetail = LearningArchiveSessionSummary & {
  guide?: LearningGuide;
  events: LearningArchiveEvent[];
};

export type SessionRow = {
  id: string;
  repository: string;
  repository_url: string;
  default_branch: string;
  commit_sha: string;
  created_at: string;
  expires_at: string;
  status: string;
  title: string | null;
  subtitle: string | null;
  guide_json: string | null;
  issue_count: number;
  last_event_at: string;
  public_deleted_at: string | null;
};

export type EventRow = {
  id: number;
  session_id: string;
  type: LearningArchiveEventType;
  created_at: string;
  payload_json: string;
};

export type LearningArchiveRpc = {
  recordSessionCreated(metadata: LearningSessionMetadata): void | Promise<void>;
  recordAssistantTurn(input: { conversationId: string; prompt: string; answer: string; route: string; createdAt?: string }): void | Promise<void>;
  recordGuidePublished(metadata: LearningSessionMetadata, guide: LearningGuide): void | Promise<void>;
  recordFollowup(input: { sessionId: string; question: string; selectedText?: string; sectionTitle?: string; answer: string }): void | Promise<void>;
  recordShareDraft(sessionId: string, draft: unknown): void | Promise<void>;
  recordIssueCreated(input: { sessionId: string; title: string; issueUrl: string; number?: number; evidencePaths?: string[] }): void | Promise<void>;
  recordFileChangeCreated(input: { sessionId: string; path: string; branch: string; commitUrl?: string; contentUrl?: string }): void | Promise<void>;
  recordPublicDeleted(sessionId: string, reason?: 'deleted' | 'expired'): void | Promise<void>;
  listSessions(limit?: number): LearningArchiveSessionSummary[] | Promise<LearningArchiveSessionSummary[]>;
  getSession(sessionId: string): LearningArchiveSessionDetail | null | Promise<LearningArchiveSessionDetail | null>;
};

export type ArchiveBindingEnv = {
  LEARNING_ARCHIVE: DurableObjectNamespace;
};

export function nowIso() {
  return new Date().toISOString();
}

export function boundedJson(value: unknown): string {
  const json = JSON.stringify(value);
  return json.length > MAX_EVENT_PAYLOAD_CHARACTERS
    ? `${json.slice(0, MAX_EVENT_PAYLOAD_CHARACTERS)}...[truncated]`
    : json;
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function sessionSummary(row: SessionRow): LearningArchiveSessionSummary {
  return {
    id: row.id,
    repository: row.repository,
    repositoryUrl: row.repository_url,
    defaultBranch: row.default_branch,
    commitSha: row.commit_sha,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    ...(row.title ? { title: row.title } : {}),
    ...(row.subtitle ? { subtitle: row.subtitle } : {}),
    issueCount: row.issue_count,
    lastEventAt: row.last_event_at,
    ...(row.public_deleted_at ? { publicDeletedAt: row.public_deleted_at } : {}),
  };
}

export function eventFromRow(row: EventRow): LearningArchiveEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    createdAt: row.created_at,
    payload: parseJson(row.payload_json),
  };
}

export function learningArchiveStub(env: ArchiveBindingEnv) {
  return env.LEARNING_ARCHIVE.getByName(LEARNING_ARCHIVE_NAME) as DurableObjectStub & LearningArchiveRpc;
}

export async function tryArchive(operation: Promise<unknown> | unknown, context: Record<string, unknown>) {
  try {
    await operation;
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Learning archive write failed',
      ...context,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}
