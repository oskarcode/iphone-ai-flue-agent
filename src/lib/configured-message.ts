import { isGatewayCallerMetadata, type GatewayCallerMetadata } from './gateway-metadata.ts';

// Flue receives one string, so this shape describes the trusted metadata encoded before the visible prompt.
export type ConfiguredMessage = {
  prompt: string;
  routingContext?: string;
  route?: 'direct_answer' | 'web_research' | 'clarification';
  gatewayCaller?: GatewayCallerMetadata;
};

const CONFIG_START = '<iphone-assistant-config>';
const CONFIG_END = '</iphone-assistant-config>';

/**
 * Input:
 * - A visible user prompt, optional chat context, and optional preselected route.
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
  routingContext?: string,
  route?: ConfiguredMessage['route'],
  gatewayCaller?: GatewayCallerMetadata,
): string {
  const config = JSON.stringify({
    v: 1,
    ...(routingContext ? { routingContext } : {}),
    ...(route ? { route } : {}),
    ...(gatewayCaller ? { gatewayCaller } : {}),
  });
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
 * - Runtime-validates the envelope version and route before the agent acts on them.
 */
export function decodeConfiguredMessage(value: string): ConfiguredMessage | null {
  const newline = value.indexOf('\n');
  if (newline < 0) return null;

  const metadata = value.slice(0, newline);
  if (!metadata.startsWith(CONFIG_START) || !metadata.endsWith(CONFIG_END)) return null;

  try {
    const parsed = JSON.parse(metadata.slice(CONFIG_START.length, -CONFIG_END.length)) as {
      v?: unknown;
      routingContext?: unknown;
      route?: unknown;
      gatewayCaller?: unknown;
    };
    if (parsed.v !== 1) return null;
    return {
      prompt: value.slice(newline + 1),
      ...(typeof parsed.routingContext === 'string' ? { routingContext: parsed.routingContext } : {}),
      ...(['direct_answer', 'web_research', 'clarification'].includes(String(parsed.route))
        ? { route: parsed.route as ConfiguredMessage['route'] }
        : {}),
      ...(isGatewayCallerMetadata(parsed.gatewayCaller) ? { gatewayCaller: parsed.gatewayCaller } : {}),
    };
  } catch {
    return null;
  }
}

/** Finds the most recent app-owned caller identity in a serialized model request. */
export function gatewayCallerFromModelInput(input: unknown): GatewayCallerMetadata | undefined {
  if (!input || typeof input !== 'object' || !('messages' in input) || !Array.isArray(input.messages)) return undefined;
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (!message || typeof message !== 'object' || !('content' in message)) continue;
    const content = message.content;
    const textParts = typeof content === 'string'
      ? [content]
      : Array.isArray(content)
        ? content.flatMap((part) => part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? [part.text] : [])
        : [];
    for (const text of textParts) {
      const configured = decodeConfiguredMessage(text);
      if (configured?.gatewayCaller) return configured.gatewayCaller;
    }
  }
  return undefined;
}
