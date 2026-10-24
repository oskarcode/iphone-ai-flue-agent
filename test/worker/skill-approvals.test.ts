import { env } from "cloudflare:workers";
import { runInDurableObject, evictDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import type { SessionMetadata } from "../../src/runtime/contracts.ts";

/** Input: exact skill proposals in a durable session. Output: no mutation before approval, retained receipts afterwards. */
it("requires approval for skill changes, preserves global skills after session deletion and handles stale proposals", async () => {
  const id = crypto.randomUUID();
  const session = (env as CloudflareBindings).LEARNING_SESSIONS.getByName(id);
  const skills = (env as CloudflareBindings).LEARNING_SKILLS.getByName(
    "personal",
  );
  const slug = "approval-" + id;
  const metadata: SessionMetadata = {
    id,
    owner: "personal",
    title: "Skill approval",
    type: "general",
    private: false,
    archived: false,
    pinned: false,
    createdAt: "now",
    updatedAt: "now",
  };
  await session.create(metadata);
  const args = {
    slug,
    name: "Approved fixture",
    description: "Test",
    markdown: "Explain carefully.",
    expectedRevision: "",
  };
  async function proposal(key: string) {
    await runInDurableObject(session, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO learning_approvals VALUES (?,?)",
        key,
        JSON.stringify({
          id: key,
          tool: "skill.save",
          args,
          status: "pending",
          createdAt: "now",
        }),
      );
    });
  }
  await proposal("reject-skill");
  expect(await skills.get("personal", slug)).toBeNull();
  expect(
    await (await session.approve("personal", "reject-skill", false)).json(),
  ).toMatchObject({ status: "rejected" });
  expect(await skills.get("personal", slug)).toBeNull();
  await proposal("accept-skill");
  expect(
    await (await session.approve("personal", "accept-skill", true)).json(),
  ).toMatchObject({ status: "done" });
  const saved = await skills.get("personal", slug);
  expect(saved?.markdown).toBe("Explain carefully.");
  await evictDurableObject(session);
  expect(
    await (await session.approve("personal", "accept-skill", true)).json(),
  ).toMatchObject({ status: "done" });
  expect(await skills.get("personal", slug)).toEqual(saved);
  await proposal("stale-skill");
  expect(
    await (await session.approve("personal", "stale-skill", true)).json(),
  ).toMatchObject({ status: "uncertain" });
  expect(await skills.get("personal", slug)).toEqual(saved);
  await session.remove("personal");
  expect(await skills.get("personal", slug)).toEqual(saved);
  await skills.apply("personal", "cleanup-" + id, "skill.delete", {
    slug,
    expectedRevision: saved!.revision,
  });
});
