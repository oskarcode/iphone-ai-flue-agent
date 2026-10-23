import { DurableObject } from "cloudflare:workers";
import type { DirectoryItem, Note } from "./contracts.ts";

/** Rebuildable, owner-scoped index. Never the canonical conversation store. */
export class LearningLibrary extends DurableObject<CloudflareBindings> {
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    ctx.storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, version INTEGER NOT NULL, metadata TEXT NOT NULL, search_text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK(id=1), text TEXT NOT NULL, recall INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS notes (session_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session_id,id));`);
  }
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
  remove(id: string) {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO tombstones VALUES(?)",
        id,
      );
      this.ctx.storage.sql.exec("DELETE FROM notes WHERE session_id=?", id);
      this.ctx.storage.sql.exec("DELETE FROM sessions WHERE id=?", id);
    });
  }
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
  setPreferences(text: string, recall: boolean) {
    this.ctx.storage.sql.exec(
      "INSERT INTO preferences VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,recall=excluded.recall",
      text.slice(0, 4000),
      recall ? 1 : 0,
    );
  }
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
