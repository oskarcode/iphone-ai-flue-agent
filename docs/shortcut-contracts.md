# Current iPhone contracts

## Grammar Shortcut (retained)

`POST /v1/correct` accepts JSON `{ "text": "…" }` and responds with `{ "corrected_text": "…" }`. Keep the current Cloudflare Access service credentials and signed-audience configuration: the grammar Shortcut may share them with other clients. Correction neither creates a session nor invokes the Pi tutor.

## Browser learning workspace

Open `/chat` and paste into **＋ New learning** or an existing workspace. The browser creates a session via `POST /api/sessions` and submits via `POST /api/sessions/:id/messages`; retry with the same session ID, request ID and text. Reopen `/sessions/:id` from Library. Pi chooses retrieval/repository/visual tools, without a Jev classification call.

The explanation/handoff Shortcut and old chat POST interfaces have been retired: `/v1/ask`, `/handoff`, `/v1/chat-session`, `/chat/api`, `/chat/stream`, `/learn/:id/chat`, `/v1/learning-sessions/:id` and `/chat/session/:id` return 404. Historical workspace, review and visual GET links remain readable; the migration endpoints and stored records are not deleted. Issued temporary `/chat?session=…` links no longer deliver text. Remove the installed explanation Shortcut manually.
