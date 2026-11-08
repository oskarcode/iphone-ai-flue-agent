# Personal Learning Workspace

An iPhone-first tutor for pasted text, questions, web pages and GitHub repositories. Open the browser workspace, start **＋ New learning** or continue an existing session, and reopen conversations from Library. Pi Durable retains history, sources and notes in SQLite-backed Durable Objects. The grammar and quick-explanation Shortcuts are separate stateless Workers AI paths.

## What It Does

- Keeps non-expiring learning sessions in a searchable Library; starting a new session does not delete the old one.
- Explains concepts, researches public pages and tutors directly from commit-pinned repository files, including authorized private repositories.
- Retains source text, retrieval timestamps, hashes and independently addressable visual artifacts.
- Renders escaped Markdown, copyable code and scrollable tables on phones.
- Shows a collapsible **Agent activity** panel for each turn: queued/running/completed status, tool activity, retries and context summarization. Recorded progress survives reloads; raw reasoning, tool payloads and provider errors are never sent to this panel. New messages go directly to Pi, which chooses its own tools; historical Jev routing labels remain readable on old activity.
- Keeps the workspace focused on conversation: no Sources & notes panel or Save note buttons. Only rename and pin/unpin live in the compact **⋯ Session options** menu; Delete stays in the header. Archive and session-export controls are removed. The Library includes all saved sessions, including previously archived ones, without changing their retained data.
- Applies a saved learner profile tailored to a Python/FastAPI/Django developer learning TypeScript, Cloudflare developer products and agent harnesses. The obsolete note-recall checkbox and import control are removed; historical APIs and saved source evidence remain. Legacy recall requests are disabled.
- Creates reviewable social-post drafts with an illustrative TypeScript mental model. Nothing publishes automatically.
- Requires explicit server-side approval before GitHub issue creation or a branch-only file change.
- Keeps grammar correction on `/v1/correct` and offers stateless, on-screen explanations on `/v1/ask`: plain English, a small fenced TypeScript mental model with line-by-line comments for technical concepts, and a traffic flow when meaningful. The existing `answer` key remains plain text for Show Result; for a styled code block on iPhone, convert the additive `answer_markdown` field with Shortcuts **Make Rich Text from Markdown** before **Quick Look**. The browser-opening handoff and old chat POST APIs remain retired. See [Shortcut setup and contracts](docs/shortcut-contracts.md).

## Learning coach

Use `/learning-coach` **from any learning session** to ask about earlier questions, possible misunderstandings or a study plan. The command loads a reusable skill and launches an idempotent Pi Durable child conversation owned by that tool call. Its **read-only, owner-checked tools** list retained sessions and page through committed visible messages across separate Durable Objects, including private sessions on this explicit request. Long messages can be read in chunks. Deleted sessions, partial generations, tools and reasoning are not available. Give session/message citations for observations; distinguish inferences and suggested questions from what the learner actually asked. The coach runs only when requested—not in a background model loop—and never receives write tools.

The child's evidence and final reply are saved in the session where you ask. **If you later delete a cited source session, that earlier answer in another session remains**; it is not retroactively removed from unrelated sessions. The former Learning coach tab is gone. Ordinary turns no longer project text into the old coach index. The existing `LearningCoach` Durable Object and its authenticated legacy endpoints remain for compatibility and previously stored data; only calls to those endpoints refresh its projection. New coaching questions use the skill/subagent path. Learning preferences remain in Settings.

## Skills, Computer and Settings

The composer loads saved `/skill-command` buttons, rather than hardcoded prompt text. Select one, add your question/source, and send; selection does not submit automatically or discard your question. The tutor reads the saved instructions before applying them. Starter skills include explain-simply, high-level-purpose, architecture-map, learning-post, learning-coach, learning-gadget, feature-bug-tracker and technical-blog-content. Use `/feature-bug-tracker` to log an idea or bug, review items, or update an item by ID. Entries live in the persistent `/workspace/feature-bug-tracker.md` ledger, not a chat session; writes run without a second approval and use revision checks to prevent lost edits. Commands refresh after confirmed changes and periodically while the page is visible.

