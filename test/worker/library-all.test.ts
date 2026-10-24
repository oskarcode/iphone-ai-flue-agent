import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import type { DirectoryItem } from "../../src/runtime/contracts.ts";

/** Input: mixed historical archive flags. Output: a unified, searchable, paginated Library without changing stored flags. */
it("lists all sessions for the simplified UI while retaining compatible archive filters", async () => {
  const library = (env as CloudflareBindings).LEARNING_LIBRARY.getByName(
    crypto.randomUUID(),
  );
  await runInDurableObject(library, (instance) => {
    for (let i = 0; i < 54; i++) {
      const item: DirectoryItem = {
        id: `library-all-${i}`,
        owner: "personal",
        title: `Lesson ${i}`,
        type: "general",
        private: false,
        pinned: i === 1,
        archived: i % 2 === 1,
        createdAt: "now",
        updatedAt: String(i).padStart(3, "0"),
      };
      instance.upsert(item, 1, i === 3 ? "literal % marker" : "", []);
    }
  });
  const first = await library.list("", "all");
  expect(first.items).toHaveLength(50);
  expect(first.items[0]).toMatchObject({
    id: "library-all-1",
    pinned: true,
    archived: true,
  });
  const second = await library.list("", "all", first.nextOffset);
  expect(second.items).toHaveLength(4);
  expect(second.nextOffset).toBeUndefined();
  expect(
    new Set([...first.items, ...second.items].map((item) => item.id)).size,
  ).toBe(54);
  expect((await library.list("", false)).items).toHaveLength(27);
  expect((await library.list("", true)).items).toHaveLength(27);
  expect((await library.list("%", "all")).items.map((item) => item.id)).toEqual(
    ["library-all-3"],
  );
});
