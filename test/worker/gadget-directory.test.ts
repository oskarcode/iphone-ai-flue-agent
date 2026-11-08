import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import app from "../../src/app.ts";
import type { SessionMetadata } from "../../src/runtime/contracts.ts";

const source = `import { DurableObject } from "cloudflare:workers";
export class Gadget extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)"); }
  async render() { const row=this.ctx.storage.sql.exec("SELECT value FROM counter WHERE id=1").toArray()[0]; return '<html><body><h1>Count: ' + (row?.value ?? 0) + '</h1><form><input name="_action" value="add"><button>Add</button></form></body></html>'; }
  async handleAction(action) { if(action!=="add") throw new Error("Unknown action"); this.ctx.storage.sql.exec("INSERT INTO counter(id,value) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET value=value+1"); }
}`;
const tests = (expected: string) => [
  { action: "add", data: {}, expectText: expected },
];

it("lists gadgets across archived/private lessons, updates in place with CAS and supports owner-checked deletion", async () => {
  const bindings = { ...env, DEV_AUTH: "local" } as CloudflareBindings;
  const meta = (
    id: string,
    title: string,
    archived = false,
  ): SessionMetadata => ({
    id,
    owner: "personal",
    title,
    type: "general",
    archived,
    private: archived,
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const firstId = crypto.randomUUID(),
    secondId = crypto.randomUUID();
  const first = bindings.LEARNING_SESSIONS.getByName(firstId);
  const second = bindings.LEARNING_SESSIONS.getByName(secondId);
  await first.create(meta(firstId, "First lesson"));
  await second.create(meta(secondId, "Private archived lesson", true));
  const gadget = await first.createGadget(
    "personal",
    "first-create",
    "Counter",
    source,
    tests("Count: 1"),
  );
  const other = await second.createGadget(
    "personal",
    "second-create",
    "Other",
    source,
    tests("Count: 1"),
  );
  const directory = await app.fetch(
    new Request("http://localhost/api/gadgets"),
    bindings,
  );
  expect(directory.status).toBe(200);
  const listed = (await directory.json()) as {
    gadgets: {
      id: string;
      sessionId: string;
      sessionTitle: string;
      code?: string;
    }[];
    nextOffset?: number;
  };
  expect(listed.gadgets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: gadget.id,
        sessionId: firstId,
        sessionTitle: "First lesson",
      }),
      expect.objectContaining({
        id: other.id,
        sessionId: secondId,
        sessionTitle: "Private archived lesson",
      }),
    ]),
  );
  expect(listed.gadgets.every((item) => item.code === undefined)).toBe(true);
  expect(
    (
      await app.fetch(
        new Request("http://localhost/api/gadgets?offset=-1"),
        bindings,
      )
    ).status,
  ).toBe(400);
  const url = `/api/sessions/${firstId}/gadgets/${gadget.id}`;
  const form = () =>
    app.fetch(
      new Request(`http://localhost${url}`, {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "_action=add",
      }),
      bindings,
    );
  expect((await form()).status).toBe(303);
  expect(
    await (
      await app.fetch(new Request(`http://localhost${url}`), bindings)
    ).text(),
  ).toContain("Count: 1");
  const replacement = source.replace("Count: ", "Total: ");
  const failed = await runInDurableObject(first, async (instance) => {
    try {
      await instance.updateGadget(
        "personal",
        gadget.id,
        "bad-edit",
        1,
        "Counter v2",
        replacement,
        tests("not visible"),
      );
      return false;
    } catch {
      return true;
    }
  });
  expect(failed).toBe(true);
  expect(
    await (
      await app.fetch(new Request(`http://localhost${url}`), bindings)
    ).text(),
  ).toContain("Count: 1");
  const edited = await first.updateGadget(
    "personal",
    gadget.id,
    "good-edit",
    1,
    "Counter v2",
    replacement,
    tests("Total: 1"),
  );
  expect(edited.id).toBe(gadget.id);
  expect(edited.generation).toBe(2);
  expect(await first.listGadgets("personal")).toHaveLength(1);
  expect(
    await (
      await app.fetch(new Request(`http://localhost${url}`), bindings)
    ).text(),
  ).toContain("Total: 0"); // New class has fresh state.
  expect((await form()).status).toBe(303);
  expect(
    await (
      await app.fetch(new Request(`http://localhost${url}`), bindings)
    ).text(),
  ).toContain("Total: 1");
  expect(
    (
      await first.updateGadget(
        "personal",
        gadget.id,
        "good-edit",
        1,
        "ignored",
        source,
        tests("Count: 1"),
      )
    ).generation,
  ).toBe(2); // Task replay.
  const stale = await runInDurableObject(first, async (instance) => {
    try {
      await instance.updateGadget(
        "personal",
        gadget.id,
        "stale-edit",
        1,
        "Stale",
        source,
        tests("Count: 1"),
      );
      return false;
    } catch {
      return true;
    }
  });
  expect(stale).toBe(true);
  const denied = await app.fetch(
    new Request(`http://localhost${url}`, {
      method: "DELETE",
      headers: {
        Origin: "https://example.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expectedGeneration: 2 }),
    }),
    bindings,
  );
  expect(denied.status).toBe(403);
  expect(
    (
      await app.fetch(
        new Request(`http://localhost${url}`, {
          method: "DELETE",
          headers: {
            Origin: "http://localhost",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ expectedGeneration: 1 }),
        }),
        bindings,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await app.fetch(
        new Request(`http://localhost${url}`, {
          method: "DELETE",
          headers: {
            Origin: "http://localhost",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ expectedGeneration: 2 }),
        }),
        bindings,
      )
    ).status,
  ).toBe(204);
  expect(await first.listGadgets("personal")).toEqual([]);
  expect(
    (await app.fetch(new Request(`http://localhost${url}`), bindings)).status,
  ).toBe(404);
  expect(
    (
      (await (
        await app.fetch(new Request("http://localhost/api/gadgets"), bindings)
      ).json()) as { gadgets: { id: string }[] }
    ).gadgets.map((item) => item.id),
  ).not.toContain(gadget.id);
  await first.remove("personal");
  await second.remove("personal");
}, 60_000);

it("migrates pre-directory gadget rows without changing their IDs or source", async () => {
  const bindings = env as CloudflareBindings;
  const id = crypto.randomUUID();
  const stub = bindings.LEARNING_SESSIONS.getByName(id);
  await stub.create({
    id,
    owner: "personal",
    title: "Older gadget lesson",
    type: "general",
    private: false,
    pinned: false,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("DROP TABLE learning_gadgets");
    state.storage.sql.exec(
      "CREATE TABLE learning_gadgets (id TEXT PRIMARY KEY,title TEXT NOT NULL,code TEXT NOT NULL,createdAt TEXT NOT NULL)",
    );
    state.storage.sql.exec(
      "INSERT INTO learning_gadgets VALUES(?,?,?,?)",
      "gadget-legacy-test",
      "Original",
      source,
      "2026-01-01T00:00:00Z",
    );
  });
  await evictDurableObject(stub);
  expect(await stub.listGadgets("personal")).toEqual([
    {
      id: "gadget-legacy-test",
      title: "Original",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      generation: 1,
    },
  ]);
  const html = await stub.renderGadget("personal", "gadget-legacy-test");
  expect(html).toContain("Count: 0");
  await stub.remove("personal");
}, 30_000);
