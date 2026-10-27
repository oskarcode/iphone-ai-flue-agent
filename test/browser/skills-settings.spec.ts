import { test, expect } from "@playwright/test";

test("Settings manages persistent skills, dynamic commands and a working Computer shell", async ({
  page,
  request,
}) => {
  const slug = `browser-skill-${Date.now()}`;
  const command = `echo skill-shell-works`;
  async function settings() {
    await page.getByRole("button", { name: "Open library" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
  }
  try {
    await page.goto("/chat");
    await expect(
      page.getByRole("button", { name: "/explain-simply", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "/feature-bug-tracker", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "/learning-coach", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "/deep-learn", exact: true }),
    ).toBeVisible();
    expect(
      (await (await request.get("/api/skills/deep-learn")).json()).markdown,
    ).toContain("in THIS workspace");
    expect(
      (await (await request.get("/api/skills/feature-bug-tracker")).json())
        .markdown,
    ).toContain("/workspace/feature-bug-tracker.md");
    await expect(
      page.getByRole("button", { name: "Import previous sessions" }),
    ).toHaveCount(0);
    await page.getByLabel("Question").fill("Explain closures");
    await page
      .getByRole("button", { name: "/explain-simply", exact: true })
      .click();
    await expect(page.getByLabel("Question")).toHaveValue(
      "/explain-simply Explain closures",
    );
    await page.getByRole("button", { name: "/deep-learn", exact: true }).click();
    await expect(page.getByLabel("Question")).toHaveValue(
      "/deep-learn Explain closures",
    );
    await settings();
    await expect(
      page.getByRole("button", { name: "Learning preferences" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New skill", exact: true }).click();
    await page.getByLabel("Skill command").fill(slug);
    await page.getByLabel("Skill name").fill("Test examples");
    await page.getByLabel("Skill description").fill("Teach using examples");
    await page
      .getByLabel("Skill instructions")
      .fill("Use a short TypeScript example.");
    await page.getByRole("button", { name: "Save skill", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Delete skill", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Skill instructions").fill("Use two small examples.");
    await page.getByRole("button", { name: "Save skill", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/skills/${slug}`)).json()).markdown,
      )
      .toBe("Use two small examples.");
    await page.getByLabel("Computer command").fill(command);
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.locator(".computer-output[role=status]")).toContainText(
      "skill-shell-works",
    );
    await page.getByLabel("Execution backend").selectOption("javascript");
    await page
      .getByLabel("Computer command")
      .fill(
        'export default async function () { console.log("JS_SETTINGS_OK"); return 5; }',
      );
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.locator(".computer-output[role=status]")).toContainText(
      "JS_SETTINGS_OK",
      { timeout: 45000 },
    );
    await page.getByRole("button", { name: "Learning preferences" }).click();
    await expect(page.getByLabel("Teaching preferences")).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Back to chat" }).click();
    await expect(
      page.getByRole("button", { name: `/${slug}`, exact: true }),
    ).toBeAttached();
    await page.getByRole("button", { name: `/${slug}`, exact: true }).click();
    await expect(page.getByLabel("Question")).toHaveValue(
      `/${slug} Explain closures`,
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: `/${slug}`, exact: true }),
    ).toBeAttached();
    await settings();
    await page.getByRole("button", { name: new RegExp(`/${slug}`) }).click();
    await page
      .getByRole("button", { name: "Delete skill", exact: true })
      .click();
    await expect(page.locator(".computer-output[role=status]")).toContainText("Skill removed.");
    await expect
      .poll(async () => (await request.get(`/api/skills/${slug}`)).status())
      .toBe(404);
    await page.evaluate(() => localStorage.setItem("unrelated:test", "keep"));
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Clear device drafts" }).click();
    expect(
      await page.evaluate(() => localStorage.getItem("unrelated:test")),
    ).toBe("keep");
    await page.getByRole("button", { name: "Back to chat" }).click();
    await expect(page.getByLabel("Question")).toHaveValue("");
    await expect(
      page.getByRole("button", { name: `/${slug}`, exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    const response = await request.get(`/api/skills/${slug}`);
    if (response.status() === 200) {
      const skill = await response.json();
      await request.post("/api/computer/actions", {
        data: {
          tool: "skill.delete",
          args: { slug, expectedRevision: skill.revision },
        },
      });
    }
  }
});
