export type AssistantMode = 'correct' | 'explain' | 'chat';

export type ConfiguredMessage = {
  mode: AssistantMode;
  prompt: string;
  routingContext?: string;
  route?: 'correct' | 'direct_answer' | 'read_url' | 'web_search' | 'clarification';
};

const CONFIG_START = '<iphone-assistant-config>';
const CONFIG_END = '</iphone-assistant-config>';

export function encodeConfiguredMessage(
  prompt: string,
  mode: AssistantMode,
  routingContext?: string,
  route?: ConfiguredMessage['route'],
): string {
  const config = JSON.stringify({ v: 1, mode, ...(routingContext ? { routingContext } : {}), ...(route ? { route } : {}) });
  return `${CONFIG_START}${config}${CONFIG_END}\n${prompt}`;
}

export function decodeConfiguredMessage(value: string): ConfiguredMessage | null {
  const newline = value.indexOf('\n');
  if (newline < 0) return null;

  const metadata = value.slice(0, newline);
  if (!metadata.startsWith(CONFIG_START) || !metadata.endsWith(CONFIG_END)) return null;

  try {
    const parsed = JSON.parse(metadata.slice(CONFIG_START.length, -CONFIG_END.length)) as {
      v?: unknown;
      mode?: unknown;
      routingContext?: unknown;
      route?: unknown;
    };
    if (parsed.v !== 1 || !['correct', 'explain', 'chat'].includes(String(parsed.mode))) return null;
    return {
      mode: parsed.mode as AssistantMode,
      prompt: value.slice(newline + 1),
      ...(typeof parsed.routingContext === 'string' ? { routingContext: parsed.routingContext } : {}),
      ...(['correct', 'direct_answer', 'read_url', 'web_search', 'clarification'].includes(String(parsed.route))
        ? { route: parsed.route as ConfiguredMessage['route'] }
        : {}),
    };
  } catch {
    return null;
  }
}
