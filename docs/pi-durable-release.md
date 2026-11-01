# Pi Durable release verification — 2026-11-01

## TypeScript mental models in on-screen explanations

- Deployed Worker version `78c98e3a-b218-4fc4-8b89-8ecb0130896b` at `iphoneai.oskarcode.com`. The existing `/v1/ask` contract is unchanged: technical answers now use a plain-English definition, one small conceptual TypeScript sketch with relevant beginner syntax explanation, and a final traffic flow when meaningful. Everyday terms remain prose. The completion-token ceiling increased to fit the code and syntax without an automatic truncation; no chat, grammar, Access, binding or storage changes.
- Verified 111 pure and 42 workerd tests, typecheck, build and Wrangler dry run. Local authenticated-development real-model probes returned TypeScript plus a final traffic flow for “Durable Object” and “API Gateway”; an everyday term remained code-free. An earlier probe confirmed URL-only input does not claim to fetch the page. The local dev Worker encountered a SQLite lock during a simultaneous rebuild with another local dev session; restarting with isolated local persistence completed the real-model checks. The workerd test runner continues to print the two known stale-revision exceptions while passing all tests.
- Production unauthenticated checks returned health `router: pi`, redirected `/chat` to Access, rejected `/api/sessions` without identity and blocked `/v1/ask` and `/v1/correct` without Access. A fresh authenticated production call and physical iPhone run for this prompt revision were not performed; the previously configured Shortcut itself was not changed.

## Prior release — stateless on-screen quick explanation (historical)

## Stateless on-screen quick explanation Shortcut

- Deployed Worker version `b4904b70-4341-45ce-bb96-03980eba4045` at `iphoneai.oskarcode.com`. Restored `POST /v1/ask` as a deliberately narrow, stateless `{text} -> {answer}` contract using the existing Workers AI model and Gateway. It does not classify with Jev, call Pi, use retrieval tools, write to Durable Objects/KV or alter browser sessions. The independent grammar endpoint and Access configuration remain unchanged. `/handoff` and legacy chat POST APIs remain retired.
- Reuse the old handoff Shortcut by changing its URL from `/handoff` to `/v1/ask`, the dictionary key from `chat_url` to `answer`, and **Open URL** to **Show Result** or **Quick Look**. Keep its existing Access headers and JSON `text` body. Details: [Shortcut contracts](shortcut-contracts.md). No installed iPhone Shortcut was modified by this deployment.
- Verification: 111 pure and 42 workerd tests passed, including stateless route, malformed/oversized/model-truncated responses, unchanged grammar and retired-route checks; typecheck, build and Wrangler dry run passed. Local real-model calls returned short answers for a technical term and an everyday word, told the user it cannot fetch a pasted URL, and preserved grammar `corrected_text`. The workerd runner still printed two revision-conflict exceptions from earlier stale-write tests despite a passing suite.
- Production unauthenticated checks: `/health` returned `router: pi`, `/chat` redirected to Access (302), `/api/sessions` denied anonymous access (401), and both `/v1/ask` and `/v1/correct` rejected unauthenticated requests (403). An authenticated production service-token request and physical iPhone Shortcut run were **not** performed; the edge policy's acceptance of the existing Shortcut credentials for `/v1/ask` must be checked on-device.

## Prior release — immediate skill and Computer writes (historical)

## Immediate skill edits and Computer file writes

- Deployed Worker version `a4216c15-922d-49e2-b368-81d8c839eed3` at `iphoneai.oskarcode.com`. Explicitly requested skill creation/update/removal and `write_computer_file` now execute without a second UI approval and leave durable, content-free notifications. Revision checks, owner scoping, idempotent receipts and uncertain-outcome handling remain. GitHub writes, Computer file/directory deletion and shell/JavaScript commands still require approval. No Worker bindings, Access settings, migrations or grammar Shortcut contracts changed.
- Verified locally: 109 pure tests, 39 workerd tests, typecheck, build, Wrangler dry run and four mobile browser tests. Browser tests included real-model skill and file writes that completed without an approval click, persisted across reload, and were cleaned up. The workerd runner still logs two uncaught revision-conflict exceptions from deliberately stale-write tests while reporting a passing suite.
- Unauthenticated production smoke: `/health` returned `router: pi`, `/chat` redirected to Access (302), `/api/sessions`, `/api/skills` and `/api/computer` returned 401, and `/v1/correct` remained Access-protected (403 on GET). Fresh authenticated production mutation, physical iPhone interaction and the grammar Shortcut were not tested during this release.

