// Historical routing decisions remain readable in retained activity; no classifier runs on new turns.
export type RoutingDecision = {
  route: "direct_answer" | "web_research" | "github_learning" | "visual_explanation" | "clarification";
  source: "jev" | "github_rule" | "recap_rule" | "fallback";
};

/** Render allowlisted labels for old decisions or the direct Pi path without exposing request content. */
export function routingLabel(decision?: RoutingDecision): string {
  if (!decision) return "Direct to Pi tutor";
  const labels: Record<RoutingDecision["route"], string> = {
    direct_answer: "Direct answer",
    web_research: "Web research",
    github_learning: "Repository learning",
    visual_explanation: "Visual explanation",
    clarification: "Clarification",
  };
  if (!Object.hasOwn(labels, decision.route)) throw new Error("Invalid routing decision");
  const route = `${labels[decision.route]} (${decision.route})`;
  switch (decision.source) {
    case "jev": return `Jev decision → ${route}`;
    case "github_rule": return `GitHub URL rule — Jev bypassed → ${route}`;
    case "recap_rule": return `Recap preset rule — Jev bypassed → ${route}`;
    case "fallback": return `Jev unavailable — fallback → ${route}`;
    default: throw new Error("Invalid routing decision source");
  }
}
