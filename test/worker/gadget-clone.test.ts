import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

const code = `import { DurableObject } from "cloudflare:workers";
export class Gadget extends DurableObject {
  constructor(ctx,env) { super(ctx,env); this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)"); }
  async render() { return "Count: " + (this.ctx.storage.sql.exec("SELECT value FROM state WHERE id=1").toArray()[0]?.value ?? 0); }
  async handleAction(action) { if(action!=="add") throw new Error("wrong action"); this.ctx.storage.sql.exec("INSERT INTO state VALUES(1,1) ON CONFLICT(id) DO UPDATE SET value=value+1"); }
}`;

it("can clone a running facet's SQLite and restart it with a new dynamic class without touching the original", async () => {
  const bindings = env as CloudflareBindings;
  const id = crypto.randomUUID();
  const session = bindings.LEARNING_SESSIONS.getByName(id);
  await session.create({
    id,
    owner: "personal",
    title: "Clone trial",
    type: "general",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archived: false,
    pinned: false,
    private: false,
  });
  const gadget = await session.createGadget(
    "personal",
    "clone-test",
    "Count",
    code,
    [{ action: "add", data: {}, expectText: "Count: 1" }],
  );
  await session.actOnGadget("personal", gadget.id, "add", {});
  const result = await runInDurableObject(session, async (_instance, state) => {
    const clone = gadget.id + ":v2";
    state.facets.clone(gadget.id, clone);
    const worker = bindings.SKILL_LOADER.get("clone-trial:" + id, () => ({
      compatibilityDate: "2026-10-13",
      mainModule: "worker.js",
      modules: { "worker.js": code.replace("Count: ", "Total: ") },
      globalOutbound: null,
    }));
    const facet = state.facets.get(clone, () => ({
      class: worker.getDurableObjectClass("Gadget"),
      id: clone,
    })) as unknown as {
      render(): Promise<string>;
      handleAction(action: string): Promise<void>;
    };
    const before = await facet.render();
    await facet.handleAction("add");
    const after = await facet.render();
    state.facets.delete(clone);
    return { before, after };
  });
  expect(result).toEqual({ before: "Total: 1", after: "Total: 2" });
  expect(await session.renderGadget("personal", gadget.id)).toBe("Count: 1");
  await session.remove("personal");
}, 40_000);
