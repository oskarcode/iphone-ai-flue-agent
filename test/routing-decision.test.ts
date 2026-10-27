import { describe, expect, it } from "vitest";
import { routingLabel } from "../src/runtime/routing-label.ts";

describe("historical routing labels", () => {
  it("describes new workspace messages without a classifier", () => {
    expect(routingLabel()).toBe("Direct to Pi tutor");
  });
  it("preserves saved classifications without exposing untrusted route names", () => {
    expect(routingLabel({ route: "github_learning", source: "jev" })).toBe(
      "Jev decision → Repository learning (github_learning)",
    );
    expect(() => routingLabel({ route: "__proto__", source: "jev" } as never)).toThrow("Invalid routing decision");
    expect(() => routingLabel({ route: "web_research", source: "unknown" } as never)).toThrow("Invalid routing decision source");
  });
});
