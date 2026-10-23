import { env, exports } from "cloudflare:workers";
import {
  evictDurableObject,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../../src/app.ts";
import type {
  SessionMetadata,
  SessionSnapshot,
} from "../../src/runtime/contracts.ts";

it("nonces trusted scripts and blocks injected scripts on private HTML pages", async () => {
  const response = await app.request("http://localhost/chat", {}, {
    ...env,
    DEV_AUTH: "local",
    ASSETS: {
      fetch: async () =>
        new Response(
          '<script type="module" src="/assets/client.js"></script>',
          { headers: { "Content-Type": "text/html" } },
        ),
    },
  } as unknown as CloudflareBindings);
  expect(response.status).toBe(200);
  const csp = response.headers.get("Content-Security-Policy")!;
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).toContain("frame-ancestors 'none'");
  const nonce = csp.match(/'nonce-([^']+)'/)![1];
  expect(await response.text()).toContain(`nonce="${nonce}"`);
});

const bindings = env as CloudflareBindings;
const make = () => {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const metadata: SessionMetadata = {
    id,
    owner: "personal",
    title: "Persistent lesson",
    type: "general",
    private: false,
    createdAt: now,
    updatedAt: now,
    archived: false,
    pinned: false,
  };
  return { id, metadata, stub: bindings.LEARNING_SESSIONS.getByName(id) };
};
const call = (
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) =>
  exports.default.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

