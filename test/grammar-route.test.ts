import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configuredAiRun = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({
  env: {
    AI: { run: configuredAiRun },
    MODEL: 'cloudflare/@cf/zai-org/glm-5.2',
    AI_GATEWAY_ID: 'iphone-flue-shortcut',
  },
}));

import app from '../src/app';

function correctionRequest(text: unknown) {
  return new Request('https://example.com/v1/correct', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

function accessContext(identity: Record<string, unknown>) {
  return {
    access: { aud: 'test-aud', getIdentity: async () => identity },
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as never;
}

describe('POST /v1/correct', () => {
  beforeEach(() => {
    configuredAiRun.mockReset();
    process.env.MODEL = 'cloudflare/@cf/zai-org/glm-5.2';
    process.env.AI_GATEWAY_ID = 'iphone-flue-shortcut';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the stable correction envelope through the configured gateway', async () => {
    const run = vi.fn().mockResolvedValue({ response: 'This is a test.' });
    const response = await app.fetch(correctionRequest('this are test.'), {
      AI: { run },
      MODEL: 'cloudflare/@cf/zai-org/glm-5.2',
      AI_GATEWAY_ID: 'iphone-flue-shortcut',
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ corrected_text: 'This is a test.' });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      '@cf/zai-org/glm-5.2',
      expect.objectContaining({ temperature: 0, reasoning_effort: 'none' }),
      expect.objectContaining({ gateway: expect.objectContaining({ id: 'iphone-flue-shortcut', skipCache: true }) }),
    );
  });

  it('adds verified human identity to gateway metadata', async () => {
    const run = vi.fn().mockResolvedValue({ response: 'Corrected.' });
    const response = await app.fetch(
      correctionRequest('correct me'),
      { AI: { run } } as never,
      accessContext({ user_uuid: 'user-123', email: 'person@example.com' }),
    );

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        gateway: expect.objectContaining({
          metadata: {
            application: 'iphone-ai-flue-agent',
            component: 'grammar-correction',
            caller_type: 'user',
            access_user_id: 'user-123',
          },
        }),
      }),
    );
  });

  it.each([undefined, null, 42, '', '   ', 'x'.repeat(30_001)])('rejects invalid text without calling AI', async (text) => {
    const run = vi.fn();
    const request = text === undefined
      ? new Request('https://example.com/v1/correct', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      : correctionRequest(text);
    const response = await app.fetch(request, { AI: { run } } as never);

    expect(response.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('accepts the 30,000-character boundary', async () => {
    const run = vi.fn().mockResolvedValue({ response: 'Corrected.' });
    const response = await app.fetch(correctionRequest('x'.repeat(30_000)), { AI: { run } } as never);

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledOnce();
  });

  it('rejects an oversized JSON body before calling AI', async () => {
    const run = vi.fn();
    const response = await app.fetch(new Request('https://example.com/v1/correct', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Fix me.', padding: 'x'.repeat(200_000) }),
    }), { AI: { run } } as never);

    expect(response.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ['provider rejection', () => Promise.reject(new Error('provider unavailable'))],
    ['empty output', () => Promise.resolve({ response: '' })],
    ['truncated output', () => Promise.resolve({ choices: [{ finish_reason: 'length', message: { content: 'Incomplete' } }] })],
    ['filtered output', () => Promise.resolve({ choices: [{ finish_reason: 'content_filter', message: { content: 'Partial' } }] })],
  ])('maps %s to 502', async (_name, providerResult) => {
    const run = vi.fn().mockImplementation(providerResult);
    const response = await app.fetch(correctionRequest('Fix me.'), { AI: { run } } as never);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'Grammar correction request failed' });
  });
});
