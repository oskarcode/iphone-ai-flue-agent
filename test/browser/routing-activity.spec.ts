// UI fixtures verify decision visibility independently of model availability; Worker tests cover real persistence.
import { test, expect } from "@playwright/test";

/** Input: a session snapshot with one classified turn and a routing-only handoff. Output: visible, collapsible decisions.
 * What this function does: checks closed summaries, replay on reload and phone-width layout without running models.
 */
test("shows Jev decisions alongside historical bypass labels", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/sessions", {
    data: { text: "Routing UI fixture" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  try {
    const snapshot = await (await request.get(`/api/sessions/${id}`)).json();
    snapshot.messages = [
      { id: "10", role: "user", content: "Find recent docs" },
    ];
    snapshot.activity = [
      {
        id: "1",
        entryId: "10",
        status: "done",
        steps: [
          {
            id: "routing",
            status: "done",
            at: "2026-10-23T00:00:00Z",
            label: "Jev decision → Web research (web_research)",
          },
        ],
      },
      {
        id: "routing:2",
        entryId: "20",
        status: "done",
        routingOnly: true,
        steps: [
          {
            id: "routing",
            status: "done",
            at: "2026-10-23T00:00:00Z",
            label:
              "GitHub URL rule — Jev bypassed → Repository learning (github_learning)",
          },
        ],
      },
    ];
    await page.route(`**/api/sessions/${id}`, async (route) => {
      if (route.request().method() === "GET")
        await route.fulfill({ json: snapshot });
      else await route.continue();
    });
    await page.goto(`/sessions/${id}`);
    const turn = page.locator(".message.user .turn-activity");
    await expect(turn.locator("summary")).toContainText(
      "Jev decision → Web research",
    );
    await expect(turn).not.toHaveAttribute("open", "");
    await turn.locator("summary").click();
    await expect(turn.locator("li")).toContainText(
      "Jev decision → Web research",
    );
    const handoff = page
      .locator(".turn-activity")
      .filter({ has: page.locator("summary", { hasText: "Request routing" }) });
    await expect(handoff.locator("summary")).toContainText(
      "GitHub URL rule — Jev bypassed",
    );
    await page.reload();
    await expect(turn.locator("summary")).toContainText(
      "Jev decision → Web research",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".wrangler/mobile-routing-activity.png",
      fullPage: true,
    });
  } finally {
    await request.delete(`/api/sessions/${id}`);
  }
});
