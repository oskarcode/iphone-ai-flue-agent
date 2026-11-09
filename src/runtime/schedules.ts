import { Type } from "@earendil-works/pi-ai";
import {
  defineDoc,
  defineTask,
  defineTool,
  type ToolRegistration,
  type ConversationId,
} from "@earendil-works/pi-durable";

/** Session-owned scheduled agent turns. A course gadget cannot run timers itself. */
export type ScheduleRecurrence = { intervalDays: number; timezone: string };
export type LearningSchedule = {
  id: string;
  occurrenceId: string;
  instruction: string;
  runAt: number;
  revision: number;
  createdAt: number;
  recurrence?: ScheduleRecurrence;
};
export type ScheduleOccurrence = LearningSchedule & {
  conversationId: ConversationId;
};
const ScheduleIntent = defineDoc<{ id?: string }>({
  kind: "learning.schedule-intent",
  version: 1,
  scope: "task",
  initial: () => ({}),
});
export const LearningSchedules = defineDoc<{
  items: Record<string, ScheduleOccurrence>;
}>({
  kind: "learning.schedules",
  version: 1,
  scope: "session",
  initial: () => ({ items: {} }),
});

/** Retain the selected local hour across DST, unlike adding a fixed 24-hour duration. */
export function nextDailyRun(
  previous: number,
  recurrence: ScheduleRecurrence,
  now: number,
): number {
  const parts = (ms: number) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: recurrence.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(ms)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    ) as Record<string, number>;
  const local = parts(previous);
  let day = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    previous % 1000,
  );
  for (let i = 0; i < 370; i++) {
    day += recurrence.intervalDays * 86_400_000;
    for (const offset of [0, -3, 3, -12, 12, -24, 24].map(
      (h) => h * 3_600_000,
    )) {
      const guess = day + offset;
      const shown = parts(guess);
      const localGuess = Date.UTC(
        shown.year,
        shown.month - 1,
        shown.day,
        shown.hour,
        shown.minute,
        shown.second,
        guess % 1000,
      );
      const candidate = day - (localGuess - guess);
      const actual = parts(candidate);
      if (
        actual.year === new Date(day).getUTCFullYear() &&
        actual.month === new Date(day).getUTCMonth() + 1 &&
        actual.day === new Date(day).getUTCDate() &&
        actual.hour === local.hour &&
        actual.minute === local.minute &&
        candidate > now
      )
        return candidate;
    }
  }
  throw new Error("Could not calculate next local schedule time");
}

export function validateSchedule(
  instruction: string,
  runAt: number,
  recurrence?: ScheduleRecurrence,
): void {
  if (
    typeof instruction !== "string" ||
    !instruction.trim() ||
    instruction.length > 4000
  )
    throw new Error("Instruction must be 1–4000 characters");
  if (
    !Number.isSafeInteger(runAt) ||
    runAt <= Date.now() ||
    runAt > Date.now() + 366 * 86_400_000
  )
    throw new Error("Choose a future time within one year");
  if (recurrence) {
    if (
      !Number.isSafeInteger(recurrence.intervalDays) ||
      recurrence.intervalDays < 1 ||
      recurrence.intervalDays > 30 ||
      typeof recurrence.timezone !== "string" ||
      recurrence.timezone.length > 100
    )
      throw new Error("Invalid daily recurrence");
    try {
      new Intl.DateTimeFormat("en", { timeZone: recurrence.timezone });
    } catch {
      throw new Error("Invalid IANA timezone");
    }
  }
}

export const DeliverLearningSchedule = defineTask<
  ScheduleOccurrence,
  { phase: "wait" | "deliver" },
  null
>({
  name: "learning.deliver-schedule",
  version: 1,
  initial: () => ({ phase: "wait" }),
  phases: {
    wait: async (task, runtime, context) => {
      await runtime.sleep(task.input.runAt, context);
      await runtime.commit(async (tx) => {
        const current = (await tx.doc(LearningSchedules)).items[task.input.id];
        return current?.occurrenceId === task.input.occurrenceId
          ? { status: "running", checkpoint: { phase: "deliver" } }
          : {
              status: "terminal",
              outcome: { status: "completed", result: null },
            };
      }, context);
    },
    deliver: async (task, runtime, context) => {
      const {
        id,
        occurrenceId,
        conversationId,
        instruction,
        recurrence,
        runAt,
      } = task.input;
      const active = await runtime.snapshot(LearningSchedules, context);
      if (active?.items[id]?.occurrenceId === occurrenceId) {
        const conversation = await runtime.conversation(
          conversationId,
          context,
        );
        if (conversation) {
          const submission = await conversation.submit(
            {
              type: "input",
              content: `Scheduled learning task (${id}): ${instruction}`,
              requestId: occurrenceId,
              whenBusy: "followUp",
            },
            context,
          );
          await submission.wait(context);
        }
      }
      await runtime.commit(async (tx) => {
        const doc = await tx.doc(LearningSchedules);
        const current = doc.items[id];
        if (current?.occurrenceId === occurrenceId) {
          if (recurrence) {
            const next: ScheduleOccurrence = {
              ...current,
              occurrenceId: `schedule:${crypto.randomUUID()}`,
              revision: current.revision + 1,
              runAt: nextDailyRun(runAt, recurrence, Date.now()),
            };
            doc.items[id] = next;
            await tx.createTask(DeliverLearningSchedule, next, {
              ownership: { kind: "conversation" },
              conversationId,
              background: true,
            });
          } else delete doc.items[id];
        }
        return {
          status: "terminal",
          outcome: { status: "completed", result: null },
        };
      }, context);
    },
  },
  abort: async (_task, runtime, context) => {
    await runtime.commit(
      () => ({ status: "terminal", outcome: { status: "aborted" } }),
      context,
    );
  },
});

