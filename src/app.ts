// Cloudflare supplies environment bindings; Flue supplies durable agent dispatch and Workers AI integration.
import { env as workerEnv } from 'cloudflare:workers';
import { init, setProvider } from '@flue/runtime';
import { cloudflareBindingProvider, type CloudflareAIBinding } from '@flue/runtime/cloudflare/workers-ai';

// Hono registers the Worker's HTTP middleware and route handlers.
import { Hono, type Context } from 'hono';

// Application modules own grammar correction, the agent, browser UI, event projection, request envelope, and Jev routing.
import { IphoneAssistant } from './agents/iphone-assistant.ts';
import { GithubLearningAgent } from './agents/github-learning.ts';
import { renderChatPage } from './chat-page.ts';
import { renderLearningGuidePage, renderLearningWaitingPage } from './learning-page.ts';
import { createSubmissionEventProjector } from './lib/chat-events.ts';
import { encodeConfiguredMessage, gatewayCallerFromModelInput } from './lib/configured-message.ts';
import { gatewayCallerFromAccess, gatewayMetadata, type GatewayCallerMetadata } from './lib/gateway-metadata.ts';
import { correctedTextFromAi, createGrammarRequest, grammarModelFromConfiguredModel } from './lib/grammar-correction.ts';
import {
  deleteLearningSession,
  getLearningGuide,
  getLearningSession,
  getLearningSubmission,
  LEARNING_SESSION_TTL_SECONDS,
  putLearningSession,
  putLearningSubmission,
  type LearningSessionMetadata,
} from './lib/learning-session.ts';
import { resolveGithubRepository } from './tools/github-repository.ts';
import { classifyWithJev, type JevRoute } from './tools/jev-router.ts';

// These are the bindings accessed directly by the HTTP application layer.
type Bindings = {
  AI: Ai;
  CHAT_SESSIONS: KVNamespace;
  FLUE_GITHUB_LEARNING_AGENT: DurableObjectNamespace;
};

// Flue's model provider is configured once when the Worker isolate starts, not once per request.
const bindings = workerEnv as unknown as Bindings;

const baseAiBinding = bindings.AI as unknown as CloudflareAIBinding;
const identityAwareBinding: CloudflareAIBinding = {
  /**
   * Input:
   * - Model name, Flue model input, and optional provider options.
   *
   * Output:
   * - The underlying Workers AI request promise.
   *
   * What this function does:
   * - Adds pseudonymous caller identity to existing AI Gateway metadata when available.
   */
  run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>) {
    const caller = gatewayCallerFromModelInput(input);
    if (!caller || !options || typeof options !== 'object' || !('gateway' in options) || !options.gateway || typeof options.gateway !== 'object') {
      return baseAiBinding.run(model, input, options);
    }
    const gateway = options.gateway as Record<string, unknown>;
    const existingMetadata = gateway.metadata && typeof gateway.metadata === 'object'
      ? gateway.metadata as Record<string, unknown>
      : {};
    return baseAiBinding.run(model, input, {
      ...options,
      gateway: { ...gateway, metadata: { ...existingMetadata, ...caller } },
    });
  },
};

setProvider(cloudflareBindingProvider({
  binding: identityAwareBinding,
  gateway: {
    id: process.env.AI_GATEWAY_ID?.trim() || 'default',
    metadata: gatewayMetadata('assistant'),
  },
  streamIdleTimeoutMs: 3 * 60 * 1000,
}));

// Hono uses AppEnv to type c.env, while ChatMessage defines the browser's accepted history shape.
type AppEnv = { Bindings: Bindings };
type ChatMessage = { role: 'user' | 'assistant'; content: string };

const app = new Hono<AppEnv>();

// Request limits bound model cost, memory use, and one-time handoff lifetime.
const CHAT_SESSION_TTL_SECONDS = 600;
const CHAT_SESSION_KEY_PREFIX = 'chat-session:';
const MAX_TEXT_LENGTH = 30_000;
const MAX_GRAMMAR_REQUEST_BYTES = 200_000;
const MAX_LEARNING_QUESTION_BYTES = 16_000;
const MAX_CHAT_MESSAGES = 20;
const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,100}$/;

