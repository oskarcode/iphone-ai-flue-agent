import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import app from "../../src/app.ts";
import {
  COURSE_LESSON_COUNT,
  COURSE_PRACTICE_COUNT,
  COURSE_ANSWER_KEYS,
  TYPESCRIPT_COURSE_SOURCE,
} from "../../src/lib/typescript-course.ts";

const bindings = { ...env, DEV_AUTH: "local" } as CloudflareBindings;
const request = (path: string, init?: RequestInit) =>
  app.fetch(new Request(`http://localhost${path}`, init), bindings);
const post = (path: string, data: Record<string, string>) =>
  request(path, {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(data).toString(),
  });

it("ships a complete 21-day course with checked basics, Pi harness and request-flow cards", () => {
  expect(COURSE_LESSON_COUNT).toBe(21);
  expect(COURSE_PRACTICE_COUNT).toBe(21);
  expect(TYPESCRIPT_COURSE_SOURCE.length).toBeLessThan(64 * 1024);
  for (const topic of [
    "Classes, methods and composition",
    "Tool arguments and validation",
    "Request enters the Worker",
    "Failures and retries",
    "Week 3 review: trace one request",
  ])
    expect(TYPESCRIPT_COURSE_SOURCE).toContain(topic);
  expect(TYPESCRIPT_COURSE_SOURCE).not.toContain("eval(");
});

it("creates one owner-scoped gadget, checks feedback, retains progress and rejects skipping ahead", async () => {
  const id = crypto.randomUUID();
  const response = await request("/api/learning-course", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: id }),
  });
  expect(response.status).toBe(201);
  const { url, gadgetId, sessionId } = await response.json<{
    url: string;
    gadgetId: string;
    sessionId: string;
  }>();
  expect(sessionId).toBe(id);
  expect(gadgetId).toBe("gadget-typescript-course-v1");
  const first = await request(url);
  expect(first.status).toBe(200);
  expect(first.headers.get("Content-Security-Policy")).toContain(
    "script-src 'none'",
  );
  expect(await first.text()).toContain("Day 1: Values, variables and types");
  expect(
    (await post(url, { _action: "answer", day: "2", slot: "0", choice: "1" }))
      .status,
  ).toBe(400);
  expect(
    (await post(url, { _action: "answer", day: "0", slot: "0", choice: "0" }))
      .status,
  ).toBe(303);
  expect(
    (
      await post(url, {
        _action: "practice",
        note: "<script>alert('x')</script>",
      })
    ).status,
  ).toBe(303);
  const practice = await (await request(url)).text();
  expect(practice).toContain("Worked answer:");
  expect(practice).toContain("&lt;script&gt;");
  expect(practice).not.toContain("<script>alert");
  const wrong = await (await request(url)).text();
  expect(wrong).toContain("Not yet");
  expect(wrong).toContain("The addition changes the number value");
  expect(
    (await post(url, { _action: "answer", day: "0", slot: "0", choice: "1" }))
      .status,
  ).toBe(303);
  expect(
    (await post(url, { _action: "answer", day: "0", slot: "1", choice: "2" }))
      .status,
  ).toBe(303);
  const completed = await (await request(url)).text();
  expect(completed).toContain("Day complete");
  expect(completed).toContain("Correct");
  expect((await post(url, { _action: "next" })).status).toBe(303);
  const next = await (await request(url)).text();
  expect(next).toContain("Day 2: Arrays and tuples");
  expect(next).toContain("1 completed");
  expect(next).toContain("Review from earlier days");
  const repeat = await request("/api/learning-course", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: id }),
  });
  expect(repeat.status).toBe(201);
  expect((await repeat.json<{ gadgetId: string }>()).gadgetId).toBe(gadgetId);
  expect(await (await request(url)).text()).toContain(
    "Day 2: Arrays and tuples",
  );
  await bindings.LEARNING_SESSIONS.getByName(id).remove("personal");
}, 65_000);

it("has answers and feedback for all 21 lessons and reaches a real final day", async () => {
  const id = crypto.randomUUID();
  const response = await request("/api/learning-course", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: id }),
  });
  expect(response.status).toBe(201);
  const { url, gadgetId } = await response.json<{
    url: string;
    gadgetId: string;
  }>();
  const stub = bindings.LEARNING_SESSIONS.getByName(id);
  for (let day = 0; day < COURSE_LESSON_COUNT; day++) {
    for (let slot = 0; slot < 2; slot++) {
      await stub.actOnGadget("personal", gadgetId, "answer", {
        day: String(day),
        slot: String(slot),
        choice: String(COURSE_ANSWER_KEYS[day][slot]),
      });
      expect(await stub.renderGadget("personal", gadgetId)).toContain(
        "Correct",
      );
    }
    if (day < COURSE_LESSON_COUNT - 1)
      await stub.actOnGadget("personal", gadgetId, "next", {});
  }
  const finished = await (await request(url)).text();
  expect(finished).toContain("21 completed");
  expect(finished).toContain("Three-week course complete");
  expect(finished).toContain("Week 3 review: trace one request");
  await stub.remove("personal");
}, 110_000);

it("requires authentication and same-origin creation", async () => {
  const id = crypto.randomUUID();
  const body = JSON.stringify({ requestId: id });
  expect(
    (
      await app.fetch(
        new Request("http://localhost/api/learning-course", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
        { ...env, DEV_AUTH: undefined } as CloudflareBindings,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await request("/api/learning-course", {
        method: "POST",
        headers: {
          Origin: "https://other.example",
          "Content-Type": "application/json",
        },
        body,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request("/api/learning-course", {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestId: "no" }),
      })
    ).status,
  ).toBe(400);
});
