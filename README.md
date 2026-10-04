# iPhone AI Flue Agent

A Cloudflare Worker for iPhone AI shortcuts, durable browser chat, grammar correction, public-web research, and temporary code-learning guides for public GitHub repositories.

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
4. `src/lib/learning-session.ts`: one-hour KV state and atomic guide publication.
5. `src/chat-page.ts` and `src/learning-page.ts`: fixed self-contained browser interfaces.
6. `wrangler.jsonc`: production route, bindings, Durable Object migrations, and observability.

## What This Project Does
- `POST /v1/ask` routes one-shot requests to direct answers, web research, clarification, or GitHub learning.
- `POST /v1/correct` performs stateless grammar correction.
- `POST /handoff` moves selected iPhone text into a ten-minute browser chat handoff.
- Browser chat streams durable follow-up answers from a Flue Durable Object.
- Public GitHub URLs can produce an escaped, mobile-first learning guide pinned to one commit for one hour.
- The existing copy -> iPhone handoff Shortcut -> chat flow treats a copied `github.com/owner/repository` URL as GitHub learning and returns a clickable guide link.
- Ready guides include a floating repository tutor; selecting guide text prepares bounded, explicitly untrusted context for a follow-up explanation.

## Learning Guide
- [Detailed learning guide](docs/iphone-ai-flue-agent-learning-guide.html)
- [Interactive architecture diagram](docs/diagrams/index.html)
- Local guide agent: `cd "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/local-learning-guide-agent" && .venv/bin/python run_guide_agent.py "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/iphone-ai-flue-agent/docs/iphone-ai-flue-agent-learning-guide.html" --project-root "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/iphone-ai-flue-agent"`

## Architecture At A Glance
- One Hono Worker is the HTTP entrypoint and fixed HTML renderer.
- `FlueIphoneAssistantAgent` stores normal conversation history in a Durable Object.
- `FlueGithubLearningAgent` stores one repository tutor and expires its state after one hour.
- `CHAT_SESSIONS` KV stores ten-minute handoffs and one-hour learning records/receipts.
- Workers AI runs through AI Gateway; Browser Run and public search support web research.
- GitHub API and raw content are read-only, bounded, and pinned to a resolved commit SHA.

## Traffic Flow (Input -> Output)
1. Shortcut/chat request -> Cloudflare Access -> Hono route -> Jev classification.
2. Normal request -> durable assistant -> Workers AI and optional research -> JSON or SSE answer.
3. GitHub learning request -> resolve repository -> queued KV record -> durable tutor -> atomic ready record -> learning page.
4. Typed question or selected guide text -> bounded follow-up payload -> same session Durable Object -> commit-pinned answer.
5. Expiry/manual delete -> KV record and Durable Object storage removed.

## Hosting and Deployment
- Runtime: Cloudflare Workers at `https://iphoneai.oskarcode.com`.
- Deploy command: `npm run deploy`.
- Verification command: `npm run check`.
- Current deployed version: `399ff432-87ac-4017-81ec-2097dd8fb692`.
- Copied GitHub repository URLs now route from the existing handoff chat to a clickable temporary learning guide.
- The floating mobile tutor is deployed; health and Access ingress passed smoke checks. Its authenticated selection interaction still needs a browser smoke test.

## Security Model
- Auth boundary: Cloudflare Access is expected to protect AI/chat ingress; the Worker has no application auth middleware.
- Public learning links: opaque UUIDs, one-hour expiry, and explicit deletion; anyone with an allowed link can use that session.
- Secret name: optional `GITHUB_TOKEN` raises GitHub API limits; never commit its value.
- Repository controls: public repositories only, immutable commit SHA, allowlisted paths, fixed GitHub hosts, timeouts, and byte limits.
- Rendering controls: model content is schema-validated and escaped; browser chat answers use `textContent`.
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
| `GET /learn/:id`, `/status`, `/events` | Guide page and generation lifecycle |
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
- If selection context is missing, highlight text outside the tutor panel; the selection controls remain disabled until context is captured.
- If deployment fails, inspect `wrangler.jsonc`, then run `npm run types` and `npm run check`.
- Live logs: `npx wrangler tail iphone-ai-flue-agent`.

## License
No open-source license is currently included. Add one before redistribution.
