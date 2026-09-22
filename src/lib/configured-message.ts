// Explain mode preserves the dedicated Shortcut behavior; chat mode handles general requests.
export type AssistantMode = 'explain' | 'chat';

// Flue receives one string, so this shape describes the trusted metadata encoded before the visible prompt.
export type ConfiguredMessage = {
  mode: AssistantMode;
  prompt: string;
  routingContext?: string;
  route?: 'direct_answer' | 'web_research' | 'clarification';
};

const CONFIG_START = '<iphone-assistant-config>';
const CONFIG_END = '</iphone-assistant-config>';

/**
 * Input:
 * - A visible user prompt, compatibility mode, optional chat context, and optional preselected route.
 *
 * Output:
 * - One string containing a private JSON metadata line followed by the visible prompt.
 *
 * What this function does:
 * - Carries app-owned routing instructions through Flue's string message contract.
 * - Keeps the format versioned so future decoders can reject incompatible metadata.
 */
export function encodeConfiguredMessage(
  prompt: string,
  mode: AssistantMode,
  routingContext?: string,
  route?: ConfiguredMessage['route'],
): string {
  const config = JSON.stringify({ v: 1, mode, ...(routingContext ? { routingContext } : {}), ...(route ? { route } : {}) });
  return `${CONFIG_START}${config}${CONFIG_END}\n${prompt}`;
}

/**
 * Input:
 * - A Flue delivery body that may or may not use this application's metadata format.
 *
 * Output:
 * - Parsed trusted configuration, or null when the envelope is absent or invalid.
 *
 * What this function does:
 * - Separates the first metadata line from the visible user prompt.
 * - Runtime-validates mode and route values before the agent acts on them.
 */
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
    if (parsed.v !== 1 || !['explain', 'chat'].includes(String(parsed.mode))) return null;
    return {
      mode: parsed.mode as AssistantMode,
      prompt: value.slice(newline + 1),
      ...(typeof parsed.routingContext === 'string' ? { routingContext: parsed.routingContext } : {}),
      ...(['direct_answer', 'web_research', 'clarification'].includes(String(parsed.route))
        ? { route: parsed.route as ConfiguredMessage['route'] }
        : {}),
    };
  } catch {
    return null;
  }
}
