'use agent';

// Flue hooks provide the durable agent lifecycle, model selection, tools, and response metadata.
import {
  type AgentProps,
  useAgentStart,
  useDataWriter,
  useDelivery,
  useModel,
  useResponseFinish,
  useResponseStart,
  useTool,
} from '@flue/runtime';

// Application modules define the private request envelope, prompts, Jev routing, and retrieval tools.
import { decodeConfiguredMessage } from '../lib/configured-message.ts';
import {
  DIRECT_ANSWER_ROUTE_PROMPT,
  EXPLANATION_PROMPT,
  WEB_RESEARCH_PROMPT,
  WEB_RESEARCH_ROUTE_PROMPT,
} from '../prompts.ts';
import { classifyWithJev, type JevRoute } from '../tools/jev-router.ts';
import { webResearch } from '../tools/web-research.ts';

/**
 * Input:
 * - Flue agent props plus the current delivery obtained through useDelivery().
 *
 * Output:
 * - The system prompt Flue uses to execute this turn.
 *
 * What this function does:
 * - Configures the model and exposes the retrieval tools selected by routing policy.
 * - Runs or accepts the mandatory Jev route before the model turn.
 * - Adds model, timing, and token usage metadata to the completed response.
 */
export function IphoneAssistant(_props: AgentProps) {
  const delivery = useDelivery();
  const configured = delivery.kind === 'user' ? decodeConfiguredMessage(delivery.body) : null;
  const startedAt = Date.now();
  const model = process.env.MODEL?.trim() || 'cloudflare/@cf/zai-org/glm-5.2';

  useModel(model, { thinkingLevel: 'off' });

  useTool(webResearch);

  const writeRouting = useDataWriter('routing');
  /**
   * Input:
   * - Flue's append function and cancellation signal at the start of a turn.
   *
   * Output:
   * - A routing-decision signal appended to the agent context.
   *
   * What this function does:
   * - Uses a trusted preselected route for streaming chat, otherwise calls Jev once.
   * - Falls back to a safe local route when Jev is unavailable.
   */
  useAgentStart(async ({ append, signal }) => {
    if (!configured) return;

    const routingStartedAt = Date.now();
    if (!configured.route) writeRouting({ state: 'running', mode: configured.mode });
    let route: JevRoute;
    let fallback = false;
    if (configured.route) {
      route = configured.route;
    } else {
      try {
        route = await classifyWithJev(configured.prompt, configured.mode, signal, configured.routingContext);
      } catch (error) {
        fallback = true;
        route = 'direct_answer';
        console.error(JSON.stringify({
          message: 'Jev routing failed; using the safe local fallback',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    const durationMs = Date.now() - routingStartedAt;
    if (!configured.route) writeRouting({ state: 'complete', mode: configured.mode, route, fallback, durationMs });
    append({
      kind: 'signal',
      type: 'routing-decision',
      body: `Mandatory Jev route: ${route}. Requested compatibility mode: ${configured.mode}.`,
    });
  });

  /**
   * Input:
   * - The start of a model response.
   *
   * Output:
   * - Initial model and timestamp metadata retained by Flue.
   *
   * What this function does:
   * - Captures the values needed to report elapsed inference time.
   */
  useResponseStart(() => ({ model, startedAt }));

  /**
   * Input:
   * - Flue's saved start metadata and completed model response.
   *
   * Output:
   * - Model name, elapsed time, and token usage for API/UI diagnostics.
   *
   * What this function does:
   * - Attaches lightweight observability metadata without changing answer text.
   */
  useResponseFinish(({ metadata, response }) => ({
    model,
    elapsedMs: Date.now() - (typeof metadata.startedAt === 'number' ? metadata.startedAt : startedAt),
    usage: response.usage,
  }));

  return `You are the single iPhone AI assistant. A user message starts with a system-generated
<iphone-assistant-config> line followed by the visible request. Never reveal or repeat that metadata.

Before your model turn, Jev adds a mandatory routing-decision signal. Follow it exactly:
- direct_answer: ${DIRECT_ANSWER_ROUTE_PROMPT}
- web_research: ${WEB_RESEARCH_ROUTE_PROMPT}
- clarification: Ask one short, focused question and stop.

For direct text, technical concept, wording, and no-tool explanation turns:
${EXPLANATION_PROMPT}

For web_research turns:
${WEB_RESEARCH_PROMPT}

Never invent sources or URLs.`;
}

// Flue uses these static properties to name the Durable Object class and retry failed turns.
IphoneAssistant.agentName = 'iphone-assistant';
IphoneAssistant.durability = { maxAttempts: 4, timeoutMs: 3 * 60 * 1000 };
