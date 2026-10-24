// Jev is called through the Cloudflare AI binding, while this module owns the app-specific route contract.
import {
  gatewayMetadata,
  type GatewayCallerMetadata,
} from "../lib/gateway-metadata.ts";

export type JevRoute =
  | "direct_answer"
  | "web_research"
  | "github_learning"
  | "visual_explanation"
  | "clarification";

/** Every newly classified request uses Jev; legacy origins remain readable in saved activity. */
type JevDecision = { route: JevRoute; source: "jev" };
export type RoutingDecision =
  | JevDecision
  | {
      route: JevRoute;
      source: "github_rule" | "recap_rule" | "fallback";
    };

/** Input: current request and optional classifier implementation. Output: Jev's validated route.
 * What this function does: always calls Jev, including GitHub URLs and recaps; failures propagate without choosing a substitute route.
 */
export async function classifyRequest(
  prompt: string,
  classifier = classifyWithJev,
): Promise<JevDecision> {
  return {
    route: await classifier(prompt, new AbortController().signal),
    source: "jev",
  };
}

/** Input: routing result, or absent for a direct Pi submission. Output: an allowlisted UI event label.
 * What this function does: exposes the decision without raw model responses, prompts, errors or invented reasoning.
 */
export function routingLabel(decision?: RoutingDecision): string {
  if (!decision) return "Direct to Pi tutor — Jev not used";
  const labels: Record<JevRoute, string> = {
    direct_answer: "Direct answer",
    web_research: "Web research",
    github_learning: "Repository learning",
    visual_explanation: "Visual explanation",
    clarification: "Clarification",
  };
  if (!Object.hasOwn(labels, decision.route))
    throw new Error("Invalid routing decision");
  const route = `${labels[decision.route]} (${decision.route})`;
  // Legacy cases only render retained history; they never classify new requests.
  switch (decision.source) {
    case "jev":
      return `Jev decision → ${route}`;
    case "github_rule":
      return `GitHub URL rule — Jev bypassed → ${route}`;
    case "recap_rule":
      return `Recap preset rule — Jev bypassed → ${route}`;
    case "fallback":
      return `Jev unavailable — fallback → ${route}`;
    default:
      throw new Error("Invalid routing decision source");
  }
}

type JsonRecord = Record<string, unknown>;

// Jev evaluates this declarative question against the request state and returns one choice.
const QUESTIONS = {
  route: {
    type: "choice",
    instructions:
      "Choose the single best execution path for this iPhone assistant request.",
    criteria: {
      direct_answer:
        "Explain pasted or provided text, answer an explicit question without external information, or answer a conversational follow-up from provided conversation context. Do not choose this when the request contains a github.com owner/repository URL.",
      web_research:
        "The request contains a non-GitHub URL to read or needs current, recent, live, broader web context, or external verification. Do not choose this for a github.com owner/repository URL.",
      github_learning:
        "Choose this whenever the current request contains a github.com owner/repository URL, including a bare copied URL or one prefixed with instructions to explain pasted text. This choice takes priority over direct_answer and web_research. Also choose it when the user explicitly asks to learn, understand, map, study, or generate a code-learning guide for that repository.",
      visual_explanation:
        "The user explicitly asks for a visual, diagram, anatomy, interactive explainer, picture, SVG, visual guide, or visual teaching page for a technical concept. Do not choose this for GitHub repository URLs; github_learning takes priority.",
      clarification:
        "The request is too ambiguous to answer safely or usefully, and it is not a conversational follow-up with available conversation history.",
    },
  },
} as const;

/**
 * Input:
 * - Any value returned by Workers AI.
 *
 * Output:
 * - True when the value is a non-array object.
 *
 * What this function does:
 * - Safely narrows Jev's unknown response before nested property access.
 */
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Input:
 * - The unknown JSON result returned by the Jev model.
 *
 * Output:
 * - One validated application route.
 *
 * What this function does:
 * - Accepts the nested response envelopes Jev may return.
 * - Rejects missing or unknown route choices before they reach the agent.
 */
export function parseJevRoute(value: unknown): JevRoute {
  if (!isRecord(value)) throw new Error("Jev returned a non-object response.");
  const firstEnvelope = isRecord(value.result) ? value.result : value;
  const result = isRecord(firstEnvelope.result)
    ? firstEnvelope.result
    : firstEnvelope;
  const answers = isRecord(result.answers) ? result.answers : null;
  const route =
    answers && isRecord(answers.route) ? answers.route.choice : undefined;
  if (
    typeof route !== "string" ||
    ![
      "direct_answer",
      "web_research",
      "github_learning",
      "visual_explanation",
      "clarification",
    ].includes(route)
  ) {
    throw new Error("Jev returned an invalid route.");
  }
  return route as JevRoute;
}

/**
 * Input:
 * - The current prompt, abort signal, and optional recent chat context.
 *
 * Output:
 * - The route Jev selected for the Shortcut/legacy compatibility path.
 *
 * What this function does:
 * - Calls Jev through the Worker AI binding and dedicated AI Gateway.
 * - Disables gateway caching by default so routing reflects the current request.
 */
export async function classifyWithJev(
  prompt: string,
  signal: AbortSignal,
  routingContext?: string,
  gatewayCaller?: GatewayCallerMetadata,
): Promise<JevRoute> {
  const gatewayId = process.env.AI_GATEWAY_ID?.trim() || "default";
  const state = JSON.stringify({
    user_request: prompt,
    ...(routingContext ? { recent_conversation: routingContext } : {}),
  });
  const { env } = await import("cloudflare:workers");
  const bindings = env as unknown as CloudflareBindings;
  const ai = bindings.AI as unknown as {
    run(model: string, input: unknown, options: unknown): Promise<unknown>;
  };
  const result = await ai.run(
    process.env.JEV_MODEL?.trim() || "typesafe/jev",
    { state, questions: QUESTIONS },
    {
      signal,
      gateway: {
        id: gatewayId,
        skipCache: process.env.JEV_SKIP_CACHE?.trim() !== "false",
        metadata: gatewayMetadata("jev-router", gatewayCaller),
      },
    },
  );
  return parseJevRoute(result);
}
