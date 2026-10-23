import { DurableObject } from "cloudflare:workers";
import { BACKGROUND_CONTEXT as background } from "@earendil-works/chord/context";
import {
  Harness,
  watchEvents,
  type Cursor,
  type EntryRecord,
  type EntryId,
  type SubmissionId,
} from "@earendil-works/pi-durable";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import * as v from "valibot";
import { createLearningHarnessOptions } from "./harness.ts";
import {
  directoryItem,
  sha256,
  type SessionMetadata,
  type SessionSnapshot,
  type Message,
  type Source,
  type Note,
  type Approval,
} from "./contracts.ts";
import {
  createGithubRepositoryTools,
  type GithubRepository,
} from "../tools/github-repository.ts";

export function entryMessage(entry: EntryRecord): Message | undefined {
  if (entry.kind === "learning.import") {
    const data = entry.data as {
      role?: string;
      content?: string;
      createdAt?: string;
    };
    if ((data.role === "user" || data.role === "assistant") && data.content)
      return {
        id: String(entry.id),
        role: data.role,
        content: data.content,
        createdAt: data.createdAt,
      };
  }
  const messages =
    entry.model?.filter((m) => m.role === "user" || m.role === "assistant") ??
    [];
  const message = messages[0];
  if (!message || (message.role !== "user" && message.role !== "assistant"))
    return;
  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
  return content
    ? { id: String(entry.id), role: message.role, content }
    : undefined;
}

