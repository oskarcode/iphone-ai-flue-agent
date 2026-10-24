import { it, expect } from "vitest";
import {
  coachAnswer,
  COACH_INSTRUCTIONS,
  LEARNING_PREFERENCE,
} from "../src/lib/coach.ts";
it("accepts bounded model text but never exposes reasoning or malformed responses", () => {
  expect(coachAnswer({ response: "Learn TypeScript unions." })).toBe(
    "Learn TypeScript unions.",
  );
  expect(
    coachAnswer({ choices: [{ message: { content: "Follow up gently." } }] }),
  ).toBe("Follow up gently.");
  expect(() => coachAnswer({ response: "", reasoning: "private" })).toThrow();
  expect(() =>
    coachAnswer({ response: "partial", finish_reason: "length" }),
  ).toThrow();
  expect(COACH_INSTRUCTIONS).toContain("Never infer knowledge from absence");
  expect(LEARNING_PREFERENCE).toContain("FastAPI");
});
