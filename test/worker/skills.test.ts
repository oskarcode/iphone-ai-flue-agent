import { env } from "cloudflare:workers";
import { runInDurableObject, evictDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import app from "../../src/app.ts";
import { DEFAULT_SKILLS } from "../../src/lib/skills.ts";
const computer = () =>
  (env as CloudflareBindings).LEARNING_SKILLS.getByName(crypto.randomUUID());
const data = {
  slug: "test-skill",
  name: "Test skill",
  description: "A reusable test",
  markdown: "Teach with a small example.",
  expectedRevision: "",
};
/** Input: real Computer RPCs. Output: seeded files, CAS edits and durable deletion across eviction. */
it("persists skills, enforces revision checks, deduplicates edits and does not reseed deleted skills", async () => {
  const stub = computer();
  expect((await stub.list("personal")).length).toBe(DEFAULT_SKILLS.length);
  const first = (await stub.apply(
    "personal",
    "create-skill-test",
    "skill.save",
    data,
  )) as { revision: string };
  expect(first.revision).toHaveLength(64);
  expect(
    await stub.apply("personal", "create-skill-test", "skill.save", data),
  ).toEqual(first);
  const rejected = await runInDurableObject(stub, async (instance) => {
    try {
      await instance.apply("personal", "stale-skill-test", "skill.save", data);
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
  await stub.apply("personal", "update-skill-test", "skill.save", {
    ...data,
    expectedRevision: first.revision,
    markdown: "Updated instructions.",
  });
  await evictDurableObject(stub);
  expect((await stub.get("personal", data.slug))?.markdown).toBe(
    "Updated instructions.",
  );
  const starter = await stub.get("personal", "explain-simply");
  await stub.apply("personal", "delete-default-test", "skill.delete", {
    slug: starter!.slug,
    expectedRevision: starter!.revision,
  });
  await evictDurableObject(stub);
  expect(await stub.get("personal", "explain-simply")).toBeNull();
  expect(
    (await stub.tree("personal")).some((entry) =>
      entry.path.endsWith("/test-skill/SKILL.md"),
    ),
  ).toBe(true);
});
it("rejects wrong owners and keeps separate Computer objects independent", async () => {
  const stub = computer();
  const denied = await runInDurableObject(stub, async (instance) => {
    try {
      await instance.list("other");
      return false;
    } catch {
      return true;
    }
  });
  expect(denied).toBe(true);
  await stub.apply("personal", "isolated-skill-test", "skill.save", data);
  expect(await computer().get("personal", data.slug)).toBeNull();
});
it("runs real worker-shell commands and never executes a completed operation twice", async () => {
  const stub = computer();
  await stub.apply("personal", "seed-shell-test", "computer.write", {
    path: "/workspace/proof.txt",
    content: "initial\n",
  });
  const args = {
    command: "echo hello >> /workspace/proof.txt; cat /workspace/proof.txt",
  };
  const first = (await stub.apply(
    "personal",
    "shell-run-test",
    "computer.run",
    args,
  )) as { exitCode: number; stdout: string };
  expect(first.exitCode).toBe(0);
  expect(first.stdout.trim()).toBe("initial\nhello");
  expect(
    await stub.apply("personal", "shell-run-test", "computer.run", args),
  ).toEqual(first);
  await evictDurableObject(stub);
  expect(
    (await stub.read("personal", "/workspace/proof.txt")).content.trim(),
  ).toBe("initial\nhello");
});
it("protects HTTP skill actions with existing auth, origin and argument validation", async () => {
  const call = (path: string, body?: unknown, origin?: string) =>
    app.fetch(
      new Request("http://localhost" + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          ...(origin ? { Origin: origin } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { ...env, DEV_AUTH: "local" } as CloudflareBindings,
    );
  expect((await call("/api/skills")).status).toBe(200);
  expect(
    (
      await call("/api/computer/actions", {
        tool: "computer.delete",
        args: { path: "/workspace/../x" },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        "/api/computer/actions",
        { tool: "computer.run", args: { command: "echo nope" } },
        "https://evil.example",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await app.fetch(
        new Request("https://iphoneai.oskarcode.com/api/skills"),
        env as CloudflareBindings,
      )
    ).status,
  ).toBe(401);
});
