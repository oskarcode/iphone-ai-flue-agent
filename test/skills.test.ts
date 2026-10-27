import { describe, expect, it } from "vitest";
import {
  computerAction,
  computerPath,
  skillSlug,
  skillFile,
  DEFAULT_SKILLS,
} from "../src/lib/skills.ts";
describe("Computer boundaries", () => {
  it.each([
    "../secret",
    "/workspace/../secret",
    "/workspace/a/../../b",
    "/workspace/a\\b",
    "/workspace/",
    "/etc/passwd",
  ])("rejects traversal %s", (path) =>
    expect(() => computerPath(path)).toThrow(),
  );
  it("keeps valid workspace paths", () =>
    expect(computerPath("/workspace/skills/example/SKILL.md")).toBe(
      "/workspace/skills/example/SKILL.md",
    ));
  it.each(["../skill", "Upper", "two--hyphens", "x/y"])(
    "rejects invalid skill %s",
    (slug) => expect(() => skillSlug(slug)).toThrow(),
  );
  it("validates mutations and revisions", () => {
    expect(() =>
      computerAction("skill.save", {
        slug: "test",
        expectedRevision: "",
        name: "Test",
        description: "Demo",
        markdown: "Instructions",
      }),
    ).not.toThrow();
    expect(() => computerAction("skill.delete", { slug: "test" })).toThrow();
    expect(() => computerAction("computer.run", { command: "" })).toThrow();
    expect(() =>
      computerAction("computer.write", {
        path: "/workspace/feature-bug-tracker.md",
        content: "New idea",
        expectedRevision: "",
      }),
    ).not.toThrow();
    expect(() =>
      computerAction("computer.write", {
        path: "/workspace/feature-bug-tracker.md",
        content: "New idea",
        expectedRevision: "not-a-hash",
      }),
    ).toThrow();
    expect(() => computerAction("unknown", {})).toThrow();
  });
  it("bounds UTF-8 rather than just characters", () =>
    expect(() =>
      computerAction("computer.write", {
        path: "/workspace/test",
        content: "😀".repeat(40000),
      }),
    ).toThrow());
  it("seeds real editable skills without losing recap instructions", () => {
    expect(new Set(DEFAULT_SKILLS.map((skill) => skill.slug)).size).toBe(
      DEFAULT_SKILLS.length,
    );
    for (const skill of DEFAULT_SKILLS)
      expect(() =>
        computerAction("skill.save", { ...skill, expectedRevision: "" }),
      ).not.toThrow();
    expect(
      DEFAULT_SKILLS.find((skill) => skill.slug === "feature-bug-tracker")
        ?.markdown,
    ).toContain("write_computer_file");
    expect(
      DEFAULT_SKILLS.find((skill) => skill.slug === "learning-coach")?.markdown,
    ).toContain("run_learning_coach");
    const deepLearn = DEFAULT_SKILLS.find((skill) => skill.slug === "deep-learn");
    expect(deepLearn?.markdown).toContain("in THIS workspace");
    expect(deepLearn?.markdown).toContain("Ask only one question at a time");
    expect(deepLearn?.markdown).toContain("Only change skills or Computer files when I explicitly request it");
    expect(skillFile(DEFAULT_SKILLS.at(-1)!)).toContain(
      "Do not include private repository",
    );
  });
});
