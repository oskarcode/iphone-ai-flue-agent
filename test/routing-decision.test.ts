// Classifier fixtures exercise provenance and safe presentation without remote inference.
import { describe, it, expect, vi } from "vitest";
import { classifyRequest, routingLabel } from "../src/tools/jev-router.ts";
import { LEARNING_RECAP_PROMPT } from "../src/lib/chat-presets.ts";

/** Input: prompts and deterministic classifier responses. Output: truthful routing origin and safe labels.
 * What this function does: distinguishes genuine Jev decisions, rules, fallback and direct Pi entry.
 */
describe("routing activity provenance", () => {
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
  it("does not attribute deterministic shortcuts to Jev", async () => {
    const classifier = vi.fn(async () => "clarification" as const);
    const github = await classifyRequest(
      "Explain https://github.com/example/repo.git",
      classifier,
    );
    const recap = await classifyRequest(LEARNING_RECAP_PROMPT, classifier);
    expect(classifier).not.toHaveBeenCalled();
    expect(github).toEqual({ route: "github_learning", source: "github_rule" });
    expect(recap).toEqual({ route: "direct_answer", source: "recap_rule" });
    expect(routingLabel(github)).toContain("Jev bypassed");
    expect(routingLabel(recap)).toContain("Recap preset rule");
  });
  it("records fallback without leaking classifier errors", async () => {
    const decision = await classifyRequest("Question", async () => {
      throw new Error("PRIVATE-PROVIDER-ERROR");
    });
    expect(decision).toEqual({ route: "direct_answer", source: "fallback" });
    expect(routingLabel(decision)).toBe(
      "Jev unavailable — fallback → Direct answer (direct_answer)",
    );
    expect(routingLabel(decision)).not.toContain("PRIVATE-PROVIDER-ERROR");
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
