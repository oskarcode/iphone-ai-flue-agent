import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerAiRun = vi.hoisted(() => vi.fn());
const requestAiRun = vi.hoisted(() => vi.fn());

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {},
  env: { AI: { run: workerAiRun } },
}));

vi.mock('@flue/runtime', () => ({
  defineTool: (tool: unknown) => tool,
  init: vi.fn(),
  setProvider: vi.fn(),
  useAgentFinish: vi.fn(),
  useAgentStart: vi.fn(),
  useDataWriter: vi.fn(),
  useDelivery: vi.fn(),
  useInitialData: vi.fn(),
  useModel: vi.fn(),
  usePersistentState: vi.fn(),
  useResponseFinish: vi.fn(),
  useResponseStart: vi.fn(),
  useTool: vi.fn(),
}));

vi.mock('@flue/runtime/cloudflare', () => ({ extend: (extension: unknown) => extension }));
vi.mock('@flue/runtime/cloudflare/workers-ai', () => ({ cloudflareBindingProvider: vi.fn(() => ({})) }));

import app from '../src/app.ts';

const visualResponse = {
  title: 'Workers KV as a library shelf',
  concept: 'Workers KV',
  analogy: 'a labeled library shelf',
  summary: 'KV stores values by key and reads them quickly at the edge.',
  caption: 'The shelf labels are keys, and the drawers are cached values.',
  parts: [
    { id: 'key-label', label: 'Key label', meaning: 'The lookup name.', role: 'Finds the value.' },
    { id: 'edge-shelf', label: 'Edge shelf', meaning: 'Nearby cached storage.', role: 'Serves reads quickly.' },
    { id: 'origin-ledger', label: 'Origin ledger', meaning: 'Eventually consistent source.', role: 'Propagates updates.' },
  ],
  flow: [
    { from: 'key-label', to: 'edge-shelf', label: 'A request asks for one key.' },
    { from: 'origin-ledger', to: 'edge-shelf', label: 'Updates replicate outward.' },
  ],
  codeExample: 'const value = await env.KV.get("key");',
};

function memoryKv(): KVNamespace {
  const storage = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const value = storage.get(key) ?? null;
      return type === 'json' && value ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      storage.set(key, value);
    },
  } as unknown as KVNamespace;
}

describe('visual explanation route', () => {
  beforeEach(() => {
    workerAiRun.mockReset().mockResolvedValue({ result: { answers: { route: { choice: 'visual_explanation' } } } });
    requestAiRun.mockReset().mockResolvedValue({ response: JSON.stringify(visualResponse), finish_reason: 'stop' });
  });

  it('creates and serves a temporary visual explainer page', async () => {
    const kv = memoryKv();
    const createResponse = await app.fetch(new Request('https://example.com/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Explain Workers KV visually' }),
    }), { AI: { run: requestAiRun }, CHAT_SESSIONS: kv } as never);

    expect(createResponse.status).toBe(200);
    const created = await createResponse.json() as { route: string; visual_url: string };
    expect(created.route).toBe('visual_explanation');
    expect(created.visual_url).toMatch(/^https:\/\/example.com\/visual\//);

    const pageResponse = await app.fetch(new Request(created.visual_url), { CHAT_SESSIONS: kv } as never);
    const html = await pageResponse.text();

    expect(pageResponse.status).toBe(200);
    expect(html).toContain('Workers KV as a library shelf');
    expect(html).toContain('Interactive anatomy');
    expect(html).toContain('TypeScript mental model');
  });
});
