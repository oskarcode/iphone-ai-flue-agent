import { test, expect } from "@playwright/test";

/** Input: a saved workspace. Output: compact controls without source/note management.
 * What this function does: checks rename, pin, archive, export, keyboard dismissal and retained evidence on mobile.
 */
test("compact session options preserve administration and saved evidence", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/sessions", {
    data: { text: "Simplified workspace fixture" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  try {
    const before = await (await request.get(`/api/sessions/${id}`)).json();
    await page.goto(`/sessions/${id}`);
    await expect(
      page.getByRole("button", { name: "Sources & notes" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save note" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Delete session" }),
    ).toBeVisible();
    const menu = page.locator(".session-menu");
    const toggle = menu.locator("summary");
    await expect(toggle).toHaveAccessibleName("Session options");
    await toggle.click();
    await expect(
      menu.getByRole("button", { name: "Rename", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".wrangler/mobile-session-options.png",
      fullPage: true,
    });
    await toggle.press("Escape");
    await expect(menu).not.toHaveAttribute("open", "");
    await expect(toggle).toBeFocused();
    await toggle.press("Enter");
    page.once("dialog", (dialog) => dialog.accept("Renamed workspace"));
    await menu.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Renamed workspace" }),
    ).toBeVisible();
    await expect(menu).not.toHaveAttribute("open", "");
    await toggle.click();
    await menu.getByRole("button", { name: "Pin", exact: true }).click();
    await toggle.click();
    await expect(
      menu.getByRole("button", { name: "Unpin", exact: true }),
    ).toBeVisible();
    await menu.getByRole("button", { name: "Archive", exact: true }).click();
    await toggle.click();
    await expect(
      menu.getByRole("button", { name: "Unarchive", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.locator(".session-menu > summary").click();
    await expect(
      menu.getByRole("button", { name: "Unpin", exact: true }),
    ).toBeVisible();
    await menu.getByRole("button", { name: "Unarchive", exact: true }).click();
    await toggle.click();
    await expect(
      menu.getByRole("button", { name: "Archive", exact: true }),
    ).toBeVisible();
    const link = menu.getByRole("link", { name: "Export complete session" });
    await expect(link).toHaveAttribute("href", `/api/sessions/${id}/export`);
    expect((await request.get(`/api/sessions/${id}/export`)).status()).toBe(
      200,
    );
    const after = await (await request.get(`/api/sessions/${id}`)).json();
    expect(after.sources).toEqual(before.sources);
    expect(after.notes).toEqual(before.notes);
    expect(after.metadata).toMatchObject({
      title: "Renamed workspace",
      pinned: true,
      archived: false,
    });
  } finally {
    expect((await request.delete(`/api/sessions/${id}`)).status()).toBe(204);
  }
});
