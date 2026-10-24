import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
it("executes JavaScript modules with durable filesystem access", async () => {
  const computer = (env as CloudflareBindings).LEARNING_SKILLS.getByName(
    crypto.randomUUID(),
  );
  const result = (await computer.apply(
    "personal",
    "javascript-runtime-test",
    "computer.run",
    {
      backend: "javascript",
      command:
        'import fs from "node:fs/promises"; export default async function () { await fs.writeFile("/workspace/javascript-proof.txt", "JS works"); console.log("JS_OK"); return { answer: 2 + 3 }; }',
    },
  )) as { status: string; exitCode: number; stdout: string; value: unknown };
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("JS_OK");
  expect(result.value).toEqual({ answer: 5 });
  expect(
    (await computer.read("personal", "/workspace/javascript-proof.txt"))
      .content,
  ).toBe("JS works");
}, 45000);