describe("Pi learning persistence in workerd", () => {
  it("retains separate immutable visual artifacts across edits and eviction", async () => {
    const { id, metadata, stub } = make();
    await stub.create(metadata);
    const visual = {
      title: "Original diagram",
      concept: "Transactions",
      analogy: "A workbench",
      summary: "Changes commit together.",
      caption: "Follow the arrows.",
      parts: [
        {
          id: "input",
          label: "Input",
          meaning: "A proposed change",
          role: "Receive work",
        },
        {
          id: "output",
          label: "Output",
          meaning: "Committed data",
          role: "Save work",
        },
      ],
      flow: [{ from: "input", to: "output", label: "Commit" }],
      codeExample: "await transaction.commit();",
    };
    const first = await stub.setVisual("personal", visual);
    const second = await stub.setVisual("personal", {
      ...visual,
      title: "Later diagram",
    });
    expect(first).not.toBe(second);
    await evictDurableObject(stub);
    const original = await call(
      `/visual/${id}?artifact=${encodeURIComponent(first)}`,
    );
    expect(original.status).toBe(200);
    expect(await original.text()).toContain("Original diagram");
    const latest = await call(`/visual/${id}`);
    expect(await latest.text()).toContain("Later diagram");
    expect((await stub.source("personal", first))?.hash).toHaveLength(64);
  });
  it("persists visible imported history, sources and notes across eviction", async () => {
    const { id, metadata, stub } = make();
    await stub.create(metadata);
    await stub.retainInput("personal", "An article we actually read");
    await stub.importMessages("personal", "fixture", [
      { id: "old-user", role: "user", content: "Explain SQLite" },
      {
        id: "old-answer",
        role: "assistant",
        content: "SQLite stores structured data.",
      },
    ]);
    let snap = (await (
      await stub.snapshot("personal")
    ).json()) as SessionSnapshot;
    expect(snap.messages.map((m) => m.content)).toEqual([
      "Explain SQLite",
      "SQLite stores structured data.",
    ]);
    await stub.note(
      "personal",
      "SQLite keeps structured records.",
      snap.messages[1].id,
    );
    await evictDurableObject(stub);
    snap = (await (await stub.snapshot("personal")).json()) as SessionSnapshot;
    expect(snap.notes).toHaveLength(1);
    expect(snap.sources).toHaveLength(1);
    expect(await stub.source("personal", "shared-input")).toMatchObject({
      content: "An article we actually read",
    });
    const directory =
      await bindings.LEARNING_LIBRARY.getByName("personal").list("SQLite");
    expect(directory.items.some((item) => item.id === id)).toBe(true);
    await stub.importMessages("personal", "fixture", [
      { id: "old-user", role: "user", content: "Explain SQLite" },
    ]);
    expect(
      ((await (await stub.snapshot("personal")).json()) as SessionSnapshot)
        .messages,
    ).toHaveLength(2);
  });
  it("enforces owner isolation and rejects wrong-origin mutations", async () => {
    const { id, metadata, stub } = make();
    await stub.create(metadata);
    const denied = await runInDurableObject(stub, async (instance) => {
      try {
        await instance.snapshot("someone-else");
        return false;
      } catch {
        return true;
      }
    });
    expect(denied).toBe(true);
    const response = await exports.default.fetch(
      new Request(`http://localhost/api/sessions/${id}`, {
        method: "PATCH",
        headers: {
          Origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "Attack" }),
      }),
    );
    expect(response.status).toBe(403);
    const noAuth = await exports.default.fetch(
      new Request(`https://iphoneai.oskarcode.com/api/sessions/${id}`),
    );
    expect(noAuth.status).toBe(401);
  });
  it("retries a dirty library projection on an alarm and never resurrects a tombstone", async () => {
    const { id, metadata, stub } = make();
    await stub.create(metadata);
    await stub.retainInput("personal", "A durable source");
    expect(
      await runInDurableObject(stub, (_instance, state) =>
        state.storage.getAlarm(),
      ),
    ).not.toBeNull();
    await evictDurableObject(stub);
    await runDurableObjectAlarm(stub);
    await stub.remove("personal");
    expect(await stub.exists("personal")).toBe(false);
    const rejected = await runInDurableObject(stub, async (instance) => {
      try {
        await instance.create(metadata);
        return false;
      } catch {
        return true;
      }
    });
    expect(rejected).toBe(true);
    await bindings.LEARNING_LIBRARY.getByName("personal").upsert(
      { ...metadata, repository: undefined },
      999,
      "stale projection",
      [],
    );
    expect(
      (
        await bindings.LEARNING_LIBRARY.getByName("personal").list(
          "Persistent lesson",
        )
      ).items.some((item) => item.id === id),
    ).toBe(false);
    await evictDurableObject(stub);
    expect(await stub.exists("personal")).toBe(false);
  });
  it("preserves handoff URL, JSON shape and one-time text consumption", async () => {
    for (const path of ["/handoff", "/v1/chat-session"]) {
      const response = await call(path, { text: "Explain durable state" });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        chat_url: string;
        expires_in_seconds: number;
      };
      expect(Object.keys(body).sort()).toEqual([
        "chat_url",
        "expires_in_seconds",
      ]);
      expect(body.expires_in_seconds).toBe(600);
      const url = new URL(body.chat_url);
      expect(url.pathname).toBe("/chat");
      const id = url.searchParams.get("session")!;
      expect(await (await call(`/chat/session/${id}`)).json()).toEqual({
        text: "Explain durable state",
      });
      expect((await call(`/chat/session/${id}`)).status).toBe(404);
      expect((await call(`/api/sessions/${id}`)).status).toBe(200);
    }
  });
  it("upgrades a reconnectable WebSocket through fetch rather than RPC", async () => {
    const { id, metadata, stub } = make();
    await stub.create(metadata);
    const response = await exports.default.fetch(
      new Request(`http://localhost/api/sessions/${id}/socket`, {
        headers: { Upgrade: "websocket" },
      }),
    );
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeTruthy();
    response.webSocket!.accept();
    response.webSocket!.close(1000, "test complete");
  });
  it("validates old Shortcut endpoint inputs without invoking AI", async () => {
    for (const path of [
      "/v1/ask",
      "/v1/correct",
      "/handoff",
      "/v1/chat-session",
    ]) {
      expect((await call(path, { text: "" })).status).toBe(400);
      expect((await call(path, { text: "x".repeat(30001) })).status).toBe(400);
    }
    expect(await (await call("/health")).json()).toMatchObject({
      status: "ok",
      framework: "pi-durable",
    });
  });
  it("exports all retained records and serves approval proposals without executing them", async () => {
    const { id, metadata, stub } = make();
    await stub.create(metadata);
    await stub.importMessages("personal", "export", [
      { id: "1", role: "user", content: "Keep this" },
    ]);
    const page = JSON.parse(await stub.exportPage("personal"));
    expect(
      page.entries.some(
        (entry: { kind: string }) => entry.kind === "learning.import",
      ),
    ).toBe(true);
    const response = await call(`/api/sessions/${id}/export`);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(new TextDecoder().decode(await response.arrayBuffer())).toContain(
      "Keep this",
    );
  });
});
