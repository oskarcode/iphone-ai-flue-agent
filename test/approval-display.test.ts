import { expect, it } from "vitest";
import { showApprovalCard, uncertainActionNotice } from "../src/lib/approval-display.ts";
import type { Approval } from "../src/runtime/contracts.ts";

it("shows only approval decisions and in-flight gated actions in the transcript", () => {
  for (const status of ["pending", "executing"] as const)
    expect(showApprovalCard({ status })).toBe(true);
  for (const status of ["done", "rejected", "uncertain"] as const)
    expect(showApprovalCard({ status })).toBe(false);
  expect(showApprovalCard({ status: "pending", automatic: true })).toBe(false);
});

it("does not discard durable action receipts when selecting cards", () => {
  const approvals = ["done", "pending", "uncertain", "rejected", "executing"].map(
    (status, i) => ({ id: String(i), status }) as Approval,
  );
  expect(approvals.filter(showApprovalCard).map((item) => item.id)).toEqual(["1", "4"]);
  expect(approvals).toHaveLength(5);
});

it("warns about uncertain writes without repeating raw arguments or results", () => {
  expect(uncertainActionNotice({ tool: "createIssue", status: "uncertain" })).toContain("Check GitHub");
  expect(uncertainActionNotice({ tool: "computer.write", status: "uncertain" })).toContain("Check Skills/Computer in Settings");
  expect(uncertainActionNotice({ tool: "skill.save", status: "done" })).toBeUndefined();
});
