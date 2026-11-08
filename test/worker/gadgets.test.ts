import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import app from "../../src/app.ts";
import { gadgetPage } from "../../src/lib/gadget-page.ts";
import type {
  SessionMetadata,
  SessionSnapshot,
} from "../../src/runtime/contracts.ts";

const code = `import { DurableObject } from "cloudflare:workers";
export class Gadget extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)"); }
  async render() {
    const row = this.ctx.storage.sql.exec("SELECT value FROM counter WHERE id=1").toArray()[0];
    return '<!doctype html><html><body><h1>Count: ' + (row?.value ?? 0) + '</h1><form method="post"><input type="hidden" name="_action" value="increment"><button>Add</button></form><script>alert(1)</script></body></html>';
  }
  async handleAction(action, data) {
    if (action !== "increment") throw new Error("Unknown action");
    this.ctx.storage.sql.exec("INSERT INTO counter(id,value) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET value=value+1");
  }
}`;

it("preflights a durable gadget, isolates test state, renders only safe forms and deletes with its session", async () => {
  const bindings = { ...env, DEV_AUTH: "local" } as CloudflareBindings;
  const id = crypto.randomUUID();
  const stub = bindings.LEARNING_SESSIONS.getByName(id);
  const metadata: SessionMetadata = {
    id,
    owner: "personal",
    title: "Gadget lesson",
    type: "general",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archived: false,
    pinned: false,
    private: false,
  };
  await stub.create(metadata);
  const created = await stub.createGadget(
    "personal",
    "task-one",
    "Counter",
    code,
    [{ action: "increment", data: {}, expectText: "Count: 1" }],
  );
  expect(
    (
      (await (await stub.snapshot("personal")).json()) as SessionSnapshot
    ).gadgets?.map((g) => g.id),
  ).toEqual([created.id]);
  const path = `/api/sessions/${id}/gadgets/${created.id}`;
  const get = () => app.fetch(new Request(`http://localhost${path}`), bindings);
  const first = await get();
  expect(first.status).toBe(200);
  expect(first.headers.get("Content-Security-Policy")).toContain(
    "script-src 'none'",
  );
  expect(first.headers.get("Referrer-Policy")).toBe("same-origin");
  const html = await first.text();
  expect(html).toContain("Count: 0");
  expect(html).not.toContain("<script>");
  expect(html).toContain(`action="${path}"`);
  expect(html).toContain(
    'name="viewport" content="width=device-width,initial-scale=1"',
  );
  expect(html).toContain(`href="/sessions/${id}"`);
  const malicious = await gadgetPage(
    '<html><body><a href="https://example.invalid/">outside</a><img src="https://example.invalid/x" onerror="alert(1)"><form action="https://example.invalid/" method="get"><button formaction="https://example.invalid/">Go</button></form></body></html>',
    path,
    `/sessions/${id}`,
  ).text();
  expect(malicious).not.toContain("example.invalid");
  expect(malicious).not.toContain("onerror");
  expect(malicious).toContain(`action="${path}"`);
  const form = (origin = "http://localhost") =>
    app.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: origin,
        },
        body: "_action=increment",
      }),
      bindings,
    );
  expect((await form("https://example.invalid")).status).toBe(403);
  expect(
    (
      await app.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: "http://localhost",
          },
          body: `_action=increment&extra=${"x".repeat(17_000)}`,
        }),
        bindings,
      )
    ).status,
  ).toBe(400);
  expect((await form()).status).toBe(303);
  expect(
    (
      await stub.createGadget("personal", "task-one", "Counter", code, [
        { action: "increment", data: {}, expectText: "Count: 1" },
      ])
    ).id,
  ).toBe(created.id);
  const failed = await runInDurableObject(stub, async (instance) => {
    try {
      await instance.createGadget("personal", "broken", "Bad", code, [
        { action: "increment", data: {}, expectText: "Never rendered" },
      ]);
      return false;
    } catch {
      return true;
    }
  });
  expect(failed).toBe(true);
  expect(
    ((await (await stub.snapshot("personal")).json()) as SessionSnapshot)
      .gadgets,
  ).toHaveLength(1);
  expect(await (await get()).text()).toContain("Count: 1");
  const otherId = crypto.randomUUID();
  const other = bindings.LEARNING_SESSIONS.getByName(otherId);
  await other.create({ ...metadata, id: otherId });
  expect(
    (
      await app.fetch(
        new Request(
          `http://localhost/api/sessions/${otherId}/gadgets/${created.id}`,
        ),
        bindings,
      )
    ).status,
  ).toBe(404);
  const anonymous = await app.fetch(new Request(`http://localhost${path}`), {
    ...bindings,
    DEV_AUTH: undefined,
  } as CloudflareBindings);
  expect(anonymous.status).not.toBe(200);
  await stub.remove("personal");
  await other.remove("personal");
  expect((await get()).status).not.toBe(200);
}, 50_000);
