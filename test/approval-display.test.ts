import { expect, it } from "vitest";
import { showApprovalCard, automaticActionNotice } from "../src/lib/approval-display.ts";
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

it("notifies automatic skill/file changes without exposing arguments or offering approval", () => {
  for (const tool of ["skill.save", "skill.delete", "computer.write"]) {
    expect(showApprovalCard({ status: "done", automatic: true })).toBe(false);
    expect(showApprovalCard({ status: "uncertain", automatic: true })).toBe(false);
    expect(automaticActionNotice({ tool, status: "done", automatic: true })).toMatch(/saved|removed/);
    expect(automaticActionNotice({ tool, status: "uncertain", automatic: true })).toContain("Check Settings");
    expect(automaticActionNotice({ tool, status: "pending" })).toBeUndefined();
  }
  expect(automaticActionNotice({ tool: "computer.run", status: "done", automatic: true })).toBeUndefined();
});
