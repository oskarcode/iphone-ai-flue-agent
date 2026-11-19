import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { newWebSocketRpcSession } from "capnweb";
import app from "../../src/app.ts";
import type { SessionMetadata } from "../../src/runtime/contracts.ts";
import { RPC_LEARNING_LAB_SERVER, RPC_LEARNING_LAB_CLIENT, RPC_LEARNING_LAB_TESTS } from "../../src/lib/rpc-learning-lab.ts";

const server = `import { DurableObject } from 'cloudflare:workers';
export class Gadget extends DurableObject {
  constructor(ctx, env) { super(ctx, env); ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS cards(id INTEGER PRIMARY KEY, title TEXT NOT NULL)'); }
  healthCheck() { return true; }
  async addCard(title) { this.ctx.storage.sql.exec('INSERT INTO cards(title) VALUES(?)', title); return title; }
  async listCards() { return this.ctx.storage.sql.exec('SELECT title FROM cards ORDER BY id').toArray().map(row => row.title); }
  async saveMedia() {
    const asset = await this.env.MEDIA.put({ name: 'note.txt', contentType: 'text/plain', bytes: new TextEncoder().encode('Saved media') });
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS media(id TEXT NOT NULL)');
    this.ctx.storage.sql.exec('INSERT INTO media(id) VALUES(?)', asset.id);
    return 'saved';
  }
  async mediaText() {
    const row = this.ctx.storage.sql.exec('SELECT id FROM media LIMIT 1').toArray()[0];
    const asset = row ? await this.env.MEDIA.get(row.id) : null;
    return asset ? new TextDecoder().decode(asset.bytes) : 'missing';
  }
}`;
const client = `export default { async main(gadget) {
  const button = document.createElement('button'); button.textContent = 'Add card';
  const status = document.createElement('p');
  button.onclick = async () => { await gadget.addCard('TypeScript'); status.textContent = (await gadget.listCards()).join(', '); };
  document.body.append(button, status);
} };`;

it("ships a reviewed learning lab with durable authoring, answer feedback and R2 media", async () => {
  const bindings = { ...env, DEV_AUTH: "local" } as CloudflareBindings;
  const id = crypto.randomUUID();
  const result = await app.fetch(new Request("http://localhost/api/learning-lab", {
    method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: id }),
  }), bindings);
  expect(result.status).toBe(201);
  const created = await result.json() as { gadgetId: string; url: string };
  expect(created.url).toBe(`/gadget/${id}/${created.gadgetId}`);
  const stub = bindings.LEARNING_SESSIONS.getByName(id);
  try {
    expect((await stub.listGadgets("personal"))[0]?.mode).toBe("rpc");
    expect(RPC_LEARNING_LAB_CLIENT).toContain("Check answer");
    expect(RPC_LEARNING_LAB_SERVER).toContain("MEDIA.put");
    expect(RPC_LEARNING_LAB_TESTS).toHaveLength(2);
    expect((await app.fetch(new Request(`http://localhost${created.url}`), bindings)).status).toBe(200);
    expect((await app.fetch(new Request("http://localhost/api/learning-lab", {
      method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ requestId: id }),
    }), bindings)).status).toBe(201);
    expect(await stub.listGadgets("personal")).toHaveLength(1);
  } finally { await stub.remove("personal"); }
}, 60_000);

it("publishes an RPC learning gadget only after method preflight, without changing server-rendered gadgets", async () => {
  const bindings = { ...env, DEV_AUTH: "local" } as CloudflareBindings;
  const id = crypto.randomUUID();
  const stub = bindings.LEARNING_SESSIONS.getByName(id);
  const metadata: SessionMetadata = {
    id, owner: "personal", title: "Interactive cards", type: "general",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    archived: false, pinned: false, private: false,
  };
  await stub.create(metadata);
  try {
    const created = await stub.createRpcGadget("personal", "rpc-card-task", "Interactive cards", server, client, [
      { method: "addCard", args: ["Preflight only"], expect: "Preflight only" },
      { method: "listCards", args: [], expect: ["Preflight only"] },
      { method: "saveMedia", args: [], expect: "saved" },
      { method: "mediaText", args: [], expect: "Saved media" },
    ]);
    expect(created.mode).toBe("rpc");
    expect((await stub.listGadgets("personal"))[0]?.mode).toBe("rpc");
    const url = `http://localhost/gadget/${id}/${created.id}`;
    const page = await app.fetch(new Request(url), bindings);
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Security-Policy")).toContain("strict-dynamic");
    const ui = await app.fetch(new Request(`http://localhost/api/sessions/${id}/gadgets/${created.id}/ui`), bindings);
    expect(ui.status).toBe(200);
    expect(ui.headers.get("Content-Security-Policy")).toContain("script-src data:");
    expect(ui.headers.get("Content-Security-Policy")).not.toContain("strict-dynamic");
    expect(await ui.text()).toContain("learning.gadget.connect");
    const rpcPath = `http://localhost/api/sessions/${id}/gadgets/${created.id}/rpc`;
    expect((await app.fetch(new Request(rpcPath), bindings)).status).toBe(426);
    expect((await app.fetch(new Request(rpcPath, { headers: { Upgrade: "websocket", Origin: "https://other.invalid" } }), bindings)).status).toBe(403);
    const socket = await app.fetch(new Request(rpcPath, { headers: { Upgrade: "websocket", Origin: "http://localhost" } }), bindings);
    expect(socket.status).toBe(101);
    socket.webSocket?.accept();
    const api = newWebSocketRpcSession<{ getUiBundle(): Promise<{ code: string }>; connectToGadget(): Promise<{ listCards(): Promise<string[]>; addCard(title: string): Promise<string> }> }>(socket.webSocket!);
    expect((await api.getUiBundle()).code).toContain("Add card");
    const gadget = await api.connectToGadget();
    expect(await gadget.listCards()).toEqual([]);
    await gadget.addCard("Saved across update");
    expect(await gadget.listCards()).toEqual(["Saved across update"]);
    api[Symbol.dispose]();
    const updated = await stub.updateRpcGadget("personal", created.id, "update-task", 1, "Cards updated", server, client + "\n", [
      { method: "addCard", args: ["Preflight only"], expect: "Preflight only" },
      { method: "listCards", args: [], expect: ["Preflight only"] },
    ]);
    expect(updated).toMatchObject({ id: created.id, mode: "rpc", generation: 2 });
    const second = await app.fetch(new Request(rpcPath, { headers: { Upgrade: "websocket", Origin: "http://localhost" } }), bindings);
    second.webSocket?.accept();
    const newApi = newWebSocketRpcSession<{ connectToGadget(): Promise<{ listCards(): Promise<string[]> }> }>(second.webSocket!);
    expect(await (await newApi.connectToGadget()).listCards()).toEqual(["Saved across update"]);
    newApi[Symbol.dispose]();
    const otherId = crypto.randomUUID();
    const missing = await app.fetch(new Request(`http://localhost/gadget/${otherId}/${created.id}`), bindings);
    expect(missing.status).not.toBe(200);
    const anonymous = await app.fetch(new Request(url), { ...bindings, DEV_AUTH: undefined } as CloudflareBindings);
    expect(anonymous.status).not.toBe(200);
  } finally { await stub.remove("personal"); }
}, 60_000);
