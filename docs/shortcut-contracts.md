# Current iPhone Shortcut contracts

## Grammar correction (unchanged)

`POST /v1/correct` accepts JSON `{ "text": "…" }` and responds with `{ "corrected_text": "…" }`. This is stateless: no Pi, learning workspace or stored conversation.

## Quick explanation (on-screen result)

`POST /v1/ask` accepts JSON `{ "text": "…" }` (non-empty, at most 30,000 characters) and responds with `{ "answer": "…", "answer_markdown": "…" }`. The existing `answer` key remains readable plain text for the current Shortcut; `answer_markdown` has the same explanation with Markdown headings and a fenced `ts` code block, with a short comment on every code line. Technical explanations start in plain English, include a conceptual TypeScript model and beginner syntax explanation, and end with a traffic flow when one exists. Everyday terms remain prose without forced code. It does **not** create a workspace, call Pi or tools, read URLs, or save an answer. Pasted links should be opened in browser learning chat if the page needs to be read. Invalid input returns 400; model failure returns a redacted 502, not a fabricated answer.

To reuse the old explanation Shortcut shown in the screenshot:

1. Keep **Get Clipboard** and the existing Access headers; change its POST URL from `/handoff` to `https://iphoneai.oskarcode.com/v1/ask`. Keep the JSON body key `text` mapped to Clipboard.
2. In **Get Dictionary Value**, change the key from `chat_url` to `answer`.
3. Keep **Show Result** with `answer` if you want to reuse the existing Shortcut unchanged; it shows a plain-text code sketch with line comments. For styled code, change the dictionary key to `answer_markdown`, pass it through **Make Rich Text from Markdown**, then **Quick Look** at that Rich Text. It stays in the Shortcut sheet without opening a chat tab. Rich Text may render code as a block but does not guarantee editor-like syntax coloring.

The existing Access service token may be shared with grammar and other clients. Do not publish the header values, rotate them without updating every consumer, or remove the grammar audience. Before depending on the Shortcut, test it on the physical iPhone: the Worker validates signed Access identity, but only a real run confirms that the edge policy issues it for `/v1/ask`.

## Browser learning workspace

Open `/chat` and paste into **＋ New learning** or an existing workspace. The browser creates a session via `POST /api/sessions` and submits via `POST /api/sessions/:id/messages`; retry with the same session ID, request ID and text. Reopen `/sessions/:id` from Library. Pi can read web pages and repositories and create visual explainers; there is no Jev classification call.

The browser-opening handoff and old chat POST interfaces remain retired: `/handoff`, `/v1/chat-session`, `/chat/api`, `/chat/stream`, `/learn/:id/chat`, `/v1/learning-sessions/:id` and `/chat/session/:id` return 404. Historical workspace, review and visual GET links remain readable; the migration endpoints and stored records are not deleted. Issued temporary `/chat?session=…` links no longer deliver text.
