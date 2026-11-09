import React, { useEffect, useState } from "react";
import { api } from "./api.ts";
import type {
  LearningSchedule,
  ScheduleRecurrence,
} from "../runtime/schedules.ts";

type Item = LearningSchedule & { sessionId: string; sessionTitle: string };
type Directory = { schedules: Item[]; unavailable: number; truncated: boolean };
const localInput = (ms: number) =>
  new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

/** One owner-scoped Settings list; editing checks the version before replacing a future task. */
export function ScheduleDirectory() {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item>();
  const [instruction, setInstruction] = useState("");
  const [runAt, setRunAt] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [intervalDays, setIntervalDays] = useState(1);
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(0);
  const [truncated, setTruncated] = useState(false);
  async function reload() {
    setBusy(true);
    try {
      const list = await api<Directory>("/api/schedules");
      setItems(list.schedules);
      setUnavailable(list.unavailable);
      setTruncated(list.truncated);
      setError("");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  const path = (item: Item) =>
    `/api/sessions/${encodeURIComponent(item.sessionId)}/schedules/${encodeURIComponent(item.id)}`;
  function edit(item: Item) {
    setSelected(item);
    setInstruction(item.instruction);
    setRunAt(localInput(item.runAt));
    setRecurring(Boolean(item.recurrence));
    setIntervalDays(item.recurrence?.intervalDays ?? 1);
    setTimezone(
      item.recurrence?.timezone ??
        (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
    );
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const recurrence: ScheduleRecurrence | undefined = recurring
        ? { intervalDays, timezone }
        : undefined;
      await api(path(selected), {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: selected.revision,
          instruction,
          runAt: new Date(runAt).getTime(),
          recurrence,
        }),
      });
      setSelected(undefined);
      await reload();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  async function remove(item: Item) {
    if (
      !window.confirm(
        `Delete the scheduled instruction in “${item.sessionTitle}”? A turn already running cannot be recalled.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(path(item), {
        method: "DELETE",
        body: JSON.stringify({ expectedRevision: item.revision }),
      });
      if (selected?.id === item.id && selected.sessionId === item.sessionId)
        setSelected(undefined);
      await reload();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card" aria-label="Scheduled learning tasks">
      <h2>Schedules</h2>
      <p>
        Future Agent turns in your retained learning sessions. Ask the assistant
        in a lesson to schedule an instruction. Gadgets themselves do not run
        timers. Times below are displayed in your device timezone.
      </p>
      <button type="button" disabled={busy} onClick={() => void reload()}>
        Refresh schedules
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {unavailable > 0 && (
        <p role="status">
          {unavailable} session(s) could not be checked; refresh to try again.
        </p>
      )}
      {truncated && (
        <p role="status">
          The schedule list was truncated; refresh or open the attached lesson
          to manage its schedule.
        </p>
      )}
      {!busy && !items.length && <p>No active schedules.</p>}
      <ul>
        {items.map((item) => (
          <li key={`${item.sessionId}:${item.id}`}>
            <strong>{item.sessionTitle}</strong> ·{" "}
            <time dateTime={new Date(item.runAt).toISOString()}>
              {new Date(item.runAt).toLocaleString()}
            </time>
            {item.recurrence && (
              <span>
                {" "}
                · Every {item.recurrence.intervalDays} day(s) (
                {item.recurrence.timezone})
              </span>
            )}
            <p>{item.instruction}</p>
            <a href={`/sessions/${encodeURIComponent(item.sessionId)}`}>
              Open attached learning workspace
            </a>{" "}
            <button type="button" disabled={busy} onClick={() => edit(item)}>
              Edit
            </button>{" "}
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void remove(item)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <form onSubmit={(event) => void save(event)}>
          <h3>Edit schedule in {selected.sessionTitle}</h3>
          <label>
            Future Agent instruction
            <textarea
              aria-label="Future Agent instruction"
              required
              maxLength={4000}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>
          <label>
            Next run (your device time)
            <input
              aria-label="Next run"
              type="datetime-local"
              required
              value={runAt}
              onChange={(event) => setRunAt(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={recurring}
              onChange={(event) => setRecurring(event.target.checked)}
            />{" "}
            Repeat
          </label>
          {recurring && (
            <label>
              Repeat every (days)
              <input
                type="number"
                aria-label="Repeat every days"
                min={1}
                max={30}
                required
                value={intervalDays}
                onChange={(event) =>
                  setIntervalDays(Number(event.target.value))
                }
              />
            </label>
          )}
          {recurring && (
            <label>
              IANA timezone
              <input
                aria-label="IANA timezone"
                required
                maxLength={100}
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </label>
          )}
          <button disabled={busy}>Save schedule</button>{" "}
          <button type="button" onClick={() => setSelected(undefined)}>
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}
