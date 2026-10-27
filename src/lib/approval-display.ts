import type { Approval } from "../runtime/contracts.ts";

/** Only actions that actually need approval or inspection use the full approval card. */
export function showApprovalCard(approval: Pick<Approval, "status" | "automatic">): boolean {
  return !approval.automatic && approval.status !== "done" && approval.status !== "rejected";
}

/** New auto-applied changes have compact persisted notifications, without arguments or file contents. */
export function automaticActionNotice(approval: Pick<Approval, "tool" | "status" | "automatic">): string | undefined {
  if (!approval.automatic) return undefined;
  const label = approval.tool === "skill.save" ? "Skill saved"
    : approval.tool === "skill.delete" ? "Skill removed"
    : approval.tool === "computer.write" ? "Computer file saved" : undefined;
  if (!label) return undefined;
  if (approval.status === "done") return `${label}.`;
  if (approval.status === "uncertain") return `${label.replace(/ saved| removed/, " change")} could not be confirmed. Check Settings before trying again.`;
  return `${label} in progress…`;
}
