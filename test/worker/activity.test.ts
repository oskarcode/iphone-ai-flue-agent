// Real DO SQLite verifies the sanitized journal independently of remote model/network availability.
import { env } from "cloudflare:workers";
import { runInDurableObject, evictDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  watchEvents,
  type AgentEvent,
  type SubmissionId,
  type EntryId,
  type ConversationId,
} from "@earendil-works/pi-durable";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxText,
} from "@earendil-works/pi-ai";
import { ActivityJournal } from "../../src/runtime/activity.ts";
import type { SessionMetadata } from "../../src/runtime/contracts.ts";

/** Input: deterministic turn identity/status. Output: a real Pi-shaped submission event.
 * What this function does: makes stable entry associations explicit in privacy/isolation fixtures.
 */
function submission(
  id: number,
  entry: number,
  status: "placed" | "done" = "placed",
): AgentEvent {
  const base = {
    id: id as SubmissionId,
    conversationId: 1 as ConversationId,
    type: "input" as const,
    entry: entry as EntryId,
  };
  return {
    type: "submission",
    record:
      status === "done"
        ? { ...base, status, answer: (entry + 1) as EntryId }
        : { ...base, status },
  };
}

/** Input: local DO and synthetic content-bearing events. Output: durable, isolated, redacted progress.
 * What this function does: tests per-submission association, reload persistence, paging and complete deletion.
 */
it("persists per-turn activity without raw tool arguments, output, reasoning or errors", async () => {
  const id = crypto.randomUUID();
  const stub = (env as CloudflareBindings).LEARNING_SESSIONS.getByName(id);
  const metadata: SessionMetadata = {
    id,
    owner: "personal",
    title: "Activity test",
    type: "general",
    private: false,
    pinned: false,
    archived: false,
    createdAt: "now",
    updatedAt: "now",
  };
  await stub.create(metadata);
  await runInDurableObject(stub, (_instance, state) => {
    const journal = new ActivityJournal(state.storage.sql);
    journal.record([
      submission(10, 100),
      { type: "run_start", inputs: [10 as SubmissionId] },
      {
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "read_repository_file",
        args: { token: "DO-NOT-EXPOSE" },
      },
      {
        type: "tool_execution_update",
        toolCallId: "call-1",
        toolName: "read_repository_file",
        output: { set: "DO-NOT-EXPOSE" },
      },
      {
        type: "auto_retry_start",
        attempt: 1,
        at: 1,
        errorMessage: "DO-NOT-EXPOSE",
      },
      submission(20, 200), // A different placed input must not steal the active tool's events.
      {
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "read_repository_file",
      },
      { type: "run_end", inputs: [10 as SubmissionId] },
      submission(10, 100, "done"),
    ]);
    const rows = journal.list(["100", "200"], false);
    expect(rows[0].entryId).toBe("100");
    expect(rows[0].steps.find((s) => s.id === "tool:call-1")?.status).toBe(
      "error",
    );
    expect(rows[1].steps).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain("DO-NOT-EXPOSE");
    expect(journal.list(["100"], false)).toHaveLength(1);
    journal.submission(
      (
        submission(20, 200, "done") as Extract<
          AgentEvent,
          { type: "submission" }
        >
      ).record,
    );
  });
  await evictDurableObject(stub);
  const saved = await runInDurableObject(stub, (_instance, state) =>
    new ActivityJournal(state.storage.sql).list(["100"], false),
  );
  expect(saved[0].status).toBe("done");
  expect(saved[0].steps.some((s) => s.label === "Read repository file")).toBe(
    true,
  );
  await stub.remove("personal");
  const remaining = await runInDurableObject(
    stub,
    (_instance, state) =>
      state.storage.sql
        .exec<{
          count: number;
        }>("SELECT COUNT(*) AS count FROM learning_activity")
        .one().count,
  );
  expect(remaining).toBe(0);
});

/** Input: actual Pi event stream from a faux response. Output: completed journal attached to the real user entry.
 * What this function does: checks the installed event protocol rather than only hand-authored event fixtures.
 */
