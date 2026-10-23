import { DurableObject } from "cloudflare:workers";
import { decodeConfiguredMessage } from "../lib/configured-message.ts";
import type { Message } from "./contracts.ts";

/** Keep the original class identities/bindings, but never run Flue or replay tools.
 * All original tables remain untouched and can be exported during the rollback window. */
class LegacyReader extends DurableObject<CloudflareBindings> {
  identity(): string | null {
    if (
      !this.ctx.storage.sql
        .exec(
          "SELECT name FROM sqlite_master WHERE name='flue_conversation_streams'",
        )
        .toArray().length
    )
      return null;
    return (
      this.ctx.storage.sql
        .exec<{
          identity_json: string;
        }>("SELECT identity_json FROM flue_conversation_streams LIMIT 1")
        .toArray()[0]?.identity_json ?? null
    );
  }
  exportPage(after = 0) {
    if (
      !this.ctx.storage.sql
        .exec(
          "SELECT name FROM sqlite_master WHERE name='flue_conversation_stream_batches'",
        )
        .toArray().length
    )
      return JSON.stringify({ rows: [] });
    const rows = this.ctx.storage.sql
      .exec<{
        rowid: number;
        path: string;
        seq: number;
        data: string;
      }>(
        "SELECT rowid,path,seq,data FROM flue_conversation_stream_batches WHERE rowid>? ORDER BY rowid LIMIT 50",
        after,
      )
      .toArray();
    return JSON.stringify({
      rows: rows.map((row) => {
        let data = row.data;
        if (data.startsWith("{")) {
          const count = JSON.parse(data).$flueChunkCount;
          const chunks = this.ctx.storage.sql
            .exec<{
              data: string;
            }>(
              "SELECT data FROM flue_conversation_stream_batch_chunks WHERE path=? AND seq=? ORDER BY chunk_index",
              row.path,
              row.seq,
            )
            .toArray();
          if (chunks.length !== count)
            throw new Error("Legacy chunk count mismatch");
          data = chunks.map((chunk) => chunk.data).join("");
        }
        return {
          ...row,
          records: JSON.parse(data) as Record<string, unknown>[],
          data: undefined,
        };
      }),
      next: rows.length === 50 ? rows.at(-1)!.rowid : undefined,
    });
  }
  /** Only called for an explicitly confirmed permanent session deletion. */
  async purge() {
    await this.ctx.storage.deleteAlarm();
    const tables = this.ctx.storage.sql
      .exec<{
        name: string;
      }>("SELECT name FROM sqlite_master WHERE type='table'")
      .toArray();
    for (const { name } of tables)
      if (
        name.startsWith("flue_") ||
        name.startsWith("cf_agents_") ||
        name.startsWith("cf_agent_")
      )
        this.ctx.storage.sql.exec(
          `DELETE FROM "${name.replaceAll('"', '""')}"`,
        );
    const keys = await this.ctx.storage.list();
    if (keys.size) await this.ctx.storage.delete([...keys.keys()]);
  }
  async alarm() {
    await this.ctx.storage.deleteAlarm();
  }
}
export class FlueIphoneAssistantAgent extends LegacyReader {}
export class FlueGithubLearningAgent extends LegacyReader {}

/** Import only visible text; keep tool history/reasoning in the read-only original.
 * Called over all pages so a text block spanning batches is reconstructed correctly. */
export function projectLegacyMessages(
  records: Record<string, unknown>[],
): Message[] {
  const result: Message[] = [];
  const pending = new Map<
    string,
    { createdAt?: string; blocks: Map<string, string> }
  >();
  const seen = new Set<string>();
  for (const record of records) {
    if (typeof record.id === "string") {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
    }
    const id = String(record.messageId ?? record.id);
    if (record.type === "user_message") {
      const value = record.content;
      const text =
        typeof value === "string"
          ? value
          : Array.isArray(value)
            ? value
                .flatMap((p) => (p?.type === "text" ? [p.text] : []))
                .join("\n")
            : "";
      if (text)
        result.push({
          id,
          role: "user",
          content: decodeConfiguredMessage(text)?.prompt ?? text,
          createdAt: String(record.timestamp ?? ""),
        });
    } else if (record.type === "assistant_message_started") {
      pending.set(id, {
        createdAt: String(record.timestamp ?? ""),
        blocks: new Map(),
      });
    } else if (record.type === "assistant_text_delta") {
      const entry = pending.get(id);
      if (entry && typeof record.delta === "string")
        entry.blocks.set(
          String(record.blockId),
          (entry.blocks.get(String(record.blockId)) ?? "") + record.delta,
        );
    } else if (record.type === "assistant_message_completed") {
      const entry = pending.get(id);
      const content = entry ? [...entry.blocks.values()].join("\n") : "";
      if (content)
        result.push({
          id,
          role: "assistant",
          content,
          createdAt: entry?.createdAt,
        });
      pending.delete(id);
    }
  }
  return result;
}
