import React, { useEffect, useState } from "react";
import { api } from "./api.ts";
import type { GadgetSummary } from "../runtime/gadgets.ts";

type Item = GadgetSummary & { sessionId: string; sessionTitle: string };
type Page = { gadgets: Item[]; unavailable: number; nextOffset?: number };

/** Owner-scoped catalog: the API pages across all retained (including archived/private) sessions. */
export function GadgetLibrary({ changed }: { changed(): void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [nextOffset, setNextOffset] = useState<number>();
  const [unavailable, setUnavailable] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const course = items.find(
    (item) => item.id === "gadget-typescript-course-v1",
  );
  async function load(offset = 0, append = false, signal?: AbortSignal) {
    setBusy(true);
    setError("");
    try {
      const page = await api<Page>(`/api/gadgets?offset=${offset}`, { signal });
      if (signal?.aborted) return;
      setItems((current) =>
        (append ? [...current, ...page.gadgets] : page.gadgets).sort((a, b) =>
          a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
        ),
      );
      setNextOffset(page.nextOffset);
      setUnavailable((current) =>
        append ? current + page.unavailable : page.unavailable,
      );
      setLoaded(true);
    } catch (cause) {
      if (!signal?.aborted) setError(String(cause));
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(0, false, controller.signal);
    return () => controller.abort();
  }, []);
  async function startCourse() {
    setBusy(true);
    setError("");
    const key = "typescript-course-request-id";
    const requestId = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, requestId);
    try {
      const created = await api<{ url: string }>("/api/learning-course", {
        method: "POST",
        body: JSON.stringify({ requestId }),
      });
      sessionStorage.removeItem(key);
      window.location.assign(created.url);
    } catch (cause) {
      setError(String(cause));
      setBusy(false);
    }
  }
  async function enableScheduledCards(item: Item) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/sessions/${encodeURIComponent(item.sessionId)}/course-upgrade`, { method: "POST", body: "{}" });
      setMessage("Course is ready for scheduled lesson cards. Existing progress was retained.");
      await load();
      changed();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function remove(item: Item) {
    if (
      !window.confirm(
        `Delete “${item.title}” from “${item.sessionTitle}”? This permanently removes its saved data. The chat session remains.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api<void>(
        `/api/sessions/${encodeURIComponent(item.sessionId)}/gadgets/${encodeURIComponent(item.id)}`,
        {
          method: "DELETE",
          body: JSON.stringify({ expectedGeneration: item.generation }),
        },
      );
      setItems((current) =>
        current.filter(
          (entry) => entry.sessionId !== item.sessionId || entry.id !== item.id,
        ),
      );
      changed();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="settings-card gadget-directory"
      aria-label="Your gadgets"
    >
      <h2>Gadgets</h2>
      <p>
        Start a structured TypeScript course: seven days of fundamentals, seven
        days reading this Pi Durable harness, then seven days tracing a real
        request. It includes explanations, two checked questions and an ungraded
        writing exercise per day, reviews and saved progress. Enter your
        experience and goal inside the gadget; for evidence-based
        personalization, request /learning-coach from its lesson. Week 4 awaits
        your goal.
      </p>
      {course ? (
        <a
          href={`/api/sessions/${encodeURIComponent(course.sessionId)}/gadgets/${course.id}`}
        >
          Open TypeScript course
        </a>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void startCourse()}
        >
          Start TypeScript course
        </button>
      )}
      <p>
        Interactive gadgets from all your learning sessions, including archived
        and private lessons. Compatible updates keep one link and preserve saved
        data; deleting a gadget removes its saved data but leaves the lesson.
      </p>
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {unavailable > 0 && (
        <p role="status">
          {unavailable} session(s) could not be checked. Refresh to try again.
        </p>
      )}
      <button type="button" disabled={busy} onClick={() => void load()}>
        Refresh gadgets
      </button>
      {!loaded && !error && <p role="status">Loading gadgets…</p>}
      {loaded && !items.length && !nextOffset && (
        <p>No gadgets yet. Ask for /learning-gadget in a lesson.</p>
      )}
      <ul>
        {items.map((item) => (
          <li key={`${item.sessionId}:${item.id}`}>
            <div>
              <strong>{item.title}</strong>
              <small>{item.sessionTitle}</small>
            </div>
            <div className="gadget-directory-actions">
              <a href={`/sessions/${encodeURIComponent(item.sessionId)}`}>
                Lesson
              </a>
              <a
                href={`/api/sessions/${encodeURIComponent(item.sessionId)}/gadgets/${encodeURIComponent(item.id)}`}
                target="_blank"
                rel="noreferrer"
              >
                Open gadget ↗
              </a>
              {item.id === "gadget-typescript-course-v1" && <button type="button" disabled={busy} onClick={() => void enableScheduledCards(item)}>Enable scheduled lesson cards</button>}
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => void remove(item)}
                aria-label={`Delete ${item.title}`}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {nextOffset !== undefined && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(nextOffset, true)}
        >
          More sessions
        </button>
      )}
    </section>
  );
}
