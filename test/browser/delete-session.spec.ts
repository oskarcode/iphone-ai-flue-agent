// These deletion tests create only disposable local sessions; no model call is required.
import { test, expect } from "@playwright/test";

/** Input: a disposable saved session. Output: safe cancellation/error handling followed by permanent deletion.
 * What this function does: verifies header access, confirmation, real server removal and device-draft cleanup.
 */
test("header Delete confirms, handles failure and permanently removes the session", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/sessions", {
    data: { text: "Disposable deletion fixture" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  try {
    await page.goto(`/sessions/${id}`);
    const remove = page.getByRole("button", {
      name: "Delete session",
      exact: true,
    });
    await expect(remove).toBeEnabled();
    await page.getByLabel("Question").fill("Unsaved throwaway draft");
    await page.evaluate(() =>
      localStorage.setItem(
        "pi-learning:draft:other-session",
        "Keep my other draft",
      ),
    );
    page.once("dialog", (dialog) => dialog.dismiss());
    await remove.click();
    expect((await request.get(`/api/sessions/${id}`)).status()).toBe(200);
    await expect(page.getByLabel("Question")).toHaveValue(
      "Unsaved throwaway draft",
    );

    await page.route(`**/api/sessions/${id}`, async (route) => {
      if (route.request().method() === "DELETE")
        await route.fulfill({
          status: 502,
          json: { error: "Test cleanup failure" },
        });
      else await route.continue();
    });
    page.once("dialog", (dialog) => dialog.accept());
    await remove.click();
    await expect(page.getByRole("alert")).toContainText(
      "Could not confirm deletion",
    );
    await expect(remove).toBeEnabled();
    await expect(page.getByLabel("Question")).toHaveValue(
      "Unsaved throwaway draft",
    );
    await page.unroute(`**/api/sessions/${id}`);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".wrangler/mobile-header-delete.png",
      fullPage: true,
    });
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("cannot be undone");
      return dialog.accept();
    });
    await remove.click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(
      page.getByRole("heading", { name: "What would you like to learn?" }),
    ).toBeVisible();
    await expect(remove).toHaveCount(0);
    expect((await request.get(`/api/sessions/${id}`)).status()).toBe(404);
    const library = await (await request.get("/api/sessions")).json();
    expect(library.items.some((item: { id: string }) => item.id === id)).toBe(
      false,
    );
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        `pi-learning:draft:${id}`,
      ),
    ).toBeNull();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("pi-learning:draft:other-session"),
      ),
    ).toBe("Keep my other draft");
  } finally {
    await request.delete(`/api/sessions/${id}`);
  }
});

/** Input: deletion in flight while navigating to another session. Output: only the targeted session disappears.
 * What this function does: guards against a late DELETE response closing the newly selected workspace.
 */
test("finishing deletion does not close a different selected workspace", async ({
  page,
  request,
}) => {
  const ids: string[] = [];
  let release: (() => void) | undefined;
  try {
    for (const text of ["Delete race fixture", "Keep race fixture"]) {
      const created = await request.post("/api/sessions", { data: { text } });
      expect(created.status()).toBe(201);
      ids.push((await created.json()).id);
    }
    await request.patch(`/api/sessions/${ids[1]}`, {
      data: { title: "Keep race fixture" },
    });
    await page.goto(`/sessions/${ids[0]}`);
    const remove = page.getByRole("button", {
      name: "Delete session",
      exact: true,
    });
    await expect(remove).toBeEnabled();
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/sessions/${ids[0]}`, async (route) => {
      if (route.request().method() === "DELETE") await hold;
      await route.continue();
    });
    page.once("dialog", (dialog) => dialog.accept());
    await remove.click();
    await expect(remove).toBeDisabled();
    await page.getByRole("button", { name: "Open library" }).click();
    await page
      .locator(".library .session")
      .filter({ hasText: "Keep race fixture" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${ids[1]}$`));
    release!();
    await expect(remove).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`/sessions/${ids[1]}$`));
    expect((await request.get(`/api/sessions/${ids[0]}`)).status()).toBe(404);
    expect((await request.get(`/api/sessions/${ids[1]}`)).status()).toBe(200);
  } finally {
    release?.();
    for (const id of ids) await request.delete(`/api/sessions/${id}`);
  }
});
