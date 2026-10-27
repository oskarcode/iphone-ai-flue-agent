// Exercise direct Pi submission and historical activity in real Durable Object SQLite.
import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import app from "../../src/app.ts";
import { ActivityJournal } from "../../src/runtime/activity.ts";
import type { SessionSnapshot, SessionMetadata } from "../../src/runtime/contracts.ts";
import type { SubmissionId } from "@earendil-works/pi-durable";

it("submits a workspace message directly to Pi, preserving text and retry key", async () => {
  const calls: unknown[][] = [];
  const bindings = {
    ...env,
    DEV_AUTH: "local",
    LEARNING_SESSIONS: { getByName: () => ({
      exists: async () => true,
      submit: async (...args: unknown[]) => {
        calls.push(args);
        return { sessionId: "12345678", submissionId: "1" };
      },
    }) },
  } as unknown as CloudflareBindings;
  const response = await app.fetch(new Request("http://localhost/api/sessions/12345678/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Find current Workers docs", requestId: "browser-routing-test" }),
  }), bindings);
  expect(response.status).toBe(202);
  expect(calls).toEqual([["personal", "Find current Workers docs", "browser-routing-test"]]);
});

it("does not expose retired learning Shortcut and legacy chat routes", async () => {
  const bindings = { ...env, DEV_AUTH: "local" } as CloudflareBindings;
  for (const path of ["/v1/ask", "/handoff", "/v1/chat-session", "/chat/api", "/chat/stream", "/learn/12345678/chat", "/v1/learning-sessions/12345678"]) {
    const response = await app.fetch(new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Do not create a session" }),
    }), bindings);
    expect(response.status, path).toBe(404);
  }
  expect((await app.fetch(new Request("http://localhost/chat/session/12345678"), bindings)).status).toBe(404);
});

it("retains old classified activity without generating an answer", async () => {
  const id = crypto.randomUUID();
  const stub = (env as CloudflareBindings).LEARNING_SESSIONS.getByName(id);
  const metadata: SessionMetadata = {
    id, owner: "personal", title: "Historical routing fixture", type: "general",
    private: false, archived: false, pinned: false, createdAt: "now", updatedAt: "now",
  };
  await stub.create(metadata);
  const decision = { route: "visual_explanation", source: "jev" } as const;
  const denied = await runInDurableObject(stub, async (instance) => {
    try {
      await instance.recordRouting("wrong-owner", "routing-request", decision);
      return false;
    } catch { return true; }
  });
  expect(denied).toBe(true);
  await stub.recordRouting("personal", "routing-request", decision);
  await stub.recordRouting("personal", "routing-request", decision);
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("DELETE FROM learning_activity");
  });
  await stub.recordRouting("personal", "routing-request", {
    route: "direct_answer", source: "jev",
  });
  await evictDurableObject(stub);
  const snap = (await (await stub.snapshot("personal")).json()) as SessionSnapshot;
  expect(snap.busy).toBe(false);
  expect(snap.messages).toEqual([]);
  expect(snap.activity).toHaveLength(1);
  expect(snap.activity![0].routingOnly).toBe(true);
  expect(snap.activity![0].steps[0].label).toBe("Jev decision → Visual explanation (visual_explanation)");
  const exported = JSON.parse(await stub.exportPage("personal"));
  expect(exported.activity).toHaveLength(1);
  expect(exported.entries.filter((entry: { kind: string }) => entry.kind === "learning.routing")).toHaveLength(1);
  await stub.remove("personal");
  const rows = await runInDurableObject(stub, (_instance, state) => state.storage.sql
    .exec<{ count: number }>("SELECT COUNT(*) AS count FROM learning_activity").one().count);
  expect(rows).toBe(0);
});

it("keeps historical routing on its turn through activity truncation", async () => {
  const stub = (env as CloudflareBindings).LEARNING_SESSIONS.getByName(crypto.randomUUID());
  await runInDurableObject(stub, (_instance, state) => {
    const journal = new ActivityJournal(state.storage.sql);
    journal.routing("1", { route: "web_research", source: "jev" });
    journal.routing("1", { route: "direct_answer", source: "jev" });
    journal.routing("2");
    journal.record([{ type: "run_start", inputs: [1 as SubmissionId] }]);
    for (let i = 0; i < 100; i++) journal.record([{
      type: "tool_execution_start", toolCallId: `call-${i}`, toolName: "web_research", args: {},
    }]);
    const turns = journal.list([], true);
    expect(turns[0].steps).toHaveLength(80);
    expect(turns[0].steps[0].label).toContain("Jev decision → Web research");
    expect(turns[1].steps[0].label).toBe("Direct to Pi tutor");
  });
});
