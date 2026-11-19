import { test, expect } from "@playwright/test";

test("interactive lab edits cards, checks answers, saves media and survives reload", async ({ page, request }) => {
  let sessionId = "";
  try {
    await page.goto("/chat");
    await page.getByRole("button", { name: "Open library" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Gadgets", exact: true }).click();
    await page.getByRole("button", { name: "Start interactive learning lab" }).click();
    await expect(page).toHaveURL(/\/gadget\/([\w-]+)\/gadget-rpc-learning-lab-v1/);
    sessionId = new URL(page.url()).pathname.split("/")[2];
    const frame = page.frameLocator('iframe[title="Interactive learning gadget"]');
    await expect(frame.getByRole("heading", { name: "Learning lab" })).toBeVisible({ timeout: 30_000 });
    await frame.getByLabel("Card title").fill("My new card");
    await frame.getByLabel("Practice question").fill("What is stored?");
    await frame.getByLabel("Expected answer").fill("progress");
    await frame.getByLabel("Explanation after checking").fill("Progress survives a reload.");
    await frame.getByRole("button", { name: "Save card" }).click();
    await expect(frame.getByRole("heading", { name: "My new card" })).toBeVisible();
    await frame.getByLabel("Your answer for My new card").fill("progress");
    await frame.getByRole("button", { name: "Check answer" }).last().click();
    await expect(frame.getByText("Correct! Progress survives a reload.", { exact: false })).toBeVisible();
    await frame.getByLabel("Add media to My new card").setInputFiles({
      name: "diagram.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gE8AAAAASUVORK5CYII=", "base64"),
    });
    await expect(frame.getByText("Media saved.")).toBeVisible();
    await expect(frame.locator("img[alt='diagram.png']")).toBeVisible();
    await page.reload();
    await expect(frame.getByRole("heading", { name: "My new card" })).toBeVisible({ timeout: 30_000 });
    await expect(frame.getByText("Attempts: 1")).toBeVisible();
    await expect(frame.locator("img[alt='diagram.png']")).toBeVisible();
    const card = frame.locator("section").filter({ has: frame.getByRole("heading", { name: "My new card" }) });
    await card.getByRole("button", { name: "Edit" }).click();
    await frame.getByLabel("Card title").fill("Updated card");
    await frame.getByRole("button", { name: "Update card" }).click();
    await expect(frame.getByRole("heading", { name: "Updated card" })).toBeVisible();
    const updated = frame.locator("section").filter({ has: frame.getByRole("heading", { name: "Updated card" }) });
    await updated.getByRole("button", { name: "Delete" }).click();
    await updated.getByRole("button", { name: "Tap again to delete" }).click();
    await expect(frame.getByRole("heading", { name: "Updated card" })).toHaveCount(0);
  } finally {
    if (sessionId) await request.delete(`/api/sessions/${sessionId}`);
  }
});
