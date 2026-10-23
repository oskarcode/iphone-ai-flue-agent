// Live mobile integration: exercise real event delivery, two turns and reconnect, without GitHub mutations.
import { test, expect } from "@playwright/test";

/** Input: a locally served learning workspace. Output: independently associated live/completed activity panels.
 * What this function does: proves real tool progress reaches the UI, survives reload and remains collapsible per input.
 */
test("streams tool activity per turn and restores it after reload", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  let changes = 0;
  page.on("websocket", (socket) => socket.on("framereceived", () => changes++));
  await page.goto("/chat");
  await page
    .getByLabel("Question")
    .fill(
      "Use web_research to read https://developers.cloudflare.com/durable-objects/ and explain its purpose in one short sentence.",
    );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\//);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  try {
    const first = page.locator(".message.user .turn-activity").first();
    await expect(first).toBeVisible();
    await first.locator("summary").click();
    await expect(first.getByText("Agent started", { exact: true })).toBeVisible(
      { timeout: 30_000 },
    );
    await expect(
      first.getByText("Research the web", { exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    await expect(first).toHaveAttribute("data-status", "done", {
      timeout: 90_000,
    });
    expect(changes).toBeGreaterThan(1);
    await page.getByLabel("Question").fill("Now answer with exactly: Ready.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".message.user .turn-activity")).toHaveCount(2);
    await expect(
      page.locator(".message.user .turn-activity").nth(1),
    ).toHaveAttribute("data-status", "done", { timeout: 90_000 });
    await page.reload();
    const panels = page.locator(".message.user .turn-activity");
    await expect(panels).toHaveCount(2);
    await expect(panels.first()).toHaveAttribute("data-status", "done");
    await panels.first().locator("summary").click();
    await expect(
      panels.first().getByText("Research the web", { exact: true }),
    ).toBeVisible();
    await panels.nth(1).locator("summary").click();
    await expect(
      panels.nth(1).getByText("Research the web", { exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".wrangler/mobile-turn-activity.png",
      fullPage: true,
    });
  } finally {
    await request.delete(`/api/sessions/${id}`);
  }
});