## Prior release — browser-only learning (historical)

## Browser-only learning; grammar Shortcut retained

- Deployed Worker version `3d20c341-9322-4ada-a475-8b5199b16761` at `iphoneai.oskarcode.com`. Browser messages now submit directly to Pi, with no Jev execution or model config. The active learning handoff/Shortcut and legacy chat POST handlers were removed, along with the handoff-consumption GET handler. `/v1/correct`, its Access audience and credentials, historical object bindings/migrations and retained workspace/review/visual GET links were not changed.
- The UI uses **＋ New learning** or an existing workspace in one tab. Local real-model iPhone-size browser checks passed for new-versus-existing workspaces, reload persistence, and pasted public webpage/GitHub URLs with recorded `web_research`/`open_repository` tool calls (4 tests). Pure tests: 108 passed; workerd: 38 passed. Typecheck, build, Wrangler dry run and `git diff --check` passed. The workerd runner printed an uncaught skill-revision exception despite reporting a passing suite; this was not caused by the retired-route tests and remains to investigate.
- Production unauthenticated checks confirmed `/health` reports `router: pi`, `/chat` redirects to Access and `/api/sessions` denies unauthenticated requests. The retired POST paths are edge-blocked without authentication, so these probes cannot confirm their authenticated 404 behavior; workerd tests cover it. A fresh authenticated production turn, real grammar Shortcut execution and a physical iPhone run were not performed. Remove the retired Shortcut on the phone manually; deployment cannot delete an installed Shortcut.

## Prior release — 2026-10-23 (historical)

## Approval cards, activity, Jev and generated titles

- Deployed version: `6a851a7c-8d9a-40ab-866d-c9803c99cb36` for `iphone-ai-flue-agent` at `iphoneai.oskarcode.com`.
- Resolved approval cards disappear from chat on success/rejection without deleting the stored receipts; pending, executing and uncertain actions remain visible. Refresh does not resurrect terminal cards.
- Activity now names allowlisted tool calls and validated `/skill` slugs, shows the actual coach subagent's read-tool lifecycle, and removes the duplicate expanded routing line. Arguments, tool output, reasoning and raw errors remain private. Browser workspace messages now pass through Jev before Pi; the panel records the classified route **and** the actual Pi tool events. Jev classifies intent and gates the turn on failure; Pi still selects its own tools. No Clef runtime is installed.
- New sessions get a short title generated by the configured Workers AI model from the first user request. Failed/invalid title generation returns an error instead of guessing a fallback or creating a partial session. Existing, renamed, deleted and imported sessions keep their existing identities and titles.
- 127 pure and 44 workerd tests passed, with typecheck, build, Wrangler dry run and two iPhone-size browser regression checks. Local real Workers AI smoke checks returned a generated title, completed a Jev-classified Pi turn and recorded a coach skill/read-tool trace. Unauthenticated production checks still redirect `/chat` to Access (302) and reject `/api/skills` (401); a fresh authenticated production turn and physical Shortcut were not retested.

## Deep-learning command release (historical)

- Deployed version: `56f020f1-0a64-4975-b9d6-fe0986cc8358` for Worker `iphone-ai-flue-agent` at `iphoneai.oskarcode.com`.
- `/deep-learn` is an opt-in, editable skill available in any workspace. It uses conversational probing, a short plan, stepwise teaching/checks and later practice without importing LearnHarness code, adding a persistent mastery graph or reading other sessions by default. Existing owner edits/deletions are respected by one-time seeding.
- The previously deployed activity lookup batching fix remains in this version; no session data or Worker bindings/migrations were changed.
- 118 pure and 39 workerd tests passed, along with typecheck, build, Wrangler dry run and `git diff --check`. The new browser assertion was added but not run this release; unauthenticated production checks observed the expected Access redirect for `/chat` and 401 for `/api/skills`. An authenticated `/deep-learn` conversation and physical Shortcut remain untested.

## Large-session activity recovery (historical)

