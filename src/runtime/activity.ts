// Pi events stay server-side; only allowlisted operational labels cross the UI boundary.
import type { AgentEvent, SubmissionRecord } from "@earendil-works/pi-durable";
import type { TurnActivity, ActivityStep } from "./contracts.ts";

// Never display arbitrary provider errors, arguments, output, reasoning or credentials.
const TOOL_LABELS: Record<string, string> = {
  web_research: "Research the web",
  open_repository: "Open repository",
  list_repository_files: "List repository files",
  read_repository_file: "Read repository file",
  search_repository: "Search repository",
  create_visual: "Create visual explainer",
  create_github_issue: "Prepare GitHub issue approval",
  create_github_file_change: "Prepare GitHub file approval",
  get_github_actions: "Check GitHub action status",
  recall_learning: "Recall saved public notes",
  read_saved_source: "Read saved evidence",
};

/** Per-session operational journal; canonical answers/tasks remain in Pi's own tables.
 * Rows belong to input submission IDs, not whichever message happens to be newest.
 */
export class ActivityJournal {
  private active: string[] = [];
  /** Input: this session's SQLite storage. Output: initialized additive activity table.
   * What this function does: preserves reload/eviction history without changing DO identities or migrations.
   */
  constructor(private sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS learning_activity (
      id TEXT PRIMARY KEY, entry_id TEXT, status TEXT NOT NULL, data TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS learning_activity_entry ON learning_activity(entry_id);`);
  }
  /** Input: submission ID. Output: retained row or a queued placeholder.
   * What this function does: resolves stable activity identity without reading private conversation content.
   */
  private get(id: string): TurnActivity {
    const row = this.sql
      .exec<{
        data: string;
      }>("SELECT data FROM learning_activity WHERE id=?", id)
      .toArray()[0];
    return row ? JSON.parse(row.data) : { id, status: "queued", steps: [] };
  }
  /** Input: sanitized activity. Output: persisted row.
   * What this function does: atomically stores the bounded journal and its message association.
   */
  private save(turn: TurnActivity) {
    this.sql.exec(
      "INSERT INTO learning_activity VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET entry_id=excluded.entry_id,status=excluded.status,data=excluded.data",
      turn.id,
      turn.entryId ?? null,
      turn.status,
      JSON.stringify(turn),
    );
  }
  /** Input: a committed Pi submission. Output: updated turn lifecycle.
   * What this function does: attaches the actual input entry ID; never infers ownership from message order.
   */
  submission(record: SubmissionRecord) {
    if (record.type !== "input") return;
    const turn = this.get(String(record.id));
    if (
      (turn.status === "done" || turn.status === "interrupted") &&
      (record.status === "placed" || record.status === "queued")
    )
      return;
    turn.entryId =
      record.entry === undefined ? undefined : String(record.entry);
    turn.status =
      record.status === "placed"
        ? "running"
        : record.status === "unanswered"
          ? "interrupted"
          : record.status;
    if (record.status === "done" || record.status === "unanswered") {
      for (const step of turn.steps)
        if (step.status === "running" || step.status === "queued")
          step.status =
            record.status === "done" && step.status === "running"
              ? "done"
              : "interrupted";
    }
    this.save(turn);
  }
  /** Input: stable event key, static label and status. Output: per-active-input journal update.
   * What this function does: coalesces token updates, bounds history to 80 steps and preserves tool identity.
   */
  private step(id: string, label: string, status: ActivityStep["status"]) {
    for (const input of this.active) {
      const turn = this.get(input);
      const existing = turn.steps.find((step) => step.id === id);
      if (existing?.status === status && existing.label === label) continue;
      // A late live snapshot must not turn a settled submission back into ongoing work.
      if (
        (turn.status === "done" || turn.status === "interrupted") &&
        (status === "running" || status === "queued")
      )
        continue;
      if (existing) {
        existing.status = status;
        existing.label = label;
      } else
        turn.steps.push({ id, label, status, at: new Date().toISOString() });
      if (turn.steps.length > 80) {
        turn.steps = turn.steps.slice(-80);
        turn.truncated = true;
      }
      this.save(turn);
    }
  }
  /** Input: ordered Pi event batch. Output: sanitized durable progress.
   * What this function does: ignores content-bearing events and records lifecycle/tool/retry/compaction summaries only.
   */
  record(events: readonly AgentEvent[]) {
    for (const event of events) {
      switch (event.type) {
        case "submission":
          this.submission(event.record);
          break;
        case "run_start":
          this.active = event.inputs.map(String);
          this.step("started", "Agent started", "done");
          break;
        case "snapshot":
          this.active = event.run?.inputs.map(String) ?? [];
          if (this.active.length) this.step("started", "Agent started", "done");
          for (const tool of event.tools) {
            const result = event.entries
              .find((entry) => entry.id === tool.entry)
              ?.model?.find((message) => message.role === "toolResult");
            // A finished slot is not necessarily a successful tool. Recover its committed result flag.
            const status =
              tool.status === "pending"
                ? "queued"
                : tool.status === "running"
                  ? "running"
                  : result
                    ? result.isError
                      ? "error"
                      : "done"
                    : "interrupted";
            this.step(
              `tool:${tool.callId}`,
              TOOL_LABELS[tool.name] ?? "Run agent tool",
              status,
            );
          }
          if (event.generation)
            this.step(
              "generation",
              event.generation.retry
                ? "Waiting to retry model"
                : "Generating response",
              "running",
            );
          break;
        case "run_end":
          this.active = [];
          break;
        case "turn_start":
          this.step("generation", "Generating response", "running");
          break;
        case "message_update":
          if (event.changes.some((change) => change.type === "text_delta"))
            this.step("generation", "Writing response", "running");
          break;
        case "tool_execution_start":
          this.step(
            `tool:${event.toolCallId}`,
            TOOL_LABELS[event.toolName] ?? "Run agent tool",
            "running",
          );
          break;
        case "tool_execution_end": {
          const failed =
            (!event.entry && !event.result) ||
            event.entry?.model?.some(
              (message) => message.role === "toolResult" && message.isError,
            ) ||
            event.result?.isError;
          this.step(
            `tool:${event.toolCallId}`,
            TOOL_LABELS[event.toolName] ?? "Run agent tool",
            failed ? "error" : "done",
          );
          break;
        }
        case "auto_retry_start":
          this.step(
            `retry:${event.attempt}`,
            "Model retry scheduled",
            "running",
          );
          break;
        case "auto_retry_end":
          this.step(`retry:${event.attempt}`, "Model retry finished", "done");
          break;
        case "deferred_poll":
          this.step("deferred", "Waiting for model response", "running");
          break;
        case "compaction_start":
          this.step(
            `compact:${event.taskId}`,
            "Summarizing conversation context",
            "running",
          );
          break;
        case "compaction_end":
          this.step(
            `compact:${event.taskId}`,
            "Summarize conversation context",
            event.error ? "error" : "done",
          );
          break;
        case "task_failed":
          this.step(
            `failure:${event.taskId}`,
            "Agent task interrupted",
            "error",
          );
          break;
      }
    }
  }
  /** Input: visible entry IDs and whether this is the current page. Output: relevant journals only.
   * What this function does: pages completed turns with history and includes queued/running work for live updates.
   */
  list(entryIds: string[], includeActive: boolean): TurnActivity[] {
    const placeholders = entryIds.map(() => "?").join(",") || "NULL";
    return this.sql
      .exec<{ data: string }>(
        `SELECT data FROM learning_activity WHERE entry_id IN (${placeholders}) ${includeActive ? "OR status IN ('queued','running')" : ""} ORDER BY rowid LIMIT 200`,
        ...entryIds,
      )
      .toArray()
      .map((row) => JSON.parse(row.data));
  }
}
