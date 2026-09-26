import { describe, expect, it } from 'vitest';

import {
  correctedTextFromAi,
  createGrammarRequest,
  DEFAULT_GRAMMAR_MODEL,
  GRAMMAR_MAX_COMPLETION_TOKENS,
  grammarModelFromConfiguredModel,
} from '../src/lib/grammar-correction.ts';
import { GRAMMAR_CORRECTION_PROMPT } from '../src/prompts.ts';

describe('grammar correction', () => {
  it('builds a deterministic stateless request', () => {
    expect(DEFAULT_GRAMMAR_MODEL).toBe('@cf/zai-org/glm-5.2');
    expect(grammarModelFromConfiguredModel('cloudflare/@cf/zai-org/glm-5.2')).toBe('@cf/zai-org/glm-5.2');
    expect(GRAMMAR_CORRECTION_PROMPT).toBe('Correct spelling and grammar in the provided text.\nKeep the original tone and structure.\nReturn only the corrected text.');
    expect(createGrammarRequest('this are a test')).toEqual({
      messages: [
        { role: 'system', content: GRAMMAR_CORRECTION_PROMPT },
        { role: 'user', content: 'this are a test' },
      ],
      temperature: 0,
      max_completion_tokens: GRAMMAR_MAX_COMPLETION_TOKENS,
      reasoning_effort: 'none',
    });
  });

  it.each([
    [{ response: 'This is corrected.' }, 'This is corrected.'],
    [{ output_text: 'This is also corrected.' }, 'This is also corrected.'],
    [{ choices: [{ message: { content: 'This works too.' } }] }, 'This works too.'],
  ])('reads corrected text from a supported response envelope', (response, expected) => {
    expect(correctedTextFromAi(response)).toBe(expected);
  });

  it.each([null, {}, { response: '   ' }, { choices: [] }])('rejects an empty or malformed response', (response) => {
    expect(() => correctedTextFromAi(response)).toThrow();
  });

  it('rejects truncated output instead of returning an incomplete correction', () => {
    expect(() => correctedTextFromAi({ choices: [{ finish_reason: 'length', message: { content: 'Incomplete' } }] })).toThrow('truncated');
  });

  it.each(['content_filter', 'tool_calls', 'function_call'])('rejects the incomplete %s finish reason', (finishReason) => {
    expect(() => correctedTextFromAi({ choices: [{ finish_reason: finishReason, message: { content: 'Partial' } }] })).toThrow('did not finish normally');
  });

  it.each([null, 42, {}])('rejects a malformed explicit finish reason: %j', (finishReason) => {
    expect(() => correctedTextFromAi({ response: 'Partial', finish_reason: finishReason })).toThrow('did not finish normally');
  });

  it('preserves provider-returned boundary whitespace', () => {
    expect(correctedTextFromAi({ response: '\nCorrected text.\n' })).toBe('\nCorrected text.\n');
  });
});
