import { test, expect } from "@playwright/test";

test("Settings Schedules shows owner lessons with workspace links and revision-safe edit/delete", async ({
  page,
}) => {
  const id = "archived-schedule-lesson-001",
    schedule = "schedule:browser-one";
  const instructions: string[] = [];
  let active = true,
    revision = 1,
    next = Date.now() + 7200_000,
    instruction = "Add one safe practice card";
  await page.route("**/api/schedules", async (route) =>
    route.fulfill({
      json: {
        schedules: active
          ? [
              {
                id: schedule,
                occurrenceId: schedule,
                sessionId: id,
                sessionTitle: "Archived TypeScript lesson",
                instruction,
                runAt: next,
                revision,
                createdAt: Date.now(),
              },
            ]
          : [],
        unavailable: 0,
        truncated: false,
      },
    }),
  );
  await page.route(
    `**/api/sessions/${id}/schedules/${encodeURIComponent(schedule)}`,
    async (route) => {
      const request = route.request();
      instructions.push(request.method() + ":" + (request.postData() ?? ""));
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        if (body.expectedRevision !== revision)
          return route.fulfill({ status: 409, json: { error: "Stale" } });
        next = body.runAt;
        instruction = body.instruction;
        revision++;
        return route.fulfill({ json: { revision } });
      }
      active = false;
      return route.fulfill({ json: { cancelled: true } });
    },
  );
  await page.goto("/chat");
  await page.getByRole("button", { name: "Open library" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Schedules", exact: true }).click();
  const directory = page.getByRole("region", {
    name: "Scheduled learning tasks",
  });
  await expect(directory.getByText("Add one safe practice card")).toBeVisible();
  await expect(
    directory.getByRole("link", { name: "Open attached learning workspace" }),
  ).toHaveAttribute("href", `/sessions/${id}`);
  await directory.getByRole("button", { name: "Edit" }).click();
  await directory
    .getByLabel("Future Agent instruction")
    .fill("Add two practice cards, preserve saved progress");
  await directory.getByRole("button", { name: "Save schedule" }).click();
  await expect(
    directory.getByText("Add two practice cards, preserve saved progress"),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await directory.getByRole("button", { name: "Delete" }).click();
  await expect(directory.getByText("No active schedules.")).toBeVisible();
  expect(instructions[0]).toContain('"expectedRevision":1');
  expect(instructions[1]).toContain('"expectedRevision":2');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