After learning a topic in a session, send `/technical-blog-content Draft a technical article from what we learned here, with a portfolio content handoff.` or select **Technical blog content** in the composer. The command can read this session's retained notes and source evidence without rescanning a repository or automatically reading other sessions. It returns a complete Markdown article with diagrams where supported, plus a content handoff (audience, title, slug, excerpt, tags, verified links, caveats and evidence). Each successful draft replaces the ONE shared Computer file at `/workspace/blog-drafts/current.md` with a revision check; older file contents are not retained here. The private portfolio agent can read that file through a named Worker-to-Worker service binding by asking it to use the current learning draft. Nothing is published automatically; the portfolio agent handles later styling and publication. Drafts from private material must be reviewed before sharing outside the learning workspace.

For a working interactive teaching tool, use `/learning-gadget Build a ...` in the lesson where you want it. The tutor creates a session-owned, SQLite-backed server-rendered gadget, runs form-action preflight tests and shows **Open gadget** in the chat. Actions persist across reloads; multiple gadgets can belong to a session, with no cross-session gadget library. Gadgets are separate from static visual explainers and the shared Computer. The Access-protected gadget page uses no browser scripts, disables network and unsafe embeds, and accepts only owner-checked same-origin forms. Permanently deleting a session deletes its gadgets and state. Failed preflight leaves no gadget. The experimental Worker Loader/Facet runtime is required.

Ask the assistant to create, update or remove a skill. It performs the revision-checked change immediately and notifies you when confirmed, without a second approval. **Settings** also offers a direct skill editor, Computer file viewer and shell command runner, plus learning preferences, clear-device-drafts and sign-out. Unsaved chat drafts survive switching tabs.

`LearningSkills` is a separate owner-scoped Durable Object using pinned **Cloudflare Computer 0.5.1 (preview)**. Its SQLite-backed filesystem stores `/workspace/skills/<slug>/SKILL.md`; a one-time seed never recreates deleted defaults. Files use JSON-compatible YAML frontmatter for name/description and a Markdown body. Skill edits check a SHA-256 revision to prevent stale overwrites. Tracker file writes use the optional revision check; existing Computer file-write callers remain compatible. Session deletion does not remove shared skills or Computer files. Mutation receipts remain for retry safety; skill deletion removes its active files/command, not historical conversation references or operation receipts.

**Execution is enabled**, including the worker-shell's file tools, curl/network access, jq and HTML conversion, plus a separate isolated JavaScript module backend with persistent filesystem access. JavaScript uses `export default async function () { ... }`, not the `node` CLI. This is not a full Linux VM or a Docker container; npm/native binaries are not provided by this backend. Dynamic Workers use `SKILL_LOADER`, `WorkspaceServiceProxy` and the experimental compatibility flag. No application credentials are passed to the shell. Agent-originated skill saves/deletions and Computer file writes run immediately and produce durable, compact notifications; they do not need a second approval. File/directory deletion, shell/JavaScript execution and GitHub writes still require exact UI approval. Commands run with a 30-second timeout and bounded output. Interrupted operations are not blindly repeated; direct Settings command execution still asks for confirmation.

The preview SDK and experimental Worker Loader are deliberate demo dependencies. The existing `v5-learning-computer` migration and earlier migrations stay unchanged. Access configuration and the grammar Shortcut contract are retained. Dependency overrides patch transitive Undici and test-plugin Zod security issues.

## How It Works

```text
Browser workspace / grammar or quick-explanation Shortcut
  -> Access identity verification + Hono routes
  -> LearningSession Durable Object for one session ID
       Pi SQLite entries, submissions and recoverable tasks
       sources, notes, metadata and durable action receipts
  -> Workers AI through AI Gateway -> bounded web / GitHub tools
  -> committed snapshot -> browser explanation

LearningSession -> session-owned gadget registry -> isolated Worker Loader Facets + SQLite state
LearningSession -> LearningSkills Computer -> durable skill files + approved worker-shell
/learning-coach -> task-owned Pi Durable child -> owner-checked Library + live LearningSession reads
LearningSession -> retryable projection -> LearningLibrary -> search / reopen
POST /v1/correct -> Workers AI directly -> corrected_text (no Pi/session writes)
POST /v1/ask -> Workers AI directly -> answer (no Pi/session writes)
```

The browser holds drafts and one retryable pending send, not canonical history. WebSockets notify it that something changed; authorized HTTP snapshots supply the visible messages. A persisted alarm can resume unfinished server work after the browser closes or the object is evicted.

Pi event batches update a bounded operational journal (latest 80 steps per input submission). WebSocket invalidations refresh it alongside the answer; reconnects recover it from authorized snapshots. Earlier turns without recorded events are labelled **Not recorded**, rather than inventing a trace. Session export includes the journal, and permanent deletion removes it.

