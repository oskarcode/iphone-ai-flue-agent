# Flue → Pi Durable migration and operations

## Fixed compatibility boundary

Worker `iphone-ai-flue-agent`, domain `iphoneai.oskarcode.com`, Gateway
`iphone-flue-shortcut`, existing GitHub secret, Access application and KV namespace
remain unchanged. See [Shortcut contracts](shortcut-contracts.md). New SQLite DOs
are added by immutable migration `v4-pi-learning`; migrations v1–v3 are unchanged.

Pi Durable, Pi AI and Chord are pinned to **1.2.0**. Pi's API is experimental; verify
all storage, recovery and tool-boundary tests before upgrading. The Cloudflare
Agents package is used for its Workers AI provider adapter, not as a competing
conversation engine. There are no active Flue dependencies or generated agents.

## Authoritative storage and recovery

- Each `LearningSession` owns one Pi SQLite storage. Pi entries, submissions and
  task checkpoints are canonical; the browser never submits its claimed history
  as authoritative context.
- App-owned SQL tables retain metadata, source snapshots/hashes, notes, approvals,
  request hashes and import receipts. The root conversation owns model context.
- Persist the alarm before admitting work. Recover pending tasks through alarms
  and on reconnect, independent of the browser request lifetime.
- The Library is a rebuildable directory/search projection. A persisted dirty bit
  and monotonic revision act as an outbox; an unsuccessful write is retried by an
  alarm. Deletion tombstones prevent stale projection writes resurrecting a session.
- WebSocket upgrade responses use DO `fetch()`, not structured-clone RPC. Sockets
  send invalidations only; authenticated snapshot reads deliver visible text.
- A same-ID/same-content retry returns the existing Pi submission. Reusing an ID
  with different content is rejected. Browser drafts/pending messages are local
  convenience data and are cleared by the Sign out action.
- Automatic compaction changes model context, not retained history. Export emits
  NDJSON pages over all Pi entries and the retained source/note/action records.

Source snapshots are bounded SQLite records (900 KB per retained tool-result
record); large arbitrary uploads and full repository clones are not implemented.
Library search indexes recent entries, source excerpts and notes up to a bounded
budget. R2 and semantic retrieval can be added without replacing canonical Pi state.

## Legacy migration

The original `FlueIphoneAssistantAgent` and `FlueGithubLearningAgent` class names
remain exported, with their original namespace bindings. Their new implementation
is a **read-only SQL adapter**; it neither initializes Flue nor replays old tools.
The original tables and historical archive remain available during the migration
window. Explicit per-session permanent deletion is the only destructive adapter call.

Migration:

1. Inventory namespaces and objects through the Cloudflare control plane.
2. Read the original stream identity to recover the user-visible instance ID.
3. Create a Pi session with that same ID and provenance.
4. Read original stream batches (including spilled chunks), join assistant text
   deltas, exclude reasoning, and preserve original user/assistant timestamps.
5. Retain the old archive/guide snapshot and repository context where available.
6. Import visible entries with stable request IDs, then mark the import complete.
   Imported text is quoted historical evidence in model context—not new instructions.
7. Keep original tool traces read-only; do not turn an old tool intent into a new
   GitHub action. Importing performs no model inference.

Both partial and completed imports are retryable without duplicate visible entries.
Unknown/expired/unretained content is not fabricated. Very large sessions exceeding
100,000 raw stream records are flagged for a separate paginated recovery rather
than silently truncated. Existing sources with unknown privacy are conservative.

The in-app **Import previous sessions** action discovers repository records in KV.
For a complete inventory, including general conversations without KV records, use:

```sh
python3 scripts/migrate-legacy.py               # read-only inventory
python3 scripts/migrate-legacy.py --apply       # import enumerated stored objects
```

The script is deliberately scoped to this Worker and account. It reads existing
Wrangler OAuth credentials and a valid cached cloudflared Access token locally;
it never prints them or writes them into reports. Reports contain IDs, classes,
statuses and failures, not conversation content. Authenticate with cloudflared if
its cached application token is missing or expired. Review every `needs-review`
result before declaring historical migration complete.

## Privacy, writes and deletion

