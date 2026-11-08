export const MAX_GADGET_SOURCE = 64 * 1024;
export type GadgetTest = {
  action: string;
  data: Record<string, string>;
  expectText: string;
};
export type GadgetSummary = { id: string; title: string; createdAt: string };
type GadgetRow = GadgetSummary & { code: string };
type GadgetFacet = {
  render(): Promise<string>;
  handleAction(action: string, data: Record<string, string>): Promise<void>;
};

/** Per-learning-session registry; generated code and state never live in the transcript or shared Computer. */
export class LearningGadgets {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly loader: WorkerLoader,
  ) {
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS learning_gadgets (id TEXT PRIMARY KEY, title TEXT NOT NULL, code TEXT NOT NULL, createdAt TEXT NOT NULL)",
    );
  }
  list(): GadgetSummary[] {
    return this.ctx.storage.sql
      .exec<GadgetSummary>(
        "SELECT id,title,createdAt FROM learning_gadgets ORDER BY createdAt DESC",
      )
      .toArray();
  }
  private record(id: string): GadgetRow {
    const row = this.ctx.storage.sql
      .exec<GadgetRow>(
        "SELECT id,title,code,createdAt FROM learning_gadgets WHERE id=?",
        id,
      )
      .toArray()[0];
    if (!row) throw new Error("Gadget not found");
    return row;
  }
  private facet(row: GadgetRow): GadgetFacet {
    const stub = this.ctx.facets.get(row.id, () => {
      const worker = this.loader.get(`learning-gadget:${row.id}:v1`, () => ({
        compatibilityDate: "2026-10-13",
        mainModule: "worker.js",
        modules: { "worker.js": row.code },
        globalOutbound: null,
      }));
      return { class: worker.getDurableObjectClass("Gadget"), id: row.id };
    });
    return stub as unknown as GadgetFacet;
  }
  async render(id: string): Promise<string> {
    const html = await this.facet(this.record(id)).render();
    if (typeof html !== "string" || html.length > 256 * 1024)
      throw new Error("Invalid gadget page");
    return html;
  }
  async action(
    id: string,
    action: string,
    data: Record<string, string>,
  ): Promise<void> {
    if (!/^[a-zA-Z][\w-]{0,63}$/.test(action))
      throw new Error("Invalid gadget action");
    await this.facet(this.record(id)).handleAction(action, data);
  }
  async create(
    id: string,
    title: string,
    code: string,
    tests: GadgetTest[],
  ): Promise<GadgetSummary> {
    const existing = this.ctx.storage.sql
      .exec<GadgetSummary>(
        "SELECT id,title,createdAt FROM learning_gadgets WHERE id=?",
        id,
      )
      .toArray()[0];
    if (existing) return existing;
    if (
      !title.trim() ||
      title.length > 120 ||
      !code.trim() ||
      code.length > MAX_GADGET_SOURCE ||
      tests.length < 1 ||
      tests.length > 16
    )
      throw new Error("Invalid gadget specification");
    const createdAt = new Date().toISOString();
    this.ctx.storage.sql.exec(
      "INSERT INTO learning_gadgets(id,title,code,createdAt) VALUES(?,?,?,?)",
      id,
      title.trim(),
      code,
      createdAt,
    );
    try {
      let before = await this.render(id);
      for (const test of tests) {
        if (!test.expectText?.trim() || test.expectText.length > 1000)
          throw new Error("Gadget preflight requires expected visible text");
        await this.action(id, test.action, test.data);
        const html = await this.render(id);
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
      this.ctx.facets.delete(id); // Discard test data before the learner opens the new gadget.
      return { id, title: title.trim(), createdAt };
    } catch (error) {
      this.ctx.facets.delete(id);
      this.ctx.storage.sql.exec("DELETE FROM learning_gadgets WHERE id=?", id);
      throw error;
    }
  }
  deleteAll(): void {
    for (const { id } of this.list()) this.ctx.facets.delete(id);
    this.ctx.storage.sql.exec("DELETE FROM learning_gadgets");
  }
}
