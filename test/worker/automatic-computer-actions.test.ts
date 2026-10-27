import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import type { SessionMetadata, SessionSnapshot } from "../../src/runtime/contracts.ts";

it("applies requested skill and file writes without approval, retains safe receipts and never replays them", async () => {
  const id = crypto.randomUUID();
  const owner = "personal";
  const session = (env as CloudflareBindings).LEARNING_SESSIONS.getByName(id);
  const computer = (env as CloudflareBindings).LEARNING_SKILLS.getByName(owner);
  const metadata: SessionMetadata = {
    id, owner, title: "Automatic changes", type: "general", private: false,
    archived: false, pinned: false, createdAt: "now", updatedAt: "now",
  };
  await session.create(metadata);
  const slug = `automatic-${id}`;
  const path = `/workspace/auto-${id}.md`;
  const args = { slug, name: "Autotest", description: "Check", markdown: "Private fixture content", expectedRevision: "" };
  async function rejected(actor: string, actionId: string, tool: string, input: Record<string, unknown>) {
    return runInDurableObject(session, async (instance) => {
      try { await instance.proposeAction(actor, actionId, tool, input); return false; }
      catch { return true; }
    });
  }
  try {
    expect(await rejected("wrong-owner", "save-auto", "skill.save", args)).toBe(true);
    expect(await rejected(owner, "bad-auto", "computer.write", { path: "/etc/outside", content: "x" })).toBe(true);
    expect(await computer.get(owner, slug)).toBeNull();
    expect(await session.proposeAction(owner, "save-auto", "skill.save", args)).toMatchObject({ status: "done", automatic: true });
    const skill = await computer.get(owner, slug);
    expect(skill?.markdown).toBe(args.markdown);
    expect(await session.proposeAction(owner, "save-auto", "skill.save", args)).toMatchObject({ status: "done" });
    await evictDurableObject(session);
    expect(await session.proposeAction(owner, "save-auto", "skill.save", args)).toMatchObject({ status: "done" });
    expect(await rejected(owner, "save-auto", "skill.save", { ...args, markdown: "different" })).toBe(true);
    expect((await computer.get(owner, slug))?.revision).toBe(skill?.revision);

    const write = { path, content: "First draft", expectedRevision: "" };
    expect(await session.proposeAction(owner, "write-auto", "computer.write", write)).toMatchObject({ status: "done", automatic: true });
    expect((await computer.read(owner, path)).content).toBe("First draft");
    const snapshot = (await (await session.snapshot(owner)).json()) as SessionSnapshot;
    const receipt = snapshot.approvals.find((action) => action.id === "write-auto")!;
    expect(receipt).toMatchObject({ automatic: true, status: "done", args: {} });
    expect(JSON.stringify(receipt)).not.toContain("First draft");
    expect(await (await session.approve(owner, "write-auto", false)).json()).toMatchObject({ status: "done" });
    const stale = await session.proposeAction(owner, "stale-write", "computer.write", { path, content: "Overwritten", expectedRevision: "" });
    expect(stale).toMatchObject({ status: "uncertain" });
    expect((await computer.read(owner, path)).content).toBe("First draft");
    expect(await session.proposeAction(owner, "stale-write", "computer.write", { path, content: "Overwritten", expectedRevision: "" })).toMatchObject({ status: "uncertain" });
    expect((await computer.read(owner, path)).content).toBe("First draft");

    expect(await session.proposeAction(owner, "delete-file", "computer.delete", { path })).toMatchObject({ status: "pending" });
    expect(await session.proposeAction(owner, "run-shell", "computer.run", { command: "echo hello" })).toMatchObject({ status: "pending" });
    expect(await session.proposeAction(owner, "github-issue", "createIssue", { title: "test" })).toMatchObject({ status: "pending" });
    expect((await computer.read(owner, path)).content).toBe("First draft");
    expect(await session.proposeAction(owner, "delete-auto", "skill.delete", { slug, expectedRevision: skill!.revision })).toMatchObject({ status: "done", automatic: true });
    expect(await computer.get(owner, slug)).toBeNull();
  } finally {
    await computer.apply(owner, `cleanup-${id}`, "computer.delete", { path });
    await session.remove(owner);
  }
}, 30000);