/** One Pi storage owner per learning UUID. Browser connections never own generation. */
export class LearningSession extends DurableObject<CloudflareBindings> {
  private opening?: Promise<Harness>;
  private harness?: Harness;
  private watched = new Set<string>();
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    ctx.storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS learning_state (id INTEGER PRIMARY KEY CHECK(id=1), metadata TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, dirty INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE TABLE IF NOT EXISTS learning_sources (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS learning_notes (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS learning_approvals (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS learning_requests (id TEXT PRIMARY KEY, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS learning_imports (id TEXT PRIMARY KEY);`);
    // An external write may have succeeded before its result was persisted. Never repeat it.
    for (const row of this.rows<Approval>("learning_approvals")) {
      if (row.status === "executing")
        this.store("learning_approvals", row.id, {
          ...row,
          status: "uncertain",
        });
    }
  }
  private state() {
    return this.ctx.storage.sql
      .exec<{
        metadata: string;
        revision: number;
        dirty: number;
        deleted: number;
        error: string | null;
      }>("SELECT * FROM learning_state WHERE id=1")
      .toArray()[0];
  }
  private metadata(): SessionMetadata {
    const row = this.state();
    if (!row || row.deleted) throw new Error("Session not found");
    return JSON.parse(row.metadata);
  }
  private authorize(owner: string) {
    const metadata = this.metadata();
    if (metadata.owner !== owner) throw new Error("Session not found");
    return metadata;
  }
  private rows<T>(
    table: "learning_sources" | "learning_notes" | "learning_approvals",
  ): T[] {
    return this.ctx.storage.sql
      .exec<{ data: string }>(`SELECT data FROM ${table}`)
      .toArray()
      .map((r) => JSON.parse(r.data));
  }
  private store(
    table: "learning_sources" | "learning_notes" | "learning_approvals",
    id: string,
    data: unknown,
  ) {
    this.ctx.storage.sql.exec(
      `INSERT INTO ${table} VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      id,
      JSON.stringify(data),
    );
    this.dirty();
  }
  private dirty() {
    this.ctx.storage.sql.exec(
      "UPDATE learning_state SET dirty=1,revision=revision+1 WHERE id=1",
    );
  }
  private notify() {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send('{"type":"changed"}');
      } catch {}
    }
  }
  private async wake() {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > Date.now() + 30_000)
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
  }
  async create(metadata: SessionMetadata) {
    const row = this.state();
    if (row?.deleted) throw new Error("Session was deleted");
    if (row) {
      this.authorize(metadata.owner);
      return;
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO learning_state(id,metadata) VALUES(1,?)",
      JSON.stringify(metadata),
    );
    await this.wake();
    await this.syncLibrary();
  }
  async isDeleted(owner: string) {
    const row = this.state();
    return Boolean(row?.deleted && JSON.parse(row.metadata).owner === owner);
  }
  async exists(owner: string) {
    const row = this.state();
    return Boolean(
      row && !row.deleted && JSON.parse(row.metadata).owner === owner,
    );
  }
  private async update(patch: Partial<SessionMetadata>) {
    const meta = {
      ...this.metadata(),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.ctx.storage.sql.exec(
      "UPDATE learning_state SET metadata=?,dirty=1,revision=revision+1 WHERE id=1",
      JSON.stringify(meta),
    );
    await this.wake();
    this.notify();
  }
  private async open(): Promise<Harness> {
    if (this.harness) return this.harness;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const harness = await Harness.open(
        await openDurableObjectSqliteStorage(this.ctx.storage),
        createLearningHarnessOptions(this.env, {
          metadata: () => this.metadata(),
          update: (patch) => this.update(patch),
          source: async (id, title, content) => {
            const source: Source = {
              id,
              title,
              content,
              private: this.metadata().private,
              hash: await sha256(content),
              createdAt: new Date().toISOString(),
            };
            if (new TextEncoder().encode(content).length > 900_000)
              throw new Error("Source exceeds retained evidence limit");
            this.store("learning_sources", id, source);
            await this.wake();
          },
          proposal: async (id, tool, args) => {
            const existing = this.rows<Approval>("learning_approvals").find(
              (a) => a.id === id,
            );
            if (existing) return existing;
            const proposal: Approval & { repository: GithubRepository } = {
              id,
              tool,
              args,
              repository: this.metadata().repository!,
              status: "pending",
              createdAt: new Date().toISOString(),
            };
            this.store("learning_approvals", id, proposal);
            await this.wake();
            this.notify();
            return proposal;
          },
          preferences: async () => (await this.library().preferences()).text,
          recall: (query) => this.library().recall(query, this.metadata().id),
          actions: () =>
            this.rows<Approval>("learning_approvals").map(
              ({ id, tool, status, result, createdAt }) => ({
                id,
                tool,
                status,
                result,
                createdAt,
              }),
            ),
          savedSource: (id) =>
            id
              ? (this.rows<Source>("learning_sources").find(
                  (s) => s.id === id,
                ) ?? { error: "Source not found" })
              : this.rows<Source>("learning_sources")
                  .slice(-30)
                  .map(({ id, title }) => ({ id, title })),
        }),
        background,
      );
      this.harness = harness;
      await harness.root(background);
      harness.subscribeCommits((publication) => {
        if (publication.changes.some((change) => change.type === "entry"))
          this.dirty();
        this.notify();
      });
      void harness.closed.then((end) => {
        if (end.reason === "failed") this.ctx.abort("Learning harness failed");
      });
      return harness;
    })();
    try {
      return await this.opening;
    } finally {
      this.opening = undefined;
    }
  }
  private library() {
    return this.env.LEARNING_LIBRARY.getByName(this.metadata().owner);
  }
  private async syncLibrary() {
    const row = this.state();
    if (!row || !row.dirty || row.deleted) return;
    const metadata = this.metadata();
    const harness = await this.open();
    const root = await harness.root(background);
    const recent = await root.entries(
      { order: "descending" },
      400,
      undefined,
      background,
    );
    const text = [
      metadata.title,
      ...recent.items.map((entry) => entryMessage(entry)?.content ?? ""),
      ...this.rows<Source>("learning_sources").map(
        (s) => s.title + "\n" + s.content.slice(0, 4000),
      ),
      ...this.rows<Note>("learning_notes").map((n) => n.text),
    ].join("\n");
    const notes = this.rows<Note>("learning_notes").map((n) => ({
      ...n,
      private: metadata.private || n.private,
    }));
    await this.library().upsert(
      directoryItem(metadata),
      row.revision,
      text,
      notes,
    );
    this.ctx.storage.sql.exec(
      "UPDATE learning_state SET dirty=0 WHERE revision=?",
      row.revision,
    );
  }
  async submit(owner: string, text: string, requestId: string) {
    this.authorize(owner);
    if (
      !text.trim() ||
      text.length > 30_000 ||
      !/^[a-zA-Z0-9:_-]{8,160}$/.test(requestId)
    )
      throw new Error("Invalid submission");
    const hash = await sha256(text);
    const previous = this.ctx.storage.sql
      .exec<{
        hash: string;
      }>("SELECT hash FROM learning_requests WHERE id=?", requestId)
      .toArray()[0];
    if (previous && previous.hash !== hash)
      throw new Error("Request ID already used for different content");
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO learning_requests VALUES(?,?)",
      requestId,
      hash,
    );
    // Persist the wakeup BEFORE submit starts Pi's scheduler.
    await this.wake();
    const root = await (await this.open()).root(background);
    const submission = await root.submit(
      { type: "input", content: text, requestId },
      background,
    );
    this.ctx.storage.sql.exec(
      "UPDATE learning_state SET error=NULL WHERE id=1",
    );
    await this.update({});
    this.watchSubmission(String(submission.id));
    return {
      submissionId: String(submission.id),
      sessionId: this.metadata().id,
    };
  }
  private watchSubmission(id: string) {
    if (this.watched.has(id)) return;
    this.watched.add(id);
    this.ctx.waitUntil(
      (async () => {
        const submission = await (
          await this.open()
        ).submission(Number(id) as SubmissionId, background);
        const outcome = await submission?.wait(background);
        if (outcome?.status === "unanswered")
          this.ctx.storage.sql.exec(
            "UPDATE learning_state SET error=? WHERE id=1",
            "The last answer did not complete. You can retry with a new message.",
          );
        await this.reconcile();
        this.notify();
      })()
        .catch(() => {
          this.ctx.waitUntil(this.wake());
        })
        .finally(() => this.watched.delete(id)),
    );
  }
  async answer(owner: string, text: string, requestId: string) {
    const receipt = await this.submit(owner, text, requestId);
    const harness = await this.open();
    const submission = await harness.submission(
      Number(receipt.submissionId) as SubmissionId,
      background,
    );
    const settled = await submission!.wait(background);
    if (settled.status !== "done" || settled.type !== "input")
      throw new Error("Answer did not complete");
    const entry = await harness.commit(
      (tx) => tx.entry(settled.answer),
      background,
    );
    const answer = entry && entryMessage(entry)?.content;
    if (!answer) throw new Error("Empty answer");
    return answer;
  }
  async snapshot(owner: string, cursor?: string): Promise<Response> {
    const metadata = this.authorize(owner);
    const harness = await this.open();
    const root = await harness.root(background);
    const page = await root.entries(
      { order: "descending" },
      200,
      cursor ? (JSON.parse(cursor) as Cursor) : undefined,
      background,
    );
    const stream = await watchEvents(harness, root.id, background);
    const live = stream.snapshot;
    await stream.stop();
    const partial =
      live.generation?.message?.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("") ?? "";
    const snapshot: SessionSnapshot = {
      metadata,
      messages: page.items
        .flatMap((entry) => {
          const m = entryMessage(entry);
          return m ? [m] : [];
        })
        .reverse(),
      partial,
      busy: Boolean(live.run || live.inbox.length),
      error: this.state()?.error ?? undefined,
      sources: this.rows<Source>("learning_sources").map(
        ({ content: _content, ...source }) => source,
      ),
      notes: this.rows<Note>("learning_notes"),
      approvals: this.rows<Approval>("learning_approvals"),
      nextCursor: page.next ? JSON.stringify(page.next) : undefined,
    };
    return Response.json(snapshot);
  }
  async getMetadata(owner: string) {
    return this.authorize(owner);
  }
  async attachRepository(owner: string, repository: GithubRepository) {
    this.authorize(owner);
    await this.update({
      repository,
      type: "repository",
      private: this.metadata().private || repository.private,
    });
  }
  async retainLegacy(
    owner: string,
    content: string,
    repository?: GithubRepository,
  ) {
    this.authorize(owner);
    if (repository)
      await this.update({
        repository,
        private: this.metadata().private || repository.private,
      });
    if (new TextEncoder().encode(content).length > 900_000)
      throw new Error("Legacy archive exceeds source record limit");
    this.store("learning_sources", "legacy-archive", {
      id: "legacy-archive",
      title: "Original Flue archive and guide",
      content,
      hash: await sha256(content),
      private: this.metadata().private,
      createdAt: new Date().toISOString(),
    });
    await this.wake();
  }
  async retainLegacySource(
    owner: string,
    id: string,
    title: string,
    content: string,
    createdAt: string,
  ) {
    this.authorize(owner);
    if (new TextEncoder().encode(content).length > 900_000)
      throw new Error("Legacy source exceeds record limit");
    this.store("learning_sources", id, {
      id,
      title,
      content,
      createdAt,
      hash: await sha256(content),
      private: this.metadata().private,
    });
    await this.wake();
  }
  async retainInput(owner: string, text: string) {
    this.authorize(owner);
    const source: Source = {
      id: "shared-input",
      title: "Original shared input",
      content: text,
      private: this.metadata().private,
      hash: await sha256(text),
      createdAt: this.metadata().createdAt,
    };
    this.store("learning_sources", source.id, source);
    await this.wake();
  }
  async setVisual(
    owner: string,
    visual: NonNullable<SessionMetadata["visual"]>,
  ) {
    const metadata = this.authorize(owner);
    const id = `visual:${crypto.randomUUID()}`;
    const content = JSON.stringify(visual);
    this.store("learning_sources", id, {
      id,
      title: `Visual: ${visual.title}`,
      content,
      hash: await sha256(content),
      private: metadata.private,
      createdAt: new Date().toISOString(),
    });
    await this.update({
      visual,
      type: metadata.repository ? "repository" : "visual",
    });
    return id;
  }
  async source(owner: string, id: string) {
    this.authorize(owner);
    return this.rows<Source>("learning_sources").find(
      (source) => source.id === id,
    );
  }
  async edit(
    owner: string,
    patch: { title?: string; archived?: boolean; pinned?: boolean },
  ) {
    this.authorize(owner);
    const safe: Partial<SessionMetadata> = {};
    if (typeof patch.title === "string") {
      if (!patch.title.trim() || patch.title.length > 140)
        throw new Error("Invalid title");
      safe.title = patch.title.trim();
    }
    if (typeof patch.archived === "boolean") safe.archived = patch.archived;
    if (typeof patch.pinned === "boolean") safe.pinned = patch.pinned;
    await this.update(safe);
    await this.syncLibrary();
  }
  async note(
    owner: string,
    text: string,
    entryId: string,
    id: string = crypto.randomUUID(),
  ) {
    this.authorize(owner);
    if (text.length > 4000 || !text.trim()) throw new Error("Invalid note");
    const root = await (await this.open()).root(background);
    // Validate evidence against this conversation, not an arbitrary client-supplied ID.
    const evidenceId = Number(entryId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0)
      throw new Error("Invalid evidence entry");
    const found = await root.entries(
      { minEntryId: evidenceId as EntryId, maxEntryId: evidenceId as EntryId },
      1,
      undefined,
      background,
    );
    if (
      !found.items.some(
        (entry) => String(entry.id) === entryId && entryMessage(entry),
      )
    )
      throw new Error("Evidence entry not found in this session");
    this.store("learning_notes", id, {
      id,
      text,
      entryId,
      createdAt: new Date().toISOString(),
      private: this.metadata().private,
    });
    await this.wake();
    await this.syncLibrary();
    this.notify();
  }
  async deleteNote(owner: string, id: string) {
    this.authorize(owner);
    this.ctx.storage.sql.exec("DELETE FROM learning_notes WHERE id=?", id);
    this.dirty();
    await this.wake();
    await this.syncLibrary();
  }
  async approve(owner: string, id: string, accept: boolean) {
    this.authorize(owner);
    const proposal = this.rows<Approval & { repository: GithubRepository }>(
      "learning_approvals",
    ).find((a) => a.id === id);
    if (!proposal) throw new Error("Approval not found");
    if (proposal.status !== "pending") return Response.json(proposal);
    // Synchronous persisted claim prevents concurrent or replayed requests performing two writes.
    proposal.status = accept ? "executing" : "rejected";
    this.store("learning_approvals", id, proposal);
    if (!accept) return Response.json(proposal);
    await this.wake();
    try {
      const tools = createGithubRepositoryTools(
        this.metadata().id,
        proposal.repository,
      );
      const tool =
        proposal.tool === "createIssue"
          ? tools.createIssue
          : tools.createFileChange;
      const result =
        proposal.tool === "createIssue"
          ? await tools.createIssue.run({
              data: v.parse(tools.createIssue.input, proposal.args),
              log: { info: () => {} },
            })
          : await tools.createFileChange.run({
              data: v.parse(tools.createFileChange.input, proposal.args),
              log: { info: () => {} },
            });
      proposal.status = "done";
      proposal.result = result.output;
      const root = await (await this.open()).root(background);
      await root.submit(
        {
          type: "write",
          requestId: `approval:${id}`,
          entry: {
            kind: "learning.action",
            data: {
              id,
              tool: tool.name,
              result: JSON.stringify(result.output),
            },
          },
        },
        background,
      );
    } catch {
      proposal.status = "uncertain";
      proposal.result =
        "Action did not return a confirmed result. Check GitHub before trying again; it will not be replayed automatically.";
    }
    this.store("learning_approvals", id, proposal);
    this.notify();
    return Response.json(proposal);
  }
  async stop(owner: string) {
    this.authorize(owner);
    await (await (await this.open()).root(background)).abort(background);
    await this.reconcile();
  }
  async markImported(
    owner: string,
    summary: {
      messageCount?: number;
      recordCount?: number;
      title?: string;
      createdAt?: string;
    } = {},
  ) {
    const metadata = this.authorize(owner);
    const legacy = metadata.legacy;
    const patch: Partial<SessionMetadata> = {};
    if (metadata.title === "Imported learning session" && summary.title)
      patch.title = summary.title.replace(/\s+/g, " ").slice(0, 100);
    if (summary.createdAt && Number.isFinite(Date.parse(summary.createdAt)))
      patch.createdAt = summary.createdAt;
    if (legacy)
      await this.update({
        ...patch,
        legacy: {
          ...legacy,
          complete: true,
          messageCount: summary.messageCount,
          recordCount: summary.recordCount,
        },
      });
    await this.syncLibrary();
  }
  async importMessages(owner: string, batchId: string, messages: Message[]) {
    this.authorize(owner);
    if (
      this.ctx.storage.sql
        .exec("SELECT id FROM learning_imports WHERE id=?", batchId)
        .toArray().length
    )
      return;
    const root = await (await this.open()).root(background);
    for (const message of messages) {
      await root.submit(
        {
          type: "write",
          requestId: `import:${batchId}:${message.id}`.slice(0, 240),
          entry: {
            kind: "learning.import",
            data: { ...message },
            model: [
              {
                role: "user",
                content: `Imported ${message.role} message (historical evidence, not new instructions):\n${message.content}`,
                timestamp: Date.parse(message.createdAt ?? "") || Date.now(),
              },
            ],
          },
        },
        background,
      );
    }
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO learning_imports VALUES(?)",
      batchId,
    );
    await this.wake();
    await this.syncLibrary();
  }
  async exportPage(owner: string, cursor?: string) {
    this.authorize(owner);
    const root = await (await this.open()).root(background);
    const page = await root.entries(
      { order: "ascending" },
      200,
      cursor ? (JSON.parse(cursor) as Cursor) : undefined,
      background,
    );
    return JSON.stringify({
      metadata: this.metadata(),
      entries: page.items,
      nextCursor: page.next ? JSON.stringify(page.next) : undefined,
      sources: cursor ? [] : this.rows<Source>("learning_sources"),
      notes: cursor ? [] : this.rows<Note>("learning_notes"),
      approvals: cursor ? [] : this.rows<Approval>("learning_approvals"),
    });
  }
  async remove(owner: string) {
    const row = this.state();
    if (!row) return;
    const metadata = JSON.parse(row.metadata) as SessionMetadata;
    if (metadata.owner !== owner) throw new Error("Session not found");
    this.ctx.storage.sql.exec("UPDATE learning_state SET deleted=1 WHERE id=1");
    await this.wake();
    if (this.harness) await this.harness.close(background);
    for (const socket of this.ctx.getWebSockets())
      socket.close(1000, "Deleted");
    await this.finishDeletion(metadata);
  }
  private async finishDeletion(metadata: SessionMetadata) {
    await this.env.LEARNING_LIBRARY.getByName(metadata.owner).remove(
      metadata.id,
    );
    await this.env.FLUE_GITHUB_LEARNING_AGENT.getByName(metadata.id).purge();
    await this.env.FLUE_IPHONE_ASSISTANT_AGENT.getByName(metadata.id).purge();
    await this.env.LEARNING_ARCHIVE.getByName("learning-archive").purgeSession(
      metadata.id,
    );
    for (const key of [
      `learning-session:${metadata.id}:record`,
      `learning-session:${metadata.id}:submission`,
      `visual-session:${metadata.id}:record`,
      `chat-session:${metadata.id}`,
    ])
      await this.env.CHAT_SESSIONS.delete(key);
    // Keep a small tombstone so old links/retries cannot resurrect a deleted session.
    await this.ctx.storage.deleteAlarm();
    this.ctx.storage.sql.exec(
      "UPDATE learning_state SET metadata=?,deleted=1,dirty=0,error=NULL WHERE id=1",
      JSON.stringify({ id: metadata.id, owner: metadata.owner }),
    );
    for (const table of [
      "learning_sources",
      "learning_notes",
      "learning_approvals",
      "learning_requests",
      "learning_imports",
    ])
      this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
    // Pi 1.2's data tables only. Never touch platform or test-runner tables.
    for (const name of [
      "document_revisions",
      "documents",
      "submissions",
      "tasks",
      "entries",
      "conversations",
      "record_ids",
    ]) {
      if (
        this.ctx.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            name,
          )
          .toArray().length
      )
        this.ctx.storage.sql.exec(`DELETE FROM ${name}`);
    }
  }
  private async reconcile() {
    const row = this.state();
    if (!row) return;
    if (row.deleted) {
      await this.finishDeletion(JSON.parse(row.metadata));
      return;
    }
    const harness = await this.open();
    const inspection = await harness.inspect(background);
    if (inspection.tasks.length || row.dirty) await this.wake();
    harness.resume();
    for (const task of inspection.tasks) {
      const key = `task:${task.record.id}`;
      if (!this.watched.has(key) && task.state.kind !== "blocked") {
        this.watched.add(key);
        this.ctx.waitUntil(
          harness
            .waitForTask(task.record.id, background)
            .then(() => this.reconcile())
            .catch(() => this.wake())
            .finally(() => this.watched.delete(key)),
        );
      }
    }
    await this.syncLibrary();
    if (!inspection.tasks.length && !this.state()?.dirty)
      await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    await this.reconcile();
  }
  override async fetch(request: Request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("WebSocket required", { status: 426 });
    return this.connectBrowser(request.headers.get("X-Learning-Owner") ?? "");
  }
  private async connectBrowser(owner: string) {
    this.authorize(owner);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send('{"type":"changed"}');
    await this.reconcile();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(socket: WebSocket) {
    socket.send('{"type":"changed"}');
  }
}