The Library is a versioned projection, not a second authoritative transcript. Deletion tombstones prevent delayed updates or old links from resurrecting erased sessions. Historical Flue classes remain only as storage-reading/deletion adapters; no Flue execution package remains.

## Technology Stack

| Technology | Role |
|---|---|
| TypeScript, Node.js tooling | Shared contracts and local build/test tooling |
| React + Vite | Mobile workspace and bundled static assets |
| Hono + Cloudflare Workers | Session, grammar and quick-explanation APIs, historical read adapters, authentication and assets |
| Pi Durable / Pi AI / Chord 1.2.0 | Durable conversation execution and background task coordination |
| SQLite-backed Durable Objects | Canonical session state, rebuildable Library, shared Computer and owner-scoped learning coach |
| Cloudflare Computer 0.5.1 + Worker Loader | Persistent skill files and approved worker-shell execution |
| Workers KV | Retained historical records; no new learning handoff envelopes |
| Workers AI + AI Gateway | Tutor/visual inference, stateless grammar/quick explanations and workspace title generation |
| `jose` + Cloudflare Access | Signed JWT verification for browser/service callers |
| Valibot | Runtime validation of model tool arguments |
| Vitest + Cloudflare test plugin + Playwright | Pure, workerd persistence/recovery and mobile-browser checks |

R2, D1, Vectorize, Queues, Workflows and MCP servers are **not used**. The Browser Run binding remains configured for compatibility but current page retrieval uses bounded fetch and Workers AI conversion, not browser automation.

## Project Structure

| Path | Owns |
|---|---|
| `src/cloudflare.ts` | Worker entry and immutable Durable Object class exports |
| `src/app.ts` | Workspace, grammar and quick-explanation routes, Access admission, historical migration and export |
| `src/client/main.tsx`, `styles.css` | Library, composer, snapshots, reconnects and phone layout |
| `src/runtime/session.ts` | Canonical Pi/application state, recovery, immediate skill/file edits, gated approvals and deletion |
| `src/runtime/library.ts` | Search projection, preferences, note recall and tombstones |
| `src/runtime/skills.ts`, `src/lib/skills.ts` | Computer filesystem, revision-checked skills, mutation receipts and starter skills |
| `src/runtime/coach.ts`, `src/lib/coach.ts`, `src/client/coach.tsx` | Cross-session evidence projection and on-demand learning coach |
| `src/client/settings.tsx`, `api.ts` | Settings, skill editor, Computer explorer/runner and authenticated API helper |
| `src/runtime/harness.ts` | Models, teaching context and Pi tool adapters |
| `src/runtime/activity.ts`, `src/client/turn-activity.tsx` | Sanitized persistent per-turn progress and collapsible UI |
| `src/runtime/auth.ts`, `contracts.ts` | Verified identity and shared transport/data shapes |
| `src/runtime/legacy.ts`, `src/learning-archive.ts` | Historical storage access; not the active tutor runtime |
| `src/tools/` | Web retrieval and GitHub operations |
| `src/lib/`, `src/prompts.ts` | Rendering, prompts, grammar/visual normalization and compatibility helpers |
| `scripts/migrate-legacy.py` | Explicit operator inventory/import utility |
| `test/` | Validators, contracts, SQLite recovery and browser tests |
| `wrangler.jsonc` | Ingress, bindings, observability and immutable migration history |

`node_modules/`, `dist/`, `.wrangler/` and generated `worker-configuration.d.ts` are not source. Keep the lockfile and generated binding declarations needed by local checks; regenerate declarations with `npm run types` rather than editing them.

## APIs and Interfaces

All private interfaces require verified Access admission. Keep the existing Shortcut's `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers for both grammar and quick explanations; Access injects the signed identity consumed by the Worker. Do not revoke a shared credential without checking its other users.

