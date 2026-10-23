// Keep grammar independent of Pi tools, session storage and intent routing.
import { GRAMMAR_CORRECTION_PROMPT } from '../prompts.ts';

type JsonRecord = Record<string, unknown>;

export const DEFAULT_GRAMMAR_MODEL = '@cf/zai-org/glm-5.2';
export const GRAMMAR_MAX_COMPLETION_TOKENS = 32_768;

/** Input: configured provider/model selector. Output: Workers AI model ID.
 * What this function does: removes the provider prefix and supplies the grammar default.
 */
export function grammarModelFromConfiguredModel(configuredModel?: string): string {
  const model = configuredModel?.trim();
  return model ? model.replace(/^cloudflare\//, '') : DEFAULT_GRAMMAR_MODEL;
}

/** Keeps short edits bounded, while retaining the existing ceiling for long text.
 * UTF-8 bytes are a conservative token estimate, including non-English input.
 */
/** Input: original text. Output: bounded completion-token budget.
 * What this function does: estimates from UTF-8 bytes so short edits avoid the maximum allocation.
 */
export function grammarCompletionBudget(text: string): number {
  const bytes = new TextEncoder().encode(text).length;
  return Math.min(GRAMMAR_MAX_COMPLETION_TOKENS, Math.max(256, Math.ceil(bytes * 1.5) + 128));
}

/** Input: unmodified text. Output: deterministic Workers AI request.
 * What this function does: disables thinking explicitly without involving durable conversation state.
 */
export function createGrammarRequest(text: string) {
  return {
    messages: [
      { role: 'system' as const, content: GRAMMAR_CORRECTION_PROMPT },
      { role: 'user' as const, content: text },
    ],
    temperature: 0,
    max_completion_tokens: grammarCompletionBudget(text),
    reasoning_effort: 'none' as const,
    // Live GLM-5.2 responses still contained reasoning with reasoning_effort alone.
    // Explicitly disabling it in the chat template removed that work in A/B tests.
    chat_template_kwargs: { enable_thinking: false },
  };
}

/** Input: untrusted AI response. Output: non-empty corrected text.
 * What this function does: accepts supported envelopes but rejects truncation and abnormal finish reasons.
 */
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
