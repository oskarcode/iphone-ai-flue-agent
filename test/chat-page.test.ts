// This test catches broken escaping in the HTML template before the Worker is deployed.
import { describe, expect, it } from 'vitest';
import { renderChatPage } from '../src/chat-page.ts';

describe('renderChatPage', () => {
  it('renders the streaming interface with valid browser JavaScript', () => {
    const html = renderChatPage();
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(html).toContain('/chat/stream');
    expect(html).toContain('How this answer was made');
    expect(html).toContain("sendMessage('Explain this pasted text in plain English:\\n\\n' + data.text)");
    expect(html).toContain('messages: history');
    expect(html).not.toContain('messages: history, mode');
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });
});
