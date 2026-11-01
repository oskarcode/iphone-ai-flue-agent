import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import app from "../../src/app.ts";

afterEach(() => vi.restoreAllMocks());

function fixture(reply: unknown = { response: "A Durable Object stores state for one coordinated instance.", finish_reason: "stop" }) {
  const run = vi.fn(async (_model: unknown, _input: unknown, _options: unknown) => reply);
  const forbidden = () => { throw new Error("One-shot explanations must not access sessions or KV"); };
  const bindings = {
    ...env,
    DEV_AUTH: "local",
    AI: { run },
    LEARNING_SESSIONS: { getByName: forbidden },
    LEARNING_LIBRARY: { getByName: forbidden },
    CHAT_SESSIONS: { get: forbidden, put: forbidden },
  } as unknown as CloudflareBindings;
  const call = (body: string) => app.request("http://localhost/v1/ask", {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  }, bindings);
  return { call, run, bindings };
}

it("returns an answer without creating a workspace or logging selected text", async () => {
  const { call, run } = fixture();
  const logs = vi.spyOn(console, "info").mockImplementation(() => {});
  const response = await call(JSON.stringify({ text: "  Durable Object  " }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ answer: "A Durable Object stores state for one coordinated instance." });
  expect(response.headers.get("Server-Timing")).toMatch(/identity;dur=\d+, inference;dur=\d+, total;dur=\d+/);
  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0][1]).toMatchObject({
    messages: [{ role: "system" }, { role: "user", content: "Durable Object" }],
    reasoning_effort: "none",
    chat_template_kwargs: { enable_thinking: false },
  });
  expect(run.mock.calls[0][2]).toMatchObject({
    gateway: { skipCache: true, metadata: { component: "quick-explanation" } },
  });
  expect(JSON.stringify(logs.mock.calls)).not.toContain("Durable Object");
});

it("rejects invalid input before inference and redacts malformed model output", async () => {
  const { call, run } = fixture();
  for (const input of ["not-json", JSON.stringify({ text: "" }), JSON.stringify({ text: "x".repeat(30001) })]) {
    const response = await call(input);
    expect(response.status).toBe(400);
  }
  expect(run).not.toHaveBeenCalled();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const failed = fixture({ response: "unfinished", finish_reason: "length" });
  const response = await failed.call(JSON.stringify({ text: "Explain this" }));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "Request failed. Please retry." });
});

it("requires signed Access identity rather than trusting service-token header names", async () => {
  const response = await app.request("http://localhost/v1/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Access-Client-Id": "unverified", "CF-Access-Client-Secret": "unverified" },
    body: JSON.stringify({ text: "Durable Object" }),
  }, { ...env, DEV_AUTH: undefined } as CloudflareBindings);
  expect(response.status).toBe(401);
});
