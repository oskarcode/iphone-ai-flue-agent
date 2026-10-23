import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import app from "../../src/app.ts";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const run = vi.fn(
    async (_model: unknown, _input: unknown, _options: unknown) => ({
      response: "She went to school yesterday.",
    }),
  );
  const forbidden = () => {
    throw new Error("Grammar must not access durable sessions");
  };
  const bindings = {
    ...env,
    DEV_AUTH: "local",
    AI: { run },
    LEARNING_SESSIONS: { getByName: forbidden },
    LEARNING_LIBRARY: { getByName: forbidden },
  } as unknown as CloudflareBindings;
  return { run, bindings };
}

it("preserves the stateless Shortcut grammar response, no-thinking settings and metadata-only logs", async () => {
  const { run, bindings } = fixture();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const response = await app.request(
    "http://localhost/v1/correct",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "She go to school yesterday." }),
    },
    bindings,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    corrected_text: "She went to school yesterday.",
  });
  expect(response.headers.get("Server-Timing")).toMatch(
    /identity;dur=\d+, inference;dur=\d+, total;dur=\d+/,
  );
  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0][1]).toMatchObject({
    reasoning_effort: "none",
    chat_template_kwargs: { enable_thinking: false },
  });
  expect(run.mock.calls[0][2]).toMatchObject({ gateway: { skipCache: true } });
  expect(JSON.stringify(log.mock.calls)).not.toContain("She ");
});

it("rejects malformed or oversized grammar requests before calling a model", async () => {
  const { run, bindings } = fixture();
  for (const body of [
    "not json",
    JSON.stringify({ text: "" }),
    JSON.stringify({ text: "a".repeat(30_001) }),
  ]) {
    const response = await app.request(
      "http://localhost/v1/correct",
      { method: "POST", headers: { "Content-Type": "application/json" }, body },
      bindings,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
  }
  expect(run).not.toHaveBeenCalled();
});
