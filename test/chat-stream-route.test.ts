import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dispatch, read, classify, resolveRepo } = vi.hoisted(() => ({
  dispatch: vi.fn(), read: vi.fn(), classify: vi.fn(), resolveRepo: vi.fn(),
}));
vi.mock('cloudflare:workers', () => ({ DurableObject: class {}, env: { AI: { run: vi.fn() } } }));
vi.mock('@flue/runtime', () => ({
  defineTool: (tool: unknown) => tool,
  init: () => ({ dispatch, read }),
  setProvider: vi.fn(), useAgentFinish: vi.fn(), useAgentStart: vi.fn(),
  useDataWriter: vi.fn(), useDelivery: vi.fn(), useInitialData: vi.fn(),
  useModel: vi.fn(), usePersistentState: vi.fn(), useResponseFinish: vi.fn(),
  useResponseStart: vi.fn(), useTool: vi.fn(),
}));
vi.mock('@flue/runtime/cloudflare', () => ({ extend: (extension: unknown) => extension }));
vi.mock('@flue/runtime/cloudflare/workers-ai', () => ({ cloudflareBindingProvider: vi.fn(() => ({})) }));
vi.mock('../src/tools/jev-router.ts', () => ({ classifyWithJev: classify }));
vi.mock('../src/tools/github-repository.ts', () => ({ resolveGithubRepository: resolveRepo, createGithubRepositoryTools: vi.fn() }));

import app from '../src/app.ts';
import { LEARNING_RECAP_PROMPT } from '../src/lib/chat-presets.ts';

const recordAssistantTurn = vi.fn();
const recordShareDraft = vi.fn();
const recordSessionCreated = vi.fn();
const env = {
  CHAT_SESSIONS: { get: vi.fn().mockResolvedValue(null), put: vi.fn(), delete: vi.fn() },
  LEARNING_ARCHIVE: { getByName: () => ({ recordAssistantTurn, recordShareDraft, recordSessionCreated }) },
} as never;

function request(messages: { role: string; content: string }[]) {
  return new Request('https://example.com/chat/stream', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversation_id: '7df74d60-cb1b-4b31-a5ae-f28608efdab5', messages }),
  });
}

describe('main chat mode and recap routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatch.mockResolvedValue({ submissionId: 'receipt-1' });
    read.mockResolvedValue({ text: 'A grounded learning note.', data: {} });
    classify.mockResolvedValue('direct_answer');
  });

  it('uses the conversation for the preset without classifying or archiving a new draft', async () => {
    const response = await app.fetch(request([
      { role: 'user', content: 'Why await storage?' },
      { role: 'assistant', content: 'The handler needs the stored value before returning.' },
      { role: 'user', content: LEARNING_RECAP_PROMPT },
    ]), env);
    const body = await response.text();
    expect(body).toContain('A grounded learning note.');
    expect(classify).not.toHaveBeenCalled();
    expect(JSON.stringify(dispatch.mock.calls[0])).toContain('Why await storage?');
    expect(recordAssistantTurn).not.toHaveBeenCalled();
    expect(recordShareDraft).not.toHaveBeenCalled();
  });

  it('hands repository identity to the same UI instead of returning a separate page link', async () => {
    classify.mockResolvedValue('github_learning');
    resolveRepo.mockResolvedValue({
      owner: 'sample', repo: 'private-repo', fullName: 'sample/private-repo',
      url: 'https://github.com/sample/private-repo', private: true,
      description: '', defaultBranch: 'main', commitSha: 'a'.repeat(40), files: [], treeTruncated: false,
    });
    const response = await app.fetch(request([{ role: 'user', content: 'Teach me https://github.com/sample/private-repo' }]), env);
    const text = await response.text();
    const done = text.split('\n\n').find((block) => block.startsWith('event: done'))!;
    const data = JSON.parse(done.split('data: ')[1]);
    expect(data.repositorySession).toEqual({ id: expect.any(String), repository: 'sample/private-repo', private: true });
    expect(data.text).not.toContain('/learn/');
    expect(resolveRepo).toHaveBeenCalledOnce();
    expect(recordShareDraft).not.toHaveBeenCalled();
  });
});