it("consumes real Pi event batches and finishes the correct turn", async () => {
  const stub = (env as CloudflareBindings).LEARNING_SESSIONS.getByName(
    crypto.randomUUID(),
  );
  await runInDurableObject(stub, async (_instance, state) => {
    const models = createModels();
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage([fauxText("Safe visible answer")]),
    ]);
    const harness = await Harness.open(
      new MemoryStorage(),
      { models, registry: createRegistry() },
      context,
    );
    const root = await harness.root(context, {
      agent: {
        model: { provider: "faux", modelId: "faux-1" },
        tools: [],
        thinkingLevel: "off",
      },
    });
    const journal = new ActivityJournal(state.storage.sql);
    const stream = await watchEvents(harness, root.id, context);
    const completed = Promise.withResolvers<void>();
    stream.start(async (events) => {
      journal.record(events);
      if (
        events.some(
          (event) =>
            event.type === "submission" && event.record.status === "done",
        )
      )
        completed.resolve();
    });
    try {
      const turn = await root.submit(
        {
          type: "input",
          content: "Test progress",
          requestId: "activity-protocol-test",
        },
        context,
      );
      const settled = await turn.wait(context);
      await completed.promise;
      expect(settled.status).toBe("done");
      if (settled.type !== "input" || settled.status !== "done")
        throw new Error("Expected completed input");
      const result = journal.list([String(settled.entry)], false);
      expect(result[0].status).toBe("done");
      expect(
        result[0].steps.some((step) => step.label === "Agent started"),
      ).toBe(true);
      expect(result[0].steps.every((step) => step.status !== "running")).toBe(
        true,
      );
      expect(JSON.stringify(result)).not.toContain("Safe visible answer");
      // Overflow/reconnect snapshots retain failure flags and do not call pending tools running.
      journal.record([
        submission(55, 56),
        {
          ...stream.snapshot,
          run: { inputs: [55 as SubmissionId] },
          entries: [
            {
              id: 57 as EntryId,
              conversationId: root.id,
              kind: "pi.tool",
              model: [
                {
                  role: "toolResult",
                  toolCallId: "failed",
                  toolName: "web_research",
                  isError: true,
                  content: [{ type: "text", text: "PRIVATE-FAILURE" }],
                  timestamp: 1,
                },
              ],
            },
          ],
          tools: [
            {
              callId: "failed",
              name: "web_research",
              status: "done",
              entry: 57 as EntryId,
            },
            { callId: "pending", name: "web_research", status: "pending" },
          ],
        },
      ]);
      const restored = journal.list(["56"], false)[0];
      expect(
        restored.steps.find((step) => step.id === "tool:failed")?.status,
      ).toBe("error");
      expect(
        restored.steps.find((step) => step.id === "tool:pending")?.status,
      ).toBe("queued");
      expect(JSON.stringify(restored)).not.toContain("PRIVATE-FAILURE");
      journal.record([
        {
          type: "submission",
          record: {
            id: 55 as SubmissionId,
            conversationId: root.id,
            type: "input",
            status: "unanswered",
            entry: 56 as EntryId,
            reason: "aborted",
          },
        },
      ]);
      expect(journal.list(["56"], false)[0].status).toBe("interrupted");
    } finally {
      await stream.stop();
      await harness.close(context);
    }
  });
});

/** Input: more than one UI window of activity. Output: bounded journal with explicit truncation.
 * What this function does: prevents long tool runs from producing unbounded browser responses.
 */
it("bounds activity and ignores late lifecycle downgrades", async () => {
  const stub = (env as CloudflareBindings).LEARNING_SESSIONS.getByName(
    crypto.randomUUID(),
  );
  await runInDurableObject(stub, (_instance, state) => {
    const journal = new ActivityJournal(state.storage.sql);
    journal.record([
      submission(1, 2),
      { type: "run_start", inputs: [1 as SubmissionId] },
    ]);
    for (let i = 0; i < 110; i++)
      journal.record([
        {
          type: "tool_execution_start",
          toolCallId: `call-${i}`,
          toolName: "unknown-private-name",
          args: {},
        },
      ]);
    journal.record([submission(1, 2, "done"), submission(1, 2)]);
    const result = journal.list(["2"], false)[0];
    expect(result.steps).toHaveLength(80);
    expect(result.truncated).toBe(true);
    expect(result.status).toBe("done");
    expect(JSON.stringify(result)).not.toContain("unknown-private-name");
  });
});