| Interface | Input / result |
|---|---|
| `POST /v1/correct` | `{ "text": "She go yesterday." }` -> `{ "corrected_text": "She went yesterday." }` |
| `POST /v1/ask` | `{ "text": "Durable Object" }` -> `{ "answer": "plain text…", "answer_markdown": "formatted code…" }`; no session, tools or URL fetching |
| `GET /api/coach`, `POST /api/coach/questions` | Evidence-backed coach dashboard and on-demand teacher answers |
| `POST /api/coach/clear`, `/api/coach/resume` | Clear/pause and resume observation without restoring erased history |
| `GET /api/skills`, `/api/skills/:slug` | Shared command catalog and full skill instructions/revision |
| `GET /api/computer`, `/api/computer/file?path=...` | Bounded Computer file listing and preview |
| `POST /api/computer/actions` | Explicit skill/file/shell mutation with a stable `Idempotency-Key` |
| `GET /chat`, `/sessions/:id`, `/learn/:id` | Current browser workspace |
| `GET /api/sessions` | Literal search, archive filter and offset pagination |
| `POST /api/sessions` | `{ text, id? }` -> 201 `{ id, url }`; does not submit a model turn |
| `GET/PATCH/DELETE /api/sessions/:id` | Snapshot, title/pin/archive update, or permanent deletion |
| `POST /api/sessions/:id/messages` | `{ text, requestId }` -> 202 receipt; reuse both on retry |
| `GET /api/sessions/:id/socket` | WebSocket invalidations; messages still use HTTP |
| Sources, notes, approvals, stop, export | Session subroutes for retained evidence and explicit operations |
| `GET/PUT /api/preferences` | Teaching text and opt-in public-note recall |
| `GET /visual/:id?artifact=…` | Retained version-specific visual HTML; treat returned links as opaque URLs |
| Historical review/learning/visual GET links | Retained read-only compatibility, not the new browser transport |
| `POST /api/migrate`, `/api/migrate/object` | Authorized passive import; never replays historical tools |
| `GET /health` | Public framework/router status, not model/storage readiness |

Retired handoff and legacy chat POST routes (`/handoff`, `/v1/chat-session`, `/chat/api`, `/chat/stream`, `/learn/:id/chat`, `/v1/learning-sessions/:id`) and the handoff-consumption GET route (`/chat/session/:id`) now return 404. Old session, review and visual GET links remain; previously issued temporary `/chat?session=…` links no longer auto-submit.

Text admission is limited to 30,000 characters. Invalid bodies normally return 400, missing authentication 401, cross-origin writes 403, missing sessions 404 and uncaught dependency failures a redacted 502. Some validation inside a Durable Object currently reaches the generic 502 handler; do not assume every validation failure is 400.

## Run It Locally

Prerequisites: Node **22.19+ on the 22.x line or 24.11+**, npm and a Cloudflare account authorized for the configured remote AI services. Use the lockfile for reproducible installs.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run types
npm run dev

npm run check       # typecheck + pure tests + workerd tests + production build
npm audit
```

`DEV_AUTH=local` works only on localhost/127.0.0.1. Optional `GITHUB_TOKEN` enables private reads. Never commit actual environment values. Deterministic tests disable remote bindings; browser/real-model checks can incur inference costs.

For mobile browser tests against the built app:

```sh
npm run build
npx wrangler dev --config dist/iphone_ai_flue_agent/wrangler.json \
  --var DEV_AUTH:local --host localhost --port 8792
