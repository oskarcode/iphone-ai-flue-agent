type JsonRecord = Record<string, unknown>;

export type PublicChatEvent =
  | { type: 'classification'; state: 'running' | 'complete'; route?: string; durationMs?: number; fallback?: boolean }
  | { type: 'planning' }
  | { type: 'token'; delta: string }
  | { type: 'tool'; state: 'running' | 'complete' | 'error'; name: string; durationMs?: number }
  | { type: 'response'; state: 'running' | 'complete' };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function projectConversationChunk(value: unknown): PublicChatEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;

  if (value.type === 'data-part' && value.name === 'routing' && isRecord(value.data)) {
    const state = value.data.state;
    if (state !== 'running' && state !== 'complete') return null;
    return {
      type: 'classification',
      state,
      ...(typeof value.data.route === 'string' ? { route: value.data.route } : {}),
      ...(typeof value.data.durationMs === 'number' ? { durationMs: value.data.durationMs } : {}),
      ...(typeof value.data.fallback === 'boolean' ? { fallback: value.data.fallback } : {}),
    };
  }

  if (value.type === 'message-delta' && value.kind === 'text' && typeof value.delta === 'string') {
    return { type: 'token', delta: value.delta };
  }

  // Raw model reasoning is intentionally not exposed to clients.
  if (value.type === 'message-delta' && value.kind === 'reasoning') return { type: 'planning' };

  if (value.type === 'tool-input' && typeof value.toolName === 'string') {
    return { type: 'tool', state: 'running', name: value.toolName };
  }

  if ((value.type === 'tool-output' || value.type === 'tool-output-error') && typeof value.toolCallId === 'string') {
    return {
      type: 'tool',
      state: value.type === 'tool-output' ? 'complete' : 'error',
      name: value.toolCallId,
      ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
    };
  }

  if (value.type === 'message-started') return { type: 'response', state: 'running' };
  if (value.type === 'message-completed') return { type: 'response', state: 'complete' };
  return null;
}
