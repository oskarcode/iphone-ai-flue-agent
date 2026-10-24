// Classifier fixtures exercise Jev-only routing and historical labels without remote inference.
import { describe, it, expect, vi } from "vitest";
import {
  classifyRequest,
  parseJevRoute,
  routingLabel,
} from "../src/tools/jev-router.ts";
import { LEARNING_RECAP_PROMPT } from "../src/lib/chat-presets.ts";

/** Input: prompts and classifier responses. Output: Jev decisions or errors, never substitute routes.
 * What this function does: verifies Jev owns every classification while previously stored labels remain truthful.
 */
describe("Jev-only routing", () => {
  it("records a real classifier choice as Jev", async () => {
    const classifier = vi.fn(async () => "web_research" as const);
    const decision = await classifyRequest(
      "What changed recently?",
      classifier,
    );
    expect(classifier).toHaveBeenCalledOnce();
    expect(decision).toEqual({ route: "web_research", source: "jev" });
    expect(routingLabel(decision)).toBe(
      "Jev decision → Web research (web_research)",
    );
  });
  it.each([
    "Explain https://github.com/example/repo.git",
    "https://github.com/example/repo",
    LEARNING_RECAP_PROMPT,
  ])("uses Jev rather than a deterministic shortcut for %s", async (prompt) => {
    const classifier = vi.fn(async () => "clarification" as const);
    expect(await classifyRequest(prompt, classifier)).toEqual({
      route: "clarification",
      source: "jev",
    });
    expect(classifier).toHaveBeenCalledExactlyOnceWith(
      prompt,
      expect.any(AbortSignal),
    );
  });
  it.each([
    "Question",
    "https://github.com/example/repo",
    LEARNING_RECAP_PROMPT,
  ])("does not fall back when Jev fails for %s", async (prompt) => {
    const error = new Error("PRIVATE-PROVIDER-ERROR");
    const classifier = vi.fn(async () => {
      throw error;
    });
    await expect(classifyRequest(prompt, classifier)).rejects.toBe(error);
    expect(classifier).toHaveBeenCalledOnce();
  });
  it("does not replace an invalid model response with a direct answer", async () => {
    await expect(
      classifyRequest("Question", async () =>
        parseJevRoute({ answers: { route: { choice: "unknown" } } }),
      ),
    ).rejects.toThrow("invalid route");
  });
  it("keeps historical labels readable without rewriting their origins", () => {
    expect(
      routingLabel({ route: "github_learning", source: "github_rule" }),
    ).toContain("GitHub URL rule — Jev bypassed");
    expect(
      routingLabel({ route: "direct_answer", source: "recap_rule" }),
    ).toContain("Recap preset rule");
    expect(
      routingLabel({ route: "direct_answer", source: "fallback" }),
    ).toContain("Jev unavailable — fallback");
    expect(routingLabel()).toBe("Direct to Pi tutor — Jev not used");
  });
  it("rejects unrecognized runtime route and source values", () => {
    expect(() =>
      routingLabel({ route: "__proto__", source: "jev" } as never),
    ).toThrow("Invalid routing decision");
    expect(() =>
      routingLabel({
        route: "direct_answer",
        source: "private-output",
      } as never),
    ).toThrow("Invalid routing decision source");
  });
});
