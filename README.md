# Personal learning workspace · Pi Durable

An iPhone-first learning assistant on **the existing Worker and domain**:
<https://iphoneai.oskarcode.com/chat>. General explanations, articles, pasted text,
GitHub tutoring, saved visual explanations and copyable learning-post drafts share
one persistent session model. Grammar correction remains a fast, stateless call.

**Existing Shortcuts do not need changes.** The production hostname, service-token
headers, request fields, endpoint paths and consumed response fields are retained.
See [Shortcut contracts](docs/shortcut-contracts.md).

## Architecture

```text
Access-authenticated browser / existing iPhone Shortcut
  → Hono Worker router
  → LearningSession DO per opaque session ID
      Pi Durable 1.2 + SQLite: canonical entries, tasks, submissions
      application tables: sources, notes, approval records, metadata
      alarms: execution recovery and retryable library projection
  → LearningLibrary DO for the personal workspace
      session directory, bounded search projection, preferences, saved notes
  → Workers AI GLM-5.2 + existing AI Gateway
      read-only web/GitHub tools, visual generation, approval-only write proposals
```

- **React + Vite** supplies the mobile chat and Library drawer; desktop gets a sidebar.
- Browser WebSockets carry invalidations, followed by sanitized committed snapshots.
  Neither thinking traces nor credentials are streamed to the browser.
- Server state is authoritative. Local storage holds only drafts and a retryable
  pending submission. Sign out clears those device-local values.
- UUIDs identify sessions; verified Cloudflare Access admission authorizes this
  **single personal workspace**. Browser and Shortcut service-token identities
  deliberately share one library. Do not admit unrelated users to this Access app.
- Sessions and retained sources have **no TTL**. New learning is not deletion.
- Compaction bounds model context, not historical storage. Exports page through all
  retained Pi entries, including records outside the active model context.
- Flue packages/build plugins are gone. Original DO class names remain as narrow,
  read-only migration adapters—not active Flue agents. Explicit permanent deletion
  also removes that session's original stored copies.

## Features

- Search recent session content, source summaries and saved notes; rename, pin,
  archive, reopen, export or delete sessions.
- Saved source snapshots include retrieval time and a content hash. Repository
  context is commit-pinned, and private GitHub reads use the existing Worker secret.
- Markdown is HTML-disabled, with copyable code, horizontal tables and no remote images.
- Save/edit evidence-linked learning notes. Optional requested cross-session recall
  searches saved **public** notes; private-session notes are excluded.
- Editable teaching preferences. Discussing a topic does not imply mastery.
- On-demand X/LinkedIn drafts include the TypeScript mental model in the post.
  Nothing posts automatically; review every draft before sharing private-derived lessons.
- GitHub write tools prepare exact proposals. Only an authenticated approval request
  executes one. Interrupted/uncertain actions are never blindly retried. File changes
  use a new branch and reject a stale default-branch commit.

## Source map

| Path | Responsibility |
|---|---|
| `src/app.ts` | Authenticated routes, stable Shortcut adapters, migration and exports |
| `src/cloudflare.ts` | Worker and DO exports |
| `src/runtime/session.ts` | Pi storage owner, recovery, snapshots, sources, notes, approvals |
| `src/runtime/harness.ts` | Workers AI provider, teaching instructions, Pi tool registration |
| `src/runtime/library.ts` | Rebuildable directory/search projection and preferences |
| `src/runtime/auth.ts` | Signed Access JWT verification; local-only development admission |
| `src/runtime/legacy.ts` | Read-only Flue storage readers and visible-message import |
| `src/client/` | React mobile workspace |
| `src/tools/` | Framework-neutral web/GitHub operations and Jev classification |
| `src/lib/grammar-correction.ts` | Existing direct grammar request, no-thinking flag and budget |
| `test/worker/` | Real workerd/SQLite isolation, recovery, WebSocket and contract tests |
| `test/browser/` | Mobile browser reload, notes, Library and Shortcut handoff checks |

## Development and verification

Use Node **22.19+ on the 22.x line, or 24.11+**. Some dependencies reject Node 24.9.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run types
npm run dev

npm run check          # typecheck, pure tests, workerd tests, production build
npm audit             # dependency advisories
```

Workers AI and Browser Run bindings are remote in local development. Real-model
smoke/browser tests use the configured account and may incur inference charges;
unit and recovery fixtures do not depend on live model output.

To run browser checks against a production build locally:

```sh
npm run build
npx wrangler dev --config dist/iphone_ai_flue_agent/wrangler.json \
  --var DEV_AUTH:local --host localhost --port 8792
# Separate terminal:
npm run test:browser
```

`--host localhost` is important: Wrangler otherwise rewrites the Worker request
hostname to the production custom domain, where the local auth bypass is refused.
The local override never enters the deployed Wrangler configuration.

```sh
npm run deploy
```

The Worker name, custom domain, Gateway ID and existing KV namespace intentionally
retain their original identifiers. Do not rename them during a runtime migration.

## Migration, privacy and limitations

See [migration/runbook](docs/pi-durable-migration.md) for inventory, replay safety,
legacy recovery, deployment and rollback constraints. The
[release verification](docs/pi-durable-release.md) records the deployed version,
import counts, test results and checks that still require the real iPhone.

- Pi Durable is experimental. Versions are pinned; upgrades require storage/recovery tests.
- The initial source store uses bounded SQLite records, not R2 or full repository clones.
- Library search is a bounded projection of recent entries/source excerpts and saved
  notes, not semantic search over every byte. Complete history remains exportable.
- Browser-local drafts may contain private text. Use Sign out on shared devices.
- AI Gateway logging has its own retention; deleting a session does not erase provider
  logs, GitHub issues/branches or copies previously exported from the application.
- Imported sessions preserve visible text and archive/guide evidence. Original tool
  traces stay in the read-only legacy store until explicitly deleted. Expired or
  previously unretained artifacts cannot be reconstructed by a runtime migration.
- The older generated HTML learning guide under `docs/` describes the previous Flue
  architecture and is historical, not the current implementation reference.
