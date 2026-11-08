import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import app from "../../src/app.ts";

// A code-flow card uses only inline SVG, escaped example code and server-rendered forms.
const code = `import { DurableObject } from "cloudflare:workers";
export class Gadget extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS flow (id INTEGER PRIMARY KEY, step INTEGER NOT NULL, last TEXT NOT NULL)"); }
  async render() {
    const row = this.ctx.storage.sql.exec("SELECT step,last FROM flow WHERE id=1").toArray()[0];
    const step = row?.step ?? 1, last = row?.last ?? "";
    const feedback = last === "next" ? "The increment moves the request into the handler." : last === "reset" ? "Reset takes the request back to the input." : "";
    return '<!doctype html><html><body><h1>Request flow</h1><svg aria-label="input to handler"><rect x="1" y="1" width="60" height="20"></rect></svg><pre>const next = step &lt; 2 ? 2 : 1;</pre><p>Step ' + step + ': ' + (step === 1 ? 'Input' : 'Handler') + '</p><p>' + feedback + '</p><form><input type="hidden" name="_action" value="next"><button>Next</button></form><form><input type="hidden" name="_action" value="reset"><button>Reset</button></form><p>Illustrative TypeScript, not runnable code.</p></body></html>';
  }
  async handleAction(action) {
    if (action !== "next" && action !== "reset") throw new Error("Unknown action");
    this.ctx.storage.sql.exec("INSERT INTO flow(id,step,last) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET step=excluded.step,last=excluded.last", action === "next" ? 2 : 1, action);
  }
}`;

it("preflights both the flow change and new explanatory feedback, without publishing failed drafts", async () => {
  const bindings = { ...env, DEV_AUTH: "local" } as CloudflareBindings;
  const id = crypto.randomUUID();
  const stub = bindings.LEARNING_SESSIONS.getByName(id);
  await stub.create({
    id,
    owner: "personal",
    title: "Code flow lesson",
    type: "general",
    private: false,
    archived: false,
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const invalid = await runInDurableObject(stub, async (instance) => {
    try {
      await instance.createGadget(
        "personal",
        "bad-learning-card",
        "Bad card",
        code,
        [
          {
            action: "next",
            data: {},
            expectText: "Step 2: Handler",
            expectFeedback: "Illustrative TypeScript, not runnable code.",
          },
        ],
      );
      return false;
    } catch {
      return true;
    }
  });
  expect(invalid).toBe(true); // Static text already visible before the action is not feedback.
  expect(await stub.listGadgets("personal")).toEqual([]);
  const created = await stub.createGadget(
    "personal",
    "good-learning-card",
    "Request flow",
    code,
    [
      {
        action: "next",
        data: {},
        expectText: "Step 2: Handler",
        expectFeedback: "The increment moves the request into the handler.",
      },
      {
        action: "reset",
        data: {},
        expectText: "Step 1: Input",
        expectFeedback: "Reset takes the request back to the input.",
      },
    ],
  );
  const path = `/api/sessions/${id}/gadgets/${created.id}`;
  const initial = await app.fetch(
    new Request(`http://localhost${path}`),
    bindings,
  );
  const html = await initial.text();
  expect(html).toContain("Step 1: Input");
  expect(html).not.toContain(
    "The increment moves the request into the handler.",
  );
  expect(html).toContain("<svg");
  expect(html).toContain("&lt; 2");
  expect(initial.headers.get("Content-Security-Policy")).toContain(
    "script-src 'none'",
  );
  const result = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "_action=next",
    }),
    bindings,
  );
  expect(result.status).toBe(303);
  expect(
    await (
      await app.fetch(new Request(`http://localhost${path}`), bindings)
    ).text(),
  ).toContain("The increment moves the request into the handler.");
  await stub.remove("personal");
}, 40_000);

it("checks both correct and incorrect quiz branches and their code-grounded explanations", async () => {
  const code = `import { DurableObject } from "cloudflare:workers";
export class Gadget extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS quiz (id INTEGER PRIMARY KEY, choice TEXT NOT NULL)"); }
  async render() {
    const choice = this.ctx.storage.sql.exec("SELECT choice FROM quiz WHERE id=1").toArray()[0]?.choice;
    const answer = choice === "let" ? '<p>Correct: let</p><p>Because let permits reassignment of the counter.</p>' : choice === "const" ? '<p>Try again: const</p><p>Because const forbids reassignment of the counter.</p>' : '';
    return '<html><body><h1>Predict the output</h1><pre>let counter = 0; counter += 1;</pre>' + answer + '<form><input name="_action" value="answer"><select name="choice"><option value="let">let</option><option value="const">const</option></select><button>Check</button></form></body></html>';
  }
  async handleAction(action, data) { if (action !== "answer" || !["let", "const"].includes(data.choice)) throw new Error("Invalid choice"); this.ctx.storage.sql.exec("INSERT INTO quiz(id,choice) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET choice=excluded.choice", data.choice); }
}`;
  const bindings = { ...env, DEV_AUTH: "local" } as CloudflareBindings;
  const id = crypto.randomUUID();
  const stub = bindings.LEARNING_SESSIONS.getByName(id);
  await stub.create({
    id,
    owner: "personal",
    title: "Code quiz lesson",
    type: "general",
    private: false,
    archived: false,
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const gadget = await stub.createGadget(
    "personal",
    "quiz-test",
    "Let or const?",
    code,
    [
      {
        action: "answer",
        data: { choice: "let" },
        expectText: "Correct: let",
        expectFeedback: "Because let permits reassignment",
      },
      {
        action: "answer",
        data: { choice: "const" },
        expectText: "Try again: const",
        expectFeedback: "Because const forbids reassignment",
      },
    ],
  );
  const path = `/api/sessions/${id}/gadgets/${gadget.id}`;
  const initial = await (
    await app.fetch(new Request(`http://localhost${path}`), bindings)
  ).text();
  expect(initial).not.toContain("Because let permits reassignment");
  expect(initial).not.toContain("Because const forbids reassignment");
  const wrong = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "_action=answer&choice=const",
    }),
    bindings,
  );
  expect(wrong.status).toBe(303);
  expect(
    await (
      await app.fetch(new Request(`http://localhost${path}`), bindings)
    ).text(),
  ).toContain("Because const forbids reassignment");
  await stub.remove("personal");
}, 40_000);
