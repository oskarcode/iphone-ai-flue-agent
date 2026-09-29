// These tests prove that the public stream exposes progress while withholding private model/tool data.
import { describe, expect, it } from 'vitest';
import { createSubmissionEventProjector, projectConversationChunk } from '../src/lib/chat-events.ts';

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

describe('createSubmissionEventProjector', () => {
  it('emits only the current submission response', () => {
    const project = createSubmissionEventProjector('submission-current');

    expect(project({
      type: 'message-started',
      submissionId: 'submission-old',
      messageId: 'message-old',
      position: { batch: 1, index: 0 },
    })).toBeNull();
    expect(project({
      type: 'message-delta',
      messageId: 'message-old',
      kind: 'text',
      delta: 'previous full answer',
      position: { batch: 1, index: 1 },
    })).toBeNull();

    expect(project({
      type: 'message-started',
      submissionId: 'submission-current',
      messageId: 'message-current',
      position: { batch: 2, index: 0 },
    })).toEqual({ type: 'response', state: 'running' });
    expect(project({
      type: 'message-delta',
      messageId: 'message-current',
      kind: 'text',
      delta: 'Current answer',
      position: { batch: 2, index: 1 },
    })).toEqual({ type: 'token', delta: 'Current answer' });
  });

  it('deduplicates redelivered chunks and keeps reasoning private', () => {
    const project = createSubmissionEventProjector('submission-current');
    project({
      type: 'message-started',
      submissionId: 'submission-current',
      messageId: 'message-current',
      position: { batch: 1, index: 0 },
    });
    const text = {
      type: 'message-delta',
      messageId: 'message-current',
      kind: 'text',
      delta: 'Current answer',
      position: { batch: 1, index: 1 },
    };
    const reasoning = {
      type: 'message-delta',
      messageId: 'message-current',
      kind: 'reasoning',
      delta: 'private reasoning',
      position: { batch: 1, index: 2 },
    };

    expect(project(text)).toEqual({ type: 'token', delta: 'Current answer' });
    expect(project(text)).toBeNull();
    expect(project(reasoning)).toEqual({ type: 'planning' });
  });

  it('only exposes tool lifecycle events from the current response', () => {
    const project = createSubmissionEventProjector('submission-current');
    project({
      type: 'message-started',
      submissionId: 'submission-current',
      messageId: 'message-current',
      position: { batch: 1, index: 0 },
    });

    expect(project({
      type: 'tool-output',
      toolCallId: 'old-tool',
      output: 'private old output',
      position: { batch: 1, index: 1 },
    })).toBeNull();
    expect(project({
      type: 'tool-input',
      messageId: 'message-current',
      toolCallId: 'current-tool',
      toolName: 'web_research',
      input: { url: 'https://example.com' },
      position: { batch: 1, index: 2 },
    })).toEqual({ type: 'tool', state: 'running', name: 'web_research' });
    expect(project({
      type: 'tool-output',
      toolCallId: 'current-tool',
      output: 'private current output',
      position: { batch: 1, index: 3 },
    })).toEqual({ type: 'tool', state: 'complete', name: 'web_research' });
  });
});
