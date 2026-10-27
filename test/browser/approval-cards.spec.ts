import { test, expect } from "@playwright/test";
import type { SessionSnapshot } from "../../src/runtime/contracts.ts";

test("resolved skill approvals disappear after acceptance and stay hidden on reload", async ({ page }) => {
  const id = "approval-card-fixture";
  await page.route(`**/sessions/${id}`, async (route) => {
    const response = await route.fetch({ url: new URL("/chat", route.request().url()).toString() });
    await route.fulfill({ response });
  });
  let status: "pending" | "done" = "pending";
  const approval = (key: string, state: string) => ({
    id: key, tool: "skill.save",
    args: { slug: key, name: "Fixture", description: "Test", markdown: "Test" },
    status: state, createdAt: "now",
    ...(state === "done" ? { result: { revision: "saved" } } : {}),
  });
  await page.route(`**/api/sessions/${id}`, (route) => {
    const snapshot: SessionSnapshot = {
      metadata: { id, owner: "personal", title: "Approval regression", type: "general", private: false, archived: false, pinned: false, createdAt: "now", updatedAt: "now" },
      messages: [], partial: "", busy: false, sources: [], notes: [],
      approvals: [
        approval("save-fixture", status),
        approval("finished-fixture", "done"),
        approval("rejected-fixture", "rejected"),
        approval("uncertain-fixture", "uncertain"),
        { ...approval("auto-save", "done"), automatic: true,
          args: { content: "never shown" }, tool: "computer.write" },
        { ...approval("auto-uncertain", "uncertain"), automatic: true,
          args: { content: "never shown" }, tool: "skill.save" },
      ] as SessionSnapshot["approvals"],
    };
    return route.fulfill({ json: snapshot });
  });
  await page.route("**/api/skills", (route) => route.fulfill({ json: { skills: [] } }));
  await page.route(`**/api/sessions/${id}/approvals/save-fixture`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ accept: true });
    status = "done";
    return route.fulfill({ json: approval("save-fixture", status) });
  });
  await page.goto(`/sessions/${id}`);
  const cards = page.locator(".approval");
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: "save-fixture" })).toBeVisible();
  await expect(cards.filter({ hasText: "uncertain-fixture" })).toBeVisible();
  await expect(page.getByText("Computer file saved.")).toBeVisible();
  await expect(page.getByText("Skill change could not be confirmed. Check Settings before trying again.")).toBeVisible();
  await expect(page.getByText("never shown")).toHaveCount(0);
  await cards.filter({ hasText: "save-fixture" }).getByRole("button", { name: "Approve this exact action" }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.filter({ hasText: "uncertain-fixture" })).toBeVisible();
  await page.reload();
  await expect(cards).toHaveCount(1);
  await expect(cards.filter({ hasText: "uncertain-fixture" })).toBeVisible();
});
