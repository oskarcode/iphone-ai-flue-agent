# Personal Learning Workspace

An iPhone-first tutor that turns selected text, questions, web pages and GitHub repositories into learning conversations you can reopen later. A Cloudflare Worker serves the mobile interface and existing Shortcut APIs; Pi Durable keeps conversation history, work-in-progress, sources and notes in SQLite-backed Durable Objects. Grammar correction stays separate and stateless.

## What It Does

- Keeps non-expiring learning sessions in a searchable Library; starting a new session does not delete the old one.
- Explains concepts, researches public pages and tutors directly from commit-pinned repository files, including authorized private repositories.
- Retains source text, retrieval timestamps, hashes and independently addressable visual artifacts.
- Renders escaped Markdown, copyable code and scrollable tables on phones.
- Shows a collapsible **Agent activity** panel for each turn: queued/running/completed status, tool activity, retries and context summarization. Recorded progress survives reloads; raw reasoning, tool payloads and provider errors are never sent to this panel. Routing events distinguish actual Jev decisions, deterministic GitHub/recap rules and classifier fallback. Normal workspace turns explicitly say **Jev not used**; repository/visual handoffs retain a separate **Request routing** panel.
- Saves editable evidence-linked notes and optional teaching preferences. Requested cross-session recall uses eligible saved public notes, not model retraining.
- Creates reviewable social-post drafts with an illustrative TypeScript mental model. Nothing publishes automatically.
- Requires explicit server-side approval before GitHub issue creation or a branch-only file change.
- Preserves existing Shortcut request paths, fields, service-token headers and response fields. See [Shortcut contracts](docs/shortcut-contracts.md).

## How It Works

```text
Browser / iPhone Shortcut
  -> Access identity verification + Hono routes
  -> LearningSession Durable Object for one session ID
       Pi SQLite entries, submissions and recoverable tasks
       sources, notes, metadata and exact approval proposals
  -> Workers AI through AI Gateway -> bounded web / GitHub tools
  -> committed snapshot -> browser explanation

LearningSession -> retryable projection -> LearningLibrary -> search / reopen
POST /v1/correct -> Workers AI directly -> corrected_text (no Pi/session writes)
```

The browser holds drafts and one retryable pending send, not canonical history. WebSockets notify it that something changed; authorized HTTP snapshots supply the visible messages. A persisted alarm can resume unfinished server work after the browser closes or the object is evicted.

Pi event batches update a bounded operational journal (latest 80 steps per input submission). WebSocket invalidations refresh it alongside the answer; reconnects recover it from authorized snapshots. Earlier turns without recorded events are labelled **Not recorded**, rather than inventing a trace. Session export includes the journal, and permanent deletion removes it.

The Library is a versioned projection, not a second authoritative transcript. Deletion tombstones prevent delayed updates or old links from resurrecting erased sessions. Historical Flue classes remain only as storage-reading/deletion adapters; no Flue execution package remains.

## Technology Stack

| Technology | Role |
|---|---|
| TypeScript, Node.js tooling | Shared contracts and local build/test tooling |
| React + Vite | Mobile workspace and bundled static assets |
| Hono + Cloudflare Workers | HTTP compatibility boundary, authentication and asset delivery |
| Pi Durable / Pi AI / Chord 1.2.0 | Durable conversation execution and background task coordination |
| SQLite-backed Durable Objects | Canonical session state and rebuildable Library |
| Workers KV | Ten-minute Shortcut delivery envelopes and retained legacy records |
| Workers AI + AI Gateway | Tutor/visual inference, stateless grammar and Jev intent classification |
| `jose` + Cloudflare Access | Signed JWT verification for browser/service callers |
| Valibot | Runtime validation of model tool arguments |
| Vitest + Cloudflare test plugin + Playwright | Pure, workerd persistence/recovery and mobile-browser checks |

R2, D1, Vectorize, Queues, Workflows and MCP servers are **not used**. The Browser Run binding remains configured for compatibility but current page retrieval uses bounded fetch and Workers AI conversion, not browser automation.

## Project Structure

