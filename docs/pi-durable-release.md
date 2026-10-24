# Pi Durable release verification — 2026-10-23

## Simplified session controls update

- Current deployed version: `1a7ed1f6-932d-4c9d-b544-38841ba18933`.
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
