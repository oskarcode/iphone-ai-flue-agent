import { expect, it } from "vitest";
import { showApprovalCard } from "../src/lib/approval-display.ts";
import type { Approval } from "../src/runtime/contracts.ts";

it("hides completed and rejected approval cards while retaining unresolved actions", () => {
  for (const status of ["pending", "executing", "uncertain"] as const)
    expect(showApprovalCard({ status })).toBe(true);
  for (const status of ["done", "rejected"] as const)
    expect(showApprovalCard({ status })).toBe(false);
});

it("does not discard durable action receipts when selecting cards", () => {
  const approvals = ["done", "pending", "uncertain", "rejected"].map(
    (status, i) => ({ id: String(i), status }) as Approval,
  );
  expect(approvals.filter(showApprovalCard).map((item) => item.id)).toEqual([
    "1",
    "2",
  ]);
  expect(approvals).toHaveLength(4);
});
