import { env as workerEnv } from 'cloudflare:workers';
import { init, setProvider } from '@flue/runtime';
import { cloudflareBindingProvider } from '@flue/runtime/cloudflare/workers-ai';
import { Hono, type Context } from 'hono';
import { IphoneAssistant } from './agents/iphone-assistant.ts';
import { renderChatPage } from './chat-page.ts';
import { encodeConfiguredMessage, type AssistantMode } from './lib/configured-message.ts';
import { correctedTextFromAgent } from './lib/output.ts';

type Bindings = {
  AI: Ai;
  CHAT_SESSIONS: KVNamespace;
};

const bindings = workerEnv as unknown as Bindings;
setProvider(cloudflareBindingProvider({
  binding: bindings.AI,
  gateway: { id: process.env.AI_GATEWAY_ID?.trim() || 'default' },
  streamIdleTimeoutMs: 3 * 60 * 1000,
}));

type AppEnv = { Bindings: Bindings };
type ChatMessage = { role: 'user' | 'assistant'; content: string };

const app = new Hono<AppEnv>();
const CHAT_SESSION_TTL_SECONDS = 600;
const CHAT_SESSION_KEY_PREFIX = 'chat-session:';
const MAX_TEXT_LENGTH = 30_000;
const MAX_CHAT_MESSAGES = 20;
const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,100}$/;

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

async function readTextBody(c: Context<AppEnv>): Promise<string | null> {
  const body = await c.req.json<{ text?: unknown }>().catch(() => null);
  if (typeof body?.text !== 'string') return null;
  const text = body.text.trim();
  return text && text.length <= MAX_TEXT_LENGTH ? text : null;
}

type AssistantResult = {
  text: string;
  route?: string;
};

async function runAgent(
  prompt: string,
  mode: AssistantMode,
  conversationId: string = crypto.randomUUID(),
  routingContext?: string,
): Promise<AssistantResult> {
  const agent = init(IphoneAssistant, { id: conversationId });
  const receipt = await agent.dispatch(encodeConfiguredMessage(prompt, mode, routingContext));
  const reply = await agent.read(receipt);
  if (!reply.text.trim()) throw new Error('The Flue agent returned an empty response.');
  const routingWrites = reply.data.routing;
  const latestRouting = Array.isArray(routingWrites) ? routingWrites.at(-1) : undefined;
  const route = latestRouting && typeof latestRouting === 'object' && 'route' in latestRouting
    ? String(latestRouting.route)
    : undefined;
  return { text: reply.text, route };
}

async function runTextRoute(c: Context<AppEnv>, mode: 'correct' | 'explain') {
  const text = await readTextBody(c);
  if (!text) return c.json({ error: `Send JSON with a non-empty text field of at most ${MAX_TEXT_LENGTH} characters` }, 400);
  try {
    const result = await runAgent(text, mode);
    return mode === 'correct'
      ? c.json({ corrected_text: correctedTextFromAgent(result.text) })
      : c.json({ explanation: result.text });
  } catch (error) {
    console.error(JSON.stringify({ message: 'Flue agent request failed', error: error instanceof Error ? error.message : String(error) }));
    return c.json({ error: 'Assistant request failed' }, 502);
  }
}

function validateChatMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_CHAT_MESSAGES) return null;
  let totalLength = 0;
  const messages: ChatMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const role = 'role' in item ? item.role : undefined;
    const content = 'content' in item ? item.content : undefined;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) return null;
    totalLength += content.length;
    if (totalLength > 36_000) return null;
    messages.push({ role, content });
  }
  return messages.at(-1)?.role === 'user' ? messages : null;
}

app.get('/health', (c) => c.json({ status: 'ok', framework: 'flue', router: 'jev' }));
app.post('/v1/correct', (c) => runTextRoute(c, 'correct'));
app.post('/v1/explain', (c) => runTextRoute(c, 'explain'));
app.post('/v1/ask', async (c) => {
  const text = await readTextBody(c);
  if (!text) return c.json({ error: `Send JSON with a non-empty text field of at most ${MAX_TEXT_LENGTH} characters` }, 400);
  try {
    const result = await runAgent(text, 'chat');
    return c.json({ answer: result.text, route: result.route });
  } catch (error) {
    console.error(JSON.stringify({ message: 'Flue agent request failed', error: error instanceof Error ? error.message : String(error) }));
    return c.json({ error: 'Assistant request failed' }, 502);
  }
});

async function createChatSession(c: Context<AppEnv>) {
  const text = await readTextBody(c);
  if (!text) return c.json({ error: `Send JSON with a non-empty text field of at most ${MAX_TEXT_LENGTH} characters` }, 400);
  const sessionId = crypto.randomUUID();
  await c.env.CHAT_SESSIONS.put(`${CHAT_SESSION_KEY_PREFIX}${sessionId}`, text, { expirationTtl: CHAT_SESSION_TTL_SECONDS });
  const chatUrl = new URL(c.req.url);
  chatUrl.pathname = '/chat';
  chatUrl.search = new URLSearchParams({ session: sessionId }).toString();
  return c.json({ chat_url: chatUrl.toString(), expires_in_seconds: CHAT_SESSION_TTL_SECONDS });
}

app.post('/handoff', createChatSession);
app.post('/v1/chat-session', createChatSession);
app.get('/chat', (c) => c.html(renderChatPage()));

app.get('/chat/session/:id', async (c) => {
  const id = c.req.param('id');
  if (!CONVERSATION_ID_PATTERN.test(id)) return c.json({ error: 'Invalid chat session' }, 400);
  const key = `${CHAT_SESSION_KEY_PREFIX}${id}`;
  const text = await c.env.CHAT_SESSIONS.get(key);
  if (text === null) return c.json({ error: 'Chat session expired or was already used' }, 404);
  await c.env.CHAT_SESSIONS.delete(key);
  return c.json({ text });
});

app.post('/chat/api', async (c) => {
  const body = await c.req.json<{ conversation_id?: unknown; messages?: unknown }>().catch(() => null);
  const messages = validateChatMessages(body?.messages);
  const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : '';
  if (!messages || !CONVERSATION_ID_PATTERN.test(conversationId)) {
    return c.json({ error: 'Send a conversation_id and chat history ending with a user message' }, 400);
  }
  try {
    const routingContext = messages.slice(-6).map((message) => `${message.role}: ${message.content}`).join('\n');
    const result = await runAgent(messages.at(-1)!.content, 'chat', conversationId, routingContext);
    return c.json({ explanation: result.text, conversation_id: conversationId, route: result.route });
  } catch (error) {
    console.error(JSON.stringify({ message: 'Flue chat failed', error: error instanceof Error ? error.message : String(error) }));
    return c.json({ error: 'Assistant request failed' }, 502);
  }
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
