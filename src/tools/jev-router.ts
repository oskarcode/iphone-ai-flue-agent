// Jev is called through the Cloudflare AI binding, while this module owns the app-specific route contract.
import { gatewayMetadata, type GatewayCallerMetadata } from '../lib/gateway-metadata.ts';

export type JevRoute = 'direct_answer' | 'web_research' | 'clarification';

type JsonRecord = Record<string, unknown>;

// Jev evaluates this declarative question against the request state and returns one choice.
const QUESTIONS = {
  route: {
    type: 'choice',
    instructions: 'Choose the single best execution path for this iPhone assistant request.',
    criteria: {
      direct_answer: 'Explain pasted or provided text, answer an explicit question without external information, or answer a conversational follow-up from existing Flue context.',
      web_research: 'The request contains a URL to read or needs current, recent, live, broader web context, or external verification. The research tool can read a page, search the web, or do both in one call.',
      clarification: 'The request is too ambiguous to answer safely or usefully, and it is not a conversational follow-up with available Flue history.',
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
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  if (!isRecord(value)) throw new Error('Jev returned a non-object response.');
  const firstEnvelope = isRecord(value.result) ? value.result : value;
  const result = isRecord(firstEnvelope.result) ? firstEnvelope.result : firstEnvelope;
  const answers = isRecord(result.answers) ? result.answers : null;
  const route = answers && isRecord(answers.route) ? answers.route.choice : undefined;
  if (!['direct_answer', 'web_research', 'clarification'].includes(String(route))) {
    throw new Error('Jev returned an invalid route.');
  }
  return route as JevRoute;
}

/**
 * Input:
 * - The current prompt, abort signal, and optional recent chat context.
 *
 * Output:
 * - The route Jev selected for the Flue agent.
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
  const gatewayId = process.env.AI_GATEWAY_ID?.trim() || 'default';
  const state = JSON.stringify({
    user_request: prompt,
    ...(routingContext ? { recent_conversation: routingContext } : {}),
  });
  const { env } = await import('cloudflare:workers');
  const bindings = env as unknown as CloudflareBindings;
  const ai = bindings.AI as unknown as {
    run(model: string, input: unknown, options: unknown): Promise<unknown>;
  };
  const result = await ai.run(
    process.env.JEV_MODEL?.trim() || 'typesafe/jev',
    { state, questions: QUESTIONS },
    {
      signal,
      gateway: {
        id: gatewayId,
        skipCache: process.env.JEV_SKIP_CACHE?.trim() !== 'false',
        metadata: gatewayMetadata('jev-router', gatewayCaller),
      },
    },
  );
  return parseJevRoute(result);
}
