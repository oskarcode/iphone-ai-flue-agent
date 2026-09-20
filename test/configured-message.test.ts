import { describe, expect, it } from 'vitest';
import { decodeConfiguredMessage, encodeConfiguredMessage } from '../src/lib/configured-message.ts';

describe('configured messages', () => {
  it('round trips a visible prompt and mode', () => {
    const encoded = encodeConfiguredMessage('Fix this sentence.', 'correct');
    expect(decodeConfiguredMessage(encoded)).toEqual({ mode: 'correct', prompt: 'Fix this sentence.' });
  });

  it('rejects ordinary user text', () => {
    expect(decodeConfiguredMessage('hello')).toBeNull();
  });

  it('carries optional context for Jev without changing the visible prompt', () => {
    const encoded = encodeConfiguredMessage('What is my favorite?', 'chat', 'user: My favorite is TypeScript.', 'direct_answer');
    expect(decodeConfiguredMessage(encoded)).toEqual({
      mode: 'chat',
      prompt: 'What is my favorite?',
      routingContext: 'user: My favorite is TypeScript.',
      route: 'direct_answer',
    });
  });
});
