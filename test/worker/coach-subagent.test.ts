import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import type { SessionMetadata } from "../../src/runtime/contracts.ts";

it("pages committed private and public session text through owner-checked RPCs, never reopens deleted history", async () => {
  const bindings = env as CloudflareBindings;
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const stubs = ids.map((id) => bindings.LEARNING_SESSIONS.getByName(id));
  const text = "Private TypeScript misunderstanding ".repeat(300);
  for (let i = 0; i < stubs.length; i++) {
    const metadata: SessionMetadata = {
      id: ids[i]!,
      owner: "personal",
      title: `Lesson ${i}`,
      type: "general",
      private: i === 0,
      archived: i === 1,
      pinned: false,
      createdAt: "now",
      updatedAt: "now",
    };
    await stubs[i]!.create(metadata);
    await stubs[i]!.importMessages("personal", `coach-read-${i}`, [
      {
        id: `lesson-${i}`,
        role: "user",
        content: i === 0 ? text : "What is a Worker?",
        createdAt: "now",
      },
      ...(i === 1
        ? [
            {
              id: "answer-1",
              role: "assistant" as const,
              content: "A Worker runs code at the edge.",
              createdAt: "now",
            },
          ]
        : []),
    ]);
  }
  try {
    const list = await bindings.LEARNING_LIBRARY.getByName("personal").list(
      "Lesson",
      "all",
    );
    expect(ids.every((id) => list.items.some((s) => s.id === id))).toBe(true);
    const page = await stubs[0]!.coachHistory("personal");
    expect(page.private).toBe(true);
    const message = page.messages[0]!;
    expect(message.content).toContain("Private TypeScript misunderstanding");
    expect(message.totalCharacters).toBe(text.length);
    const rest = await stubs[0]!.coachMessage("personal", message.id, 6000);
    expect(rest.content).toBe(text.slice(6000, 14000));
    const firstPublic = await stubs[1]!.coachHistory("personal");
    expect(firstPublic).toMatchObject({ private: false });
    expect(firstPublic.nextCursor).toBeDefined();
    const nextPublic = await stubs[1]!.coachHistory(
      "personal",
      firstPublic.nextCursor,
    );
    expect(
      [firstPublic, nextPublic].flatMap((p) =>
        p.messages.map((m) => m.content),
      ),
    ).toContain("What is a Worker?");
    const denied = await runInDurableObject(stubs[0]!, async (instance) => {
      try {
        await instance.coachHistory("other");
        return false;
      } catch {
        return true;
      }
    });
    expect(denied).toBe(true);
    const hidden = await runInDurableObject(stubs[0]!, async (instance) => {
      try {
        await instance.coachMessage("personal", "999999999", 0);
        return false;
      } catch {
        return true;
      }
    });
    expect(hidden).toBe(true);
  } finally {
    for (const stub of stubs) await stub.remove("personal");
  }
  const removed = await runInDurableObject(stubs[0]!, async (instance) => {
    try {
      await instance.coachHistory("personal");
      return false;
    } catch {
      return true;
    }
  });
  expect(removed).toBe(true);
  const list = await bindings.LEARNING_LIBRARY.getByName("personal").list(
    "Lesson",
    "all",
  );
  expect(ids.some((id) => list.items.some((s) => s.id === id))).toBe(false);
});
