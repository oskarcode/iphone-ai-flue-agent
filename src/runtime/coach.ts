// The coach wakes for committed learning activity or an explicit coach question; it does not poll or infer in the background.
import { DurableObject } from "cloudflare:workers";
import {
  COACH_INSTRUCTIONS,
  coachAnswer,
  type CoachObservation,
  type CoachTurn,
  type CoachView,
} from "../lib/coach.ts";
import { PERSONAL_OWNER } from "./contracts.ts";
import { grammarModelFromConfiguredModel } from "../lib/grammar-correction.ts";

/** Owner-scoped durable index plus on-demand teacher conversation. Session entries remain authoritative. */
export class LearningCoach extends DurableObject<CloudflareBindings> {
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    ctx.storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS coach_sessions (id TEXT PRIMARY KEY, last_entry INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS coach_observations (session_id TEXT NOT NULL, entry_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, private INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(session_id,entry_id));
      CREATE TABLE IF NOT EXISTS coach_turns (id TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS coach_state (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO coach_state VALUES(1,0,0);`);
  }
  private authorize(owner: string) {
    if (owner !== PERSONAL_OWNER) throw new Error("Session not found");
  }
  private revision() {
    return this.ctx.storage.sql
      .exec<{ revision: number }>("SELECT revision FROM coach_state WHERE id=1")
      .one().revision;
  }
  private paused() {
    return Boolean(
      this.ctx.storage.sql
        .exec<{ paused: number }>("SELECT paused FROM coach_state WHERE id=1")
        .one().paused,
    );
  }
  /** Existing cursor makes replay cheap; tombstones prohibit resurrection after session deletion. */
  cursor(owner: string, sessionId: string) {
    this.authorize(owner);
    const row = this.ctx.storage.sql
      .exec<{
        last_entry: number;
        deleted: number;
      }>("SELECT last_entry,deleted FROM coach_sessions WHERE id=?", sessionId)
      .toArray()[0];
    return {
      last: row?.last_entry ?? 0,
      deleted: Boolean(row?.deleted),
      paused: this.paused(),
    };
  }
  /** Input: current entry high-water while paused. Output: a baseline that prevents reset data from resurfacing. */
  baseline(owner: string, sessionId: string, last: number) {
    this.authorize(owner);
    if (
      !this.paused() ||
      !/^[\w-]{8,100}$/.test(sessionId) ||
      !Number.isSafeInteger(last) ||
      last < 0
    )
      return;
    this.ctx.storage.sql.exec(
      "INSERT INTO coach_sessions VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET last_entry=MAX(last_entry,excluded.last_entry)",
      sessionId,
      last,
    );
  }
  /** When a session becomes private, retract previously projected text and every answer that may mention it. */
  redact(owner: string, sessionId: string) {
    this.authorize(owner);
    if (!/^[\w-]{8,100}$/.test(sessionId))
      throw new Error("Invalid coach session");
    const exposed = this.ctx.storage.sql
      .exec<{
        count: number;
      }>("SELECT COUNT(*) AS count FROM coach_observations WHERE session_id=? AND private=0", sessionId)
      .one().count;
    if (!exposed) return;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE coach_observations SET text='[Private session activity; content withheld]',private=1 WHERE session_id=?",
        sessionId,
      );
      this.ctx.storage.sql.exec("DELETE FROM coach_turns");
      this.ctx.storage.sql.exec(
        "UPDATE coach_state SET revision=revision+1 WHERE id=1",
      );
    });
  }
  /** Input: a bounded, validated batch of committed visible entries. Output: idempotent index update. */
  ingest(owner: string, sessionId: string, observations: CoachObservation[]) {
    this.authorize(owner);
    if (!/^[\w-]{8,100}$/.test(sessionId) || observations.length > 200)
      throw new Error("Invalid coach observations");
    const state = this.cursor(owner, sessionId);
    if (state.deleted || state.paused) return;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO coach_sessions VALUES(?,0,0)",
        sessionId,
      );
      let last = state.last;
      for (const entry of observations) {
        const entryId = Number(entry.entryId);
        if (
          entry.sessionId !== sessionId ||
          !Number.isSafeInteger(entryId) ||
          entryId <= 0 ||
          (entry.role !== "user" && entry.role !== "assistant") ||
          typeof entry.text !== "string" ||
          entry.text.length > 1600 ||
          typeof entry.private !== "boolean"
        )
          throw new Error("Invalid coach observation");
        // Private repository names and content are never projected into the global teacher.
        const text = entry.private
          ? "[Private session activity; content withheld]"
          : entry.text;
        this.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO coach_observations VALUES(?,?,?,?,?,?)",
          sessionId,
          entry.entryId,
          entry.role,
          text,
          entry.private ? 1 : 0,
          entry.createdAt.slice(0, 40),
        );
        last = Math.max(last, entryId);
      }
      this.ctx.storage.sql.exec(
        "UPDATE coach_sessions SET last_entry=? WHERE id=? AND deleted=0",
        last,
        sessionId,
      );
    });
  }
  /** Deletion first writes the tombstone, then retracts every observation and generated coach answer. */
  forget(owner: string, sessionId: string) {
    this.authorize(owner);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO coach_sessions VALUES(?,0,1) ON CONFLICT(id) DO UPDATE SET deleted=1",
        sessionId,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM coach_observations WHERE session_id=?",
        sessionId,
      );
      // A previous coach answer may have paraphrased this session: erase all derived answers conservatively.
      this.ctx.storage.sql.exec("DELETE FROM coach_turns");
      this.ctx.storage.sql.exec(
        "UPDATE coach_state SET revision=revision+1 WHERE id=1",
      );
    });
  }
  /** Explicit reset pauses collection so opening a session cannot silently rebuild erased observations. */
  clear(owner: string) {
    this.authorize(owner);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE coach_state SET paused=1,revision=revision+1 WHERE id=1",
      );
      this.ctx.storage.sql.exec("DELETE FROM coach_observations");
      this.ctx.storage.sql.exec("DELETE FROM coach_turns");
    });
  }
  resume(owner: string) {
    this.authorize(owner);
    // Start fresh from current session cursors; old evidence remains erased until new entries arrive.
    this.ctx.storage.sql.exec("UPDATE coach_state SET paused=0 WHERE id=1");
  }
  view(owner: string): CoachView {
    this.authorize(owner);
    const observations = this.ctx.storage.sql
      .exec<{
        session_id: string;
        entry_id: string;
        role: "user" | "assistant";
        text: string;
        private: number;
        created_at: string;
      }>("SELECT * FROM coach_observations ORDER BY rowid DESC LIMIT 120")
      .toArray()
      .map((r) => ({
        sessionId: r.session_id,
        entryId: r.entry_id,
        role: r.role,
        text: r.text,
        private: Boolean(r.private),
        createdAt: r.created_at,
      }));
    const turns = this.ctx.storage.sql
      .exec<{
        id: string;
        question: string;
        answer: string;
        created_at: string;
      }>("SELECT * FROM coach_turns ORDER BY rowid DESC LIMIT 30")
      .toArray()
      .map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        createdAt: r.created_at,
      }));
    const messageCount = this.ctx.storage.sql
      .exec<{
        count: number;
      }>("SELECT COUNT(*) AS count FROM coach_observations")
      .one().count;
    const sessionCount = this.ctx.storage.sql
      .exec<{
        count: number;
      }>("SELECT COUNT(DISTINCT session_id) AS count FROM coach_observations")
      .one().count;
    return {
      observations,
      turns,
      sessionCount,
      messageCount,
      paused: this.paused(),
    };
  }
  /** Model work runs only on an explicit question. Stable IDs never cause duplicate coach conversations. */
  async ask(
    owner: string,
    requestId: string,
    question: string,
  ): Promise<CoachTurn> {
    this.authorize(owner);
    if (
      !/^[\w:-]{8,160}$/.test(requestId) ||
      typeof question !== "string" ||
      !question.trim() ||
      question.length > 3000
    )
      throw new Error("Invalid coach question");
    const previous = this.ctx.storage.sql
      .exec<{
        id: string;
        question: string;
        answer: string;
        created_at: string;
      }>("SELECT * FROM coach_turns WHERE id=?", requestId)
      .toArray()[0];
    if (previous) {
      if (previous.question !== question)
        throw new Error("Coach request ID already used");
      return {
        id: previous.id,
        question: previous.question,
        answer: previous.answer,
        createdAt: previous.created_at,
      };
    }
    const generation = this.revision();
    const view = this.view(owner);
    const evidence = view.observations
      .filter((o) => !o.private)
      .slice(0, 60)
      .map(({ sessionId, entryId, role, text }) => ({
        sessionId,
        entryId,
        role,
        text,
      }));
    const preferences = (
      await this.env.LEARNING_LIBRARY.getByName(owner).preferences()
    ).text;
    let answer = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.env.AI.run(
        grammarModelFromConfiguredModel(this.env.MODEL),
        {
          messages: [
            {
              role: "system",
              content:
                COACH_INSTRUCTIONS +
                "\nLearner preferences:\n" +
                preferences.slice(0, 4000),
            },
            {
              role: "user",
              content: JSON.stringify({
                question,
                observations: evidence,
                earlier_coach_questions: view.turns.slice(0, 5).map((t) => ({
                  question: t.question,
                  answer: t.answer.slice(0, 1200),
                })),
              }),
            },
          ],
          max_completion_tokens: 3000,
          chat_template_kwargs: { enable_thinking: false },
          reasoning_effort: "none",
        },
        {
          gateway: {
            id: this.env.AI_GATEWAY_ID,
            skipCache: true,
            metadata: { user: "learning-coach" },
          },
        },
      );
      try {
        answer = coachAnswer(result);
        break;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
    if (this.paused() || this.revision() !== generation)
      throw new Error(
        "Coach evidence changed while answering. Ask again to use current learning.",
      );
    const createdAt = new Date().toISOString();
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO coach_turns VALUES(?,?,?,?)",
      requestId,
      question,
      answer,
      createdAt,
    );
    return { id: requestId, question, answer, createdAt };
  }
}
