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
  const tracker = await stub.get("personal", "feature-bug-tracker");
  expect(tracker?.markdown).toContain("/workspace/feature-bug-tracker.md");
  await stub.apply("personal", "delete-tracker-test", "skill.delete", {
    slug: tracker!.slug,
    expectedRevision: tracker!.revision,
  });
  await evictDurableObject(stub);
  expect(await stub.get("personal", "feature-bug-tracker")).toBeNull();
  const coach = await stub.get("personal", "learning-coach");
  expect(coach?.markdown).toContain("run_learning_coach");
  await stub.apply("personal", "delete-coach-test", "skill.delete", {
    slug: coach!.slug,
    expectedRevision: coach!.revision,
  });
  await evictDurableObject(stub);
  expect(await stub.get("personal", "learning-coach")).toBeNull();
  const deepLearn = await stub.get("personal", "deep-learn");
  expect(deepLearn?.markdown).toContain("in THIS workspace");
  await stub.apply("personal", "delete-deep-learn-test", "skill.delete", {
    slug: deepLearn!.slug,
    expectedRevision: deepLearn!.revision,
  });
  await evictDurableObject(stub);
  expect(await stub.get("personal", "deep-learn")).toBeNull();
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
it("seeds newer skills into existing Computers only once, leaving edits intact", async () => {
  const stub = computer();
  await runInDurableObject(stub, async (instance) => {
    await instance.storage().put("skills:seeded:v1", true);
  });
  const expected = [
    "deep-learn",
    "feature-bug-tracker",
    "learning-coach",
    "technical-blog-content",
  ];
  expect((await stub.list("personal")).map((s) => s.slug)).toEqual(expected);
  const original = await stub.get("personal", "technical-blog-content");
  expect(original?.markdown).toContain("read_saved_source");
  expect(original?.markdown).toContain("/workspace/blog-drafts/current.md");
  await stub.apply("personal", "edit-blog-content-test", "skill.save", {
    slug: "technical-blog-content",
    name: original!.name,
    description: original!.description,
    markdown: "My own article instructions.",
    expectedRevision: original!.revision,
  });
  await runInDurableObject(stub, async (instance) => {
    await instance.storage().delete("skills:seeded:technical-blog-content:v1");
  });
  await evictDurableObject(stub);
  expect((await stub.list("personal")).map((s) => s.slug)).toEqual(expected);
  expect((await stub.get("personal", "technical-blog-content"))?.markdown).toBe(
    "My own article instructions.",
  );
  const edited = await stub.get("personal", "technical-blog-content");
  await stub.apply("personal", "delete-blog-content-test", "skill.delete", {
    slug: "technical-blog-content",
    expectedRevision: edited!.revision,
  });
  await runInDurableObject(stub, async (instance) => {
    await instance.storage().delete("skills:seeded:technical-blog-content:v1");
    await instance.storage().delete("skills:seeded:technical-blog-content:v2");
  });
  await evictDurableObject(stub);
  expect(await stub.get("personal", "technical-blog-content")).toBeNull();
  expect((await stub.list("personal")).map((s) => s.slug)).toEqual(
    expected.filter((slug) => slug !== "technical-blog-content"),
  );
});
it("saves tracker entries with approved compare-and-swap writes without losing prior notes", async () => {
  const stub = computer();
  const path = "/workspace/feature-bug-tracker.md";
  await stub.apply("personal", "tracker-create", "computer.write", {
    path,
    content: "# Tracker\n\nFB-0001 Feature | Inbox | Search\n",
    expectedRevision: "",
  });
  const original = await stub.read("personal", path);
  expect(original.revision).toMatch(/^[a-f0-9]{64}$/);
  await stub.apply("personal", "tracker-update", "computer.write", {
    path,
    content: original.content + "FB-0002 Bug | Inbox | Login\n",
    expectedRevision: original.revision,
  });
  const staleRejected = await runInDurableObject(stub, async (instance) => {
    try {
      await instance.apply("personal", "tracker-stale", "computer.write", {
        path,
        content: "# Tracker\n",
        expectedRevision: original.revision,
      });
      return false;
    } catch {
      return true;
    }
  });
  expect(staleRejected).toBe(true);
  await evictDurableObject(stub);
  expect((await stub.read("personal", path)).content).toContain("FB-0001");
  expect((await stub.read("personal", path)).content).toContain("FB-0002");
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
  const catalog = await call("/api/skills");
  expect(catalog.status).toBe(200);
  expect((await catalog.json() as { skills: { slug: string }[] }).skills)
    .toContainEqual(expect.objectContaining({ slug: "technical-blog-content" }));
  const blog = await call("/api/skills/technical-blog-content");
  expect(blog.status).toBe(200);
  expect((await blog.json() as { markdown: string }).markdown).toContain(
    "Portfolio content handoff",
  );
  const path = "/workspace/skills/technical-blog-content/SKILL.md";
  const file = await call(`/api/computer/file?path=${encodeURIComponent(path)}`);
  expect(file.status).toBe(200);
  expect((await file.json() as { content: string }).content).toContain(
    "source files/evidence used",
  );
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
