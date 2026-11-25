import { expect, test } from "@playwright/test";

test("a transient send failure retries once without alarming the learner or pasting text back", async ({ page, request }) => {
  const created = await request.post("/api/sessions", { data: { text: "Retry regression fixture" } });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: string };
  let attempts = 0;
  try {
    await page.route(`**/api/sessions/${id}/messages`, async (route) => {
      attempts++;
      await route.fulfill({ status: attempts === 1 ? 503 : 202, json: {} });
    });
    await page.goto(`/sessions/${id}`);
    const composer = page.getByLabel("Question");
    await composer.fill("https://example.com/new-url");
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => attempts).toBe(2);
    await expect(composer).toHaveValue("");
    await expect(page.getByText("An interrupted message is saved")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("pi-learning:pending"))).toBeNull();
  } finally {
    await request.delete(`/api/sessions/${id}`);
  }
});

test("old pasted drafts do not refill the composer or auto-send after a reload", async ({ page, request }) => {
  const created = await request.post("/api/sessions", { data: { text: "Composer regression fixture" } });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: string };
  try {
    await page.addInitScript((sessionId: string) => {
      localStorage.setItem(`pi-learning:draft:${sessionId}`, "https://example.com/old-url");
    }, id);
    await page.goto(`/sessions/${id}`);
    const composer = page.getByLabel("Question");
    await expect(composer).toHaveValue("");
    await composer.fill("https://example.com/new-url");
    await expect(composer).toHaveValue("https://example.com/new-url");
    await page.reload();
    await expect(composer).toHaveValue("");
    await page.evaluate((sessionId: string) => {
      localStorage.setItem("pi-learning:pending", JSON.stringify({
        sessionId, requestId: crypto.randomUUID(), text: "https://example.com/old-url",
      }));
    }, id);
    await page.reload();
    await expect(composer).toHaveValue("");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    const after = await request.get(`/api/sessions/${id}`);
    expect(after.status()).toBe(200);
    expect(JSON.stringify(await after.json())).not.toContain("https://example.com/old-url");
    await page.getByRole("button", { name: "Discard unsent message" }).click();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    await composer.fill("https://example.com/new-url");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  } finally {
    await request.delete(`/api/sessions/${id}`);
  }
});