| Path | Owns |
|---|---|
| `src/cloudflare.ts` | Worker entry and immutable Durable Object class exports |
| `src/app.ts` | Routes, Shortcut adapters, Access admission, migration, streaming export |
| `src/client/main.tsx`, `styles.css` | Library, composer, snapshots, reconnects and phone layout |
| `src/runtime/session.ts` | Canonical Pi/application state, recovery, approvals and deletion |
| `src/runtime/library.ts` | Search projection, preferences, note recall and tombstones |
| `src/runtime/harness.ts` | Models, teaching context and Pi tool adapters |
| `src/runtime/activity.ts`, `src/client/turn-activity.tsx` | Sanitized persistent per-turn progress and collapsible UI |
| `src/runtime/auth.ts`, `contracts.ts` | Verified identity and shared transport/data shapes |
| `src/runtime/legacy.ts`, `src/learning-archive.ts` | Historical storage access; not the active tutor runtime |
| `src/tools/` | Web retrieval, GitHub operations and Jev classification |
| `src/lib/`, `src/prompts.ts` | Rendering, prompts, grammar/visual normalization and compatibility helpers |
| `scripts/migrate-legacy.py` | Explicit operator inventory/import utility |
| `test/` | Validators, contracts, SQLite recovery and browser tests |
| `wrangler.jsonc` | Ingress, bindings, observability and immutable migration history |

`node_modules/`, `dist/`, `.wrangler/` and generated `worker-configuration.d.ts` are not source. Keep the lockfile and generated binding declarations needed by local checks; regenerate declarations with `npm run types` rather than editing them.

## APIs and Interfaces

All private interfaces require verified Access admission. The existing service-token credentials stay in the Shortcut's `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers; Access injects the signed identity consumed by the Worker.

| Interface | Input / result |
|---|---|
| `POST /v1/correct` | `{ "text": "She go yesterday." }` -> `{ "corrected_text": "She went yesterday." }` |
| `POST /v1/ask` | `{ text }` -> answer JSON, repository `learning_url` (202), or `visual_url` |
| `POST /handoff`, `/v1/chat-session` | `{ text }` -> `chat_url`, `expires_in_seconds: 600` |
| `GET /chat/session/:id` | Consumes the temporary handoff and returns `{ text }`; not a persistent page URL |
| `GET /chat`, `/sessions/:id`, `/learn/:id` | Current browser workspace |
| `GET /api/sessions` | Literal search, archive filter and offset pagination |
| `POST /api/sessions` | `{ text, id? }` -> 201 `{ id, url }`; does not submit a model turn |
| `GET/PATCH/DELETE /api/sessions/:id` | Snapshot, title/pin/archive update, or permanent deletion |
| `POST /api/sessions/:id/messages` | `{ text, requestId }` -> 202 receipt; reuse both on retry |
| `GET /api/sessions/:id/socket` | WebSocket invalidations; messages still use HTTP |
| Sources, notes, approvals, stop, export | Session subroutes for retained evidence and explicit operations |
| `GET/PUT /api/preferences` | Teaching text and opt-in public-note recall |
| `GET /visual/:id?artifact=…` | Retained version-specific visual HTML; treat returned links as opaque URLs |
| Legacy review/chat/status/SSE routes | Retained compatibility interfaces, not the new browser transport |
| `POST /api/migrate`, `/api/migrate/object` | Authorized passive import; never replays historical tools |
| `GET /health` | Public framework/router status, not model/storage readiness |

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
3. Configure Access browser admission and the Shortcut service-token application. Include both application audiences if separate apps protect those paths. This app assumes one trusted personal workspace, not unrelated tenants.
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
- Browser mutation and socket requests reject a mismatched Origin. Shortcut requests normally have no Origin.
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
| Change a Shortcut contract | `src/app.ts` | Existing client payload/field compatibility before changing anything |
| Add a read-only tool | `src/tools/`, `src/runtime/harness.ts` | Runtime schema, retrieval bounds, evidence retention, replay safety |
| Change external writes | `LearningSession.approve`, GitHub tools | Approval state machine, exact arguments and ambiguous failure handling |
| Change persistence/search | `session.ts`, `library.ts`, `contracts.ts` | Eviction, dirty revisions, tombstones and privacy filtering |
| Change model/provider | `wrangler.jsonc`, `harness.ts`, grammar/visual helpers | Tool support, no-thinking flags, Gateway routing and cost |

## Troubleshooting

| Symptom | Inspect / verify |
|---|---|
| Local 401 | `DEV_AUTH=local`, request hostname and `--host localhost`; `src/runtime/auth.ts` |
| Shortcut fails after auth changes | Distinct browser/service Access audiences and existing service-token policy; never paste secrets into logs |
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