The verified Access policy is membership for **one personal workspace**. Browser
users and existing Shortcut service-token identities admitted by that policy share
its Library. This is not a multi-tenant application: do not admit unrelated users.
Every private route and WebSocket handshake verifies the JWT issuer/audience and
signed identity. `ACCESS_AUDIENCE` explicitly includes the existing browser app
(`6b76…687a`) and the distinct Shortcut service app (`9ccb…dd77`); checking only
the browser audience would break the unchanged Shortcut service credentials.
Both existing Access applications and their policies are unchanged. The existing Access application covers legacy paths, not all new
ones: new routes verify the same signed `CF_Authorization` cookie when no injected
assertion header is present. Unauthenticated session/visual links return through
`/chat` for the existing Access login, then resume the requested page. UUIDs alone
are not authorization. Cross-origin browser writes
are rejected; Shortcuts without an Origin header still work.

- Private GitHub credentials remain Worker secrets, never tool arguments or snapshots.
- Public URL fetching retains existing SSRF/size/redirect checks.
- GitHub model tools only create proposals. The UI displays exact arguments, and
  the authenticated approval route atomically claims a pending proposal before
  making the external request.
- An interrupted external write is marked **uncertain**. It is never automatically
  retried; inspect GitHub first. File changes reject a changed default-branch SHA
  and never write directly to that branch.
- Saved public notes can be recalled only after opt-in. Private notes are excluded;
  recalled notes carry session and evidence-entry IDs. There is no automatic mastery
  inference or model retraining.
- Private social-draft redaction is an instruction, not a guaranteed DLP filter.
  Review drafts before copying them to a public service; there is no auto-publishing.

Permanent deletion revokes access first, tombstones the index, closes active work,
and removes session records, snapshots, notes, approvals, legacy state, archive
rows and matching KV records. Failed cleanup is retryable through the alarm.
Minimal ID/owner tombstones remain to prevent resurrection. This does not delete
GitHub issues/branches, exports already downloaded, or AI Gateway/provider logs.

## Release and rollback

```sh
npm run types
npm run check
npm audit
npx wrangler deploy --dry-run --config dist/iphone_ai_flue_agent/wrangler.json
npx wrangler deploy --config dist/iphone_ai_flue_agent/wrangler.json
```

Smoke-test authenticated Shortcut routes, browser handoff, repository follow-up,
source persistence, visual rendering and WebSocket reconnect after deployment.
Use only read operations in private repository tests; do not test approvals by
creating unsolicited issues or branches.

The `DEV_AUTH=local` override is allowed only on localhost/127.0.0.1 and must never
be added to production configuration. `workers.dev` and preview ingress remain disabled.

A Worker code rollback **does not roll back Durable Object schemas or data**.
Do not delete v4 namespaces or rewrite migration history to restore the old UI.
A compatibility rollback must keep the new class exports/bindings available and
preserve new Pi data. Keep the previous deployment ID and the migration report;
prefer a forward fix for individual defects. Historical namespaces may only be
retired after migration verification and separate explicit deletion approval.

## Verification coverage

- Pure validators, grammar request/response contracts, Markdown safety and signed
  browser/service Access identity tests.
- Workerd SQLite persistence, import idempotency, source/note retention, deletion,
  outbox/alarm retry, owner isolation, WebSocket transport and handoff contracts.
- Interrupted generation reopened against the same SQLite storage with a deterministic
  provider; the answer completes and the retried input is not duplicated.
- A deterministic model requesting a GitHub write creates only a pending proposal.
- Playwright mobile viewport: send, reload mid-turn, recover, save a note, start new
  learning, reopen through a stable URL, and automatic Shortcut handoff.
- Real Workers AI/GitHub/web/visual smoke checks are separate from deterministic tests.

Private HTML receives a nonce-based CSP. Separately, a hostname-scoped Configuration
Rule disables Zaraz and Rocket Loader on `iphoneai.oskarcode.com`: the existing
zone-wide consent overlay otherwise intercepted the mobile composer. Other hosts
and the pre-existing Configuration Rule are unchanged. The edge can add trusted
CSP nonces, so CSP alone is not a substitute for disabling Zaraz injection.

- Ruleset: `4de5ba0e5a974d0f86c9cfec348881ac`
- Rule: `6cc0c46400e84968ac28ca17fafa2bc0`
- Expression: `(http.host eq "iphoneai.oskarcode.com")`
- Settings: `disable_zaraz: true`, `rocket_loader: false`
- Rollback: disable/delete only this rule, not the zone ruleset.

Deterministic Worker tests disable remote bindings, so they do not require a live
model or create remote development sessions. Browser/real-service smoke checks run
separately against the local build or the authenticated production deployment.
