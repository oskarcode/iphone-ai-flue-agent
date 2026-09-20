export type JevRoute = 'correct' | 'direct_answer' | 'read_url' | 'web_search' | 'clarification';

type JsonRecord = Record<string, unknown>;

const QUESTIONS = {
  route: {
    type: 'choice',
    instructions: 'Choose the single best execution path for this iPhone assistant request.',
    criteria: {
      correct: 'Correct spelling and grammar only. Always choose this when requested_mode is correct.',
      direct_answer: 'Answer or explain using the model without external information. Choose this for conversational follow-ups when requested_mode is chat because the Flue agent has prior conversation context.',
      read_url: 'The request contains a specific URL whose page must be read before answering.',
      web_search: 'The request needs current, recent, live, or externally verified information.',
      clarification: 'The request is too ambiguous to answer safely or usefully, and it is not a conversational follow-up with available Flue history.',
    },
  },
} as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJevRoute(value: unknown): JevRoute {
  if (!isRecord(value)) throw new Error('Jev returned a non-object response.');
  const firstEnvelope = isRecord(value.result) ? value.result : value;
  const result = isRecord(firstEnvelope.result) ? firstEnvelope.result : firstEnvelope;
  const answers = isRecord(result.answers) ? result.answers : null;
  const route = answers && isRecord(answers.route) ? answers.route.choice : undefined;
  if (!['correct', 'direct_answer', 'read_url', 'web_search', 'clarification'].includes(String(route))) {
    throw new Error('Jev returned an invalid route.');
  }
  return route as JevRoute;
}

export async function classifyWithJev(
  prompt: string,
  requestedMode: string,
  signal: AbortSignal,
  routingContext?: string,
): Promise<JevRoute> {
  const gatewayId = process.env.AI_GATEWAY_ID?.trim() || 'default';
  const state = JSON.stringify({
    requested_mode: requestedMode,
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
        metadata: { application: 'iphone-ai-flue-agent', component: 'jev-router' },
      },
    },
  );
  return parseJevRoute(result);
}
