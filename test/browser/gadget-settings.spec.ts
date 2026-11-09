import { test, expect } from "@playwright/test";

test("explicitly upgrades only the existing course gadget for scheduled content", async ({
  page,
}) => {
  const id = "course-lesson-001";
  await page.route("**/api/gadgets?offset=*", (route) =>
    route.fulfill({
      json: {
        gadgets: [
          {
            id: "gadget-typescript-course-v1",
            title: "TypeScript for AI harnesses",
            sessionId: id,
            sessionTitle: "TypeScript course",
            generation: 1,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
        ],
        unavailable: 0,
      },
    }),
  );
  let upgraded = false;
  await page.route(`**/api/sessions/${id}/course-upgrade`, (route) => {
    upgraded = true;
    return route.fulfill({
      json: { id: "gadget-typescript-course-v1", generation: 2 },
    });
  });
  await page.goto("/chat");
  await page.getByRole("button", { name: "Open library" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Gadgets", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable scheduled lesson cards" })
    .click();
  await expect(
    page.getByText("Course is ready for scheduled lesson cards."),
  ).toBeVisible();
  expect(upgraded).toBe(true);
});

test("Settings Gadgets tab pages across lessons and deletes only the selected gadget", async ({
  page,
}) => {
  const idA = "browser-session-001",
    idB = "browser-session-002";
  const removed: string[] = [];
  await page.route("**/api/gadgets?offset=*", async (route) => {
    const offset = new URL(route.request().url()).searchParams.get("offset");
    await route.fulfill({
      json:
        offset === "0"
          ? {
              gadgets: [
                {
                  id: "gadget-test-one",
                  title: "Memory cards",
                  sessionId: idA,
                  sessionTitle: "First lesson",
                  generation: 1,
                  createdAt: "2026-01-01",
                  updatedAt: "2026-01-01",
                },
              ],
              nextOffset: 50,
              unavailable: 0,
            }
          : {
              gadgets: [
                {
                  id: "gadget-test-two",
                  title: "API quiz",
                  sessionId: idB,
                  sessionTitle: "Archived lesson",
                  generation: 2,
                  createdAt: "2026-01-02",
                  updatedAt: "2026-01-02",
                },
              ],
              unavailable: 0,
            },
    });
  });
  await page.route(
    "**/api/sessions/browser-session-002/gadgets/gadget-test-two",
    async (route) => {
      removed.push(route.request().postData() ?? "");
      await route.fulfill({ status: 204, body: "" });
    },
  );
  await page.goto("/chat");
  await page.getByRole("button", { name: "Open library" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Gadgets", exact: true }).click();
  const list = page.getByRole("region", { name: "Your gadgets" });
  await expect(list.getByText("Memory cards")).toBeVisible();
  await expect(list.getByRole("link", { name: "Open gadget" })).toHaveAttribute(
    "href",
    `/api/sessions/${idA}/gadgets/gadget-test-one`,
  );
  await list.getByRole("button", { name: "More sessions" }).click();
  await expect(list.getByText("API quiz")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await list.getByRole("button", { name: "Delete API quiz" }).click();
  await expect(list.getByText("API quiz")).toHaveCount(0);
  await expect(list.getByText("Memory cards")).toBeVisible();
  expect(removed).toEqual([JSON.stringify({ expectedGeneration: 2 })]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
