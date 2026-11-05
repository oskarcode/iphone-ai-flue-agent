// Pi events stay server-side; only allowlisted operational labels cross the UI boundary.
import type { AgentEvent, SubmissionRecord } from "@earendil-works/pi-durable";
import type { TurnActivity, ActivityStep } from "./contracts.ts";
import { routingLabel, type RoutingDecision } from "./routing-label.ts";

// Never display arbitrary provider errors, arguments, output, reasoning or credentials.
const TOOL_LABELS: Record<string, string> = {
  list_skills: "Listing saved skills",
  read_skill: "Reading a saved skill",
  run_learning_coach: "Reviewing learning across sessions",
  list_learning_sessions: "Finding learning sessions",
  read_learning_session: "Reading committed lesson entries",
  read_learning_message: "Reading a lesson excerpt",
  save_skill: "Preparing a skill change for approval",
  delete_skill: "Preparing skill removal for approval",
  computer_files: "Inspecting Computer files",
  read_computer_file: "Reading a Computer file",
  write_computer_file: "Preparing a file change for approval",
  delete_computer_path: "Preparing file removal for approval",
  run_computer_command: "Preparing a Computer command for approval",
  get_action_status: "Checking approved action results",
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
  read_saved_note: "Read saved note",
};

/** Model-supplied arguments are never surfaced except a validated public skill slug. */
function toolLabel(name: string, args?: Record<string, unknown>): string {
  const description = Object.hasOwn(TOOL_LABELS, name) ? TOOL_LABELS[name] : undefined;
  if (!description) return "Agent tool (name withheld)";
  const slug = args?.slug;
  const skill = name === "read_skill" && typeof slug === "string" &&
    slug.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ? ` /${slug}` : "";
  return `Tool · ${name}${skill} — ${description}`;
}

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
  /** Input: submission identity and server routing result; optional passive-entry ID. Output: durable routing step.
   * What this function does: prepends one truthful decision, preserves it on retries, and supports non-chat handoffs.
   */
  routing(id: string, decision?: RoutingDecision, entryId?: string) {
    const label = decision && !entryId
      ? `${routingLabel(decision)} → Pi tutor (tools selected by Pi)`
      : routingLabel(decision);
    const turn = this.get(id);
    if (turn.steps.some((step) => step.id === "routing")) return;
    if (entryId) {
      turn.entryId = entryId;
      turn.status = "done";
      turn.routingOnly = true;
    }
    turn.steps.unshift({
      id: "routing",
      label,
      status: "done",
      at: new Date().toISOString(),
    });
    if (turn.steps.length > 80) {
      turn.steps = [turn.steps[0], ...turn.steps.slice(-79)];
      turn.truncated = true;
    }
    this.save(turn);
  }
  /** A successful owner-scoped Computer lookup verifies the command exists; it does not claim the model read it. */
  skill(id: string, slug: string) {
    if (slug.length > 60 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return;
    const turn = this.get(id);
    if (turn.steps.some((step) => step.id === `skill:${slug}`)) return;
    turn.steps.splice(turn.steps[0]?.id === "routing" ? 1 : 0, 0, {
      id: `skill:${slug}`,
      label: `Skill command found · /${slug}`,
      status: "done",
      at: new Date().toISOString(),
    });
    this.save(turn);
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
        // Reconnection snapshots do not carry model-tool arguments. Keep an
        // earlier validated skill slug instead of replacing it with a generic label.
        if (!(id.startsWith("tool:") && existing.label.includes(" /")))
          existing.label = label;
      } else
        turn.steps.push({ id, label, status, at: new Date().toISOString() });
      if (turn.steps.length > 80) {
        const routing = turn.steps.find((step) => step.id === "routing");
        turn.steps = routing
          ? [
              routing,
              ...turn.steps.filter((step) => step.id !== "routing").slice(-79),
            ]
          : turn.steps.slice(-80);
        turn.truncated = true;
      }
      this.save(turn);
    }
  }
  /** Child conversations have their own event stream; report only allowlisted coach tool names into the parent turn. */
  childTool(name: string, taskId: string, status: ActivityStep["status"]) {
    if (!["list_learning_sessions", "read_learning_session", "read_learning_message"].includes(name))
      return;
    this.step(`coach-tool:${taskId}`, `Coach · ${toolLabel(name)}`, status);
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
              toolLabel(tool.name),
              status,
            );
          }
          if (event.generation)
            this.step(
              "generation",
              event.generation.retry
                ? "Waiting to retry model"
                : "Calling Pi model",
              "running",
            );
          break;
        case "run_end":
          this.active = [];
          break;
        case "turn_start":
          this.step("generation", "Calling Pi model", "running");
          break;
        case "message_update":
          if (event.changes.some((change) => change.type === "text_delta"))
            this.step("generation", "Writing response", "running");
          break;
        case "tool_execution_start":
          this.step(
            `tool:${event.toolCallId}`,
            toolLabel(event.toolName, event.args),
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
            toolLabel(event.toolName),
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
    // Durable Objects SQLite accepts at most 100 bound variables per statement.
    // Snapshot/export pages can contain 200 Pi entries (including tool/system entries),
    // so one unbounded IN clause would make a healthy conversation appear empty (502).
    const rows = new Map<number, string>();
    const add = (sql: string, params: string[] = []) => {
      for (const row of this.sql
        .exec<{ rowid: number; data: string }>(sql, ...params)
        .toArray())
        rows.set(row.rowid, row.data);
    };
    for (let index = 0; index < entryIds.length; index += 80) {
      const batch = entryIds.slice(index, index + 80);
      add(
        `SELECT rowid,data FROM learning_activity WHERE entry_id IN (${batch.map(() => "?").join(",")}) ORDER BY rowid LIMIT 200`,
        batch,
      );
    }
    if (includeActive)
      add(
        "SELECT rowid,data FROM learning_activity WHERE status IN ('queued','running') ORDER BY rowid LIMIT 200",
      );
    return [...rows]
      .sort(([a], [b]) => a - b)
      .slice(0, 200)
      .map(([, data]) => JSON.parse(data));
  }
}
