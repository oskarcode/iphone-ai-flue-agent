# iPhone AI Flue Agent

A Cloudflare Worker for iPhone AI shortcuts, durable browser chat, grammar correction, web research, and commit-pinned GitHub tutoring in the same chat interface.

## Start Here (Python/Django Mental Model)
| This project | Django/Python equivalent |
|---|---|
| `src/app.ts` Hono routes | `urls.py` plus `views.py` or FastAPI route decorators |
| `IphoneAssistant` / `GithubLearningAgent` | Stateful service classes backed by durable persistence |
| Valibot schemas | Pydantic models or DRF serializers |
| `wrangler.jsonc` bindings | `settings.py` plus injected service clients |
| Workers KV | Expiring cache/session storage |
| Durable Objects | One SQLite-backed actor per conversation/session ID |
| `package.json` scripts | `pyproject.toml` commands and dependency manifest |
| Vitest files | pytest modules |

## What You Actually Maintain
1. `src/app.ts`: public HTTP contracts, validation, routing, SSE, and service orchestration.
2. `src/agents/`: durable assistant behavior and lifecycle.
3. `src/tools/`: Jev routing, web research, and commit-pinned GitHub reads.
4. `src/lib/learning-session.ts`: repository session KV state and atomic setup publication.
5. `src/chat-page.ts` and `src/learning-page.ts`: fixed self-contained browser interfaces.
6. `wrangler.jsonc`: production route, bindings, Durable Object migrations, and observability.

## What This Project Does
- `POST /v1/ask` routes one-shot requests to direct answers, web research, clarification, or GitHub learning.
- `POST /v1/correct` performs stateless grammar correction directly through Workers AI, with explicit thinking disabled, input-sized output limits, and `Server-Timing` diagnostics. See [latency investigation](docs/grammar-latency.md).
- `POST /handoff` moves selected iPhone text into a ten-minute browser chat handoff.
- Browser chat streams durable follow-up answers from a Flue Durable Object.
- GitHub learning intent switches the main browser chat into repository tutor mode, pinned to one commit. Private repositories require a server-side `GITHUB_TOKEN` with access.
- Explicit visual explanation requests can produce a temporary, mobile-first interactive SVG explainer page for a technical concept.
- Repository starter prompts appear under the composer; follow-ups reuse the same tutor. **General chat** replaces the repository view with the general conversation; **Repository tutor** returns to the same tutor. Each mode retains its own transcript, unsent draft, and scroll position. **New chat** resets both browser views.
- **What I learned · post draft** uses the active conversation to request one cohesive X-style post: a natural opening, concrete lessons, an integrated TypeScript mental model, and a grounded closing. It targets roughly 100–160 words, so it may require X long-post support or adaptation before publishing. The entire post is in one copyable block; nothing posts automatically. Private-source redaction is prompt-based, not a guaranteed publication filter: review drafts before sharing.
- Review is no longer linked from chat. New conversation turns and automatic social drafts are not copied into the review archive. Historical records, repository setup snapshots, and GitHub action audit records remain; no existing data is deleted.
- The UI is unified, not the backend: Flue still persists separate assistant/repository agents, and repository setup still publishes an internal payload. This is not browser-only storage.

## Learning Guide
- [Detailed learning guide](docs/iphone-ai-flue-agent-learning-guide.html)
- [Interactive architecture diagram](docs/diagrams/index.html)
- Local guide agent: `cd "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/local-learning-guide-agent" && .venv/bin/python run_guide_agent.py "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/iphone-ai-flue-agent/docs/iphone-ai-flue-agent-learning-guide.html" --project-root "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/iphone-ai-flue-agent"`

## Architecture At A Glance
- One Hono Worker is the HTTP entrypoint and fixed HTML renderer.
- `FlueIphoneAssistantAgent` stores normal conversation history in a Durable Object.
- `FlueGithubLearningAgent` stores one repository tutor without a scheduled expiry.
- `CHAT_SESSIONS` KV stores ten-minute handoffs and repository records/receipts without a TTL.
- Workers AI runs through AI Gateway; Cloudflare Web Search (Exa) and Workers AI page conversion support web research.
- GitHub reads are bounded and pinned to a resolved commit SHA. Private file reads use the authenticated Contents API. Issue creation and branch-only single-file edits require chat permission (prompt-enforced).

