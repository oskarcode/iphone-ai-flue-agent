import { test, expect } from "@playwright/test";
import type { SessionSnapshot } from "../../src/runtime/contracts.ts";

test("mobile activity shows the Jev path, skill slug and coach tool without duplicate routing text", async ({ page }) => {
  const id = "activity-panel-fixture";
  await page.route(`**/sessions/${id}`, async (route) => {
    const response = await route.fetch({ url: new URL("/chat", route.request().url()).toString() });
    await route.fulfill({ response });
  });
  const snapshot: SessionSnapshot = {
    metadata: { id, owner: "personal", title: "Learning coach", type: "general", private: false, archived: false, pinned: false, createdAt: "now", updatedAt: "now" },
    messages: [{ id: "100", role: "user", content: "/learning-coach What have I learned?" }],
    activity: [{ id: "1", entryId: "100", status: "done", steps: [
      { id: "routing", label: "Jev decision → Direct answer (direct_answer)", status: "done", at: "now" },
      { id: "tool:skill", label: "Tool · read_skill /learning-coach — Reading a saved skill", status: "done", at: "now" },
      { id: "tool:coach", label: "Tool · run_learning_coach — Reviewing learning across sessions", status: "done", at: "now" },
      { id: "coach-tool:1", label: "Coach · Tool · list_learning_sessions — Finding learning sessions", status: "done", at: "now" },
    ] }],
    partial: "", busy: false, sources: [], notes: [], approvals: [],
  };
  await page.route(`**/api/sessions/${id}`, (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/skills", (route) => route.fulfill({ json: { skills: [] } }));
  await page.goto(`/sessions/${id}`);
  const panel = page.locator(".message.user .turn-activity");
  await expect(panel.locator("summary")).toContainText("Jev decision → Direct answer");
  await panel.locator("summary").click();
  await expect(panel.getByText(/read_skill \/learning-coach/)).toBeVisible();
  await expect(panel.getByText(/run_learning_coach/)).toBeVisible();
  await expect(panel.getByText(/list_learning_sessions/)).toBeVisible();
  await expect(panel.locator("ol").getByText("Jev decision → Direct answer (direct_answer)")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
