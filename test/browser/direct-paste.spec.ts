import { test, expect } from "@playwright/test";

// Real-model smoke: direct paste must produce evidence-bearing tool activity, not just a plausible answer.
for (const [name, prompt, tool] of [
  ["public webpage", "Read https://developers.cloudflare.com/workers/ and tell me in one sentence what Workers are.", "web_research"],
  ["public GitHub repository", "Read https://github.com/cloudflare/workers-sdk and explain in one sentence what this repository contains.", "open_repository"],
] as const) {
  test(`pasted ${name} invokes ${tool} in a new workspace`, async ({ page, request }) => {
    await page.goto("/chat");
    await page.getByRole("button", { name: "Open library" }).click();
    await page.getByRole("button", { name: "＋ New learning" }).click();
    await page.getByLabel("Question").fill(prompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page).toHaveURL(/\/sessions\//);
    const path = new URL(page.url()).pathname.replace("/sessions/", "/api/sessions/");
    try {
      await expect(page.locator(".message.user .turn-activity")).toContainText(`Tool · ${tool}`, { timeout: 110_000 });
      await expect(page.locator(".message.assistant")).toBeVisible({ timeout: 110_000 });
      await page.reload();
      await expect(page.locator(".message.user")).toHaveCount(1);
    } finally {
      await request.delete(path);
    }
  });
}
