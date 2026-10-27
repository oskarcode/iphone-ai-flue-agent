import { describe, expect, it, vi } from "vitest";
import { generateSessionTitle, parseSessionTitle } from "../src/lib/session-title.ts";

describe("generated session titles", () => {
  it("accepts a concise final model title and strips wrapping quotes", () => {
    expect(parseSessionTitle({ response: '"Understanding Durable Objects"', finish_reason: "stop" })).toBe("Understanding Durable Objects");
    expect(parseSessionTitle({ choices: [{ finish_reason: "stop", message: { content: "Agent Tool Routing" } }] })).toBe("Agent Tool Routing");
  });
  it.each([
    {}, { response: "" }, { response: "bad\nsecond line" },
    { response: "a".repeat(101) }, { response: "Partial", finish_reason: "length" },
  ])("rejects invalid output instead of guessing a title", (result) => {
    expect(() => parseSessionTitle(result)).toThrow();
  });
  it("sends the first request to the configured model with reasoning disabled", async () => {
    const run = vi.fn(async () => ({ response: "  TypeScript Generics  ", finish_reason: "stop" }));
    const signal = new AbortController().signal;
    const title = await generateSessionTitle(
      { AI: { run } as never, MODEL: "cloudflare/@cf/zai-org/glm-5.2", AI_GATEWAY_ID: "iphone-flue-shortcut" },
      "How do generics work?",
      signal,
    );
    expect(title).toBe("TypeScript Generics");
    expect(run).toHaveBeenCalledWith(
      "@cf/zai-org/glm-5.2",
      expect.objectContaining({
        reasoning_effort: "none",
        chat_template_kwargs: { enable_thinking: false },
        messages: expect.arrayContaining([{ role: "user", content: "How do generics work?" }]),
      }),
      expect.objectContaining({ signal, gateway: expect.objectContaining({ id: "iphone-flue-shortcut", skipCache: true }) }),
    );
  });
});