// This narrow RPC type documents the only direct Durable Object method the HTTP layer calls.
type LearningAgentRpc = DurableObjectStub & {
  deleteLearningSession(): Promise<void>;
};

/**
 * Input:
 * - A request context that may contain a Cloudflare Access identity.
 *
 * Output:
 * - Pseudonymous caller metadata, or undefined when Access identity is unavailable.
 *
 * What this function does:
 * - Keeps personal email addresses out of AI Gateway metadata.
 * - Lets browser and service-token calls remain distinguishable in observability.
 */
async function gatewayCallerForRequest(c: Context<AppEnv>): Promise<GatewayCallerMetadata | undefined> {
  try {
    const executionCtx = c.executionCtx as ExecutionContext & { access?: CloudflareAccessContext };
    return gatewayCallerFromAccess(executionCtx.access);
  } catch {
    return undefined;
  }
}

/**
 * Input:
 * - A Hono request context and maximum accepted body size in bytes.
 *
 * Output:
 * - Parsed JSON of the requested type, or null for oversized/malformed input.
 *
 * What this function does:
 * - Stops reading once untrusted input crosses the memory boundary.
 * - Centralizes bounded JSON parsing for routes with small request contracts.
 */
async function readBoundedJson<T>(c: Context<AppEnv>, maxRequestBytes: number): Promise<T | null> {
  const declaredBytes = Number(c.req.header('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxRequestBytes) return null;
  const reader = c.req.raw.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxRequestBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Input:
 * - Every HTTP request and Hono's next middleware function.
 *
 * Output:
 * - The original route response with additional browser security headers.
 *
 * What this function does:
 * - Applies the same response-hardening headers to every route.
 */
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

/**
 * Input:
 * - A Hono request context whose JSON body should contain text.
 *
 * Output:
 * - Valid text within the size limit, optionally preserving surrounding whitespace.
 *
 * What this function does:
 * - Centralizes the public text-body contract used by Shortcut routes and handoff creation.
 */
async function readTextBody(c: Context<AppEnv>, preserveWhitespace = false, maxRequestBytes?: number): Promise<string | null> {
  let body: { text?: unknown } | null = null;
  if (maxRequestBytes) {
    body = await readBoundedJson<{ text?: unknown }>(c, maxRequestBytes);
  } else {
    body = await c.req.json<{ text?: unknown }>().catch(() => null);
  }
  if (typeof body?.text !== 'string') return null;
  const text = preserveWhitespace ? body.text : body.text.trim();
  return text.trim() && text.length <= MAX_TEXT_LENGTH ? text : null;
}

// Internal callers need the answer and, when available, the Jev route recorded by Flue.
type AssistantResult = {
  text: string;
  route?: string;
};

/**
 * Input:
 * - Flue's named data writes collected for one response.
 *
 * Output:
 * - The most recent recorded route, or undefined when no routing data was written.
 *
 * What this function does:
 * - Hides Flue's data-part lookup details from route handlers.
 */
function routeFromReplyData(data: Record<string, unknown[]>): string | undefined {
  const latestRouting = data.routing?.at(-1);
  return latestRouting && typeof latestRouting === 'object' && 'route' in latestRouting
    ? String(latestRouting.route)
    : undefined;
}

/**
 * Input:
 * - A user prompt, optional conversation ID, optional preselected route, and caller identity.
 *
 * Output:
 * - The completed agent text and selected route.
 *
 * What this function does:
 * - Dispatches one configured message to the durable Flue agent and waits for completion.
 * - Creates a random conversation for one-shot requests and reuses browser conversation IDs.
 */
async function runAgent(
  prompt: string,
  conversationId: string = crypto.randomUUID(),
  route?: 'direct_answer' | 'web_research' | 'clarification',
  gatewayCaller?: GatewayCallerMetadata,
): Promise<AssistantResult> {
  const agent = init(IphoneAssistant, { id: conversationId });
  const receipt = await agent.dispatch(encodeConfiguredMessage(prompt, undefined, route, gatewayCaller));
  const reply = await agent.read(receipt);
  if (!reply.text.trim()) throw new Error('The Flue agent returned an empty response.');
  return { text: reply.text, route: routeFromReplyData(reply.data) || route };
}

/**
 * Input:
 * - The current request context and a prompt containing a public GitHub repository URL.
 *
 * Output:
 * - Queued one-hour session metadata with an immutable repository commit.
 *
 * What this function does:
 * - Resolves and bounds the repository before allocating durable state.
 * - Dispatches generation, then stores its receipt in a separate KV key to avoid status races.
 */
async function createGithubLearningSession(c: Context<AppEnv>, prompt: string): Promise<LearningSessionMetadata> {
  const repository = await resolveGithubRepository(prompt, c.req.raw.signal);
  const id = crypto.randomUUID();
  const createdAt = new Date();
  const metadata: LearningSessionMetadata = {
    id,
    status: 'queued',
    repository: repository.fullName,
    repositoryUrl: repository.url,
    defaultBranch: repository.defaultBranch,
    commitSha: repository.commitSha,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + LEARNING_SESSION_TTL_SECONDS * 1000).toISOString(),
  };
  await putLearningSession(c.env.CHAT_SESSIONS, metadata);
  try {
    const agent = init(GithubLearningAgent, { id });
    const receipt = await agent.dispatch({
      message: 'Create and publish the complete code-learning guide for this repository.',
      initialData: { sessionId: id, repository },
      idempotencyKey: `learning-guide:${id}`,
    });
    await putLearningSubmission(c.env.CHAT_SESSIONS, id, receipt.submissionId, metadata.expiresAt);
    return metadata;
  } catch (error) {
    await deleteLearningSession(c.env.CHAT_SESSIONS, id);
    throw error;
  }
}

/**
 * Input:
 * - The current request context and a learning-session UUID.
 *
 * Output:
 * - An absolute URL for the public temporary guide page.
 *
 * What this function does:
 * - Reuses the request origin while removing unrelated query parameters.
 */
function learningUrl(c: Context<AppEnv>, id: string): string {
  const url = new URL(c.req.url);
  url.pathname = `/learn/${id}`;
  url.search = '';
  return url.toString();
}

/**
 * Input:
 * - Unknown JSON supplied as browser chat history.
 *
 * Output:
 * - A bounded array ending in a user message, or null when invalid.
 *
 * What this function does:
 * - Runtime-validates untrusted roles, message content, count, and aggregate length.
 */
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

// The health route provides a lightweight liveness check without invoking the agent.
app.get('/health', (c) => c.json({ status: 'ok', framework: 'flue', router: 'jev' }));

/**
 * Input:
 * - POST /v1/ask with a bounded text field.
 *
 * Output:
 * - A complete answer and selected route, or a validation/dependency error.
 *
 * What this function does:
 * - Provides the universal one-shot Shortcut endpoint.
 */
app.post('/v1/ask', async (c) => {
  const text = await readTextBody(c);
  if (!text) return c.json({ error: `Send JSON with a non-empty text field of at most ${MAX_TEXT_LENGTH} characters` }, 400);
  try {
    const gatewayCaller = await gatewayCallerForRequest(c);
    let route: JevRoute;
    try {
      route = await classifyWithJev(text, c.req.raw.signal, undefined, gatewayCaller);
    } catch (error) {
      route = 'direct_answer';
      console.error(JSON.stringify({ message: 'Jev ask route failed; using direct answer', error: error instanceof Error ? error.message : String(error) }));
    }
    if (route === 'github_learning') {
      const session = await createGithubLearningSession(c, text);
      return c.json({
        route,
        status: session.status,
        learning_url: learningUrl(c, session.id),
        expires_in_seconds: LEARNING_SESSION_TTL_SECONDS,
      }, 202);
    }
    const result = await runAgent(text, undefined, route, gatewayCaller);
    return c.json({ answer: result.text, route: result.route });
  } catch (error) {
    console.error(JSON.stringify({ message: 'Flue agent request failed', error: error instanceof Error ? error.message : String(error) }));
    return c.json({ error: 'Assistant request failed' }, 502);
  }
});

/**
 * Input:
 * - POST /v1/correct with copied text in JSON `{ text }`.
 *
 * Output:
 * - The corrected text only in `{ corrected_text }`, or a validation/provider error.
 *
 * What this function does:
 * - Calls Workers AI directly without Flue state, Jev routing, tools, or chat history.
 */
app.post('/v1/correct', async (c) => {
  const text = await readTextBody(c, true, MAX_GRAMMAR_REQUEST_BYTES);
  if (!text) return c.json({ error: `Send JSON with a non-empty text field of at most ${MAX_TEXT_LENGTH} characters` }, 400);
  try {
    // The generated Ai model union lags the currently documented GLM-5.2 binding model.
    const grammarAi = c.env.AI as { run(model: string, input: unknown, options: unknown): Promise<unknown> };
    const gatewayCaller = await gatewayCallerForRequest(c);
    const result = await grammarAi.run(
      grammarModelFromConfiguredModel(process.env.MODEL),
      createGrammarRequest(text),
      {
        signal: c.req.raw.signal,
        gateway: {
          id: process.env.AI_GATEWAY_ID?.trim() || 'default',
          skipCache: true,
          metadata: gatewayMetadata('grammar-correction', gatewayCaller),
        },
      },
    );
    return c.json({ corrected_text: correctedTextFromAi(result) });
  } catch (error) {
    console.error(JSON.stringify({ message: 'Grammar correction request failed', error: error instanceof Error ? error.message : String(error) }));
    return c.json({ error: 'Grammar correction request failed' }, 502);
  }
});

/**
 * Input:
 * - POST /handoff or /v1/chat-session with selected text.
 *
 * Output:
 * - A browser URL containing a short-lived random session ID.
 *
 * What this function does:
 * - Stores selected text in KV for ten minutes so the browser can pick it up.
 * - Returns only the opaque URL; it never embeds the selected text in the URL.
 */
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

// Handoff aliases support both the current Shortcut and the explicit versioned route.
app.post('/handoff', createChatSession);
app.post('/v1/chat-session', createChatSession);
app.get('/chat', (c) => c.html(renderChatPage()));

/**
 * Input:
 * - GET /chat/session/:id using the handoff ID from the browser URL.
 *
 * Output:
 * - The selected text once, or a validation/expired-session error.
 *
 * What this function does:
 * - Reads then deletes the KV value before returning it to the browser.
 * - Provides best-effort one-time use; KV does not make the get/delete pair atomic.
 */
app.get('/chat/session/:id', async (c) => {
  const id = c.req.param('id');
  if (!CONVERSATION_ID_PATTERN.test(id)) return c.json({ error: 'Invalid chat session' }, 400);
  const key = `${CHAT_SESSION_KEY_PREFIX}${id}`;
  const text = await c.env.CHAT_SESSIONS.get(key);
  if (text === null) return c.json({ error: 'Chat session expired or was already used' }, 404);
  await c.env.CHAT_SESSIONS.delete(key);
  return c.json({ text });
});

/**
 * Input:
 * - GET /learn/:id with an opaque session UUID.
 *
 * Output:
 * - Queued/failed status HTML or the completed fixed-renderer learning guide.
 *
 * What this function does:
 * - Reads the atomic KV session record and never renders raw model-authored HTML.
 */
app.get('/learn/:id', async (c) => {
  const id = c.req.param('id');
  if (!CONVERSATION_ID_PATTERN.test(id)) return c.json({ error: 'Invalid learning session' }, 400);
  const metadata = await getLearningSession(c.env.CHAT_SESSIONS, id);
  if (!metadata) return c.json({ error: 'Learning session expired or was deleted' }, 404);
  const guide = metadata.status === 'ready' ? await getLearningGuide(c.env.CHAT_SESSIONS, id) : null;
  return c.html(guide ? renderLearningGuidePage(metadata, guide) : renderLearningWaitingPage(metadata));
});

/**
 * Input:
 * - GET /learn/:id/status with an opaque session UUID.
 *
 * Output:
 * - The browser-safe lifecycle status, error, and expiration time.
 *
 * What this function does:
 * - Supports polling when SSE admission is delayed or a connection drops.
 */
app.get('/learn/:id/status', async (c) => {
  const id = c.req.param('id');
  if (!CONVERSATION_ID_PATTERN.test(id)) return c.json({ error: 'Invalid learning session' }, 400);
  const metadata = await getLearningSession(c.env.CHAT_SESSIONS, id);
  if (!metadata) return c.json({ error: 'Learning session expired or was deleted' }, 404);
  return c.json({ status: metadata.status, error: metadata.error, expires_at: metadata.expiresAt });
});

/**
 * Input:
 * - GET /learn/:id/events for a queued session with a Flue submission receipt.
 *
 * Output:
 * - One terminal SSE event: ready or failed.
 *
 * What this function does:
 * - Waits for the original durable generation submission without exposing internal Flue events.
 * - Persists terminal failure so future page loads stop polling.
 */
app.get('/learn/:id/events', async (c) => {
  const id = c.req.param('id');
  if (!CONVERSATION_ID_PATTERN.test(id)) return c.json({ error: 'Invalid learning session' }, 400);
  const metadata = await getLearningSession(c.env.CHAT_SESSIONS, id);
  if (!metadata) return c.json({ error: 'Learning session expired or was deleted' }, 404);
  if (metadata.status === 'ready') {
    return new Response(`event: ready\ndata: ${JSON.stringify({ status: 'ready' })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  const submissionId = await getLearningSubmission(c.env.CHAT_SESSIONS, id);
  if (!submissionId) return c.json({ error: 'Learning session is still being admitted' }, 425);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // This closure serializes one safe SSE frame; internal Flue events never reach the browser.
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      /**
       * Input:
       * - No explicit arguments; it closes over the session and request signal.
       *
       * Output:
       * - No value after one terminal SSE event is sent or the client disconnects.
       *
       * What this function does:
       * - Waits for the original submission and converts its terminal state into one public event.
       */
      const follow = async () => {
        try {
          const agent = init(GithubLearningAgent, { id });
          await agent.read(submissionId, { signal: c.req.raw.signal });
          const current = await getLearningSession(c.env.CHAT_SESSIONS, id);
          if (current?.status !== 'ready') throw new Error('The agent completed without publishing a guide.');
          send('ready', { status: 'ready' });
        } catch (error) {
          if (c.req.raw.signal.aborted) return;
          const current = await getLearningSession(c.env.CHAT_SESSIONS, id);
          const message = error instanceof Error ? error.message : String(error);
          if (current) await putLearningSession(c.env.CHAT_SESSIONS, { ...current, status: 'failed', error: message });
          send('failed', { error: message });
        } finally {
          try { controller.close(); } catch { /* Client disconnected. */ }
        }
      };
      void follow();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
  });
});

/**
 * Input:
 * - POST /learn/:id/chat with bounded JSON `{ question }`.
 *
 * Output:
 * - A text answer from the same commit-pinned durable tutor.
 *
 * What this function does:
 * - Reuses the session Durable Object only after the guide reaches ready state.
 */
app.post('/learn/:id/chat', async (c) => {
  const id = c.req.param('id');
  if (!CONVERSATION_ID_PATTERN.test(id)) return c.json({ error: 'Invalid learning session' }, 400);
  const metadata = await getLearningSession(c.env.CHAT_SESSIONS, id);
  if (!metadata || metadata.status !== 'ready') return c.json({ error: 'Learning session is not ready or has expired' }, 404);
  const body = await readBoundedJson<{ question?: unknown }>(c, MAX_LEARNING_QUESTION_BYTES);
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 4_000) return c.json({ error: 'Send a question of at most 4000 characters' }, 400);
  try {
    const agent = init(GithubLearningAgent, { id });
    const receipt = await agent.dispatch(question);
    const reply = await agent.read(receipt, { signal: c.req.raw.signal });
    return c.json({ answer: reply.text });
  } catch (error) {
    console.error(JSON.stringify({ message: 'Learning follow-up failed', sessionId: id, error: error instanceof Error ? error.message : String(error) }));
    return c.json({ error: 'Learning follow-up failed' }, 502);
  }
});

/**
 * Input:
 * - DELETE /v1/learning-sessions/:id with an opaque session UUID.
 *
 * Output:
 * - HTTP 204 after KV and Durable Object state are removed.
 *
 * What this function does:
 * - Delegates all cleanup to one Durable Object RPC so partial duplicate deletion is avoided.
 */
app.delete('/v1/learning-sessions/:id', async (c) => {
  const id = c.req.param('id');
  if (!CONVERSATION_ID_PATTERN.test(id)) return c.json({ error: 'Invalid learning session' }, 400);
  try {
    const stub = c.env.FLUE_GITHUB_LEARNING_AGENT.getByName(id) as DurableObjectStub & LearningAgentRpc;
    await stub.deleteLearningSession();
    return c.body(null, 204);
  } catch (error) {
    console.error(JSON.stringify({ message: 'Learning session deletion failed', sessionId: id, error: error instanceof Error ? error.message : String(error) }));
    return c.json({ error: 'Learning session deletion failed' }, 502);
  }
});

/**
 * Input:
 * - POST /chat/stream with a conversation ID and bounded browser history.
 *
 * Output:
 * - An SSE stream containing classification, tool, safe planning, token, and completion events.
 *
 * What this function does:
 * - Runs Jev before dispatch so classification appears first in the live timeline.
 * - Reads Flue events, removes private payloads, and streams only the public event vocabulary.
 * - Cancels downstream work when the browser disconnects.
 */
app.post('/chat/stream', async (c) => {
  const body = await c.req.json<{ conversation_id?: unknown; messages?: unknown }>().catch(() => null);
  const messages = validateChatMessages(body?.messages);
  const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : '';
  if (!messages || !CONVERSATION_ID_PATTERN.test(conversationId)) {
    return c.json({ error: 'Send a conversation_id and chat history ending with a user message' }, 400);
  }
  const gatewayCaller = await gatewayCallerForRequest(c);

  const encoder = new TextEncoder();
  const readAbort = new AbortController();
  c.req.raw.signal.addEventListener('abort', () => readAbort.abort(), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    /**
     * Input:
     * - The browser stream controller created by the Web Streams API.
     *
     * Output:
     * - SSE frames enqueued until the agent completes, errors, or is cancelled.
     *
     * What this function does:
     * - Owns the complete asynchronous classification and Flue read lifecycle.
     */
    start(controller) {
      let closed = false;

      /**
       * Input:
       * - An SSE event name and JSON-serializable payload.
       *
       * Output:
       * - One encoded SSE frame when the browser connection remains open.
       *
       * What this function does:
       * - Converts enqueue failures into cancellation instead of an unhandled exception.
       */
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
          readAbort.abort();
        }
      };

      /**
       * Input:
       * - No arguments; it closes the controller owned by this request.
       *
       * Output:
       * - A closed stream, with repeated or post-cancellation closes ignored.
       *
       * What this function does:
       * - Makes cleanup idempotent across success, failure, and browser cancellation.
       */
      const close = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // The browser may have already cancelled the stream.
          }
        }
      };

      /**
       * Input:
       * - Validated chat history and helpers captured from the route scope.
       *
       * Output:
       * - A complete sequence of SSE events for one user turn.
       *
       * What this function does:
       * - Classifies once, dispatches to Flue, and projects runtime events for the browser.
       */
      const runStream = async () => {
        send('status', { type: 'accepted' });
        try {
          const routingContext = messages.slice(-6).map((message) => `${message.role}: ${message.content}`).join('\n');
          send('progress', { type: 'classification', state: 'running' });
          const classificationStartedAt = Date.now();
          let route: JevRoute;
          let fallback = false;
          try {
            route = await classifyWithJev(messages.at(-1)!.content, readAbort.signal, routingContext, gatewayCaller);
          } catch (error) {
            fallback = true;
            route = 'direct_answer';
            console.error(JSON.stringify({ message: 'Jev streaming route failed; using direct answer', error: error instanceof Error ? error.message : String(error) }));
          }
          send('progress', { type: 'classification', state: 'complete', route, fallback, durationMs: Date.now() - classificationStartedAt });
          if (route === 'github_learning') {
            const session = await createGithubLearningSession(c, messages.at(-1)!.content);
            send('done', {
              text: `Your temporary code-learning guide is being generated:\n\n${learningUrl(c, session.id)}\n\nIt expires in one hour.`,
              route,
              conversationId,
            });
            return;
          }
          const agent = init(IphoneAssistant, { id: conversationId });
          const receipt = await agent.dispatch(encodeConfiguredMessage(messages.at(-1)!.content, undefined, route, gatewayCaller));
          send('status', { type: 'queued', submissionId: receipt.submissionId });
          const projectEvent = createSubmissionEventProjector(receipt.submissionId);
          const reply = await agent.read(receipt, {
            signal: readAbort.signal,
            /**
             * Input:
             * - One raw event emitted while Flue executes the conversation turn.
             *
             * Output:
             * - At most one sanitized progress event sent to the browser.
             *
             * What this function does:
             * - Drops replayed history and duplicate chunks from Flue's at-least-once stream.
             * - Drops events that the browser-safe projector does not explicitly allow.
             */
            onEvent(chunk) {
              const projected = projectEvent(chunk);
              if (!projected) return;
              send('progress', projected);
            },
          });
          send('done', {
            text: reply.text,
            route: routeFromReplyData(reply.data) || route,
            metadata: reply.metadata,
            conversationId,
          });
        } catch (error) {
          if (!readAbort.signal.aborted) {
            console.error(JSON.stringify({ message: 'Flue streaming chat failed', error: error instanceof Error ? error.message : String(error) }));
            send('error', { error: 'Assistant request failed' });
          }
        } finally {
          close();
        }
      };

      void runStream();
    },
    /**
     * Input:
     * - A cancellation notification from the browser stream consumer.
     *
     * Output:
     * - The shared abort signal is cancelled.
     *
     * What this function does:
     * - Stops Jev, Flue reads, and compatible downstream fetches after disconnect.
     */
    cancel() {
      readAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
});

/**
 * Input:
 * - POST /chat/api with a conversation ID and bounded browser history.
 *
 * Output:
 * - A non-streaming complete answer response.
 *
 * What this function does:
 * - Preserves the earlier JSON chat contract for non-streaming clients.
 */
app.post('/chat/api', async (c) => {
  const body = await c.req.json<{ conversation_id?: unknown; messages?: unknown }>().catch(() => null);
  const messages = validateChatMessages(body?.messages);
  const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : '';
  if (!messages || !CONVERSATION_ID_PATTERN.test(conversationId)) {
    return c.json({ error: 'Send a conversation_id and chat history ending with a user message' }, 400);
  }
  try {
    const prompt = messages.at(-1)!.content;
    const routingContext = messages.slice(-6).map((message) => `${message.role}: ${message.content}`).join('\n');
    const gatewayCaller = await gatewayCallerForRequest(c);
    let route: JevRoute;
    try {
      route = await classifyWithJev(prompt, c.req.raw.signal, routingContext, gatewayCaller);
    } catch (error) {
      route = 'direct_answer';
      console.error(JSON.stringify({ message: 'Jev chat route failed; using direct answer', error: error instanceof Error ? error.message : String(error) }));
    }
    if (route === 'github_learning') {
      const session = await createGithubLearningSession(c, prompt);
      return c.json({
        answer: `Your temporary code-learning guide is being generated:\n\n${learningUrl(c, session.id)}\n\nIt expires in one hour.`,
        conversation_id: conversationId,
        route,
        learning_url: learningUrl(c, session.id),
      }, 202);
    }
    const result = await runAgent(prompt, conversationId, route, gatewayCaller);
    return c.json({ answer: result.text, conversation_id: conversationId, route: result.route });
  } catch (error) {
    console.error(JSON.stringify({ message: 'Flue chat failed', error: error instanceof Error ? error.message : String(error) }));
    return c.json({ error: 'Assistant request failed' }, 502);
  }
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
