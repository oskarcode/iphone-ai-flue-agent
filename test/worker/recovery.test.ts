import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxText,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";
import {
  Harness,
  createRegistry,
  type Storage,
} from "@earendil-works/pi-durable";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import { it, expect } from "vitest";
async function open(storage: Storage, responses: FauxResponseStep[]) {
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  return Harness.open(storage, { models, registry: createRegistry() }, context);
}
it("recovers an interrupted Pi generation from real DO SQLite and deduplicates a retried input", async () => {
  const stub = (env as CloudflareBindings).LEARNING_SESSIONS.getByName(
    crypto.randomUUID(),
  );
  await runInDurableObject(stub, async (_instance, state) => {
    const started = Promise.withResolvers<void>();
    const harness = await open(
      await openDurableObjectSqliteStorage(state.storage),
      [
        async (_request, options) => {
          started.resolve();
          return new Promise((_resolve, reject) => {
            const abort = () =>
              reject(new DOMException("Stopped", "AbortError"));
            options?.signal?.addEventListener("abort", abort, { once: true });
          });
        },
      ],
    );
    const root = await harness.root(context, {
      agent: {
        model: { provider: "faux", modelId: "faux-1" },
        thinkingLevel: "off",
        tools: [],
      },
    });
    await root.submit(
      {
        type: "input",
        content: "Explain persistence",
        requestId: "same-request",
      },
      context,
    );
    await started.promise;
    await harness.close(context);
  });
  await evictDurableObject(stub);
  const result = await runInDurableObject(stub, async (_instance, state) => {
    const harness = await open(
      await openDurableObjectSqliteStorage(state.storage),
      [fauxAssistantMessage([fauxText("Recovered answer")])],
    );
    try {
      const root = await harness.root(context);
      harness.resume();
      const retry = await root.submit(
        {
          type: "input",
          content: "Explain persistence",
          requestId: "same-request",
        },
        context,
      );
      const settled = await retry.wait(context);
      const entries = await root.entries(
        { order: "ascending" },
        100,
        undefined,
        context,
      );
      return {
        status: settled.status,
        userCount: entries.items.filter((entry) => entry.kind === "pi.user")
          .length,
        answer: entries.items
          .filter((entry) => entry.kind === "pi.assistant")
          .flatMap((entry) => entry.model ?? [])
          .map((message) => message.content),
      };
    } finally {
      await harness.close(context);
    }
  });
  expect(result.status).toBe("done");
  expect(result.userCount).toBe(1);
  expect(JSON.stringify(result.answer)).toContain("Recovered answer");
}, 15000);
