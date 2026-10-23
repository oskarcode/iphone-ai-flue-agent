import { test, expect } from "@playwright/test";

test("mobile learning persists through reload, keeps notes and supports library navigation", async ({
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
  const url = page.url();
  const answer = await page.locator(".message.assistant .markdown").innerText();
  expect(answer.length).toBeGreaterThan(30);
  page.once("dialog", (dialog) =>
    dialog.accept("A union type accepts one of several types."),
  );
  await page.getByRole("button", { name: "Save note" }).first().click();
  await page.getByRole("button", { name: "Sources & notes" }).click();
  await expect(
    page.getByText("A union type accepts one of several types.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Open library" }).click();
  await page.getByRole("button", { name: "＋ New learning" }).click();
  await expect(page.locator(".message")).toHaveCount(0);
  await page.goto(url);
  await expect(page.locator(".message.assistant .markdown")).toHaveText(answer);
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

test("unchanged Shortcut handoff opens and submits automatically", async ({
  page,
  request,
}) => {
  const response = await request.post("/handoff", {
    data: { text: "Explain why databases need an index in one sentence." },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(new URL(body.chat_url).pathname).toBe("/chat");
  const handoff = new URL(body.chat_url); // Wrangler --host strips the local port; production keeps its origin.
  await page.goto(handoff.pathname + handoff.search);
  await expect(page).toHaveURL(/\/sessions\//);
  await expect(page.locator(".message.assistant")).toBeVisible({
    timeout: 90_000,
  });
  await page.reload();
  await expect(page.locator(".message.user")).toHaveCount(1);
});
