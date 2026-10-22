import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { renderChatPage } from '../src/chat-page.ts';

// A minimal DOM double exercises browser state transitions, not layout or browser APIs.
class Element {
  children: unknown[] = [];
  listeners: Record<string, (event?: unknown) => unknown> = {};
  style = {};
  value = '';
  textContent = '';
  disabled = false;
  hidden = false;
  scrollHeight = 80;
  append(...children: unknown[]) { this.children.push(...children); }
  replaceChildren(...children: unknown[]) { this.children = children; }
  addEventListener(name: string, callback: (event?: unknown) => unknown) { this.listeners[name] = callback; }
  dispatchEvent(event: Event) { this.listeners[event.type]?.(event); }
  setAttribute() {}
  focus() {}
  get childNodes() { return this.children; }
}

function browser(fetcher: typeof fetch) {
  const nodes = new Map<string, Element>();
  const element = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector)!;
  };
  const script = renderChatPage().match(/<script>([\s\S]*)<\/script>/)![1];
  const api = runInNewContext(script + '\n({sendMessage, state:()=>({repositorySession,messages,activeController})})', {
    document: {
      querySelector: element,
      querySelectorAll: () => element('#chat-presets').children,
      createElement: () => new Element(),
      createTextNode: (text: string) => text,
      body: new Element(),
    },
    window: { scrollTo() {} }, location: { search: '', pathname: '/chat' },
    history: { replaceState() {} }, crypto, URL, URLSearchParams, Event,
    AbortController, DOMException, TextDecoder, setTimeout, clearTimeout,
    requestAnimationFrame: (callback: () => void) => callback(), fetch: fetcher,
  });
  return { api, element };
}

const json = (value: unknown) => new Response(JSON.stringify(value));
const done = (value: unknown) => new Response('event: done\ndata: ' + JSON.stringify(value) + '\n\n');

describe('main chat browser flow', () => {
  it('switches transcripts and drafts cleanly without mixing repo and general context', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(done({ text: 'General explanation.', route: 'direct_answer' }))
      .mockResolvedValueOnce(done({ text: 'Opening repository tutor…', route: 'github_learning', repositorySession: { id: 'repo-id', repository: 'owner/private', private: true } }))
      .mockResolvedValueOnce(json({ status: 'ready' }))
      .mockResolvedValueOnce(json({ answer: 'First repository answer.' }))
      .mockResolvedValueOnce(json({ status: 'ready' }))
      .mockResolvedValueOnce(json({ answer: 'Follow-up repository answer.' }))
      .mockResolvedValueOnce(done({ text: 'A learning note.', route: 'direct_answer' }))
      .mockResolvedValueOnce(json({ status: 'ready' }))
      .mockResolvedValueOnce(json({ answer: 'Resumed the same tutor.' }));
    const { api, element } = browser(fetcher);
    await api.sendMessage('Explain this article');
    await api.sendMessage('Teach me https://github.com/owner/private');
    expect(api.state().repositorySession.id).toBe('repo-id');
    expect(api.state().messages).toHaveLength(2);
    expect(api.state().messages.at(-1).content).toBe('First repository answer.');
    expect(element('#chat-mode').textContent).toContain('Repository tutor');
    expect(element('#chat-presets').children).toHaveLength(8);
    await api.sendMessage('Why is that async?');
    expect(api.state().messages.at(-1).content).toBe('Follow-up repository answer.');
    expect(fetcher.mock.calls.filter(([url]) => url === '/chat/stream')).toHaveLength(2);

    element('#input').value = 'Unsent repo question';
    element('#general-mode').listeners.click();
    expect(api.state().repositorySession).toBeNull();
    expect(api.state().messages.map((m: { content: string }) => m.content)).toEqual(['Explain this article', 'General explanation.']);
    expect(element('#messages').children).toHaveLength(2);
    expect(element('#input').value).toBe('');
    expect(element('#repo-mode').hidden).toBe(false);
    expect(element('#general-mode').hidden).toBe(true);
    expect(element('#chat-presets').children).toHaveLength(1);

    element('#input').value = 'Unsent general question';
    element('#repo-mode').listeners.click();
    expect(api.state().messages).toHaveLength(4);
    expect(element('#input').value).toBe('Unsent repo question');
    element('#general-mode').listeners.click();
    expect(element('#input').value).toBe('Unsent general question');
    (element('#chat-presets').children[0] as Element).listeners.click();
    await api.sendMessage(element('#input').value);
    const lastRequest = JSON.parse(fetcher.mock.calls.at(-1)![1].body);
    expect(lastRequest.messages).toHaveLength(3);
    expect(lastRequest.messages[0].content).toBe('Explain this article');
    expect(JSON.stringify(lastRequest)).not.toContain('owner/private');
    expect(lastRequest.messages.at(-1).content).toContain('TypeScript mental model into the post itself');

    element('#repo-mode').listeners.click();
    expect(api.state().repositorySession.id).toBe('repo-id');
    expect(element('#input').value).toBe('Unsent repo question');
    await api.sendMessage(element('#input').value);
    expect(fetcher.mock.calls.at(-1)![0]).toBe('/learn/repo-id/chat');
    expect(api.state().messages.at(-1).content).toBe('Resumed the same tutor.');
    expect(api.state().activeController).toBeNull();
  });

  it('new chat clears repository mode and restores the recap-only preset', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(done({ route: 'github_learning', repositorySession: { id: 'repo-id', repository: 'owner/repo', private: false } }))
      .mockResolvedValueOnce(json({ status: 'ready' }))
      .mockResolvedValueOnce(json({ answer: 'Ready.' }));
    const { api, element } = browser(fetcher);
    await api.sendMessage('Teach me this repo');
    element('#new-chat').listeners.click();
    expect(api.state().repositorySession).toBeNull();
    expect(api.state().messages).toHaveLength(0);
    expect(element('#general-mode').hidden).toBe(true);
    expect(element('#repo-mode').hidden).toBe(true);
    expect(element('#input').value).toBe('');
    expect(element('#chat-presets').children).toHaveLength(1);
    element('#repo-mode').listeners.click();
    expect(api.state().repositorySession).toBeNull();
  });

  it('leaves an empty general view when the conversation began in repository mode', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(done({ route: 'github_learning', repositorySession: { id: 'id', repository: 'owner/repo', private: false } }))
      .mockResolvedValueOnce(json({ status: 'ready' }))
      .mockResolvedValueOnce(json({ answer: 'Repository answer.' }));
    const { api, element } = browser(fetcher);
    await api.sendMessage('Teach me this repo');
    element('#general-mode').listeners.click();
    expect(api.state().messages).toHaveLength(0);
    expect(element('#chat-mode').textContent).toBe('General chat');
    element('#repo-mode').listeners.click();
    expect(api.state().messages).toHaveLength(2);
    expect(api.state().messages.at(-1).content).toBe('Repository answer.');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
