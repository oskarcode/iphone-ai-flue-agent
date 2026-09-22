// These tests prove that the public stream exposes progress while withholding private model/tool data.
import { describe, expect, it } from 'vitest';
import { projectConversationChunk } from '../src/lib/chat-events.ts';

describe('projectConversationChunk', () => {
  it('projects routing and tokens', () => {
    expect(projectConversationChunk({ type: 'data-part', name: 'routing', data: { state: 'complete', route: 'web_research', durationMs: 42 } }))
      .toEqual({ type: 'classification', state: 'complete', route: 'web_research', durationMs: 42 });
    expect(projectConversationChunk({ type: 'message-delta', kind: 'text', delta: 'Hello' }))
      .toEqual({ type: 'token', delta: 'Hello' });
  });

  it('does not expose raw reasoning', () => {
    expect(projectConversationChunk({ type: 'message-delta', kind: 'reasoning', delta: 'private reasoning' }))
      .toEqual({ type: 'planning' });
  });

  it('projects tool lifecycle without tool output', () => {
    expect(projectConversationChunk({ type: 'tool-input', toolName: 'web_research', toolCallId: 'call-1', input: { url: 'https://example.com' } }))
      .toEqual({ type: 'tool', state: 'running', name: 'web_research' });
    expect(projectConversationChunk({ type: 'tool-output', toolCallId: 'call-1', output: 'private page contents', durationMs: 90 }))
      .toEqual({ type: 'tool', state: 'complete', name: 'call-1', durationMs: 90 });
  });
});
