// Cloudflare supplies isolated SQL storage; contracts describe the rebuildable directory records.
import { DurableObject } from "cloudflare:workers";
import type { DirectoryItem, Note } from "./contracts.ts";

/** Rebuildable, owner-scoped index. Never the canonical conversation store. */
export class LearningLibrary extends DurableObject<CloudflareBindings> {
  /** Input: object context/bindings. Output: initialized directory tables.
   * What this function does: creates sessions, notes, preferences and permanent deletion tombstones.
   */
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    ctx.storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, version INTEGER NOT NULL, metadata TEXT NOT NULL, search_text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK(id=1), text TEXT NOT NULL, recall INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS notes (session_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session_id,id));`);
  }
  /** Input: session projection, revision, searchable text and notes. Output: atomic projection update.
   * What this function does: rejects tombstoned or older versions, then replaces that session's projected notes.
   */
  upsert(
    item: DirectoryItem,
    version: number,
    searchText: string,
    notes: Note[],
  ) {
    if (
      this.ctx.storage.sql
        .exec("SELECT id FROM tombstones WHERE id=?", item.id)
        .toArray().length
    )
      return;
    /** Input: one versioned projection. Output: atomically replaced session and notes.
     * What this function does: ignores an older revision and keeps its index row consistent with projected notes.
     */
    this.ctx.storage.transactionSync(() => {
      const rows = this.ctx.storage.sql
        .exec<{
          version: number;
        }>("SELECT version FROM sessions WHERE id=?", item.id)
        .toArray();
      if (rows.length && rows[0].version > version) return;
      this.ctx.storage.sql.exec(
        "INSERT INTO sessions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version, metadata=excluded.metadata, search_text=excluded.search_text",
        item.id,
        version,
        JSON.stringify(item),
        searchText.slice(0, 200_000),
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM notes WHERE session_id=?",
        item.id,
      );
      for (const note of notes)
        this.ctx.storage.sql.exec(
          "INSERT INTO notes VALUES(?,?,?)",
          item.id,
          note.id,
          JSON.stringify(note),
        );
    });
  }
  /** Input: literal query, archive filter and offset. Output: up to 50 directory items.
   * What this function does: escapes LIKE wildcards, sorts pinned/recent entries and detects a next page.
   */
  list(
    query = "",
    archived = false,
    offset = 0,
  ): { items: DirectoryItem[]; nextOffset?: number } {
    // Literal LIKE escaping: user input is never an FTS expression or SQL fragment.
    const term = `%${query.slice(0, 200).replace(/[\\%_]/g, "\\$&")}%`;
    const rows = this.ctx.storage.sql
      .exec<{ metadata: string }>(
        `SELECT metadata FROM sessions WHERE (search_text LIKE ? ESCAPE '\\' OR json_extract(metadata,'$.title') LIKE ? ESCAPE '\\')
       AND json_extract(metadata,'$.archived')=? ORDER BY json_extract(metadata,'$.pinned') DESC, json_extract(metadata,'$.updatedAt') DESC LIMIT 51 OFFSET ?`,
        term,
        term,
        archived ? 1 : 0,
        Math.max(0, offset),
      )
      .toArray();
    return {
      items: rows.slice(0, 50).map((row) => JSON.parse(row.metadata)),
      ...(rows.length > 50 ? { nextOffset: offset + 50 } : {}),
    };
  }
  /** Input: session ID. Output: directory/notes removed and tombstone retained.
   * What this function does: prevents delayed projection writes from resurrecting deleted sessions.
   */
  remove(id: string) {
    /** Input: deleted session ID. Output: a tombstone without directory content.
     * What this function does: atomically revokes future upserts and removes the corresponding notes and index row.
     */
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO tombstones VALUES(?)",
        id,
      );
      this.ctx.storage.sql.exec("DELETE FROM notes WHERE session_id=?", id);
      this.ctx.storage.sql.exec("DELETE FROM sessions WHERE id=?", id);
    });
  }
  /** Input: none. Output: preferences with recall disabled by default.
   * What this function does: reads the owner's one settings row.
   */
  preferences() {
    return (
      this.ctx.storage.sql
        .exec<{
          text: string;
          recall: number;
        }>("SELECT text,recall FROM preferences WHERE id=1")
        .toArray()[0] ?? { text: "", recall: 0 }
    );
  }
  /** Input: teaching text and recall flag. Output: saved settings.
   * What this function does: bounds text and stores the boolean as SQLite 0/1.
   */
  setPreferences(text: string, recall: boolean) {
    this.ctx.storage.sql.exec(
      "INSERT INTO preferences VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,recall=excluded.recall",
      text.slice(0, 4000),
      recall ? 1 : 0,
    );
  }
  /** Input: question and current session ID. Output: at most five public saved-note matches.
   * What this function does: requires opt-in, excludes current/private notes and uses literal keyword matching.
   */
  recall(query: string, excludeId: string) {
    if (!this.preferences().recall) return [];
    const words =
      query
        .toLowerCase()
        .match(/[a-z0-9]{4,}/g)
        ?.slice(0, 8) ?? [];
    if (!words.length) return [];
    const rows = this.ctx.storage.sql
      .exec<{
        session_id: string;
        data: string;
      }>(
        "SELECT session_id,data FROM notes WHERE session_id<>? LIMIT 1000",
        excludeId,
      )
      .toArray();
    return rows
      .map((row) => ({
        sessionId: row.session_id,
        note: JSON.parse(row.data) as Note,
      }))
      .filter(
        (row) =>
          !row.note.private &&
          words.some((word) => row.note.text.toLowerCase().includes(word)),
      )
      .slice(0, 5);
  }
}