- Recovery deployed version: `6608232c-5efa-47d9-bfc2-3b28ee02d1d6` at `iphoneai.oskarcode.com`.
- A private repository workspace returned 502 for snapshots because `ActivityJournal.list` bound 106+ entry IDs into one SQLite `IN` query, exceeding Cloudflare Durable Objects' 100 SQL-variable limit. The route's generic error made its stored messages look missing. Fixed by scanning batches of at most 80 IDs, deduplicating active rows and preserving global row order/200-row cap. A real workerd regression covers 200 entry IDs and live status inclusion.
- Read-only remote Data Studio checks before the fix found 198 Pi entries across the main and child conversations, 20 saved sources and `PRAGMA quick_check = ok`; no rows were erased. After the fix, authenticated production snapshot/export and iPhone-size browser checks recovered 19 visible user and 26 assistant messages in the affected workspace. All eight current Library sessions return 200, the one pinned session remains unchanged, and the temporary owner-only diagnostic endpoint was removed in the final deployment.
- **118 pure + 39 workerd + 11 serial mobile browser tests passed (168 total)**, with typecheck/build and a Wrangler dry run before deployment. Fresh interactive Access login and a physical Shortcut were not retested.

## Skill-based learning coach and feature/bug tracker update (historical)

- Skill release version: `480a6816-39d4-409d-923f-4347990466ea` for Worker `iphone-ai-flue-agent` at `iphoneai.oskarcode.com`. No new Durable Object class or migration was added; the existing bindings, routes, Access protection and Shortcut contracts remain intact.
- Replaced the Learning coach tab with `/learning-coach` in any session. An idempotent task-owned Pi Durable child gets only read-only owner-scoped Library/session RPC tools, including explicit reads of private sessions and bounded message chunks. Root sessions receive the tool allowlist on reopen; deleted sessions are inaccessible. Ordinary turns no longer automatically project evidence into the legacy coach DO, whose authenticated endpoints and old data remain for compatibility.
- The coach distinguishes observations from inference and cites session/message evidence. As explicitly agreed, an answer in one session remains there if a different cited source session is later deleted; no cross-session answer is retroactively removed.
- Added `/feature-bug-tracker` with an approval-protected shared Markdown ledger, stable issue IDs, revision-checked writes, review and status updates. One-time per-skill seeding offers both commands to existing Computers without re-creating either after deletion or overwriting edits.
- **118 pure + 38 workerd + 11 serial mobile browser tests passed (167 total)**; typecheck/build, Wrangler dry-run/deploy and dependency audit passed (zero vulnerabilities). The local browser suite tested real cross-session subagent retrieval and citations.
- Authenticated production checks confirmed both skill commands, a cited cross-session answer, persistence after reload, simplified mobile navigation, unchanged teaching preferences and zero JavaScript errors. Both disposable sessions were deleted (204/404); the exact pre-existing session inventory, including the one pinned session, remained unchanged. Tests used a cached signed Access cookie; fresh login, physical iPhone/Shortcut and external GitHub writes remain untested.

## Learning coach and teaching preferences update (historical)

- Coach-tab release version: `c7500719-b37a-4285-8e4f-a08352de263a`.
- Added an owner-scoped `LearningCoach` SQLite Durable Object in additive migration `v6-learning-coach`, without changing existing classes or migrations. Committed visible user/assistant entries are projected with stable IDs; no raw tool traces or private repository content is copied into the coach.
- The Learning coach tab shows observed questions, session evidence links and an on-demand teacher Q&A for possible gaps, corrections, suggestions and plans. No autonomous model loop is scheduled. Coach answers are bounded and cached by request ID; asking is not treated as proof of mastery.
- Session deletion tombstones coach evidence and erases all possibly derived coach answers. Clear & pause removes coach evidence/answers and baselines current entries before resuming, without deleting learning sessions or skills. A session becoming private redacts any earlier public projection.
- Removed the manual Import previous sessions button and retired saved-note recall checkbox/tool. Historical migration routes and saved sources/notes remain; legacy preference writes can no longer enable note recall. The requested learner profile was saved to production: Python/FastAPI/Django familiarity, beginner TypeScript, Cloudflare developer products, agent harnesses and clear English.
- **118 pure + 35 workerd + 11 serial mobile browser tests passed (164 total)**; typecheck/build, Wrangler dry-run and deploy passed. Dependency audit reported zero vulnerabilities. Local parallel browser tests exposed occasional AI-service interruptions; the serial suite passed.
- Authenticated production checks confirmed a real lesson projection, coach answer and reload, simplified settings, mobile fit and no JavaScript errors. Disposable session deletion returned 204/404 and retracted its observations/derived answers; the pre-existing pinned session was preserved. Tests used an existing signed Access cookie, not a fresh login or physical Shortcut.

