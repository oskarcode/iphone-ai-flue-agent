// These tests protect the private app-to-agent message envelope and visible prompt boundary.
import { describe, expect, it } from 'vitest';
import { decodeConfiguredMessage, encodeConfiguredMessage, gatewayCallerFromModelInput } from '../src/lib/configured-message.ts';

describe('configured messages', () => {
  it('round trips a visible prompt', () => {
    const encoded = encodeConfiguredMessage('Explain this sentence.');
    expect(decodeConfiguredMessage(encoded)).toEqual({ prompt: 'Explain this sentence.' });
  });

  it('rejects unsupported envelope versions', () => {
    expect(decodeConfiguredMessage('<iphone-assistant-config>{"v":2}</iphone-assistant-config>\nExplain this.')).toBeNull();
  });

  it('rejects ordinary user text', () => {
    expect(decodeConfiguredMessage('hello')).toBeNull();
  });

  it('carries optional context for Jev without changing the visible prompt', () => {
    const encoded = encodeConfiguredMessage('What is my favorite?', 'user: My favorite is TypeScript.', 'direct_answer');
    expect(decodeConfiguredMessage(encoded)).toEqual({
      prompt: 'What is my favorite?',
      routingContext: 'user: My favorite is TypeScript.',
      route: 'direct_answer',
    });
  });

  it('carries verified caller metadata into the model binding request', () => {
    const encoded = encodeConfiguredMessage(
      'Explain this.',
      undefined,
      'direct_answer',
      { caller_type: 'user', access_user_id: 'user-123' },
    );

    expect(gatewayCallerFromModelInput({ messages: [{ role: 'user', content: encoded }] })).toEqual({
      caller_type: 'user',
      access_user_id: 'user-123',
    });
  });

  it('ignores caller metadata that does not match the trusted shape', () => {
    const encoded = '<iphone-assistant-config>{"v":1,"gatewayCaller":{"caller_type":"user","access_user_id":42}}</iphone-assistant-config>\nExplain this.';
    expect(gatewayCallerFromModelInput({ messages: [{ role: 'user', content: encoded }] })).toBeUndefined();
  });
});
