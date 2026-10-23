# Stable iPhone Shortcut contracts

The Pi Durable migration keeps the production origin **https://iphoneai.oskarcode.com**.
Keep existing `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers. No Shortcut
changes or additional account flow are required.

| Endpoint | Request | Existing consumed response |
|---|---|---|
| `POST /v1/correct` | JSON `{ "text": "…" }` | `{ "corrected_text": "…" }` |
| `POST /v1/ask` — ordinary question | JSON `{ "text": "…" }` | `answer`, `route` |
| `POST /v1/ask` — repository | same | HTTP 202: `route`, `status`, `learning_url`, `expires_in_seconds` |
| `POST /v1/ask` — visual | same | `route`, `status`, `visual_url`, `expires_in_seconds` |
| `POST /handoff` | JSON `{ "text": "…" }` | `chat_url`, `expires_in_seconds: 600` |
| `POST /v1/chat-session` | same | Same behavior as `/handoff` |
| `GET /chat/session/:id` | browser handoff consumption | `{ "text": "…" }`; repeat consumption returns 404 |

Grammar retains whitespace-preserving validation, the 30,000 UTF-16-code-unit text
limit, bounded request bodies and explicit no-thinking configuration. It does not
create a session, call Pi/Jev, or use tools.

The browser handoff still returns `/chat?session=<id>`. The new browser consumes
the text and submits automatically, then uses `/sessions/<id>` for persistent
navigation. The ten-minute handoff envelope remains temporary; the underlying
learning session and shared input no longer expire.

`/learn/:id`, `/learn/:id/status`, `/learn/:id/events`, `/learn/:id/chat`,
`/visual/:id`, `/chat/api`, `/chat/stream`, and
`DELETE /v1/learning-sessions/:id` remain accepted. The main browser now uses the
session API instead of maintaining separate volatile general/repository histories.

The visual response's existing `expires_in_seconds` field is retained for old
clients. Newly saved visuals actually remain in session storage until deletion.
Returned visual links may carry an `artifact` query parameter so later diagrams
in the same session cannot overwrite an earlier link. Treat `visual_url` as an
opaque URL as before; the `/visual/:id` endpoint remains available.
Previously expired visual content cannot be reconstructed.

The browser Library, saved sources/notes, explicit GitHub action approval and
persistent session URLs are additions; they do not require editing Shortcuts.
