// React owns view state and lifecycle; the server still owns canonical conversations.
import React, { useState, useEffect, useRef, memo } from "react";
import { createRoot } from "react-dom/client";
// Shared rendering, prompts and DTO types keep browser behavior aligned with the Worker.
import { renderTutorMarkdown } from "../lib/tutor-markdown.ts";
import { TurnActivityPanel } from "./turn-activity.tsx";
import {
  LEARNING_RECAP_PROMPT,
  REPOSITORY_STARTER_PROMPTS,
} from "../lib/chat-presets.ts";
import type {
  DirectoryItem,
  SessionSnapshot,
  Source,
} from "../runtime/contracts.ts";
// Vite emits this stylesheet as a static asset alongside the client bundle.
import "./styles.css";

/** Input: relative API path and fetch options. Output: typed JSON or undefined for 204.
 * What this function does: surfaces server errors without treating TypeScript's T as response validation.
 */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error ??
        `Request failed (${response.status}). Refresh to check your login.`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
const post = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
/** Input: local key. Output: value or null.
 * What this function does: tolerates browsers that block localStorage.
 */
const readStored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
/** Input: local key and optional value. Output: best-effort draft storage.
 * What this function does: removes null values and avoids crashing when storage is unavailable.
 */
const store = (key: string, value: string | null) => {
  try {
    value === null
      ? localStorage.removeItem(key)
      : localStorage.setItem(key, value);
  } catch {}
};
// Scope local keys so sign-out clears this app's drafts, not unrelated browser data.
const PREFIX = "pi-learning:";
// Persist before network delivery; retries must reuse both IDs and the exact text.
type Pending = { sessionId: string; requestId: string; text: string };
/** Input: stored pending JSON. Output: pending delivery or undefined.
 * What this function does: recovers a reload-interrupted send without inventing a new retry key.
 */
