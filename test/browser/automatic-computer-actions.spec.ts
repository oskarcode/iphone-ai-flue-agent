import { test, expect } from "@playwright/test";

test("a requested skill save runs without an approval click and informs the learner", async ({ page, request }) => {
  const slug = `auto-smoke-${crypto.randomUUID().slice(0, 8)}`;
  let sessionPath = "";
  try {
    await page.goto("/chat");
    await page.getByLabel("Question").fill(
      `Create a reusable skill /${slug} named "Concise summary", description "Summarize in two sentences", with instructions "Summarize the requested topic in exactly two plain sentences." Save it now and tell me when done.`,
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page).toHaveURL(/\/sessions\//);
    sessionPath = new URL(page.url()).pathname.replace("/sessions/", "/api/sessions/");
    await expect(page.getByText("Skill saved.", { exact: true })).toBeVisible({ timeout: 110_000 });
    await expect(page.locator(".approval")).toHaveCount(0);
    await expect(page.getByRole("button", { name: `/${slug}`, exact: true })).toBeAttached({ timeout: 30_000 });
    const saved = await request.get(`/api/skills/${slug}`);
    expect(saved.status()).toBe(200);
    await page.reload();
    await expect(page.getByText("Skill saved.", { exact: true })).toBeVisible();
  } finally {
    const saved = await request.get(`/api/skills/${slug}`);
    if (saved.status() === 200) {
      const skill = await saved.json();
      await request.post("/api/computer/actions", {
        data: { tool: "skill.delete", args: { slug, expectedRevision: skill.revision } },
      });
    }
    if (sessionPath) await request.delete(sessionPath);
  }
});

test("a requested Computer file write runs without approval and remains readable", async ({ page, request }) => {
  const path = `/workspace/auto-smoke-${crypto.randomUUID().slice(0, 8)}.md`;
  let sessionPath = "";
  try {
    await page.goto("/chat");
    await page.getByLabel("Question").fill(
      `Use write_computer_file, not a shell command, to create ${path} containing only "Learning notes smoke test". Tell me after the write is confirmed.`,
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page).toHaveURL(/\/sessions\//);
    sessionPath = new URL(page.url()).pathname.replace("/sessions/", "/api/sessions/");
    await expect(page.getByText("Computer file saved.", { exact: true })).toBeVisible({ timeout: 110_000 });
    await expect(page.locator(".approval")).toHaveCount(0);
    const file = await request.get(`/api/computer/file?path=${encodeURIComponent(path)}`);
    expect(file.status()).toBe(200);
    expect((await file.json()).content).toBe("Learning notes smoke test");
  } finally {
    await request.post("/api/computer/actions", { data: { tool: "computer.delete", args: { path } } });
    if (sessionPath) await request.delete(sessionPath);
  }
});