# In a second terminal:
npx playwright install chromium
npm run test:browser
```

The explicit localhost host prevents Wrangler from rewriting the request to a production hostname where the bypass is correctly refused. `LEARNING_TEST_URL` can override the browser-test target; do not point mutation-based tests at a real Library casually. No lint script is configured.

## Deploy Your Own Copy

1. Replace the Worker name, custom domain, KV namespace ID, Access issuer/audiences and AI Gateway ID in `wrangler.jsonc` with your own values. Do not reuse someone else's resource IDs.
2. Create your KV namespace and AI Gateway. Bind the configured AI service. Keep the named DO exports and migration tags consistent. On an existing installation, **never rewrite applied migration history or remove legacy namespaces as cleanup**.
3. Configure Access browser admission and the grammar Shortcut's service-token application. Include both application audiences if separate apps protect those paths. This app assumes one trusted personal workspace, not unrelated tenants.
4. Authenticate Wrangler and set the optional GitHub secret in your own Worker:

```sh
npx wrangler login
npx wrangler kv namespace create CHAT_SESSIONS
npx wrangler secret put GITHUB_TOKEN
npm run types
npm run check
npx wrangler deploy --dry-run --config dist/iphone_ai_flue_agent/wrangler.json
npm run deploy
```

Creation/deployment commands change your account and are not part of ordinary tests. Keep `DEV_AUTH` out of production. The generated `dist/.../wrangler.json` is deployment output; edit the source configuration instead.

If zone-wide Zaraz or Rocket Loader interferes with private UI input, use a Configuration Rule scoped to your application hostname to disable those features. Do not disable settings across unrelated hosts. An application CSP alone cannot prevent trusted edge services from adding their own nonces.

Code rollback does not roll back DO schemas/data. A compatibility rollback must preserve the Pi classes/bindings and their stored data; prefer a forward fix over replaying old agent work.

## Security Notes

- Every admitted browser/service actor shares the **same personal Library**. Access application membership is the privacy boundary. This is not per-person tenant isolation.
- Signed JWT issuer, allowed audience, signature and expiration are checked. Email headers and UUID possession are not authentication. New paths also verify the signed app cookie when an assertion header is absent; this is not a second interactive login flow.
- Browser mutation and socket requests reject a mismatched Origin. The retained grammar Shortcut normally has no Origin.
- `GITHUB_TOKEN` is server-only. Writes execute only after an explicit approval of exact persisted arguments; uncertain writes are not automatically retried. File changes go to new branches and reject stale repository HEAD.
- Tool input validation, URL/redirect/private-address checks, byte limits and HTML escaping are intentional security controls. Do not remove them merely because TypeScript types exist.
- Imported content, external pages and repository files are untrusted evidence. Social-draft privacy instructions are not a guaranteed redaction filter; review before sharing.
- Stored sources are bounded SQLite records, not full repository clones. Search covers a bounded projection, not every retained byte or semantic similarity.
- Session deletion removes app/legacy content but not GitHub writes, downloaded exports or independent provider/Gateway logs. Minimal tombstones remain.
- Pi Durable is experimental and pinned. Upgrade only with persistence/recovery tests. Preserve old data before migration; expired/unretained content cannot be reconstructed.

## Customize It

| Goal | Start here | Recheck |
|---|---|---|
| Change teaching style or post draft | `src/prompts.ts`, `src/lib/chat-presets.ts`, `src/runtime/harness.ts` | Prompt tests and a representative answer |
| Change mobile reading/composer | `src/client/main.tsx`, `styles.css` | Reload, draft, Library and phone-width behavior |
| Change grammar correction | `src/app.ts`, `src/lib/grammar-correction.ts` | `/v1/correct` response and Access credential compatibility |
| Add a read-only tool | `src/tools/`, `src/runtime/harness.ts` | Runtime schema, retrieval bounds, evidence retention, replay safety |
| Change external writes | `LearningSession.approve`, GitHub tools | Approval state machine, exact arguments and ambiguous failure handling |
| Change persistence/search | `session.ts`, `library.ts`, `contracts.ts` | Eviction, dirty revisions, tombstones and privacy filtering |
| Change model/provider | `wrangler.jsonc`, `harness.ts`, grammar/visual helpers | Tool support, no-thinking flags, Gateway routing and cost |

## Troubleshooting

| Symptom | Inspect / verify |
|---|---|
| Local 401 | `DEV_AUTH=local`, request hostname and `--host localhost`; `src/runtime/auth.ts` |
| Grammar Shortcut fails after auth changes | Distinct browser/service Access audiences and existing service-token policy; never paste secrets into logs |
| Answer missing after reload | Pending request ID, session snapshot/error, alarm/reconcile; `npm run test:worker` |
| Library lags a conversation | Dirty revision/outbox and `LearningLibrary.upsert`; do not replace canonical history with index contents |
| Private repository 404 | Server token permissions and pinned repository; public raw URL fetching is not used for private files |
| Approval says uncertain | Inspect the real GitHub action before doing anything again |
| Composer blocked by overlay | Host-scoped Zaraz/Rocket Loader configuration, then browser console/network |
| Build fails on Node 24.9 | Switch to a supported Node release and regenerate binding types |
| Old guide missing | Historical archive/KV retention; guide publication is not required for new repository tutoring |

## Official References

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Durable Objects and SQLite storage](https://developers.cloudflare.com/durable-objects/)
- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Workers AI](https://developers.cloudflare.com/workers-ai/) and [AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [React](https://react.dev/learn), [Vite](https://vite.dev/guide/) and [Hono](https://hono.dev/docs/)
- Pinned Pi API/storage details: installed `@earendil-works/pi-durable` package documentation and declarations. Treat these as the version-specific contract rather than assuming a future release behaves identically.

## License

No license file is included. Public visibility alone would not grant permission to reuse the code; choose a license explicitly before offering it for reuse.
