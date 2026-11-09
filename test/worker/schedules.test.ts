import { env } from "cloudflare:workers";
import {
  evictDurableObject,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { expect, it } from "vitest";
import app from "../../src/app.ts";

const bindings = { ...env, DEV_AUTH: "local" } as CloudflareBindings;
const call = (path: string, init?: RequestInit) =>
  app.fetch(new Request(`http://localhost${path}`, init), bindings);
const mutation = (path: string, method: string, body: unknown) =>
  call(path, {
    method,
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function session(id: string) {
  const stub = bindings.LEARNING_SESSIONS.getByName(id);
  const now = new Date().toISOString();
  await stub.create({
    id,
    owner: "personal",
    title: "Scheduled learning",
    createdAt: now,
    updatedAt: now,
    archived: true,
    private: true,
    pinned: false,
    type: "general",
  });
  return stub;
}
it("lists owner-checked schedules from archived lessons, edits with revisions and deletes without resurrecting", async () => {
  const id = crypto.randomUUID();
  const stub = await session(id);
  const runAt = Date.now() + 120_000;
  const created = await mutation(`/api/sessions/${id}/schedules`, "POST", {
    instruction:
      "Add one question to gadget-typescript-course-v1 using update_gadget_data, preserving progress",
    runAt,
    recurrence: { intervalDays: 1, timezone: "UTC" },
  });
  expect(created.status).toBe(201);
  const first = await created.json<{
    id: string;
    revision: number;
    runAt: number;
  }>();
  expect(first.revision).toBe(1);
  const directory = await (
    await call("/api/schedules")
  ).json<{
    schedules: { id: string; sessionId: string; sessionTitle: string }[];
  }>();
  expect(
    directory.schedules.find((item) => item.id === first.id),
  ).toMatchObject({ sessionId: id, sessionTitle: "Scheduled learning" });
  await evictDurableObject(stub);
  expect(await stub.schedules("personal")).toHaveLength(1);
  const path = `/api/sessions/${id}/schedules/${encodeURIComponent(first.id)}`;
  const edit = await mutation(path, "PATCH", {
    expectedRevision: 1,
    instruction: "Review day 2 without deleting cards",
    runAt: runAt + 90_000,
  });
  expect(edit.status).toBe(200);
  expect((await edit.json<{ revision: number }>()).revision).toBe(2);
  expect(
    (
      await mutation(path, "PATCH", {
        expectedRevision: 1,
        instruction: "Stale",
        runAt: runAt + 100_000,
      })
    ).status,
  ).toBe(409);
  expect((await mutation(path, "DELETE", { expectedRevision: 1 })).status).toBe(
    409,
  );
  expect((await mutation(path, "DELETE", { expectedRevision: 2 })).status).toBe(
    200,
  );
  expect(await stub.schedules("personal")).toEqual([]);
  await stub.remove("personal");
}, 70_000);

it("wakes a due Pi Durable schedule and submits exactly one retained turn", async () => {
  const id = crypto.randomUUID();
  const stub = await session(id);
  const created = await stub.createSchedule(
    "personal",
    "Explain one TypeScript idea without changing any files",
    Date.now() + 1600,
  );
  await evictDurableObject(stub);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await runDurableObjectAlarm(stub); // The runtime may already have delivered the alarm.
  await runDurableObjectAlarm(stub); // A repeated wake must not create another turn.
  for (let attempt = 0; attempt < 20; attempt++) {
    const snapshot = await (
      await stub.snapshot("personal")
    ).json<{ messages: { content: string }[] }>();
    if (
      snapshot.messages.some((message) =>
        message.content.includes(`Scheduled learning task (${created.id})`),
      )
    ) {
      expect(
        snapshot.messages.filter((message) =>
          message.content.includes(`Scheduled learning task (${created.id})`),
        ),
      ).toHaveLength(1);
      await stub.remove("personal");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stub.remove("personal");
  throw new Error("Scheduled turn did not reach the durable conversation");
}, 50_000);

it("rolls a daily schedule forward after its agent turn without duplicating the series", async () => {
  const id = crypto.randomUUID();
  const stub = await session(id);
  const created = await stub.createSchedule(
    "personal",
    "Review the day's TypeScript lesson",
    Date.now() + 1500,
    { intervalDays: 1, timezone: "UTC" },
  );
  await new Promise((resolve) => setTimeout(resolve, 1700));
  await runDurableObjectAlarm(stub);
  for (let attempt = 0; attempt < 25; attempt++) {
    const active = await stub.schedules("personal");
    if (active.length === 1 && active[0].runAt > created.runAt) {
      expect(active[0].id).toBe(created.id);
      expect(active[0].revision).toBe(2);
      await stub.remove("personal");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  await stub.remove("personal");
  throw new Error("Recurring schedule did not advance");
}, 50_000);

it("does not allow anonymous creation, invalid timing, or reads from another owner", async () => {
  const id = crypto.randomUUID();
  const stub = await session(id);
  const path = `/api/sessions/${id}/schedules`;
  expect(
    (
      await app.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instruction: "private",
            runAt: Date.now() + 60_000,
          }),
        }),
        { ...env, DEV_AUTH: undefined } as CloudflareBindings,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await mutation(path, "POST", {
        instruction: "Too late",
        runAt: Date.now() - 1,
      })
    ).status,
  ).toBe(400);
  const rejected = await runInDurableObject(stub, async (instance) => {
    try {
      await instance.schedules("another-owner");
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
  expect(await stub.schedules("personal")).toEqual([]);
  await stub.remove("personal");
}, 45_000);
