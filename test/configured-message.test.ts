// These tests protect the private app-to-agent message envelope and visible prompt boundary.
import { describe, expect, it } from 'vitest';
import { decodeConfiguredMessage, encodeConfiguredMessage } from '../src/lib/configured-message.ts';

describe('configured messages', () => {
  it('round trips a visible prompt and mode', () => {
    const encoded = encodeConfiguredMessage('Explain this sentence.', 'explain');
    expect(decodeConfiguredMessage(encoded)).toEqual({ mode: 'explain', prompt: 'Explain this sentence.' });
  });

  it('rejects the removed correction mode and route', () => {
    expect(decodeConfiguredMessage('<iphone-assistant-config>{"v":1,"mode":"correct","route":"correct"}</iphone-assistant-config>\nFix this.')).toBeNull();
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
