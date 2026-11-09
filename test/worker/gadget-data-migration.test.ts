import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";

const oldCode = `import { DurableObject } from "cloudflare:workers";
export class Gadget extends DurableObject {
  constructor(ctx,env) { super(ctx,env); this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS progress (id INTEGER PRIMARY KEY, completed INTEGER NOT NULL)"); }
  async render() { return '<p>Completed: ' + (this.ctx.storage.sql.exec("SELECT completed FROM progress WHERE id=1").toArray()[0]?.completed ?? 0) + '</p>'; }
  async handleAction(action) { if(action !== "complete") throw new Error("Bad action"); this.ctx.storage.sql.exec("INSERT INTO progress VALUES(1,1) ON CONFLICT(id) DO UPDATE SET completed=completed+1"); }
}`;
const updatedCode = `import { DurableObject } from "cloudflare:workers";
export class Gadget extends DurableObject {
  constructor(ctx,env) { super(ctx,env); this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS progress (id INTEGER PRIMARY KEY, completed INTEGER NOT NULL)"); this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY, title TEXT NOT NULL)"); }
  async render() {
    const progress=this.ctx.storage.sql.exec("SELECT completed FROM progress WHERE id=1").toArray()[0]?.completed ?? 0;
    const cards=this.ctx.storage.sql.exec("SELECT title FROM cards ORDER BY id").toArray();
    return '<p>Completed: ' + progress + '</p>' + cards.map(card => '<p>Card: ' + card.title.replaceAll('&','&amp;').replaceAll('<','&lt;') + '</p>').join('');
  }
  async handleAction(action,data) {
    if(action === "complete") this.ctx.storage.sql.exec("INSERT INTO progress VALUES(1,1) ON CONFLICT(id) DO UPDATE SET completed=completed+1");
    else if (action === "add-card" && typeof data.title === "string" && data.title.length < 80) this.ctx.storage.sql.exec("INSERT INTO cards(title) VALUES(?)",data.title);
    else if (action === "rename-card" && typeof data.title === "string" && data.title.length < 80) this.ctx.storage.sql.exec("UPDATE cards SET title=? WHERE id=1",data.title);
    else throw new Error("Bad action or data");
  }
}`;

it("adds code-learning cards and edits gadget data without losing completed progress", async () => {
  const bindings = env as CloudflareBindings;
  const id = crypto.randomUUID();
  const stub = bindings.LEARNING_SESSIONS.getByName(id);
  await stub.create({
    id,
    owner: "personal",
    title: "Daily cards",
    type: "general",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archived: false,
    pinned: false,
    private: false,
  });
  const gadget = await stub.createGadget(
    "personal",
    "starter-deck",
    "Daily",
    oldCode,
    [{ action: "complete", data: {}, expectText: "Completed: 1" }],
  );
  await stub.actOnGadget("personal", gadget.id, "complete", {});
  await stub.actOnGadget("personal", gadget.id, "complete", {});
  const incompatible = oldCode
    .replace(
      "completed INTEGER NOT NULL)",
      "completed INTEGER NOT NULL, extra TEXT NOT NULL DEFAULT 'kept')",
    )
    .replace(
      "SELECT completed FROM progress",
      "SELECT completed,extra FROM progress",
    )
    .replace(
      "INSERT INTO progress VALUES(1,1)",
      "INSERT INTO progress(id,completed) VALUES(1,1)",
    );
  const rejectedSchema = await runInDurableObject(stub, async (instance) => {
    try {
      await instance.updateGadget(
        "personal",
        gadget.id,
        "bad-schema",
        1,
        "Broken",
        incompatible,
        [{ action: "complete", data: {}, expectText: "Completed: 1" }],
      );
      return false;
    } catch {
      return true;
    }
  });
  expect(rejectedSchema).toBe(true);
  expect(await stub.renderGadget("personal", gadget.id)).toContain(
    "Completed: 2",
  );
  expect((await stub.listGadgets("personal"))[0].generation).toBe(1);
  const updated = await stub.updateGadget(
    "personal",
    gadget.id,
    "add-first-card",
    1,
    "Daily",
    updatedCode,
    [
      {
        action: "add-card",
        data: { title: "Closures" },
        expectText: "Card: Closures",
      },
    ],
    [
      {
        action: "add-card",
        data: { title: "Durable Objects" },
        expectText: "Card: Durable Objects",
      },
    ],
  );
  expect(updated.id).toBe(gadget.id);
  expect(updated.generation).toBe(2);
  expect(await stub.renderGadget("personal", gadget.id)).toContain(
    "Completed: 2",
  );
  expect(await stub.renderGadget("personal", gadget.id)).toContain(
    "Card: Durable Objects",
  );
  const edited = await stub.updateGadgetData(
    "personal",
    gadget.id,
    "rename-first-card",
    2,
    [
      {
        action: "rename-card",
        data: { title: "Workers RPC" },
        expectText: "Card: Workers RPC",
      },
    ],
  );
  expect(edited.generation).toBe(3);
  expect(await stub.renderGadget("personal", gadget.id)).toContain(
    "Completed: 2",
  );
  expect(await stub.renderGadget("personal", gadget.id)).toContain(
    "Card: Workers RPC",
  );
  const rejected = await runInDurableObject(stub, async (instance) => {
    try {
      await instance.updateGadgetData(
        "personal",
        gadget.id,
        "bad-card-edit",
        3,
        [
          {
            action: "rename-card",
            data: { title: "Lose state" },
            expectText: "Card: not actually there",
          },
        ],
      );
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
  const retained = await stub.renderGadget("personal", gadget.id);
  expect(retained).toContain("Completed: 2");
  expect(retained).toContain("Card: Workers RPC");
  expect(retained).not.toContain("Lose state");
  await stub.remove("personal");
}, 50_000);