## Simplified session controls update (historical)

- Simplification release version: `1a7ed1f6-932d-4c9d-b544-38841ba18933`.
- Removed Archive/Unarchive, the Archived sessions filter and the complete-session export link from the UI. Session options now contain Rename and Pin/Unpin; Delete remains in the header.
- The UI requests `archived=all`, so previously archived sessions remain visible and searchable without altering their data. Existing archive filters and export APIs remain compatible.
- **117 pure + 32 workerd + 10 mobile browser tests passed (159 total)**, including mixed-archive pagination, literal search and historical-session visibility. Typecheck and production build passed.
- Production mobile checks confirmed simplified controls, access to an archived fixture through the unified Library, preserved source data and no page errors/overflow. The disposable fixture was deleted (204/404); existing sessions and pin states were unchanged.
- Checks used a cached signed cookie on a session URL. The edge-protected `/chat` entry redirected that cached client to Access; fresh login and physical-device execution were not tested.

## Shared skills, Computer and Settings update (historical)

- Skills release version: `b92935fc-70e6-44ea-97c2-75e89e853d50`.
- Cloudflare Computer `0.5.1` (preview) stores shared skill files in a new SQLite-backed `LearningSkills` object. Migration `v5-learning-computer` is additive; earlier migrations and historical class identities are unchanged.
- Nine editable starter skills replace hardcoded prompt chips. New commands appear after approved creation; selecting one preserves the user's question and does not automatically send it. Skills survive deletion of individual conversations.
- Agent tools can list/read skills, propose creation/update/removal, inspect files and propose file changes or execution. Exact approval gates mutations. Revision checks reject stale edits; persistent operation receipts prevent duplicate execution and mark interruptions uncertain.
- Both worker-shell and isolated JavaScript execution are enabled, with network egress, bounded output and 30-second execution limits. No application credentials are passed to dynamic Workers. This is not a full Linux VM.
- Settings contains the skill editor, Computer browser/runner, learning preferences, historical import, device-draft cleanup and sign-out.
- Existing sessions receive the new tool allowlist when reopened. Session URLs are now published only after durable creation, avoiding a reload race discovered during browser testing.
- **117 pure + 31 workerd + 9 mobile browser tests passed (157 total)**; typecheck, production build, generated bindings, deployment dry-run and dependency audit passed. Audit reported **zero vulnerabilities** after scoped transitive security patches.
- Authenticated production checks exercised real agent skill creation, exact approval, command invocation with instruction-following, skill update/removal, shell execution, JavaScript execution and outbound HTTP. Mobile layout and the dynamic command list were verified. Disposable skills/sessions were removed; the existing pinned session was preserved.
- Production checks used a cached signed cookie and an emulated iPhone browser. Fresh interactive Access login, a physical Shortcut run, arbitrary native binaries and external GitHub writes were not tested.
- Existing session cleanup remains in effect. The historical inventory totals below describe earlier releases, not the current Library contents.

## Per-turn activity update (historical)

- Activity release version: `2932eccc-718a-48e4-b509-329b7492c5eb`.
- Each new input has a collapsed **Agent activity** disclosure. Pi event batches
  update a session-local SQLite journal, with submission-to-entry association,
  tool status, generation status, retries and compaction summaries. The existing
  authorized WebSocket/snapshot channel delivers live updates.
- Journals retain the latest 80 steps per turn, survive reload/eviction, appear in
  paged exports and are purged by permanent session deletion. They are operational
  summaries, not complete raw traces or exactly-once audit records. Older turns
  without recorded events are labelled **Not recorded**.
- No raw reasoning, tool arguments/results, provider errors or credentials are
  projected into activity panels. No Shortcut contracts, Access policies, Worker
  bindings or historical migration tags changed.
- Supported-Node typecheck/build passed; **89 pure + 18 workerd + 3 mobile browser
  tests passed (110 total)**. Tests cover real Pi event batches, privacy, correct
  turn association, bounded retention, failure/queued recovery, deletion, live web
  tool updates, two independent turns and reload/collapse behavior.
