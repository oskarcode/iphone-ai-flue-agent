import { test, expect } from "@playwright/test";

test("does not navigate to a session URL until creation is durable", async ({
  page,
  request,
}) => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const creating = new Promise<void>((resolve) => {
    started = resolve;
  });
  let id: string | undefined;
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "POST") {
      id = route.request().postDataJSON().id;
      started();
      await gate;
    }
    await route.continue();
  });
  try {
    await page.goto("/chat");
    await page
      .getByLabel("Question")
      .fill("Reply exactly: Durable creation checked.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await creating;
    await expect(page).toHaveURL(/\/chat$/);
    release();
    await expect(page).toHaveURL(/\/sessions\//);
    await page.reload();
    await expect(page.locator(".message.assistant")).toBeVisible({
      timeout: 90000,
    });
    await expect(page.locator(".message.user")).toHaveCount(1);
  } finally {
    release();
    if (id) await request.delete(`/api/sessions/${id}`);
  }
});
