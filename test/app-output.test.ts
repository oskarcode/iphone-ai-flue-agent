import { describe, expect, it } from 'vitest';
import { correctedTextFromAgent } from '../src/lib/output.ts';

describe('compatibility output', () => {
  it('removes internal correction tags', () => {
    expect(correctedTextFromAgent('<corrected_text>This is a test.</corrected_text>')).toBe('This is a test.');
  });

  it('keeps an untagged fallback response', () => {
    expect(correctedTextFromAgent('This is a test.')).toBe('This is a test.');
  });
});