- Authenticated production mobile smoke verified a real web-research tool turn,
  39 received WebSocket frames, completion and correct input association, retained
  activity after reload, exported activity, no JavaScript errors and no horizontal
  page overflow. The smoke session was deleted (204), then read as missing (404).
- Production browser checks used an existing signed cookie. Physical iPhone
  execution, fresh Access login and real GitHub writes were not retested.

The sections below retain the original migration release evidence.

## Published application

- Worker: `iphone-ai-flue-agent`
- Existing application: <https://iphoneai.oskarcode.com/chat>
- Released version: `c5960c55-30a8-48a2-b0e4-5f1505131836`
- Pi Durable, Pi AI and Chord: pinned to `1.2.0`.
- No Flue packages or execution runtime remain. Original class identities are
  retained solely for read-only historical storage access and explicit deletion.
- All 17 previously registered application routes remain registered. Existing
  Shortcut endpoint paths, input fields, service-token headers and consumed
  response fields remain supported. No Shortcut edits are required.
- The existing browser and Shortcut Access applications have different audiences;
  both are verified explicitly. Their applications and policies were not changed.

## Historical migration

The original inventory contained 111 general-agent and 30 repository-agent objects.
All 123 objects with stored data were imported: 111 general and 12 repository
sessions. The remaining 18 repository objects had no stored data to import.

- **123 distinct retained sessions** imported, with **526 visible messages**.
- **457 source/archive records** retained with content hashes.
- **93,577 original stream records** were read to project visible history;
  the original Flue stores remain intact, not replayed or globally deleted.
- Import was run twice. A subsequent authenticated read of **every imported
  session** verified its complete marker, exact visible-message count and source
  hashes. No mismatches or import failures remained.
- Library pagination was checked: all 123 imported IDs are discoverable.
- No model generation or historical GitHub action was triggered by import.

This does not recover already-expired or previously unretained artifacts.
Operational reports contain IDs/counts rather than conversation text and were
kept locally under `/tmp/pi-learning-migration-*.json` and
`/tmp/pi-migration-verification.json`; they are not application secrets or a
replacement for durable backups. The import is repeatable using
`scripts/migrate-legacy.py`.

## Verification

Using supported Node 24.11.1:

- TypeScript check and production build passed.
- **87 pure tests, 15 workerd tests, 2 mobile Playwright tests passed** (104 total).
- Dependency audit: **zero reported vulnerabilities**.
- Wrangler deployment dry-run passed before publication.
- Local real-service checks covered unchanged grammar/ask/handoff contracts,
  web research and the exact `huggingface/tau.git` repository request.
- Authenticated production checks covered persistent generation, private GitHub
  file reading, evidence retention, a learning-post draft and visual rendering.
- Production mobile-browser checks covered reload recovery, WebSocket connections,
  imported history, draft recovery, a usable composer and Library navigation.
  No JavaScript exceptions or horizontal page overflow were observed.
- Two different visuals generated in one production session retained independent
  source hashes and stable artifact URLs; both remained readable afterward.
- Unauthenticated session APIs returned 401. Deletion of release-created test
  sessions returned 204 and their reopened URLs returned 404.

A pre-existing zone-wide Zaraz consent modal intercepted mobile input. A new
Configuration Rule disables Zaraz and Rocket Loader **only on this application's
hostname**. Its exact settings and rollback are in the
[migration runbook](pi-durable-migration.md). Other hostnames were not changed.

## Deliberately not verified

- No physical iPhone Shortcut was executed, and the real Shortcut client secret
  was not available for an end-to-end service-token request. Signed service JWTs,
  the distinct configured Access audience and unchanged HTTP contracts were tested;
  Access's existing service-token policy was inspected without modification.
- No real GitHub issue, branch or commit was created for testing. Proposal-only
  behavior and persisted approval handling were exercised with deterministic fixtures.
- Fresh interactive Access sign-in was not automated. Production browser tests used
  an existing signed app cookie on session URLs; the cached token alone did not
  complete Access's edge login on `/chat` or authorize service-only Shortcut routes.

See the [migration runbook](pi-durable-migration.md) for the single-person workspace
boundary, bounded SQLite/source search, provider-log retention and safe rollback.
