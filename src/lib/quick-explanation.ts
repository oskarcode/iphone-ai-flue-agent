// The one-shot Shortcut is independent of Pi, Jev, Durable Objects and grammar correction.
import { QUICK_EXPLANATION_PROMPT } from "../prompts.ts";

/** Leave room for per-line TypeScript comments while bounding long passages. */
export function quickExplanationBudget(text: string): number {
  const bytes = new TextEncoder().encode(text).length;
  return Math.min(2400, Math.max(1500, Math.ceil(bytes / 12) + 800));
}

/** Treat the selected text as data; disable model thinking to keep the Shortcut responsive. */
export function createQuickExplanationRequest(text: string) {
  return {
    messages: [
      { role: "system" as const, content: QUICK_EXPLANATION_PROMPT },
      { role: "user" as const, content: text },
    ],
    temperature: 0,
    max_completion_tokens: quickExplanationBudget(text),
    reasoning_effort: "none" as const,
    chat_template_kwargs: { enable_thinking: false },
  };
}

/** Reject partial, abnormal or empty model output rather than displaying an invented fallback. */
export function quickExplanationFromAi(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid explanation response");
  const record = value as Record<string, unknown>;
  const first = Array.isArray(record.choices) ? record.choices[0] : undefined;
  const choice = first && typeof first === "object" && !Array.isArray(first)
    ? first as Record<string, unknown> : undefined;
  const finish = choice?.finish_reason ?? record.finish_reason;
  if (finish !== undefined && finish !== "stop")
    throw new Error("Explanation did not finish normally");
  const message = choice?.message && typeof choice.message === "object" && !Array.isArray(choice.message)
    ? choice.message as Record<string, unknown> : undefined;
  const raw = record.response ?? record.output_text ?? message?.content;
  if (typeof raw !== "string" || !raw.trim() || raw.length > 10000)
    throw new Error("Invalid explanation text");
  return raw.trim();
}

/** Keep the existing Shortcut's answer key readable without requiring Markdown rendering. */
export function plainExplanation(markdown: string): string {
  return markdown
    .replace(/^[ \t]*```(?:ts|typescript)?[ \t]*$/gim, "")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
