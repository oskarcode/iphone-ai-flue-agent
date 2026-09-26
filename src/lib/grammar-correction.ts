import { GRAMMAR_CORRECTION_PROMPT } from '../prompts.ts';

type JsonRecord = Record<string, unknown>;

export const DEFAULT_GRAMMAR_MODEL = '@cf/zai-org/glm-5.2';
export const GRAMMAR_MAX_COMPLETION_TOKENS = 32_768;

/** Converts Flue's provider-qualified model selector into an AI binding model name. */
export function grammarModelFromConfiguredModel(configuredModel?: string): string {
  const model = configuredModel?.trim();
  return model ? model.replace(/^cloudflare\//, '') : DEFAULT_GRAMMAR_MODEL;
}

/** Builds the deterministic, stateless model input used by POST /v1/correct. */
export function createGrammarRequest(text: string) {
  return {
    messages: [
      { role: 'system' as const, content: GRAMMAR_CORRECTION_PROMPT },
      { role: 'user' as const, content: text },
    ],
    temperature: 0,
    max_completion_tokens: GRAMMAR_MAX_COMPLETION_TOKENS,
    reasoning_effort: 'none' as const,
  };
}

/** Returns corrected text from supported Workers AI response envelopes. */
export function correctedTextFromAi(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workers AI returned a non-object grammar response.');
  }
  const result = value as JsonRecord;
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const firstChoice = choices[0];
  const choiceHasFinishReason = Boolean(firstChoice && typeof firstChoice === 'object' && !Array.isArray(firstChoice) && 'finish_reason' in firstChoice);
  const hasFinishReason = choiceHasFinishReason || 'finish_reason' in result;
  const finishReason = choiceHasFinishReason && firstChoice && typeof firstChoice === 'object' && !Array.isArray(firstChoice)
    ? firstChoice.finish_reason
    : result.finish_reason;
  if (finishReason === 'length') throw new Error('Workers AI truncated the grammar response.');
  if (hasFinishReason && finishReason !== 'stop') {
    throw new Error('Workers AI grammar response did not finish normally.');
  }
  const message = firstChoice && typeof firstChoice === 'object' && !Array.isArray(firstChoice) && 'message' in firstChoice
    ? firstChoice.message
    : null;
  const choiceContent = message && typeof message === 'object' && !Array.isArray(message) && 'content' in message
    ? message.content
    : undefined;
  const output = typeof result.response === 'string'
    ? result.response
    : typeof result.output_text === 'string'
      ? result.output_text
      : choiceContent;
  if (typeof output !== 'string' || !output.trim()) {
    throw new Error('Workers AI did not return corrected text.');
  }
  return output;
}
