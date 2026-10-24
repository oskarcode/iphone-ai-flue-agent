import { env } from "cloudflare:workers";
import { runInDurableObject, evictDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import type { CoachObservation } from "../../src/lib/coach.ts";
import type { SessionMetadata } from "../../src/runtime/contracts.ts";

const bindings = env as CloudflareBindings;
function observation(
  sessionId: string,
  entryId: string,
  privateSession = false,
): CoachObservation {
  return {
    sessionId,
    entryId,
    role: "user",
    text: "Explain the private repository secret",
    private: privateSession,
    createdAt: "now",
  };
}
it("indexes idempotent evidence and redacts private content across eviction", async () => {
  const coach = bindings.LEARNING_COACH.getByName("personal");
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  await coach.ingest("personal", a, [observation(a, "1"), observation(a, "1")]);
  await coach.ingest("personal", b, [observation(b, "2", true)]);
  await evictDurableObject(coach);
  const view = await coach.view("personal");
  expect(view).toMatchObject({ sessionCount: 2, messageCount: 2 });
  expect(view.observations.find((o) => o.sessionId === b)?.text).toBe(
    "[Private session activity; content withheld]",
  );
  expect(view.observations.find((o) => o.sessionId === b)?.text).not.toContain(
    "secret",
  );
  await coach.redact("personal", a);
  expect(
    (await coach.view("personal")).observations.find((o) => o.sessionId === a)
      ?.private,
  ).toBe(true);
  expect(await coach.cursor("personal", a)).toMatchObject({
    last: 1,
    deleted: false,
  });
  await coach.forget("personal", a);
  await coach.ingest("personal", a, [observation(a, "3")]);
  expect(await coach.view("personal")).toMatchObject({
    sessionCount: 1,
    messageCount: 1,
  });
  expect((await coach.cursor("personal", a)).deleted).toBe(true);
});
it("requires the verified personal owner, pauses after clear and uses baseline on resume", async () => {
  const coach = bindings.LEARNING_COACH.getByName("personal");
  const id = crypto.randomUUID();
  const denied = await runInDurableObject(coach, (instance) => {
    try {
      instance.ingest("other", id, [observation(id, "1")]);
      return false;
    } catch {
      return true;
    }
  });
  expect(denied).toBe(true);
  await coach.ingest("personal", id, [observation(id, "1")]);
  await coach.clear("personal");
  await coach.baseline("personal", id, 12);
  await evictDurableObject(coach);
  expect(await coach.view("personal")).toMatchObject({
    paused: true,
    messageCount: 0,
  });
  await coach.resume("personal");
  expect(await coach.cursor("personal", id)).toMatchObject({
    last: 12,
    paused: false,
  });
  await coach.ingest("personal", id, [observation(id, "13")]);
  expect((await coach.view("personal")).messageCount).toBe(1);
});
it("projects actual committed visible input, retracts it on session deletion, never creates model work for observation", async () => {
  const id = crypto.randomUUID();
  const session = bindings.LEARNING_SESSIONS.getByName(id);
  const metadata: SessionMetadata = {
    id,
    owner: "personal",
    title: "Coach fixture",
    type: "general",
    private: false,
    archived: false,
    pinned: false,
    createdAt: "now",
    updatedAt: "now",
  };
  await session.create(metadata);
  try {
    await session.importMessages("personal", "coach-test", [
      {
        id: "fixture-entry",
        role: "user",
        content: "What is a TypeScript union?",
        createdAt: "now",
      },
    ]);
    const coach = bindings.LEARNING_COACH.getByName("personal");
    expect(
      (await coach.view("personal")).observations.some(
        (o) => o.sessionId === id,
      ),
    ).toBe(false);
    await session.observe("personal");
    const view = await coach.view("personal");
    expect(
      view.observations.filter((o) => o.sessionId === id).map((o) => o.text),
    ).toContain("What is a TypeScript union?");
    const snapshot = await session.snapshot("personal");
    expect(((await snapshot.json()) as { busy: boolean }).busy).toBe(false);
  } finally {
    await session.remove("personal");
  }
  const coach = bindings.LEARNING_COACH.getByName("personal");
  expect(
    (await coach.view("personal")).observations.some((o) => o.sessionId === id),
  ).toBe(false);
  expect((await coach.cursor("personal", id)).deleted).toBe(true);
});
