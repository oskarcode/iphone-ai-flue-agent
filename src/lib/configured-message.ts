export type AssistantMode = 'correct' | 'explain' | 'chat';

export type ConfiguredMessage = {
  mode: AssistantMode;
  prompt: string;
  routingContext?: string;
};

const CONFIG_START = '<iphone-assistant-config>';
const CONFIG_END = '</iphone-assistant-config>';

export function encodeConfiguredMessage(prompt: string, mode: AssistantMode, routingContext?: string): string {
  const config = JSON.stringify({ v: 1, mode, ...(routingContext ? { routingContext } : {}) });
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
    };
    if (parsed.v !== 1 || !['correct', 'explain', 'chat'].includes(String(parsed.mode))) return null;
    return {
      mode: parsed.mode as AssistantMode,
      prompt: value.slice(newline + 1),
      ...(typeof parsed.routingContext === 'string' ? { routingContext: parsed.routingContext } : {}),
    };
  } catch {
    return null;
  }
}
