import React, { useEffect, useState } from "react";
import { api, post } from "./api.ts";
import type { CoachView } from "../lib/coach.ts";

/** Input: authorized coach snapshot. Output: evidence-backed learning overview and on-demand teacher Q&A.
 * What this function does: refreshes on entry/focus, never runs a background model loop or asserts unasked questions as facts.
 */
export function Coach() {
  const [view, setView] = useState<CoachView>();
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setView(await api<CoachView>("/api/coach"));
  }
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
    const focus = () => {
      void refresh().catch((e) => setError(String(e)));
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  async function ask() {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError("");
    const text = question.trim();
    const requestId = crypto.randomUUID();
    try {
      await post("/api/coach/questions", { text, requestId });
      setQuestion("");
      await refresh();
    } catch {
      setError(
        "The coach could not confirm an answer. Your question is still here; retry when ready.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function change(path: string) {
    setBusy(true);
    setError("");
    try {
      await post(path, {});
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const observations = view?.observations ?? [];
  const questions = observations.filter((o) => o.role === "user" && !o.private);
  return (
    <div className="coach-content">
      <section className="settings-card">
        <h2>Your learning, across sessions</h2>
        <p>
          Updates from saved user and assistant messages. The coach answers only
          when you ask. Questions you have not asked are suggestions, not facts
          about your knowledge.
        </p>
        <p role="status">
          {view?.paused
            ? "Observation paused. Existing coach evidence was cleared."
            : `${view?.sessionCount ?? 0} sessions · ${view?.messageCount ?? 0} observed messages`}
        </p>
        <button
          onClick={() => void refresh().catch((e) => setError(String(e)))}
        >
          Refresh learning
        </button>
        {view?.paused ? (
          <button
            disabled={busy}
            onClick={() => void change("/api/coach/resume")}
          >
            Resume observation
          </button>
        ) : (
          <button
            disabled={busy}
            className="danger"
            onClick={() => {
              if (
                confirm(
                  "Clear all coach observations and answers and pause observation? Learning sessions and skills remain unchanged.",
                )
              )
                void change("/api/coach/clear");
            }}
          >
            Clear coach & pause
          </button>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      <section className="settings-card">
        <h2>Ask your coach</h2>
        <div className="coach-suggestions">
          {[
            "What topics have I explored, based on my questions?",
            "What might I be misunderstanding? Cite the question.",
            "Suggest three next questions or exercises for TypeScript and Cloudflare developer products.",
            "Help me make a learning plan for agent harnesses.",
          ].map((text) => (
            <button key={text} onClick={() => setQuestion(text)}>
              {text}
            </button>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <label>
            Follow-up question
            <textarea
              aria-label="Coach question"
              value={question}
              maxLength={3000}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What should I learn next, and why?"
            />
          </label>
          <button disabled={busy || !question.trim()}>
            {busy ? "Thinking…" : "Ask coach"}
          </button>
        </form>
        {view?.turns.map((turn) => (
          <article className="coach-turn" key={turn.id}>
            <strong>You asked:</strong>
            <p>{turn.question}</p>
            <strong>Coach:</strong>
            <p>{turn.answer}</p>
          </article>
        ))}
      </section>
      <section className="settings-card">
        <h2>Observed learning questions</h2>
        <p>
          Only visible retained messages are considered. Private repository
          content is withheld; deleted sessions are removed.
        </p>
        {questions.length ? (
          questions.map((o) => (
            <article
              className="coach-observation"
              key={`${o.sessionId}:${o.entryId}`}
            >
              <a href={`/sessions/${o.sessionId}`}>
                Session · message {o.entryId}
              </a>
              <p>{o.text}</p>
            </article>
          ))
        ) : (
          <p>
            No public learning questions observed yet. Ask something in a
            learning session, then return here.
          </p>
        )}
      </section>
    </div>
  );
}
