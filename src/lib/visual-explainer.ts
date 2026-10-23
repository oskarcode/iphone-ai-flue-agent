// Prompt/model helpers and shared visual types turn untrusted model JSON into renderer-owned data.
import { VISUAL_EXPLANATION_PROMPT } from '../prompts.ts';
import { grammarModelFromConfiguredModel } from './grammar-correction.ts';
import type { VisualExplainer, VisualExplainerFlow, VisualExplainerPart } from './visual-session.ts';

type JsonRecord = Record<string, unknown>;

// Bound both model work and renderer input; output never supplies executable HTML or SVG.
const MAX_VISUAL_COMPLETION_TOKENS = 8_192;
const MAX_PARTS = 8;
const MAX_FLOWS = 8;

/** Input: unknown value. Output: object type guard.
 * What this function does: excludes null and arrays before property access.
 */
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Input: possible text, fallback and cap. Output: short non-empty string.
 * What this function does: safely defaults cosmetic labels without accepting unbounded output.
 */
function boundedText(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

/** Input: label and fallback. Output: bounded identifier.
 * What this function does: normalizes diagram references to lowercase letters, numbers and hyphens.
 */
function slugId(value: string, fallback: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return slug || fallback;
}

/** Input: unknown model part and index. Output: normalized part or null.
 * What this function does: supplies readable defaults and bounds all displayed part fields.
 */
function normalizePart(value: unknown, index: number): VisualExplainerPart | null {
  if (!isRecord(value)) return null;
  const label = boundedText(value.label, `Part ${index + 1}`, 42);
  return {
    id: slugId(boundedText(value.id, label, 48), `part-${index + 1}`),
    label,
    meaning: boundedText(value.meaning, 'A component in the visual explanation.', 220),
    role: boundedText(value.role, 'Shows one responsibility in the system.', 160),
  };
}

/** Input: unknown flow item. Output: normalized from/to/label or null.
 * What this function does: keeps model data inside the renderer's known shape.
 */
function normalizeFlow(value: unknown): VisualExplainerFlow | null {
  if (!isRecord(value)) return null;
  return {
    from: slugId(boundedText(value.from, 'input', 48), 'input'),
    to: slugId(boundedText(value.to, 'output', 48), 'output'),
    label: boundedText(value.label, 'passes to', 100),
  };
}

/** Input: requested concept. Output: no-thinking structured-output prompt.
 * What this function does: requests JSON data, not model-generated page code.
 */
export function createVisualExplainerRequest(text: string) {
  return {
    messages: [
      { role: 'system' as const, content: VISUAL_EXPLANATION_PROMPT },
      { role: 'user' as const, content: text },
    ],
    temperature: 0.2,
    max_completion_tokens: MAX_VISUAL_COMPLETION_TOKENS,
    reasoning_effort: 'none' as const,
    chat_template_kwargs: { enable_thinking: false },
  };
}

/** Input: AI envelope. Output: non-empty model text.
 * What this function does: rejects truncated/abnormal responses before JSON parsing.
 */
function textFromAi(value: unknown): string {
  if (!isRecord(value)) throw new Error('Workers AI returned a non-object visual explainer response.');
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const firstChoice = choices[0];
  const choiceHasFinishReason = isRecord(firstChoice) && 'finish_reason' in firstChoice;
  const hasFinishReason = choiceHasFinishReason || 'finish_reason' in value;
  const finishReason = choiceHasFinishReason && isRecord(firstChoice) ? firstChoice.finish_reason : value.finish_reason;
  if (finishReason === 'length') throw new Error('Workers AI truncated the visual explainer response.');
  if (hasFinishReason && finishReason !== 'stop') throw new Error('Workers AI visual explainer response did not finish normally.');
  const message = isRecord(firstChoice) && isRecord(firstChoice.message) ? firstChoice.message : null;
  const choiceContent = message && typeof message.content === 'string' ? message.content : undefined;
  const output = typeof value.response === 'string'
    ? value.response
    : typeof value.output_text === 'string'
      ? value.output_text
      : choiceContent;
  if (typeof output !== 'string' || !output.trim()) throw new Error('Workers AI did not return a visual explainer.');
  return output;
}

/** Input: model JSON text. Output: object or exception.
 * What this function does: strips optional Markdown fences but does not execute returned text.
 */
function parseJsonObject(text: string): JsonRecord {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed: unknown = JSON.parse(trimmed);
  if (!isRecord(parsed)) throw new Error('Visual explainer JSON must be an object.');
  return parsed;
}

/** Input: model response. Output: normalized VisualExplainer.
 * What this function does: requires at least three parts and bounds parts, flows and descriptive text.
 */
export function visualExplainerFromAi(value: unknown): VisualExplainer {
  const object = parseJsonObject(textFromAi(value));
  const parts = Array.isArray(object.parts)
    ? object.parts.map(normalizePart).filter((part): part is VisualExplainerPart => part !== null).slice(0, MAX_PARTS)
    : [];
  if (parts.length < 3) throw new Error('Visual explainer must include at least three parts.');
  const flow = Array.isArray(object.flow)
    ? object.flow.map(normalizeFlow).filter((item): item is VisualExplainerFlow => item !== null).slice(0, MAX_FLOWS)
    : [];
  return {
    title: boundedText(object.title, 'Visual technical explainer', 90),
    concept: boundedText(object.concept, 'technical concept', 80),
    analogy: boundedText(object.analogy, 'a small working machine', 120),
    summary: boundedText(object.summary, 'A visual explanation of how the concept works.', 360),
    caption: boundedText(object.caption, 'Each part maps to one responsibility, and the flow shows how work moves through the system.', 320),
    parts,
    flow,
    codeExample: boundedText(object.codeExample, 'type Input = unknown;\ntype Output = unknown;', 1_800),
  };
}

/** Input: AI binding, concept, cancellation and Gateway metadata. Output: normalized diagram data.
 * What this function does: performs inference, then validates the response before callers retain it.
 */
export async function generateVisualExplainer(
  ai: { run(model: string, input: unknown, options: unknown): Promise<unknown> },
  text: string,
  signal: AbortSignal,
  gatewayId: string,
  gatewayMetadata: Record<string, unknown>,
): Promise<VisualExplainer> {
  const result = await ai.run(
    grammarModelFromConfiguredModel(process.env.MODEL),
    createVisualExplainerRequest(text),
    {
      signal,
      gateway: {
        id: gatewayId,
        skipCache: true,
        metadata: gatewayMetadata,
      },
    },
  );
  return visualExplainerFromAi(result);
}