export function scheduleTools(host: {
  list(): Promise<LearningSchedule[]>;
  cancel(id: string): Promise<boolean>;
  wake(at: number): Promise<void>;
}): ToolRegistration[] {
  return [
    defineTool({
      name: "schedule",
      replay: "safe",
      description:
        "Schedule one future agent turn in THIS learning session. The future turn can read and update the same gadget; never put timers inside gadget code. Use only when the user explicitly requests scheduled work. Supply a self-contained instruction naming the existing gadget ID and what content to add; do not request clearing progress. Provide exactly one of delaySeconds (relative time) or at (ISO time with explicit UTC offset or Z). Optional daily recurrence uses an IANA timezone. No scheduling of GitHub writes, Computer shell or external actions without separately required approvals.",
      parameters: Type.Object({
        instruction: Type.String({ minLength: 1, maxLength: 4000 }),
        at: Type.Optional(Type.String({ minLength: 20, maxLength: 40 })),
        delaySeconds: Type.Optional(
          Type.Integer({ minimum: 1, maximum: 366 * 86_400 }),
        ),
        recurrence: Type.Optional(
          Type.Object({
            intervalDays: Type.Integer({ minimum: 1, maximum: 30 }),
            timezone: Type.String({ minLength: 1, maxLength: 100 }),
          }),
        ),
      }),
      async execute(
        { instruction, at, delaySeconds, recurrence },
        api,
        context,
      ) {
        const intent = await api.snapshot(ScheduleIntent, api.taskId, context);
        if (intent?.id) {
          const existing = (await host.list()).find(
            (item) => item.id === intent.id,
          );
          if (existing) await host.wake(existing.runAt);
          return {
            output: [
              {
                type: "text",
                text: JSON.stringify(
                  existing
                    ? { ...existing, status: "scheduled" }
                    : {
                        id: intent.id,
                        status: "already completed or cancelled",
                      },
                ),
              },
            ],
          };
        }
        if ((at === undefined) === (delaySeconds === undefined))
          throw new Error("Choose exactly one of at or delaySeconds");
        if (at !== undefined && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(at))
          throw new Error("Time must include a timezone offset");
        const runAt =
          at !== undefined ? Date.parse(at) : Date.now() + delaySeconds! * 1000;
        validateSchedule(instruction, runAt, recurrence);
        const id = `schedule:${api.taskId}`;
        const result = await api.commit(async (tx) => {
          const doc = await tx.doc(LearningSchedules);
          const receipt = await tx.doc(ScheduleIntent, api.taskId);
          if (receipt.id)
            return {
              ...(doc.items[receipt.id] ?? {
                id: receipt.id,
                runAt,
                instruction,
                status: "already completed or cancelled",
              }),
            };
          if (doc.items[id]) {
            receipt.id = id;
            return { ...doc.items[id] };
          }
          const duplicate =
            recurrence &&
            Object.values(doc.items).find(
              (item) =>
                item.conversationId === api.conversationId &&
                item.instruction.trim().normalize("NFKC").toLowerCase() ===
                  instruction.trim().normalize("NFKC").toLowerCase() &&
                item.recurrence?.intervalDays === recurrence.intervalDays &&
                item.recurrence?.timezone === recurrence.timezone,
            );
          if (duplicate) {
            receipt.id = duplicate.id;
            return { ...duplicate };
          }
          if (Object.keys(doc.items).length >= 50)
            throw new Error("This session has too many active schedules");
          const scheduled: ScheduleOccurrence = {
            id,
            occurrenceId: id,
            instruction: instruction.trim(),
            runAt,
            revision: 1,
            createdAt: Date.now(),
            conversationId: api.conversationId,
            ...(recurrence ? { recurrence } : {}),
          };
          doc.items[id] = scheduled;
          receipt.id = id;
          await tx.createTask(DeliverLearningSchedule, scheduled, {
            ownership: { kind: "conversation" },
            conversationId: api.conversationId,
            background: true,
          });
          return { ...scheduled };
        }, context);
        await host.wake(result.runAt);
        return {
          output: [
            {
              type: "text",
              text: JSON.stringify({
                id: result.id,
                runAt: new Date(result.runAt).toISOString(),
                recurrence: result.recurrence ?? null,
                instruction: result.instruction,
                status: "scheduled",
              }),
            },
          ],
        };
      },
    }),
    defineTool({
      name: "list_schedules",
      replay: "safe",
      description:
        "List active scheduled Agent turns in this learning session, with IDs, next times, and instructions.",
      parameters: Type.Object({}),
      execute: async () => ({
        output: [{ type: "text", text: JSON.stringify(await host.list()) }],
      }),
    }),
    defineTool({
      name: "cancel_schedule",
      replay: "safe",
      description:
        "Cancel a scheduled Agent turn in this learning session, only when explicitly requested. A recurring schedule stops future occurrences.",
      parameters: Type.Object({
        id: Type.String({ minLength: 1, maxLength: 100 }),
      }),
      execute: async ({ id }) => ({
        output: [
          {
            type: "text",
            text: JSON.stringify({ id, cancelled: await host.cancel(id) }),
          },
        ],
      }),
    }),
  ];
}
