import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import app from "../../src/app.ts";
import type { SessionMetadata } from "../../src/runtime/contracts.ts";

const id = "a1b2c3d4-e5f6-4789-a123-123456789abc";
const request = () => new Request("http://localhost/api/sessions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id, text: "How do Durable Objects work?" }),
});

it("titles a new workspace from its first user request without replacing an existing title", async () => {
  let exists = false;
  const create = vi.fn(async (_metadata: SessionMetadata) => { exists = true; });
  const run = vi.fn(async () => ({ response: "Understanding Durable Objects", finish_reason: "stop" }));
  const bindings = { ...env, DEV_AUTH: "local", AI: { run },
    LEARNING_SESSIONS: { getByName: () => ({ exists: async () => exists, isDeleted: async () => false, create, retainInput: async () => {} }) },
  } as unknown as CloudflareBindings;
  expect((await app.fetch(request(), bindings)).status).toBe(201);
  expect(create.mock.calls[0]?.[0]).toMatchObject({ title: "Understanding Durable Objects" });
  expect((await app.fetch(request(), bindings)).status).toBe(201);
  expect(run).toHaveBeenCalledTimes(1);
});

it("does not create a workspace or fabricate a title when the title model fails", async () => {
  const create = vi.fn(async () => {});
  const bindings = { ...env, DEV_AUTH: "local", AI: { run: async () => ({ response: "", finish_reason: "stop" }) },
    LEARNING_SESSIONS: { getByName: () => ({ exists: async () => false, isDeleted: async () => false, create }) },
  } as unknown as CloudflareBindings;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect((await app.fetch(request(), bindings)).status).toBe(502);
    expect(create).not.toHaveBeenCalled();
  } finally { error.mockRestore(); }
});
