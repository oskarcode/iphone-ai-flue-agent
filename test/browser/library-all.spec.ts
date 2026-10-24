import { test, expect } from "@playwright/test";

test("previously archived sessions stay accessible without archive controls", async ({
  page,
  request,
}) => {
  const marker = `Unified library ${Date.now()}`;
  const ids: string[] = [];
  try {
    for (const archived of [false, true]) {
      const response = await request.post("/api/sessions", {
        data: { text: `${marker} ${archived ? "older" : "current"}` },
      });
      expect(response.status()).toBe(201);
      const { id } = await response.json();
      ids.push(id);
      if (archived)
        expect(
          (
            await request.patch(`/api/sessions/${id}`, {
              data: { archived: true, pinned: true },
            })
          ).status(),
        ).toBe(200);
    }
    await page.goto("/chat");
    await page.getByRole("button", { name: "Open library" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Archived sessions" }),
    ).toHaveCount(0);
    await page.getByLabel("Search learning library").fill(marker);
    await expect(page.locator(".library .session")).toHaveCount(2);
    await page
      .locator(".library .session")
      .filter({ hasText: `${marker} older` })
      .click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${ids[1]}$`));
    await expect(
      page.getByRole("heading", { name: `${marker} older` }),
    ).toBeVisible();
    await page.locator(".session-menu > summary").click();
    await expect(
      page.getByRole("button", { name: /^(Archive|Unarchive)$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Export complete session" }),
    ).toHaveCount(0);
    const saved = await (await request.get(`/api/sessions/${ids[1]}`)).json();
    expect(saved.metadata).toMatchObject({ archived: true, pinned: true });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    for (const id of ids) await request.delete(`/api/sessions/${id}`);
  }
});