function pending(): Pending | undefined {
  try {
    return JSON.parse(readStored(PREFIX + "pending") ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}
// Stable session links, Shortcut handoffs and Access resume parameters all select the same durable session.
const initialId =
  location.pathname.match(/^\/(?:sessions|learn)\/([\w-]+)$/)?.[1] ??
  new URLSearchParams(location.search).get("session") ??
  new URLSearchParams(location.search).get("resume") ??
  pending()?.sessionId ??
  "";
/** Input: model/user text. Output: memoized, escaped Markdown DOM.
 * What this function does: adds code-copy behavior only to renderer-owned markup; raw model HTML stays escaped.
 */
const Markdown = memo(({ text }: { text: string }) => (
  <div
    className="markdown"
    onClick={
      /** Input: rendered Markdown click. Output: clipboard write and button feedback.
       * What this function does: recognizes only renderer-owned copy buttons and copies visible code text.
       */ (event) => {
        const button = (event.target as HTMLElement).closest(
          "[data-copy-code]",
        );
        if (button) {
          const code =
            button.closest(".code-block")?.querySelector("code")?.textContent ??
            "";
          void navigator.clipboard
            .writeText(code)
            .then(() => {
              button.textContent = "Copied";
            })
            .catch(() => {
              button.textContent = "Copy failed";
            });
        }
      }
    }
    dangerouslySetInnerHTML={{ __html: renderTutorMarkdown(text) }}
  />
));

/** Input: browser URL and device drafts. Output: the learning workspace React tree.
 * What this function does: coordinates Library navigation, HTTP snapshots, invalidation sockets and durable sends.
 */
function App() {
  // State values cause re-renders; refs below keep mutable connection/scroll state without re-rendering.
  const [id, setId] = useState(initialId);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>();
  const [items, setItems] = useState<DirectoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState<number>();
  const [drawer, setDrawer] = useState(false);
  const [details, setDetails] = useState(false);
  const [draft, setDraft] = useState(
    readStored(PREFIX + "draft:" + initialId) ?? "",
  );
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("");
  const [source, setSource] = useState<Source>();
  const [prefs, setPrefs] = useState<{ text: string; recall: boolean }>();
  const [older, setOlder] = useState<SessionSnapshot["messages"]>([]);
  const [olderActivity, setOlderActivity] = useState<
    NonNullable<SessionSnapshot["activity"]>
  >([]);
  const [cursor, setCursor] = useState<string>();
  const bottom = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const active = useRef(id);
  active.current = id;
  const composing = useRef(false);
  const loadedId = useRef("");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /** Input: append flag and page offset. Output: updated directory view.
   * What this function does: fetches literal search/archive results and stores their continuation offset.
   */
  async function loadLibrary(append = false, next = 0) {
    try {
      const page = await api<{ items: DirectoryItem[]; nextOffset?: number }>(
        `/api/sessions?q=${encodeURIComponent(query)}&archived=${archived}&offset=${next}`,
      );
      setItems((old) => (append ? [...old, ...page.items] : page.items));
      setOffset(page.nextOffset);
    } catch (e) {
      setError(String(e));
    }
  }
  /** Input: target session ID. Output: updated current snapshot.
   * What this function does: ignores stale responses after navigation and scrolls only when already near the bottom.
   */
  async function refresh(target = id) {
    if (!target) return;
    try {
      const value = await api<SessionSnapshot>(`/api/sessions/${target}`);
      if (active.current === target) {
        setSnapshot(value);
        if (loadedId.current !== target) {
          loadedId.current = target;
          setCursor(value.nextCursor);
        }
        if (nearBottom.current)
          requestAnimationFrame(() =>
            bottom.current?.scrollIntoView({ block: "end" }),
          );
      }
    } catch (e) {
      if (active.current === target) setError(String(e));
    }
  }
  /** Input: next session ID and whether to retain the previous draft. Output: selected view and URL.
   * What this function does: resets pagination without deleting server state; confirmed deletion skips draft retention.
   */
  function select(next: string, retainDraft = true) {
    if (retainDraft) store(PREFIX + "draft:" + id, draft);
    active.current = next;
    setId(next);
    setSnapshot(undefined);
    setOlder([]);
    setOlderActivity([]);
    setCursor(undefined);
    loadedId.current = "";
    setDraft(readStored(PREFIX + "draft:" + next) ?? "");
    setError("");
    setDrawer(false);
    history.pushState({}, "", next ? `/sessions/${next}` : "/chat");
    nearBottom.current = true;
  }
  /** Input: Delete button for the selected saved session. Output: confirmed deletion or a retryable error.
   * What this function does: uses the existing owner-checked purge, clears only matching device data,
   * and avoids closing another workspace if the user navigates while the request is in flight.
   */
  async function deleteSession() {
    if (!id || !snapshot || sending || deleting) return;
    if (
      !confirm(
        "Permanently delete this learning session, including its conversation, sources, notes, activity and historical copies? This cannot be undone.",
      )
    )
      return;
    const target = id;
    setDeleting(true);
    setError("");
    try {
      await api(`/api/sessions/${target}`, { method: "DELETE" });
      store(PREFIX + "draft:" + target, null);
      if (pending()?.sessionId === target) store(PREFIX + "pending", null);
      setItems((old) => old.filter((item) => item.id !== target));
      if (active.current === target) {
        setDetails(false);
        setSource(undefined);
        select("", false);
      }
      await loadLibrary();
    } catch (e) {
      setError(
        `Could not confirm deletion. Retry Delete to finish cleanup. ${String(e)}`,
      );
    } finally {
      setDeleting(false);
    }
  }
  /** Input: query/archive changes. Output: debounced Library refresh.
   * What this function does: cancels the pending timer when filters change again.
   */
  useEffect(() => {
    const timer = setTimeout(() => void loadLibrary(), 200);
    return () => clearTimeout(timer);
  }, [query, archived]);
  /** Input: browser history events. Output: restored selected session.
   * What this function does: installs/removes the popstate listener.
   */
  useEffect(() => {
    const pop = () =>
      select(location.pathname.match(/^\/sessions\/([\w-]+)$/)?.[1] ?? "");
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  /** Input: draft/session changes. Output: device-local draft.
   * What this function does: persists text independently of server message submission.
   */
  useEffect(() => {
    store(PREFIX + "draft:" + id, draft);
  }, [draft, id]);
  /** Input: selected session. Output: reconnecting invalidation subscription.
   * What this function does: fetches snapshots, backs off reconnects and cleans up listeners/timers on navigation.
   */
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout>;
    let delay = 1000;
    /** Input: invalidation/focus event. Output: one scheduled snapshot fetch.
     * What this function does: coalesces bursts into a 350 ms refresh window.
     */
    const scheduleRefresh = () => {
      if (refreshTimer.current) return;
      /** Input: elapsed refresh debounce. Output: a fresh snapshot request.
       * What this function does: clears the timer slot before fetching so later invalidations can schedule again.
       */
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = undefined;
        void refresh(id);
      }, 350);
    };
    /** Input: current session URL. Output: new browser WebSocket.
     * What this function does: retries closes with capped backoff; socket payloads never replace canonical snapshots.
     */
    const connect = () => {
      setConnection("Connecting…");
      scheduleRefresh();
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/sessions/${id}/socket`,
      );
      /** Input: successful socket handshake. Output: reset backoff and refreshed view.
       * What this function does: marks the connection saved without claiming queued model work is complete.
       */
      socket.onopen = () => {
        delay = 1000;
        setConnection("Saved");
        scheduleRefresh();
      };
      socket.onmessage = scheduleRefresh;
      /** Input: socket close. Output: delayed reconnect unless navigation disposed the effect.
       * What this function does: doubles delay up to 15 seconds without resubmitting user input.
       */
      socket.onclose = () => {
        if (!stopped) {
          setConnection("Reconnecting…");
          retry = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 15000);
        }
      };
      socket.onerror = () => socket?.close();
    };
    void refresh(id);
    connect();
    /** Input: window focus. Output: refreshed conversation and Library.
     * What this function does: catches updates missed while the phone backgrounded the page.
     */
    const focus = () => {
      scheduleRefresh();
      void loadLibrary();
    };
    window.addEventListener("focus", focus);
    /** Input: effect disposal. Output: closed socket and cancelled timers/listener.
     * What this function does: prevents an old session from reconnecting after navigation.
     */
    return () => {
      stopped = true;
      socket?.close();
      clearTimeout(retry);
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = undefined;
      }
      window.removeEventListener("focus", focus);
    };
  }, [id]);
  /** Input: saved Pending record. Output: acknowledged send or retryable UI error.
   * What this function does: creates/reuses state, submits with the stable key and clears only the acknowledged pending record.
   */
  async function deliver(work: Pending) {
    setSending(true);
    setError("");
    try {
      await post("/api/sessions", { id: work.sessionId, text: work.text });
      await post(`/api/sessions/${work.sessionId}/messages`, {
        text: work.text,
        requestId: work.requestId,
      });
      if (pending()?.requestId === work.requestId)
        store(PREFIX + "pending", null);
      setDraft("");
      store(PREFIX + "draft:" + work.sessionId, null);
      if (active.current !== work.sessionId) select(work.sessionId);
      await refresh(work.sessionId);
      await loadLibrary();
    } catch (e) {
      setError(`${String(e)} Your message is saved on this device. Use Retry.`);
    } finally {
      setSending(false);
    }
  }
  /** Input: composer draft. Output: persisted pending delivery.
   * What this function does: prevents overlapping unsaved sends and stores IDs before making network requests.
   */
  async function send() {
    if (!draft.trim() || sending || deleting) return;
    const existing = pending();
    if (existing) {
      setError("Retry the pending message before sending another.");
      return;
    }
    const work = {
      sessionId: id || crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      text: draft.trim(),
    };
    store(PREFIX + "pending", JSON.stringify(work));
    if (!id) select(work.sessionId);
    await deliver(work);
  }
  /** Input: initial URL and pending device state. Output: resumed page or handoff submission.
   * What this function does: consumes temporary KV once, recovers retained input after ambiguity and reuses handoff request IDs.
   */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const visual = params.get("resume_visual");
    if (visual && /^[a-zA-Z0-9_-]{8,100}$/.test(visual)) {
      const artifact = params.get("resume_artifact");
      location.replace(
        `/visual/${visual}${artifact && /^visual:[\w-]{1,150}$/.test(artifact) ? "?artifact=" + encodeURIComponent(artifact) : ""}`,
      );
      return;
    }
    if (params.has("resume") && /^[a-zA-Z0-9_-]{8,100}$/.test(initialId))
      history.replaceState({}, "", `/sessions/${initialId}`);
    const handoff = params.get("session");
    if (handoff) {
      void api<{ text: string }>(`/chat/session/${handoff}`)
        .then(
          /** Input: consumed handoff text. Output: stable-key pending delivery.
           * What this function does: persists before sending and replaces the temporary URL with a session link.
           */ ({ text }) => {
            const work = {
              sessionId: handoff,
              requestId: `handoff:${handoff}`,
              text,
            };
            store(PREFIX + "pending", JSON.stringify(work));
            history.replaceState({}, "", `/sessions/${handoff}`);
            return deliver(work);
          },
        )
        .catch(
          /** Input: ambiguous/expired handoff delivery. Output: restored snapshot or recovered input send.
           * What this function does: checks committed history before retrying the retained source with the same key.
           */ async () => {
            history.replaceState({}, "", `/sessions/${handoff}`);
            try {
              const saved = await api<SessionSnapshot>(
                `/api/sessions/${handoff}`,
              );
              if (!saved.messages.length && !saved.busy) {
                const input = await api<Source>(
                  `/api/sessions/${handoff}/sources/shared-input`,
                );
                const work = {
                  sessionId: handoff,
                  requestId: `handoff:${handoff}`,
                  text: input.content,
                };
                store(PREFIX + "pending", JSON.stringify(work));
                await deliver(work);
              } else await refresh(handoff);
            } catch (e) {
              setError(String(e));
            }
          },
        );
    } else {
      const work = pending();
      if (work) void deliver(work);
    }
  }, []);
  /** Input: title/pin/archive patch. Output: refreshed snapshot and Library.
   * What this function does: leaves field validation and persistence to the Worker/session.
   */
  async function mutate(patch: unknown) {
    try {
      await api(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await refresh();
      await loadLibrary();
    } catch (e) {
      setError(String(e));
    }
  }
  /** Input: answer entry ID. Output: optional saved evidence-linked note.
   * What this function does: prompts for text and lets the server verify the referenced entry.
   */
  async function saveNote(entryId: string) {
    const text = prompt("Save a learning note linked to this answer:");
    if (text?.trim())
      try {
        await post(`/api/sessions/${id}/notes`, { text, entryId });
        await refresh();
      } catch (e) {
        setError(String(e));
      }
  }
  /** Input: Import previous sessions button. Output: refreshed Library and import summary.
   * What this function does: pages discoverable KV records; opaque legacy objects require the operator migration script.
   */
  async function importLegacy() {
    setError("");
    try {
      let cursor: string | undefined;
      let count = 0;
      const failures: string[] = [];
      do {
        const page = await post<{
          results: { id: string; status: string }[];
          cursor?: string;
        }>("/api/migrate", { cursor });
        count += page.results.filter((r) => r.status === "imported").length;
        failures.push(
          ...page.results
            .filter((r) => r.status !== "imported")
            .map((r) => r.id),
        );
        cursor = page.cursor;
      } while (cursor);
      await loadLibrary();
      alert(
        `${count} repository sessions imported. ${failures.length} need review. Original storage is retained; histories without a discoverable ID require manual recovery.`,
      );
    } catch (e) {
      setError(String(e));
    }
  }
  const messages = [...older, ...(snapshot?.messages ?? [])].filter(
    (message, index, all) =>
      all.findIndex((m) => m.id === message.id) === index,
  );
  // Latest snapshots override paged copies; entry IDs tie activity to the correct input, including queued turns.
  const activityByEntry = new Map(
    [...olderActivity, ...(snapshot?.activity ?? [])]
      .filter((turn) => turn.entryId)
      .map((turn) => [turn.entryId!, turn]),
  );
  return (
    <div className="workspace">
      {drawer && (
        <button
          className="backdrop"
          aria-label="Close library"
          onClick={() => setDrawer(false)}
        />
      )}
      {/* Library navigation changes selection; New learning never deletes another session. */}
      <aside className={drawer ? "library open" : "library"}>
        <div className="brand">
          Learning workspace <span>Pi Durable</span>
        </div>
        <button className="primary" onClick={() => select("")}>
          ＋ New learning
        </button>
        <input
          aria-label="Search learning library"
          placeholder="Search your learning…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="muted">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{" "}
          Archived sessions
        </label>
        <nav>
          {items.map((item) => (
            <button
              className={id === item.id ? "session active" : "session"}
              key={item.id}
              onClick={() => select(item.id)}
            >
              <strong>
                {item.pinned ? "★ " : ""}
                {item.title}
              </strong>
              <small>
                {item.type}
                {item.private ? " · Private" : ""} ·{" "}
                {new Date(item.updatedAt).toLocaleDateString()}
              </small>
            </button>
          ))}
        </nav>
        {offset !== undefined && (
          <button onClick={() => void loadLibrary(true, offset)}>
            More sessions
          </button>
        )}
        <footer>
          <button onClick={() => void importLegacy()}>
            Import previous sessions
          </button>
          <button
            onClick={() =>
              void api<{ text: string; recall: number }>("/api/preferences")
                .then((p) =>
                  setPrefs({ text: p.text, recall: Boolean(p.recall) }),
                )
                .catch((e) => setError(String(e)))
            }
          >
            Learning preferences
          </button>
          <button
            onClick={
              /** Input: sign-out click. Output: cleared app drafts and Access logout.
               * What this function does: clears only this app's localStorage prefix before leaving the page.
               */ () => {
                for (const key of Object.keys(localStorage))
                  if (key.startsWith(PREFIX)) localStorage.removeItem(key);
                location.href = "/cdn-cgi/access/logout";
              }
            }
          >
            Sign out & clear device drafts
          </button>
        </footer>
      </aside>
      <main>
        <header>
          <button
            className="mobile"
            onClick={() => setDrawer(true)}
            aria-label="Open library"
          >
            ☰
          </button>
          <div>
            <h1>
              {snapshot?.metadata.title ?? "What would you like to learn?"}
            </h1>
            <small>
              {snapshot?.busy
                ? "Working — safe to leave this page"
                : id
                  ? connection
                  : "Your learning stays here"}
            </small>
          </div>
          {id && (
            <>
              <button onClick={() => setDetails(!details)}>
                Sources & notes
              </button>
              <button
                className="danger delete-session"
                aria-label="Delete session"
                title="Permanently delete this learning session"
                disabled={!snapshot || sending || deleting}
                onClick={() => void deleteSession()}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </>
          )}
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
            {pending() && (
              <button
                disabled={sending || deleting}
                onClick={() => void deliver(pending()!)}
              >
                Retry
              </button>
            )}
          </div>
        )}
        {snapshot?.error && <div className="error">{snapshot.error}</div>}
        {/* Visible committed messages, partial generation and explicit approval controls. */}
        <div
          className="conversation"
          onScroll={
            /** Input: conversation scroll event. Output: near-bottom ref.
             * What this function does: preserves the learner's reading position while new answers arrive.
             */ (e) => {
              const el = e.currentTarget;
              nearBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 160;
            }
          }
        >
          {cursor && (
            <button
              onClick={() =>
                void api<SessionSnapshot>(
                  `/api/sessions/${id}?cursor=${encodeURIComponent(cursor)}`,
                )
                  .then(
                    /** Input: earlier history page. Output: prepended messages and next cursor.
                     * What this function does: pages retained entries without replacing the live recent snapshot.
                     */ (page) => {
                      setOlder((old) => [...page.messages, ...old]);
                      setOlderActivity((old) => [
                        ...(page.activity ?? []),
                        ...old,
                      ]);
                      setCursor(page.nextCursor);
                    },
                  )
                  .catch((e) => setError(String(e)))
              }
            >
              Load earlier messages
            </button>
          )}
          {!messages.length && !snapshot?.busy && (
            <section className="welcome">
              <h2>A place for things that click.</h2>
              <p>
                Paste an article, share a repository, or ask a question. Revisit
                the conversation whenever you need it.
              </p>
            </section>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <div className="message-label">
                {message.role === "user" ? "You" : "Learning assistant"}
              </div>
              <Markdown text={message.content} />
              {message.role === "user" && (
                <TurnActivityPanel activity={activityByEntry.get(message.id)} />
              )}
              <div className="message-actions">
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(message.content)
                      .catch((e) => setError(String(e)))
                  }
                >
                  Copy
                </button>
                {message.role === "assistant" && (
                  <button onClick={() => void saveNote(message.id)}>
                    Save note
                  </button>
                )}
              </div>
            </article>
          ))}
          {snapshot?.activity
            ?.filter(
              (turn) =>
                !turn.entryId ||
                !messages.some((message) => message.id === turn.entryId),
            )
            .map((turn) => (
              <TurnActivityPanel key={turn.id} activity={turn} />
            ))}
          {snapshot?.partial && (
            <article className="message assistant">
              <div className="message-label">Learning assistant · writing</div>
              <Markdown text={snapshot.partial} />
            </article>
          )}
          {snapshot?.busy && !snapshot.partial && (
            <p className="working" role="status">
              Reading, thinking, or using tools…
            </p>
          )}
          {snapshot?.metadata.visual && (
            <a
              className="artifact"
              href={`/visual/${id}`}
              target="_blank"
              rel="noreferrer"
            >
              Open saved visual explainer ↗
            </a>
          )}
          {snapshot?.approvals.map((approval) => (
            <section className="approval" key={approval.id}>
              <h3>GitHub action · {approval.status}</h3>
              <pre>{JSON.stringify(approval.args, null, 2)}</pre>
              {approval.status === "pending" ? (
                <>
                  <button
                    onClick={() =>
                      void post(
                        `/api/sessions/${id}/approvals/${approval.id}`,
                        { accept: true },
                      )
                        .then(() => refresh())
                        .catch((e) => setError(String(e)))
                    }
                  >
                    Approve this exact action
                  </button>
                  <button
                    onClick={() =>
                      void post(
                        `/api/sessions/${id}/approvals/${approval.id}`,
                        { accept: false },
                      ).then(() => refresh())
                    }
                  >
                    Reject
                  </button>
                </>
              ) : (
                <pre>{JSON.stringify(approval.result, null, 2)}</pre>
              )}
            </section>
          ))}
          <div ref={bottom} />
        </div>
        {/* Sticky composer and editable presets; pending sends survive reload. */}
        <section className="composer">
          <div className="presets">
            {[
              [
                "Explain simply",
                "Explain the main idea in plain English with a small example.",
              ],
              ...REPOSITORY_STARTER_PROMPTS.slice(0, 3),
              ["What I learned · post draft", LEARNING_RECAP_PROMPT],
            ].map(([label, text]) => (
              <button key={label} onClick={() => setDraft(text)}>
                {label}
              </button>
            ))}
          </div>
          <form
            onSubmit={
              /** Input: form submit. Output: durable-send workflow.
               * What this function does: prevents page navigation and delegates draft validation to send.
               */ (e) => {
                e.preventDefault();
                void send();
              }
            }
          >
            <textarea
              aria-label="Question"
              placeholder="Ask a question or paste a source…"
              value={draft}
              maxLength={30000}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={
                /** Input: keyboard event. Output: optional submit.
                 * What this function does: accepts Ctrl/Command+Enter but avoids sending during text composition.
                 */ (e) => {
                  if (
                    e.key === "Enter" &&
                    (e.metaKey || e.ctrlKey) &&
                    !composing.current
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }
              }
            />
            <button
              className="primary"
              disabled={!draft.trim() || sending || deleting}
              type="submit"
            >
              {sending ? "Saving…" : snapshot?.busy ? "Queue" : "Send"}
            </button>
            {snapshot?.busy && (
              <button
                type="button"
                onClick={() =>
                  void post(`/api/sessions/${id}/stop`, {}).then(() =>
                    refresh(),
                  )
                }
              >
                Stop
              </button>
            )}
          </form>
          <small>
            Saved sessions do not expire. Post drafts are never published
            automatically.
          </small>
        </section>
      </main>
      {/* Session administration is separate from the readable conversation. */}
      {details && snapshot && (
        <aside className="details">
          <button onClick={() => setDetails(false)}>Close</button>
          <h2>Session</h2>
          <p>
            {snapshot.metadata.private
              ? "Private sources — keep identifying details out of public drafts."
              : "Sources and answers stay with this session."}
          </p>
          <button
            onClick={
              /** Input: rename click. Output: optional title patch.
               * What this function does: prompts with the current title and leaves validation to the server.
               */ () => {
                const title = prompt("Session title", snapshot.metadata.title);
                if (title) void mutate({ title });
              }
            }
          >
            Rename
          </button>
          <button
            onClick={() => void mutate({ pinned: !snapshot.metadata.pinned })}
          >
            {snapshot.metadata.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            onClick={() =>
              void mutate({ archived: !snapshot.metadata.archived })
            }
          >
            {snapshot.metadata.archived ? "Unarchive" : "Archive"}
          </button>
          <a href={`/api/sessions/${id}/export`}>Export complete session</a>
          <h3>Sources ({snapshot.sources.length})</h3>
          {snapshot.sources.map((s) => (
            <button
              className="source"
              key={s.id}
              onClick={() =>
                void api<Source>(
                  `/api/sessions/${id}/sources/${encodeURIComponent(s.id)}`,
                )
                  .then(setSource)
                  .catch((e) => setError(String(e)))
              }
            >
              {s.title}
            </button>
          ))}
          <h3>Learning notes</h3>
          {snapshot.notes.map((note) => (
            <section key={note.id}>
              <p>{note.text}</p>
              <small>Evidence: message {note.entryId}</small>
              <button
                onClick={
                  /** Input: edit-note click. Output: note update with unchanged evidence link.
                   * What this function does: reuses the note ID instead of creating an unrelated duplicate.
                   */ () => {
                    const text = prompt("Edit note", note.text);
                    if (text)
                      void post(`/api/sessions/${id}/notes`, {
                        id: note.id,
                        entryId: note.entryId,
                        text,
                      }).then(() => refresh());
                  }
                }
              >
                Edit
              </button>
              <button
                onClick={() =>
                  void api(`/api/sessions/${id}/notes/${note.id}`, {
                    method: "DELETE",
                  }).then(() => refresh())
                }
              >
                Remove
              </button>
            </section>
          ))}
          <button
            className="danger"
            disabled={sending || deleting}
            onClick={() => void deleteSession()}
          >
            {deleting ? "Deleting…" : "Permanently delete"}
          </button>
        </aside>
      )}
      {source && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="Saved source"
        >
          <section>
            <button onClick={() => setSource(undefined)}>Close</button>
            <h2>{source.title}</h2>
            <p>
              Retrieved {source.createdAt} · SHA-256 {source.hash}
            </p>
            <pre>{source.content}</pre>
          </section>
        </div>
      )}
      {prefs && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="Learning preferences"
        >
          <section>
            <h2>Learning preferences</h2>
            <textarea
              aria-label="Teaching preferences"
              value={prefs.text}
              onChange={(e) => setPrefs({ ...prefs, text: e.target.value })}
              placeholder="For example: explain unfamiliar TypeScript syntax and use small examples."
            />
            <label>
              <input
                type="checkbox"
                checked={prefs.recall}
                onChange={(e) =>
                  setPrefs({ ...prefs, recall: e.target.checked })
                }
              />{" "}
              Allow requested cross-session recall of saved public notes
            </label>
            <p>
              Private-session notes are excluded. The assistant does not infer
              mastery or retrain itself.
            </p>
            <button
              onClick={() =>
                void api("/api/preferences", {
                  method: "PUT",
                  body: JSON.stringify(prefs),
                })
                  .then(() => setPrefs(undefined))
                  .catch((e) => setError(String(e)))
              }
            >
              Save
            </button>
            <button onClick={() => setPrefs(undefined)}>Cancel</button>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
