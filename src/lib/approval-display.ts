import type { Approval } from "../runtime/contracts.ts";

/** Keep unresolved actions visible; terminal receipts remain durable but leave the chat surface. */
export function showApprovalCard(approval: Pick<Approval, "status">): boolean {
  return approval.status !== "done" && approval.status !== "rejected";
}
