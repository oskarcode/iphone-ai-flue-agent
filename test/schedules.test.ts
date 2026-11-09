import { expect, it } from "vitest";
import { nextDailyRun, validateSchedule } from "../src/runtime/schedules.ts";

it("keeps a local 9 AM daily schedule across both New York DST transitions", () => {
  const recurrence = { intervalDays: 1, timezone: "America/New_York" };
  expect(
    new Date(
      nextDailyRun(
        Date.parse("2026-03-07T14:00:00Z"),
        recurrence,
        Date.parse("2026-03-07T14:00:00Z"),
      ),
    ).toISOString(),
  ).toBe("2026-03-08T13:00:00.000Z");
  expect(
    new Date(
      nextDailyRun(
        Date.parse("2026-10-31T13:00:00Z"),
        recurrence,
        Date.parse("2026-10-31T13:00:00Z"),
      ),
    ).toISOString(),
  ).toBe("2026-11-01T14:00:00.000Z");
});
it("rejects invalid schedule inputs before creating a task", () => {
  expect(() => validateSchedule("", Date.now() + 10_000)).toThrow();
  expect(() =>
    validateSchedule("Read one card", Date.now() - 10_000),
  ).toThrow();
  expect(() =>
    validateSchedule("Read one card", Date.now() + 10_000, {
      intervalDays: 1,
      timezone: "Not/AZone",
    }),
  ).toThrow();
});
