import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { CURRENT_BLOG_DRAFT, currentBlogDraft } from "../../src/runtime/blog-draft-reader.ts";

it("reads only the single current Computer draft and returns the latest revision", async () => {
  const binding = env as CloudflareBindings;
  const stub = binding.LEARNING_SKILLS.getByName("personal");
  const request = new Request("https://learning.internal/current");
  const missing = { LEARNING_SKILLS: { getByName: () => ({ read: async () => { throw new Error("no such path"); } }) } } as unknown as CloudflareBindings;
  expect((await currentBlogDraft(request, missing)).status).toBe(404);
  expect((await currentBlogDraft(new Request("https://learning.internal/other"), binding)).status).toBe(404);
  expect((await currentBlogDraft(new Request(request, { method: "POST" }), binding)).status).toBe(404);
  const first = "# First blog\n\n```mermaid\nflowchart LR\nA-->B\n```\n";
  await stub.apply("personal", "bridge-first-write", "computer.write", {
    path: CURRENT_BLOG_DRAFT,
    content: first,
    expectedRevision: "",
  });
  const saved = await currentBlogDraft(request, binding);
  expect(saved.status).toBe(200);
  expect(saved.headers.get("Cache-Control")).toBe("no-store");
  const initial = await saved.json() as { content: string; revision: string };
  expect(initial.content).toBe(first);
  expect(initial.revision).toMatch(/^[a-f0-9]{64}$/);
  await stub.apply("personal", "bridge-second-write", "computer.write", {
    path: CURRENT_BLOG_DRAFT,
    content: "# Second blog\n",
    expectedRevision: initial.revision,
  });
  expect(await (await currentBlogDraft(request, binding)).json()).toEqual({
    content: "# Second blog\n",
    revision: (await stub.read("personal", CURRENT_BLOG_DRAFT)).revision,
  });
  expect((await stub.tree("personal")).filter((entry) => entry.path.endsWith("/workspace/blog-drafts/current.md"))).toHaveLength(1);
}, 20_000);
