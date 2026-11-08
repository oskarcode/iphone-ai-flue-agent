export const MAX_GADGET_SOURCE = 64 * 1024;
export type GadgetTest = {
  action: string;
  data: Record<string, string>;
  expectText: string;
};
export type GadgetSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  generation: number;
};
type GadgetRow = GadgetSummary & { code: string; visible: number };
type GadgetFacet = {
  render(): Promise<string>;
  handleAction(action: string, data: Record<string, string>): Promise<void>;
};

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
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS learning_gadget_updates (task_id TEXT PRIMARY KEY, gadget_id TEXT NOT NULL)",
    );
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
        "SELECT id,title,code,createdAt,CASE WHEN updatedAt='' THEN createdAt ELSE updatedAt END AS updatedAt,generation,visible FROM learning_gadgets WHERE id=?",
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
  private facet(row: GadgetRow): GadgetFacet {
    const id = this.facetId(row);
    const stub = this.ctx.facets.get(id, () => {
      const worker = this.loader.get(
        `learning-gadget:${row.id}:v${row.generation}`,
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
    const row = this.record(id);
    if (!row.visible) throw new Error("Gadget not found");
    const html = await this.facet(row).render();
    if (typeof html !== "string" || html.length > 256 * 1024)
      throw new Error("Invalid gadget page");
    return html;
  }
  async action(
    id: string,
    action: string,
    data: Record<string, string>,
  ): Promise<void> {
    const row = this.record(id);
    if (!row.visible) throw new Error("Gadget not found");
    if (!/^[a-zA-Z][\w-]{0,63}$/.test(action))
      throw new Error("Invalid gadget action");
    await this.facet(row).handleAction(action, data);
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
        const visible = html
          .replace(
            /<(?:style|script)\b[^>]*>[\s\S]*?<\/(?:style|script)>/gi,
            "",
          )
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ");
        if (html === before || !visible.includes(test.expectText))
          throw new Error(
            "Gadget preflight failed: expected visible state change",
          );
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
  /** Revision-checked, replay-safe replacement. Same URL/list item; new Facet begins empty. */
  async update(
    id: string,
    taskId: string,
    expectedGeneration: number,
    title: string,
    code: string,
    tests: GadgetTest[],
  ): Promise<GadgetSummary> {
    const prior = this.ctx.storage.sql
      .exec<{
        gadget_id: string;
      }>("SELECT gadget_id FROM learning_gadget_updates WHERE task_id=?", taskId)
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
    const now = this.requireVisible(id); // Another mutation can interleave during preflight.
    if (now.generation !== expectedGeneration)
      throw new Error("Gadget changed. Reload it before editing.");
    const updatedAt = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE learning_gadgets SET title=?,code=?,updatedAt=?,generation=? WHERE id=? AND generation=? AND visible=1",
        title.trim(),
        code,
        updatedAt,
        expectedGeneration + 1,
        id,
        expectedGeneration,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO learning_gadget_updates(task_id,gadget_id) VALUES(?,?)",
        taskId,
        id,
      );
    });
    this.ctx.facets.delete(this.facetId(now));
    return {
      id,
      title: title.trim(),
      createdAt: now.createdAt,
      updatedAt,
      generation: expectedGeneration + 1,
    };
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
  delete(id: string, expectedGeneration: number): void {
    const row = this.requireVisible(id);
    if (row.generation !== expectedGeneration)
      throw new Error("Gadget changed. Reload it before deleting.");
    this.ctx.storage.sql.exec("DELETE FROM learning_gadgets WHERE id=?", id);
    this.ctx.facets.delete(this.facetId(row));
  }
  deleteAll(): void {
    for (const row of this.ctx.storage.sql
      .exec<GadgetRow>("SELECT id,generation FROM learning_gadgets")
      .toArray())
      this.ctx.facets.delete(this.facetId(row));
    this.ctx.storage.sql.exec("DELETE FROM learning_gadgets");
    this.ctx.storage.sql.exec("DELETE FROM learning_gadget_updates");
  }
}