## Traffic Flow (Input -> Output)
1. Shortcut/chat request -> Cloudflare Access -> Hono route -> Jev classification.
2. Normal request -> durable assistant -> Workers AI and optional research -> JSON or SSE answer.
3. GitHub learning request -> resolve repository -> queued KV record -> durable tutor -> ready record -> original question answered inside main chat.
4. Tutor follow-up -> bounded payload -> same repository Durable Object -> formatted answer. Legacy `/learn/:id` links still work.
5. Manual delete API -> repository KV record and tutor Durable Object storage removed. New chat only resets the browser UI.

## Hosting and Deployment
- Runtime: Cloudflare Workers at `https://iphoneai.oskarcode.com`.
- Deploy command: `npm run deploy`.
- Verification command: `npm run check`.
- Use Wrangler deployment output for the current production version.
- Automated checks cover recap routing, repository handoff, setup polling, cancellation, and safe rendering. Authenticated browser/private-repository interactions need a separate smoke test.

## Security Model
- Auth boundary: Cloudflare Access is expected to protect AI/chat ingress; the Worker has no application auth middleware.
- Learning links use opaque UUIDs and explicit deletion, not expiry or owner-bound authorization. Verify Access protection on `/learn/*` and legacy `/review/*`, especially before private-repository use.
- Secret name: `GITHUB_TOKEN` enables authenticated GitHub access; never commit its value.
- Repository controls: immutable read commit SHA, allowlisted paths, fixed GitHub hosts, timeouts, and byte limits.
- Rendering controls: model HTML is not trusted; main chat uses DOM text nodes, and the legacy tutor uses an escaped Markdown subset.
- Follow-up controls: question, selection, and section context are independently bounded; selected guide text is labeled untrusted in both the HTTP prompt and tutor system instructions.
- Demo limitation: there is no application-level rate limit or creator-bound authorization for learning sessions.

## APIs and Interfaces
| Method and path | Purpose |
|---|---|
| `GET /health` | Liveness without AI |
| `POST /v1/ask` | Routed one-shot assistant or learning-session creation |
| `POST /v1/correct` | Stateless grammar correction |
| `POST /handoff`, `POST /v1/chat-session` | Create ten-minute browser handoff |
| `GET /chat`, `GET /chat/session/:id` | Browser UI and one-time handoff consumption |
| `POST /chat/stream`, `POST /chat/api` | Streaming or complete durable answers |
| `GET /learn/:id`, `/status`, `/events` | Legacy tutor page and shared setup lifecycle |
| `GET /visual/:id` | Temporary interactive visual explainer page |
| `POST /learn/:id/chat` | Commit-pinned tutor follow-up with a question and optional selected guide context |
| `DELETE /v1/learning-sessions/:id` | Immediate KV and Durable Object cleanup |

## Quick Start
```bash
npm install
npm run check
npm run dev
```

Remote AI and Browser bindings can use account resources during local development. Deploy only after `npm run check` passes.

## Troubleshooting Jump Table
- If a request returns `400`, inspect its route contract and bounded body helper in `src/app.ts`.
- If Access redirects or returns `403`, inspect the Access application and service-token policy.
- If Jev chooses the wrong route, inspect `QUESTIONS` in `src/tools/jev-router.ts`.
- If GitHub creation returns `502`, inspect GitHub URL/repository visibility, API limits, and `resolveGithubRepository()`.
- If a guide stays queued, inspect `/learn/:id/status`, `/events`, Durable Object logs, and submission receipt KV state.
- If a guide fails, reload `/learn/:id`; terminal errors are stored and polling stops.
- To leave repository mode or learn a different repository, choose **General chat** first. The recap preset uses the current conversation; review its wording and source privacy before posting.
- If deployment fails, inspect `wrangler.jsonc`, then run `npm run types` and `npm run check`.
- Live logs: `npx wrangler tail iphone-ai-flue-agent`.

## License
No open-source license is currently included. Add one before redistribution.
