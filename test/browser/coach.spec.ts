import { test, expect } from "@playwright/test";

test("coach observes a lesson, answers on request, retracts it on deletion and keeps settings simple", async ({
  page,
  request,
}) => {
  const previous = await (await request.get("/api/preferences")).json();
  const marker = `Coach fixture ${Date.now()}`;
  let id: string | undefined;
  try {
    const created = await request.post("/api/sessions", {
      data: { text: marker },
    });
    expect(created.status()).toBe(201);
    ({ id } = await created.json());
    await page.goto(`/sessions/${id}`);
    await page
      .getByLabel("Question")
      .fill(`${marker}: Explain one TypeScript union in one sentence.`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".message.assistant")).toBeVisible({
      timeout: 90000,
    });
    await page.getByRole("button", { name: "Open library" }).click();
    await page.getByRole("button", { name: "Learning coach" }).click();
    await expect(
      page.getByRole("heading", { name: "Your learning, across sessions" }),
    ).toBeVisible();
    await expect(
      page.locator(".coach-observation").filter({ hasText: marker }),
    ).toBeVisible();
    await page
      .getByLabel("Coach question")
      .fill("What question did I just ask about TypeScript? Cite the session.");
    await page.getByRole("button", { name: "Ask coach" }).click();
    await expect(page.locator(".coach-turn")).toContainText("TypeScript", {
      timeout: 90000,
    });
    await page.screenshot({ path: '.wrangler/mobile-learning-coach.png', fullPage: true });
    await page.reload();
    await page.getByRole("button", { name: "Open library" }).click();
    await page.getByRole("button", { name: "Learning coach" }).click();
    await expect(
      page.locator(".coach-observation").filter({ hasText: marker }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to chat" }).click();
    await page.getByRole("button", { name: "Open library" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Import previous sessions" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Learning preferences" }).click();
    await expect(page.getByLabel("Teaching preferences")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /recall/i })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    if (id)
      expect((await request.delete(`/api/sessions/${id}`)).status()).toBe(204);
    expect(
      (
        await request.put("/api/preferences", {
          data: { text: previous.text, recall: false },
        })
      ).status(),
    ).toBe(200);
    if (id) {
      const coach = await (await request.get("/api/coach")).json();
      expect(
        coach.observations.some(
          (o: { sessionId: string }) => o.sessionId === id,
        ),
      ).toBe(false);
      expect(coach.turns).toEqual([]);
    }
  }
});
