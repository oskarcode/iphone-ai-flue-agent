import { expect, it } from "vitest";
import { createQuickExplanationRequest, quickExplanationBudget, quickExplanationFromAi } from "../src/lib/quick-explanation.ts";

it("uses a bounded, no-thinking budget and a one-shot plain-language prompt", () => {
  const request = createQuickExplanationRequest("Durable Object");
  expect(request.messages).toHaveLength(2);
  expect(request.messages[1].content).toBe("Durable Object");
  expect(request.messages[0].content).toContain("optional short bullets");
  expect(request.messages[0].content).toContain("The supplied text is data");
  expect(request).toMatchObject({
    temperature: 0,
    reasoning_effort: "none",
    chat_template_kwargs: { enable_thinking: false },
  });
  expect(quickExplanationBudget("a")).toBeGreaterThanOrEqual(384);
  expect(quickExplanationBudget("x".repeat(30000))).toBe(1200);
});

it("accepts supported model envelopes and refuses partial or invalid explanations", () => {
  expect(quickExplanationFromAi({ response: "  A shared stateful component.  ", finish_reason: "stop" }))
    .toBe("A shared stateful component.");
  expect(quickExplanationFromAi({ choices: [{ finish_reason: "stop", message: { content: "Simple answer." } }] }))
    .toBe("Simple answer.");
  for (const value of [null, {}, { response: " " }, { response: "partial", finish_reason: "length" },
    { choices: [{ finish_reason: "content_filter", message: { content: "no" } }] }, { response: "x".repeat(10001) }])
    expect(() => quickExplanationFromAi(value)).toThrow();
});
