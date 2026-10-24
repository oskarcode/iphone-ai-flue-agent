import { test, expect } from "@playwright/test";

test("invokes a cross-session Pi Durable learning-coach skill without a separate tab", async ({
  page,
  request,
}) => {
  const ids: string[] = [];
  try {
    for (const title of ["Coach evidence lesson", "Coach question workspace"]) {
      const created = await request.post("/api/sessions", {
        data: { text: title },
      });
      expect(created.status()).toBe(201);
      ids.push((await created.json()).id);
    }
    await page.goto(`/sessions/${ids[0]}`);
    await page
      .getByLabel("Question")
      .fill("What is a TypeScript union? Answer briefly.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".message.assistant")).toBeVisible({
      timeout: 90000,
    });
    await page.goto(`/sessions/${ids[1]}`);
    await expect(
      page.getByRole("button", { name: "/learning-coach", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Question")
      .fill(
        "What did I ask about TypeScript in my other workspace? Cite the session and message.",
      );
    await page
      .getByRole("button", { name: "/learning-coach", exact: true })
      .click();
    await expect(page.getByLabel("Question")).toHaveValue(
      /^\/learning-coach What did I ask/,
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const activity = page.locator(".message.user .turn-activity").last();
    await expect(activity).toHaveAttribute("data-status", "done", {
      timeout: 110000,
    });
    await expect(page.locator(".message.assistant").last()).toContainText(
      /TypeScript/i,
    );
    await expect(page.locator(".message.assistant").last()).toContainText(
      ids[0]!,
    );
    await activity.locator("summary").click();
    await expect(
      activity.getByText("Reviewing learning across sessions", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open library" }).click();
    await expect(
      page.getByRole("button", { name: "Learning coach", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Import previous sessions" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    for (const id of ids)
      expect((await request.delete(`/api/sessions/${id}`)).status()).toBe(204);
  }
});
