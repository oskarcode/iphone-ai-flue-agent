import { afterEach, describe, expect, it, vi } from 'vitest';
import { askRepositoryTutor } from '../src/lib/repository-chat.ts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('main-chat repository adapter', () => {
  it('asks an existing tutor without starting a separate session or opening a page', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ status: 'ready' })).mockResolvedValueOnce(json({ answer: '## Flow\n1. Receive' }));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    await expect(askRepositoryTutor('repo-id', 'Explain the handler', signal)).resolves.toBe('## Flow\n1. Receive');
    expect(fetcher).toHaveBeenNthCalledWith(2, '/learn/repo-id/chat', expect.objectContaining({ signal, body: JSON.stringify({ question: 'Explain the handler' }) }));
  });

  it('waits for setup in the same interface, then sends the original question', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ status: 'queued' }))
      .mockResolvedValueOnce(new Response('event: ready\ndata: {"status":"ready"}\n\n'))
      .mockResolvedValueOnce(json({ status: 'ready' }))
      .mockResolvedValueOnce(json({ answer: 'Here is the architecture.' }));
    vi.stubGlobal('fetch', fetcher);
    const result = askRepositoryTutor('repo-id', 'Architecture?', new AbortController().signal);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('Here is the architecture.');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('retries pending admission rather than dropping the first question', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ status: 'queued' }))
      .mockResolvedValueOnce(json({}, 425))
      .mockResolvedValueOnce(json({ status: 'ready' }))
      .mockResolvedValueOnce(json({ answer: 'Ready.' }));
    vi.stubGlobal('fetch', fetcher);
    const result = askRepositoryTutor('repo-id', 'Purpose?', new AbortController().signal);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('Ready.');
  });

  it('surfaces setup errors without submitting a question', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ status: 'failed', error: 'Repository unavailable' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(askRepositoryTutor('repo-id', 'Hello', new AbortController().signal)).rejects.toThrow('Repository unavailable');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not continue a cancelled conversation', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(askRepositoryTutor('repo-id', 'Hello', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports question failures instead of rendering missing data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ status: 'ready' })).mockResolvedValueOnce(json({ error: 'Question failed' }, 502)));
    await expect(askRepositoryTutor('repo-id', 'Hello', new AbortController().signal)).rejects.toThrow('Question failed');
  });

  it('can execute from its self-contained browser source', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ status: 'ready' })).mockResolvedValueOnce(json({ answer: 'Browser answer.' })));
    const embedded = new Function(`return (${askRepositoryTutor.toString()});`)();
    await expect(embedded('id', 'Question', new AbortController().signal)).resolves.toBe('Browser answer.');
  });
});
