import { test, expect } from "@playwright/test";

test("mobile learning persists through reload with a simplified workspace and library navigation", async ({
  page,
}) => {
  await page.goto("/chat");
  await expect(
    page.getByRole("heading", { name: "What would you like to learn?" }),
  ).toBeVisible();
  await page
    .getByLabel("Question")
    .fill("Explain a TypeScript union type in two short sentences.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\//);
  // Close/reload while the run is in progress; the server must own completion.
  await page.reload();
  await expect(page.locator(".message.assistant")).toBeVisible({
    timeout: 90_000,
  });
  const activity = page.locator(".message.user .turn-activity").first();
  await expect(activity).toHaveAttribute("data-status", "done", {
    timeout: 90_000,
  });
  await expect(activity.locator("summary")).toContainText(
    "Direct to Pi tutor",
  );
  await expect(activity).not.toHaveAttribute("open", "");
  await activity.locator("summary").click();
  await expect(
    activity.getByText("Agent started", { exact: true }),
  ).toBeVisible();
  await activity.locator("summary").click();
  await expect(activity).not.toHaveAttribute("open", "");
  const url = page.url();
  const answer = await page.locator(".message.assistant .markdown").innerText();
  expect(answer.length).toBeGreaterThan(30);
  await expect(page.getByRole("button", { name: "Save note" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Sources & notes" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Open library" }).click();
  await page.getByRole("button", { name: "＋ New learning" }).click();
  await expect(page.locator(".message")).toHaveCount(0);
  await page.goto(url);
  await expect(page.locator(".message.assistant .markdown")).toHaveText(
    answer,
    { useInnerText: true },
  );
  await expect(page.locator(".message.user .turn-activity")).toHaveAttribute(
    "data-status",
    "done",
  );
  const width = await page.evaluate(() => ({
    screen: innerWidth,
    body: document.documentElement.scrollWidth,
  }));
  expect(width.body).toBeLessThanOrEqual(width.screen);
  await page.screenshot({
    path: ".wrangler/mobile-learning.png",
    fullPage: true,
  });
});

test("paste into a new workspace, then continue an old workspace in the same tab", async ({ page, request }) => {
  await page.goto("/chat");
  await page.getByLabel("Question").fill("Explain a database index in one sentence.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\//);
  const first = page.url();
  await expect(page.locator(".message.assistant")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Open library" }).click();
  await page.getByRole("button", { name: "＋ New learning" }).click();
  await page.getByLabel("Question").fill("Explain a TypeScript interface in one sentence.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\//);
  const second = page.url();
  expect(second).not.toBe(first);
  await page.goto(first);
  await expect(page.locator(".message.user")).toHaveCount(1);
  await page.getByLabel("Question").fill("Give me a short analogy for that index.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".message.user")).toHaveCount(2, { timeout: 90_000 });
  await page.reload();
  await expect(page.locator(".message.user")).toHaveCount(2);
  for (const url of [first, second]) await request.delete(new URL(url).pathname.replace("/sessions/", "/api/sessions/"));
});
