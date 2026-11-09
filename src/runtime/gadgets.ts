export const MAX_GADGET_SOURCE = 64 * 1024;
export type GadgetTest = {
  action: string;
  data: Record<string, string>;
  expectText: string;
  /** New tool calls require this; optional here to preserve older direct callers. */
  expectFeedback?: string;
};
export type GadgetDataUpdate = {
  action: string;
  data: Record<string, string>;
  expectText: string;
  expectFeedback?: string;
};
export type GadgetSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  generation: number;
};
type GadgetRow = GadgetSummary & {
  code: string;
  visible: number;
  loaderId: string;
};
type GadgetFacet = {
  render(): Promise<string>;
  handleAction(action: string, data: Record<string, string>): Promise<void>;
};

function visibleText(html: string): string {
  return html
    .replace(/<(?:style|script)\b[^>]*>[\s\S]*?<\/(?:style|script)>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

/** Canonical gadget source registry inside one learning session; each version has an isolated Facet. */
export class LearningGadgets {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly loader: WorkerLoader,
  ) {
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS learning_gadgets (id TEXT PRIMARY KEY, title TEXT NOT NULL, code TEXT NOT NULL, createdAt TEXT NOT NULL)",
    );
    const columns = new Set(
      ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(learning_gadgets)")
        .toArray()
        .map((row) => row.name),
    );
    if (!columns.has("updatedAt"))
      ctx.storage.sql.exec(
        "ALTER TABLE learning_gadgets ADD COLUMN updatedAt TEXT NOT NULL DEFAULT ''",
      );
    if (!columns.has("generation"))
      ctx.storage.sql.exec(
        "ALTER TABLE learning_gadgets ADD COLUMN generation INTEGER NOT NULL DEFAULT 1",
      );
    if (!columns.has("visible"))
      ctx.storage.sql.exec(
        "ALTER TABLE learning_gadgets ADD COLUMN visible INTEGER NOT NULL DEFAULT 1",
      );
    if (!columns.has("loaderId"))
      ctx.storage.sql.exec(
        "ALTER TABLE learning_gadgets ADD COLUMN loaderId TEXT NOT NULL DEFAULT ''",
      );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS learning_gadget_updates (task_id TEXT PRIMARY KEY, gadget_id TEXT NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS learning_gadget_facets (name TEXT PRIMARY KEY, stage TEXT NOT NULL)",
    );
    // A stopped update never exposes its candidate or leaves a retired copy behind.
    for (const { name } of ctx.storage.sql
      .exec<{ name: string }>("SELECT name FROM learning_gadget_facets")
      .toArray()) {
      ctx.facets.delete(name);
      ctx.storage.sql.exec(
        "DELETE FROM learning_gadget_facets WHERE name=?",
        name,
      );
    }
    for (const { id } of ctx.storage.sql
      .exec<{ id: string }>("SELECT id FROM learning_gadgets WHERE visible=0")
      .toArray()) {
      ctx.facets.delete(id);
      ctx.storage.sql.exec("DELETE FROM learning_gadgets WHERE id=?", id);
    }
  }
  list(): GadgetSummary[] {
    return this.ctx.storage.sql
      .exec<GadgetSummary>(
        "SELECT id,title,createdAt,CASE WHEN updatedAt='' THEN createdAt ELSE updatedAt END AS updatedAt,generation FROM learning_gadgets WHERE visible=1 ORDER BY updatedAt DESC,createdAt DESC",
      )
      .toArray();
  }
  private record(id: string): GadgetRow {
    const row = this.ctx.storage.sql
      .exec<GadgetRow>(
        "SELECT id,title,code,createdAt,CASE WHEN updatedAt='' THEN createdAt ELSE updatedAt END AS updatedAt,generation,visible,loaderId FROM learning_gadgets WHERE id=?",
        id,
      )
      .toArray()[0];
    if (!row) throw new Error("Gadget not found");
    return row;
  }
  source(id: string): {
    id: string;
    title: string;
    code: string;
    generation: number;
  } {
    const { title, code, generation } = this.requireVisible(id);
    return { id, title, code, generation };
  }
  private facetId(row: GadgetRow): string {
    return row.generation === 1 ? row.id : `${row.id}:v${row.generation}`;
  }
  private readonly locks = new Map<string, Promise<void>>();
  private async locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(id, next);
    await prior;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
  private facet(row: GadgetRow): GadgetFacet {
    const id = this.facetId(row);
    const stub = this.ctx.facets.get(id, () => {
      const worker = this.loader.get(
        row.loaderId || `learning-gadget:${row.id}:v${row.generation}`,
        () => ({
          compatibilityDate: "2026-10-13",
          mainModule: "worker.js",
          modules: { "worker.js": row.code },
          globalOutbound: null,
        }),
      );
      return { class: worker.getDurableObjectClass("Gadget"), id };
    });
    return stub as unknown as GadgetFacet;
  }
  async render(id: string): Promise<string> {
    return this.locked(id, async () => this.renderRow(this.requireVisible(id)));
  }
  private async renderRow(row: GadgetRow): Promise<string> {
    const html = await this.facet(row).render();
    if (typeof html !== "string" || html.length > 256 * 1024)
      throw new Error("Invalid gadget page");
    return html;
  }
  async pageText(
    id: string,
  ): Promise<{ gadgetId: string; text: string; truncated: boolean }> {
    const text = visibleText(await this.render(id));
    return {
      gadgetId: id,
      text: text.slice(0, 20_000),
      truncated: text.length > 20_000,
    };
  }
  async action(
    id: string,
    action: string,
    data: Record<string, string>,
  ): Promise<void> {
    await this.locked(id, async () => {
      const row = this.requireVisible(id);
      if (!/^[a-zA-Z][\w-]{0,63}$/.test(action))
        throw new Error("Invalid gadget action");
      await this.facet(row).handleAction(action, data);
    });
  }
  private validate(title: string, code: string, tests: GadgetTest[]) {
    if (
      !title.trim() ||
      title.length > 120 ||
      !code.trim() ||
      code.length > MAX_GADGET_SOURCE ||
      tests.length < 1 ||
      tests.length > 16
    )
      throw new Error("Invalid gadget specification");
  }
  /** Test disposable source/state before changing any visible gadget or learner data. */
  private async preflight(code: string, tests: GadgetTest[]): Promise<void> {
    const id = `gadget-${crypto.randomUUID()}`;
    this.ctx.storage.sql.exec(
      "INSERT INTO learning_gadgets(id,title,code,createdAt,updatedAt,generation,visible) VALUES(?,?,?,?,?,1,0)",
      id,
      "Preflight",
      code,
      new Date().toISOString(),
      "",
    );
    try {
      let before = await this.facet(this.record(id)).render();
      if (typeof before !== "string" || before.length > 256 * 1024)
        throw new Error("Invalid gadget page");
      for (const test of tests) {
        if (
          !/^[a-zA-Z][\w-]{0,63}$/.test(test.action) ||
          !test.expectText?.trim() ||
          test.expectText.length > 1000 ||
          !test.data ||
          typeof test.data !== "object" ||
          JSON.stringify(test.data).length > 16_384
        )
          throw new Error("Invalid gadget preflight test");
        await this.facet(this.record(id)).handleAction(test.action, test.data);
        const html = await this.facet(this.record(id)).render();
        if (typeof html !== "string" || html.length > 256 * 1024)
          throw new Error("Invalid gadget page");
        const visible = visibleText(html);
        if (html === before || !visible.includes(test.expectText))
          throw new Error(
            "Gadget preflight failed: expected visible state change",
          );
        if (test.expectFeedback !== undefined) {
          if (
            typeof test.expectFeedback !== "string" ||
            test.expectFeedback.trim().length < 8 ||
            test.expectFeedback.length > 1000 ||
            visibleText(before).includes(test.expectFeedback) ||
            !visible.includes(test.expectFeedback)
          )
            throw new Error(
              "Gadget preflight failed: new code-learning feedback not visible",
            );
        }
        before = html;
      }
    } finally {
      this.ctx.facets.delete(id);
      this.ctx.storage.sql.exec("DELETE FROM learning_gadgets WHERE id=?", id);
    }
  }
  async create(
    id: string,
    title: string,
    code: string,
    tests: GadgetTest[],
  ): Promise<GadgetSummary> {
    const existing = this.list().find((row) => row.id === id);
    if (existing) return existing;
    this.validate(title, code, tests);
    await this.preflight(code, tests);
    const createdAt = new Date().toISOString();
    this.ctx.storage.sql.exec(
      "INSERT INTO learning_gadgets(id,title,code,createdAt,updatedAt,generation,visible) VALUES(?,?,?,?,?,1,1)",
      id,
      title.trim(),
      code,
      createdAt,
      createdAt,
    );
    return {
      id,
      title: title.trim(),
      createdAt,
      updatedAt: createdAt,
      generation: 1,
    };
  }
  /** Revision-checked replacement: clone real SQLite, test the new class on the copy, then switch. */
  async update(
    id: string,
    taskId: string,
    expectedGeneration: number,
    title: string,
    code: string,
    tests: GadgetTest[],
    dataUpdates: GadgetDataUpdate[] = [],
  ): Promise<GadgetSummary> {
    const prior = this.ctx.storage.sql
      .exec<{
        gadget_id: string;
      }>(
        "SELECT gadget_id FROM learning_gadget_updates WHERE task_id=?",
        taskId,
      )
      .toArray()[0];
    if (prior) {
      if (prior.gadget_id !== id) throw new Error("Gadget update task reused");
      return this.summary(this.requireVisible(id));
    }
    const current = this.requireVisible(id);
    if (current.generation !== expectedGeneration)
      throw new Error("Gadget changed. Reload it before editing.");
    this.validate(title, code, tests);
    await this.preflight(code, tests);
    return this.locked(id, () =>
      this.replace(
        id,
        taskId,
        expectedGeneration,
        title.trim(),
        code,
        dataUpdates,
      ),
    );
  }
  /** Assistant data edit: use only the gadget's own validated handleAction, never raw SQL. */
  async updateData(
    id: string,
    taskId: string,
    expectedGeneration: number,
    updates: GadgetDataUpdate[],
  ): Promise<GadgetSummary> {
    if (updates.length < 1 || updates.length > 8)
      throw new Error("Invalid gadget data update");
    return this.locked(id, async () => {
      const row = this.requireVisible(id);
      return this.replace(
        id,
        taskId,
        expectedGeneration,
        row.title,
        row.code,
        updates,
      );
    });
  }
  private async replace(
    id: string,
    taskId: string,
    expectedGeneration: number,
    title: string,
    code: string,
    dataUpdates: GadgetDataUpdate[],
  ): Promise<GadgetSummary> {
    const prior = this.ctx.storage.sql
      .exec<{
        gadget_id: string;
      }>(
        "SELECT gadget_id FROM learning_gadget_updates WHERE task_id=?",
        taskId,
      )
      .toArray()[0];
    if (prior) {
      if (prior.gadget_id !== id) throw new Error("Gadget update task reused");
      return this.summary(this.requireVisible(id));
    }
    const current = this.requireVisible(id);
    if (current.generation !== expectedGeneration)
      throw new Error("Gadget changed. Reload it before editing.");
    if (dataUpdates.length > 8) throw new Error("Too many gadget data updates");
    const oldName = this.facetId(current);
    const candidate = {
      ...current,
      title,
      code,
      generation: current.generation + 1,
      loaderId: `learning-gadget:${id}:${crypto.randomUUID()}`,
    };
    const candidateName = this.facetId(candidate);
    await this.renderRow(current); // Ensure even a never-opened gadget has a source database.
    this.ctx.storage.sql.exec(
      "INSERT INTO learning_gadget_facets(name,stage) VALUES(?,'candidate')",
      candidateName,
    );
    let committed = false;
    try {
      this.ctx.facets.clone(oldName, candidateName);
      await this.renderRow(candidate); // Verify the new class can read the learner's existing SQLite state.
      for (const update of dataUpdates) {
        if (
          !/^[a-zA-Z][\w-]{0,63}$/.test(update.action) ||
          !update.data ||
          typeof update.data !== "object" ||
          JSON.stringify(update.data).length > 16_384 ||
          !update.expectText?.trim() ||
          update.expectText.length > 1000 ||
          (update.expectFeedback !== undefined &&
            (typeof update.expectFeedback !== "string" ||
              update.expectFeedback.length > 1000))
        )
          throw new Error("Invalid gadget data update");
        const before = await this.renderRow(candidate);
        await this.facet(candidate).handleAction(update.action, update.data);
        const after = await this.renderRow(candidate);
        const text = visibleText(after);
        if (
          after === before ||
          !text.includes(update.expectText) ||
          (update.expectFeedback && !text.includes(update.expectFeedback))
        )
          throw new Error(
            "Gadget data update did not produce the expected visible result",
          );
      }
      const updatedAt = new Date().toISOString();
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE learning_gadgets SET title=?,code=?,updatedAt=?,generation=?,loaderId=? WHERE id=? AND generation=? AND visible=1",
          title,
          code,
          updatedAt,
          candidate.generation,
          candidate.loaderId,
          id,
          expectedGeneration,
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO learning_gadget_updates(task_id,gadget_id) VALUES(?,?)",
          taskId,
          id,
        );
        this.ctx.storage.sql.exec(
          "UPDATE learning_gadget_facets SET name=?,stage='retired' WHERE name=?",
          oldName,
          candidateName,
        );
      });
      committed = true;
      this.ctx.facets.delete(oldName);
      this.ctx.storage.sql.exec(
        "DELETE FROM learning_gadget_facets WHERE name=?",
        oldName,
      );
      return {
        id,
        title,
        createdAt: current.createdAt,
        updatedAt,
        generation: candidate.generation,
      };
    } catch (error) {
      if (!committed) {
        this.ctx.facets.delete(candidateName);
        this.ctx.storage.sql.exec(
          "DELETE FROM learning_gadget_facets WHERE name=?",
          candidateName,
        );
      }
      throw error;
    }
  }
  private summary({
    id,
    title,
    createdAt,
    updatedAt,
    generation,
  }: GadgetRow): GadgetSummary {
    return { id, title, createdAt, updatedAt, generation };
  }
  private requireVisible(id: string): GadgetRow {
    const row = this.record(id);
    if (!row.visible) throw new Error("Gadget not found");
    return row;
  }
  /** Remove the source and active state; a deleted gadget cannot be reopened from an old chat link. */
  async delete(id: string, expectedGeneration: number): Promise<void> {
    await this.locked(id, async () => {
      const row = this.requireVisible(id);
      if (row.generation !== expectedGeneration)
        throw new Error("Gadget changed. Reload it before deleting.");
      this.ctx.storage.sql.exec("DELETE FROM learning_gadgets WHERE id=?", id);
      this.ctx.facets.delete(this.facetId(row));
    });
  }
  deleteAll(): void {
    for (const row of this.ctx.storage.sql
      .exec<GadgetRow>("SELECT id,generation FROM learning_gadgets")
      .toArray())
      this.ctx.facets.delete(this.facetId(row));
    this.ctx.storage.sql.exec("DELETE FROM learning_gadgets");
    for (const { name } of this.ctx.storage.sql
      .exec<{ name: string }>("SELECT name FROM learning_gadget_facets")
      .toArray())
      this.ctx.facets.delete(name);
    this.ctx.storage.sql.exec("DELETE FROM learning_gadget_facets");
    this.ctx.storage.sql.exec("DELETE FROM learning_gadget_updates");
  }
}
