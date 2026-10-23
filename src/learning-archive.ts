// Original archive binding and row converters stay available for migration, review and explicit deletion.
import { DurableObject } from 'cloudflare:workers';
import type { LearningGuide, LearningSessionMetadata } from './lib/learning-session.ts';
import {
  boundedJson,
  eventFromRow,
  MAX_ARCHIVE_SESSIONS,
  nowIso,
  parseJson,
  sessionSummary,
  type EventRow,
  type LearningArchiveEventType,
  type LearningArchiveSessionDetail,
  type LearningArchiveSessionSummary,
  type SessionRow,
} from './lib/learning-archive.ts';

type ArchiveEnv = CloudflareBindings & {
  LEARNING_ARCHIVE: DurableObjectNamespace<LearningArchive>;
};

/** Historical SQL archive. New Pi sessions do not use its write methods; migration reads and deletion purges it. */
export class LearningArchive extends DurableObject<ArchiveEnv> {
  /** Input: Cloudflare context/bindings. Output: initialized historical tables/indexes.
   * What this function does: blocks concurrent startup access until schema creation completes.
   */
  constructor(ctx: DurableObjectState, env: ArchiveEnv) {
    super(ctx, env);
    /** Input: first object activation. Output: initialized legacy SQL tables.
     * What this function does: finishes schema setup before this historical archive accepts concurrent requests.
     */
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          repository TEXT NOT NULL,
          repository_url TEXT NOT NULL,
          default_branch TEXT NOT NULL,
          commit_sha TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          status TEXT NOT NULL,
          title TEXT,
          subtitle TEXT,
          guide_json TEXT,
          issue_count INTEGER NOT NULL DEFAULT 0,
          last_event_at TEXT NOT NULL,
          public_deleted_at TEXT
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          type TEXT NOT NULL,
          created_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS events_session_created_idx ON events (session_id, created_at)');
      this.ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS sessions_last_event_idx ON sessions (last_event_at)');
    });
  }

  /** Input: historical session metadata. Output: summary and created event.
   * What this function does: preserves the original archive write interface; no current route calls it.
   */
  recordSessionCreated(metadata: LearningSessionMetadata): void {
    const createdAt = metadata.createdAt || nowIso();
    this.ctx.storage.sql.exec(
      `INSERT INTO sessions (id, repository, repository_url, default_branch, commit_sha, created_at, expires_at, status, last_event_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         repository = excluded.repository,
         repository_url = excluded.repository_url,
         default_branch = excluded.default_branch,
         commit_sha = excluded.commit_sha,
         expires_at = excluded.expires_at,
         status = excluded.status,
         last_event_at = excluded.last_event_at`,
      metadata.id,
      metadata.repository,
      metadata.repositoryUrl,
      metadata.defaultBranch,
      metadata.commitSha,
      createdAt,
      metadata.expiresAt,
      metadata.status,
      createdAt,
    );
    this.recordEvent(metadata.id, 'created', createdAt, { metadata });
  }

  /** Input: historical assistant turn. Output: archive summary/event.
   * What this function does: records legacy general conversations without replacing an existing title.
   */
  recordAssistantTurn(input: { conversationId: string; prompt: string; answer: string; route: string; createdAt?: string }): void {
    const at = input.createdAt || nowIso();
    const title = input.prompt.length <= 120 ? input.prompt : `${input.prompt.slice(0, 119).trim()}…`;
    this.ctx.storage.sql.exec(
      `INSERT INTO sessions (id, repository, repository_url, default_branch, commit_sha, created_at, expires_at, status, title, subtitle, last_event_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         title = COALESCE(sessions.title, excluded.title),
         subtitle = excluded.subtitle,
         last_event_at = excluded.last_event_at`,
      input.conversationId,
      `Assistant: ${input.route.replace(/_/g, ' ')}`,
      '/chat',
      input.route,
      input.conversationId,
      at,
      at,
      'ready',
      title,
      'General assistant conversation',
      at,
    );
    this.recordEvent(input.conversationId, 'assistant_turn', at, { prompt: input.prompt, answer: input.answer, route: input.route });
  }

  /** Input: metadata and guide. Output: ready archive record.
   * What this function does: stores historical guide JSON and a publication event.
   */
  recordGuidePublished(metadata: LearningSessionMetadata, guide: LearningGuide): void {
    const at = nowIso();
    this.ctx.storage.sql.exec(
      `UPDATE sessions SET status = ?, title = ?, subtitle = ?, guide_json = ?, last_event_at = ? WHERE id = ?`,
      'ready',
      guide.title,
      guide.subtitle,
      JSON.stringify(guide),
      at,
      metadata.id,
    );
    this.recordEvent(metadata.id, 'guide_published', at, { title: guide.title, sectionCount: guide.sections.length });
  }

  /** Input: selected evidence, question and answer. Output: follow-up event.
   * What this function does: appends historical tutor exchanges to the archive timeline.
   */
  recordFollowup(input: { sessionId: string; question: string; selectedText?: string; sectionTitle?: string; answer: string }): void {
    const at = nowIso();
    this.ctx.storage.sql.exec('UPDATE sessions SET last_event_at = ? WHERE id = ?', at, input.sessionId);
    this.recordEvent(input.sessionId, 'followup', at, {
      question: input.question,
      selectedText: input.selectedText,
      sectionTitle: input.sectionTitle,
      answer: input.answer,
    });
  }

  /** Input: session and draft. Output: historical draft event.
   * What this function does: saves copyable text; it never publishes to a social network.
   */
  recordShareDraft(sessionId: string, draft: unknown): void {
    const at = nowIso();
    this.ctx.storage.sql.exec('UPDATE sessions SET last_event_at = ? WHERE id = ?', at, sessionId);
    this.recordEvent(sessionId, 'share_draft', at, draft);
  }

  /** Input: historical confirmed issue receipt. Output: issue count/event.
   * What this function does: records evidence of an already-completed action, not a new GitHub request.
   */
  recordIssueCreated(input: { sessionId: string; title: string; issueUrl: string; number?: number; evidencePaths?: string[] }): void {
    const at = nowIso();
    this.ctx.storage.sql.exec('UPDATE sessions SET issue_count = issue_count + 1, last_event_at = ? WHERE id = ?', at, input.sessionId);
    this.recordEvent(input.sessionId, 'issue_created', at, input);
  }

  /** Input: historical branch/file receipt. Output: file-change event.
   * What this function does: records an already-completed action for old review pages.
   */
  recordFileChangeCreated(input: { sessionId: string; path: string; branch: string; commitUrl?: string; contentUrl?: string }): void {
    const at = nowIso();
    this.ctx.storage.sql.exec('UPDATE sessions SET last_event_at = ? WHERE id = ?', at, input.sessionId);
    this.recordEvent(input.sessionId, 'file_change_created', at, input);
  }

  /** Input: session and historical removal reason. Output: deletion/expiry event.
   * What this function does: marks old public-page removal without erasing the archive itself.
   */
  recordPublicDeleted(sessionId: string, reason: 'deleted' | 'expired' = 'deleted'): void {
    const at = nowIso();
    this.ctx.storage.sql.exec('UPDATE sessions SET public_deleted_at = ?, last_event_at = ? WHERE id = ?', at, at, sessionId);
    this.recordEvent(sessionId, reason === 'expired' ? 'expired' : 'public_deleted', at, { reason });
  }

  /** Input: permanently deleted session ID. Output: archive rows removed.
   * What this function does: deletes events and summary in one local transaction.
   */
  purgeSession(id: string): void {
    /** Input: the confirmed session ID. Output: deleted archive rows.
     * What this function does: removes session metadata and events together, leaving unrelated archives intact.
     */
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM events WHERE session_id = ?', id);
      this.ctx.storage.sql.exec('DELETE FROM sessions WHERE id = ?', id);
    });
  }

  /** Input: requested limit. Output: bounded recent summaries.
   * What this function does: retains historical listing behavior; the live Library is a different object.
   */
  listSessions(limit = 100): LearningArchiveSessionSummary[] {
    const boundedLimit = Math.min(Math.max(Math.floor(limit) || 100, 1), MAX_ARCHIVE_SESSIONS);
    return this.ctx.storage.sql.exec<SessionRow>(
      'SELECT * FROM sessions ORDER BY last_event_at DESC LIMIT ?',
      boundedLimit,
    ).toArray().map(sessionSummary);
  }

  /** Input: session ID. Output: summary, optional guide and ordered events, or null.
   * What this function does: supplies migration and fallback review with original archive evidence.
   */
  getSession(sessionId: string): LearningArchiveSessionDetail | null {
    const row = this.ctx.storage.sql.exec<SessionRow>('SELECT * FROM sessions WHERE id = ?', sessionId).toArray()[0];
    if (!row) return null;
    const events = this.ctx.storage.sql.exec<EventRow>(
      'SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC, id ASC',
      sessionId,
    ).toArray().map(eventFromRow);
    const guide = row.guide_json ? parseJson(row.guide_json) as LearningGuide : undefined;
    return { ...sessionSummary(row), ...(guide ? { guide } : {}), events };
  }

  /** Input: event identity/time/payload. Output: inserted bounded event.
   * What this function does: centralizes the historical timeline's SQL write shape.
   */
  private recordEvent(sessionId: string, type: LearningArchiveEventType, createdAt: string, payload: unknown): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO events (session_id, type, created_at, payload_json) VALUES (?, ?, ?, ?)',
      sessionId,
      type,
      createdAt,
      boundedJson(payload),
    );
  }
}
