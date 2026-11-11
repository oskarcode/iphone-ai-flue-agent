import type { Approval } from "../runtime/contracts.ts";

/** Only unresolved actions requiring a decision or currently executing appear in the transcript. */
export function showApprovalCard(approval: Pick<Approval, "status" | "automatic">): boolean {
  return !approval.automatic && (approval.status === "pending" || approval.status === "executing");
}

/** Ambiguous external writes need a warning, never a replay or a raw payload in the chat. */
export function uncertainActionNotice(approval: Pick<Approval, "tool" | "status">): string | undefined {
  if (approval.status !== "uncertain") return undefined;
  const target = approval.tool.startsWith("skill.") || approval.tool.startsWith("computer.")
    ? "Skills/Computer in Settings" : "GitHub";
  return `Action could not be confirmed. Check ${target} before trying again; it will not be repeated automatically.`;
}
