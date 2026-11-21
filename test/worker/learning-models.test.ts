import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../../src/app.ts";
import { DEFAULT_LEARNING_MODEL, LEARNING_MODELS } from "../../src/lib/learning-models.ts";
import type { SessionMetadata } from "../../src/runtime/contracts.ts";

const bindings = { ...env, DEV_AUTH: "local" } as CloudflareBindings;
function request(path: string, init?: RequestInit) {
  return app.request(`http://localhost${path}`, init, bindings);
}
describe("owner-scoped learning model selection", () => {
  it("lists only reviewed models, persists a selection across eviction, and rejects unknown IDs", async () => {
    const catalog = await request("/api/models");
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toMatchObject({ defaultModelId: DEFAULT_LEARNING_MODEL, models: LEARNING_MODELS });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const stub = bindings.LEARNING_SESSIONS.getByName(id);
    const metadata: SessionMetadata = { id, owner: "personal", title: "Model choice", type: "general", private: false, createdAt: now, updatedAt: now, archived: false, pinned: false };
    await stub.create(metadata);
    const path = `/api/sessions/${id}`;
    const patch = (modelId: string) => request(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId }) });
    expect((await patch("@cf/qwen/qwen3.8-27b")).status).toBe(200);
    await evictDurableObject(stub);
    const saved = await request(path);
    expect(saved.status).toBe(200);
    expect((await saved.json() as { metadata: SessionMetadata }).metadata.modelId).toBe("@cf/qwen/qwen3.8-27b");
    expect((await patch("@cf/zai-org/glm-5.3-flash")).status).toBe(400);
    const after = await request(path);
    expect((await after.json() as { metadata: SessionMetadata }).metadata.modelId).toBe("@cf/qwen/qwen3.8-27b");
  });
});
