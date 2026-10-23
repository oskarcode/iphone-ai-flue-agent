// Exercise real SQLite persistence and the HTTP adapter without external model or GitHub calls.
import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import app from "../../src/app.ts";
import * as routing from "../../src/tools/jev-router.ts";
import { ActivityJournal } from "../../src/runtime/activity.ts";
import type {
  SessionSnapshot,
  SessionMetadata,
} from "../../src/runtime/contracts.ts";
import type { SubmissionId } from "@earendil-works/pi-durable";

afterEach(() => vi.restoreAllMocks());

/** Input: a repository Shortcut request. Output: unchanged 202 handoff plus its persisted rule decision.
 * What this function does: covers routing paths that return a URL without submitting an answer turn.
 */
it("records routing before returning a repository Shortcut handoff", async () => {
  const decision = { route: "github_learning", source: "github_rule" } as const;
  vi.spyOn(routing, "classifyRequest").mockResolvedValue(decision);
  const recordRouting = vi.fn(async () => {});
  const stub = {
    exists: async () => true,
    getMetadata: async () => ({ repository: { fullName: "example/repo" } }),
    recordRouting,
  };
  const bindings = {
    ...env,
    DEV_AUTH: "local",
    LEARNING_SESSIONS: { getByName: () => stub },
  } as unknown as CloudflareBindings;
  const response = await app.fetch(
    new Request("http://localhost/v1/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "routing-ask-test",
      },
      body: JSON.stringify({ text: "https://github.com/example/repo" }),
    }),
    bindings,
  );
  expect(response.status).toBe(202);
  expect(recordRouting).toHaveBeenCalledWith(
    "personal",
    "routing-ask-test",
    decision,
  );
  expect(await response.json()).toMatchObject({
    route: "github_learning",
    status: "ready",
    learning_url: expect.stringContaining("/learn/"),
  });
});

/** Input: passive classified handoff. Output: retained routing panel with no model turn.
 * What this function does: verifies deduplication, authorization, eviction, export and permanent deletion.
 */
it("retains classified handoff decisions without generating an answer", async () => {
  const id = crypto.randomUUID();
  const stub = (env as CloudflareBindings).LEARNING_SESSIONS.getByName(id);
  const metadata: SessionMetadata = {
    id,
    owner: "personal",
    title: "Routing fixture",
    type: "general",
    private: false,
    archived: false,
    pinned: false,
    createdAt: "now",
    updatedAt: "now",
  };
  await stub.create(metadata);
  const decision = { route: "visual_explanation", source: "jev" } as const;
  const denied = await runInDurableObject(stub, async (instance) => {
    try {
      await instance.recordRouting("wrong-owner", "routing-request", decision);
      return false;
    } catch {
      return true;
    }
  });
  expect(denied).toBe(true);
  await stub.recordRouting("personal", "routing-request", decision);
  await stub.recordRouting("personal", "routing-request", decision);
  // Recover a lost projection from the original passive record, not a changed retry classification.
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("DELETE FROM learning_activity");
  });
  await stub.recordRouting("personal", "routing-request", {
    route: "direct_answer",
    source: "fallback",
  });
  await evictDurableObject(stub);
  const snap = (await (
    await stub.snapshot("personal")
  ).json()) as SessionSnapshot;
  expect(snap.busy).toBe(false);
  expect(snap.messages).toEqual([]);
  expect(snap.activity).toHaveLength(1);
  expect(snap.activity![0].routingOnly).toBe(true);
  expect(snap.activity![0].steps[0].label).toBe(
    "Jev decision → Visual explanation (visual_explanation)",
  );
  const exported = JSON.parse(await stub.exportPage("personal"));
  expect(exported.activity).toHaveLength(1);
  expect(
    exported.entries.filter(
      (entry: { kind: string }) => entry.kind === "learning.routing",
    ),
  ).toHaveLength(1);
  await stub.remove("personal");
  const rows = await runInDurableObject(
    stub,
    (_instance, state) =>
      state.storage.sql
        .exec<{
          count: number;
        }>("SELECT COUNT(*) AS count FROM learning_activity")
        .one().count,
  );
  expect(rows).toBe(0);
});

/** Input: routing for two submissions and a long tool run. Output: correct retained decisions on the matching turns.
 * What this function does: preserves the first recorded decision on retry and keeps it through activity truncation.
 */
it("keeps routing attached to the right turn and preserves it through truncation", async () => {
  const stub = (env as CloudflareBindings).LEARNING_SESSIONS.getByName(
    crypto.randomUUID(),
  );
  await runInDurableObject(stub, (_instance, state) => {
    const journal = new ActivityJournal(state.storage.sql);
    journal.routing("1", { route: "web_research", source: "jev" });
    journal.routing("1", { route: "direct_answer", source: "fallback" });
    journal.routing("2");
    journal.record([{ type: "run_start", inputs: [1 as SubmissionId] }]);
    for (let i = 0; i < 100; i++)
      journal.record([
        {
          type: "tool_execution_start",
          toolCallId: `call-${i}`,
          toolName: "web_research",
          args: {},
        },
      ]);
    const turns = journal.list([], true);
    expect(turns[0].steps).toHaveLength(80);
    expect(turns[0].steps[0].label).toContain("Jev decision → Web research");
    expect(turns[1].steps[0].label).toBe("Direct to Pi tutor — Jev not used");
  });
});

/** Input: compatibility request with a classifier fixture. Output: unchanged response and provenance passed to Pi.
 * What this function does: proves the HTTP handler carries the actual decision rather than only the route name.
 */
it("passes Jev provenance from legacy chat to the exact answer submission", async () => {
  const decision = { route: "web_research", source: "jev" } as const;
  vi.spyOn(routing, "classifyRequest").mockResolvedValue(decision);
  const answer = vi.fn(async () => "Fixture answer");
  const stub = { exists: async () => true, answer };
  const bindings = {
    ...env,
    DEV_AUTH: "local",
    LEARNING_SESSIONS: { getByName: () => stub },
  } as unknown as CloudflareBindings;
  const response = await app.fetch(
    new Request("http://localhost/chat/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "routing-http-test",
      },
      body: JSON.stringify({
        conversation_id: "routing-session",
        messages: [{ role: "user", content: "Research the latest docs" }],
      }),
    }),
    bindings,
  );
  expect(response.status).toBe(200);
  expect(answer).toHaveBeenCalledWith(
    "personal",
    "Research the latest docs",
    "routing-http-test",
    decision,
  );
  expect(await response.json()).toMatchObject({
    route: "web_research",
    answer: "Fixture answer",
  });
});
