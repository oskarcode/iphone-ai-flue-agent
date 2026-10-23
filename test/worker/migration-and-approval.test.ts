import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxText,
} from "@earendil-works/pi-ai";
import { Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { describe, it, expect, vi } from "vitest";
import { createLearningHarnessOptions } from "../../src/runtime/harness.ts";
import type {
  SessionMetadata,
  SessionSnapshot,
  Approval,
} from "../../src/runtime/contracts.ts";

const bindings = env as CloudflareBindings;
describe("migration and action boundaries", () => {
  it("imports a legacy named object, joins streamed text, preserves sources and deduplicates retries", async () => {
    const id = crypto.randomUUID();
    const legacy = bindings.FLUE_IPHONE_ASSISTANT_AGENT.getByName(id);
    await runInDurableObject(legacy, (_instance, state) => {
      state.storage.sql.exec(
        "CREATE TABLE flue_conversation_streams(path TEXT PRIMARY KEY,identity_json TEXT)",
      );
      state.storage.sql.exec(
        "CREATE TABLE flue_conversation_stream_batches(path TEXT,seq INTEGER,data TEXT)",
      );
      state.storage.sql.exec(
        "INSERT INTO flue_conversation_streams VALUES(?,?)",
        "root",
        JSON.stringify({ agentName: "iphone-assistant", instanceId: id }),
      );
      const records = [
        {
          id: "r1",
          type: "user_message",
          messageId: "old-user",
          timestamp: "2026-10-01T00:00:00Z",
          content: [{ type: "text", text: "What is durability?" }],
        },
        {
          id: "r2",
          type: "assistant_message_started",
          messageId: "old-answer",
          timestamp: "2026-10-01T00:00:01Z",
        },
        {
          id: "r3",
          type: "assistant_text_delta",
          messageId: "old-answer",
          blockId: "b1",
          delta: "State survives ",
        },
        {
          id: "r4",
          type: "assistant_text_delta",
          messageId: "old-answer",
          blockId: "b1",
          delta: "a restart.",
        },
        {
          id: "r5",
          type: "assistant_message_completed",
          messageId: "old-answer",
        },
      ];
      state.storage.sql.exec(
        "INSERT INTO flue_conversation_stream_batches VALUES(?,?,?)",
        "root",
        0,
        JSON.stringify(records.slice(0, 3)),
      );
      state.storage.sql.exec(
        "INSERT INTO flue_conversation_stream_batches VALUES(?,?,?)",
        "root",
        1,
        JSON.stringify(records.slice(3)),
      );
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await exports.default.fetch(
        new Request("http://localhost/api/migrate/object", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "general",
            objectId: legacy.id.toString(),
          }),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id, status: "imported" });
    }
    const stub = bindings.LEARNING_SESSIONS.getByName(id);
    const snap = (await (
      await stub.snapshot("personal")
    ).json()) as SessionSnapshot;
    expect(snap.messages.map((m) => m.content)).toEqual([
      "What is durability?",
      "State survives a restart.",
    ]);
    expect(snap.messages[0].createdAt).toBe("2026-10-01T00:00:00Z");
    expect(snap.metadata.legacy?.complete).toBe(true);
    expect(snap.sources[0].id).toBe("legacy-archive");
    expect(JSON.parse(await legacy.exportPage()).rows).toHaveLength(2);
    await stub.remove("personal");
    expect(JSON.parse(await legacy.exportPage()).rows).toHaveLength(0);
  });
  it("model-requested GitHub writes can only prepare a pending proposal", async () => {
    const repository = {
      owner: "example",
      repo: "private",
      fullName: "example/private",
      url: "https://github.com/example/private",
      description: "",
      defaultBranch: "main",
      commitSha: "a".repeat(40),
      private: true,
      files: ["README.md"],
      treeTruncated: false,
    };
    const metadata: SessionMetadata = {
      id: crypto.randomUUID(),
      owner: "personal",
      title: "Private lesson",
      type: "repository",
      private: true,
      repository,
      createdAt: "now",
      updatedAt: "now",
      archived: false,
      pinned: false,
    };
    const proposals: Approval[] = [];
    const options = createLearningHarnessOptions(bindings, {
      metadata: () => metadata,
      update: async () => {},
      source: async () => {},
      preferences: async () => "",
      recall: async () => [],
      savedSource: () => [],
      actions: () => [],
      proposal: async (id, tool, args) => {
        const proposal: Approval = {
          id,
          tool,
          args,
          status: "pending",
          createdAt: "now",
        };
        proposals.push(proposal);
        return proposal;
      },
    });
    const models = createModels();
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "call-1",
            name: "create_github_issue",
            arguments: {
              title: "Document the example",
              body: "Please document the example behavior in the README.",
            },
          },
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Awaiting your approval.")]),
    ]);
    const harness = await Harness.open(
      new MemoryStorage(),
      { ...options, models, conversationCreated: undefined },
      context,
    );
    try {
      const root = await harness.root(context, {
        agent: {
          model: { provider: "faux", modelId: "faux-1" },
          thinkingLevel: "off",
        },
      });
      const result = await (
        await root.submit(
          {
            type: "input",
            content: "Prepare an issue",
            requestId: "proposal-test",
          },
          context,
        )
      ).wait(context);
      expect(result.status).toBe("done");
      expect(proposals).toHaveLength(1);
      expect(proposals[0].status).toBe("pending");
      expect(proposals[0].tool).toBe("createIssue");
    } finally {
      await harness.close(context);
    }
  });
  it("cross-session recall is opt-in and excludes private notes", async () => {
    const owner = crypto.randomUUID();
    const library = bindings.LEARNING_LIBRARY.getByName(owner);
    const now = new Date().toISOString();
    for (const privateNote of [true, false]) {
      const id = crypto.randomUUID();
      await library.upsert(
        {
          id,
          owner,
          title: "Quasar lesson",
          type: "general",
          private: privateNote,
          createdAt: now,
          updatedAt: now,
          archived: false,
          pinned: false,
        },
        1,
        "quasar",
        [
          {
            id: "note",
            text: "Quasar evidence",
            entryId: "10",
            createdAt: now,
            private: privateNote,
          },
        ],
      );
    }
    expect(await library.recall("quasar", "other-session")).toEqual([]);
    await library.setPreferences("Explain simply", true);
    const results = await library.recall("quasar", "other-session");
    expect(results).toHaveLength(1);
    expect(results[0].note.private).toBe(false);
  });
});
