# iPhone AI Flue Agent

## Start Here

- Runtime: Cloudflare Worker with Hono and a Flue SQLite-backed Durable Object agent.
- Main entrypoint: `src/app.ts` default Hono export.
- Primary user flows: one Shortcut calls `POST /v1/ask` for routed assistance; another calls stateless `POST /v1/correct` for grammar correction.
- Authoritative learning guide: [Detailed learning guide](docs/iphone-ai-flue-agent-learning-guide.html).

## What You Actually Maintain

1. `src/app.ts`: HTTP contracts, validation, KV handoff, and SSE streaming.
2. `src/lib/grammar-correction.ts`: stateless grammar request and response contract.
3. `src/agents/iphone-assistant.ts`: model, tools, routing signal, retries, and response metadata.
4. `src/tools/`: Jev classification and combined web research behavior.
5. `src/chat-page.ts`: the self-contained browser chat UI.
6. `wrangler.jsonc`: models, bindings, Durable Object migration, and observability.

Do not maintain generated or downloaded folders such as `dist/`, `.wrangler/`, and `node_modules/` by hand.

## What This Project Does

- Provides one iPhone Shortcut JSON contract for explanations, questions, and research requests.
- Provides a separate grammar-correction Shortcut contract with no chat, Jev, tools, or durable state.
- Uses Jev to select `direct_answer`, `web_research`, or `clarification` before generation.
- Runs answers through one durable Flue agent backed by GLM-5.2 and AI Gateway.
- Supports short-lived Shortcut-to-browser handoff and live SSE chat progress.

## Learning Guide

- [Authoritative project and learning documentation](docs/iphone-ai-flue-agent-learning-guide.html)
- [Interactive architecture diagram](docs/diagrams/index.html)
- [iPhone Shortcut migration guide](docs/SHORTCUT_GUIDE.md)
- Local guide agent: `cd "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/local-learning-guide-agent" && .venv/bin/python run_guide_agent.py "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/iphone-ai-flue-agent/docs/iphone-ai-flue-agent-learning-guide.html" --project-root "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/iphone-ai-flue-agent"`

README owns setup and launch commands. The HTML guide owns detailed architecture, flows, contracts, infrastructure mapping, state, and source walkthroughs.

## Architecture At A Glance

- One Worker receives Shortcut and browser requests through Hono.
- Grammar correction calls GLM-5.2 directly through the existing Workers AI binding and AI Gateway.
- Flue dispatches durable turns; the agent follows a Jev-selected route before generation.
- Workers AI calls pass through the `iphone-flue-shortcut` AI Gateway.
- `web_research` combines Browser Run page reading with DuckDuckGo or Wikipedia search.
- Workers KV stores only ten-minute browser handoff payloads.

## Traffic Flow (Input -> Output)

1. A Shortcut or browser sends a bounded request to the Worker.
2. Hono validates the selected endpoint contract.
3. `/v1/correct` calls Workers AI directly; assistant endpoints continue through Jev and Flue.
4. The Worker returns corrected text, an answer, or sanitized SSE progress.

## Hosting and Deployment

- Runtime: Cloudflare Workers, Flue Durable Object, Workers AI, AI Gateway, Browser Run, and Workers KV.
- Production: <https://iphoneai.oskarcode.com>
- Deploy: `npm run deploy`.
- Environments: one production configuration; no separate staging environment.
- Rollback: deploy a known-good Git revision and repeat representative smoke tests.
- Last live proof: version `9d5574df-416c-4ed6-91d2-b604ee0a557c` served healthy custom-domain ingress on 2026-09-25, and a post-deploy Shortcut request confirmed the new service-token identity fields in AI Gateway logs.

## Security Model

- Auth boundary: Cloudflare Access protects API and chat routes; iPhone Shortcuts use a service token, browser chat uses interactive Access identity, and `/health` remains public.
- AI Gateway identity: verified human requests are tagged with pseudonymous `access_user_id`; Shortcut calls use `service_token_id` and `caller_type=service_token`. Email is not logged, and reserved `cf.*` metadata is never supplied by the app.
- Secrets used: none in repository configuration; account services use Worker bindings.
- Access controls: alternate Worker and preview URLs are disabled; application code also bounds input, validates tool data, constructs safe DOM, and blocks literal private URLs.
- Known gaps: no application-level rate limit; URL validation does not revalidate DNS or redirects; KV consumption is not atomic.

## APIs and Interfaces

- One-shot: `POST /v1/ask`.
- Grammar correction: `POST /v1/correct`.
- Handoff: `POST /handoff` or `POST /v1/chat-session`, then `GET /chat?session=...`.
- Browser chat: `GET /chat`, `GET /chat/session/:id`, and `POST /chat/stream`.
- Non-streaming chat: `POST /chat/api`.
- Liveness: `GET /health`.
- Complete contracts and caller coverage: [learning guide](docs/iphone-ai-flue-agent-learning-guide.html#end-to-end-flows).

## Quick Start

```bash
npm install
npm run check
npm run dev
```

After deployment, export the Access service-token credentials used by the Shortcut:

```bash
export CF_ACCESS_CLIENT_ID='...'
export CF_ACCESS_CLIENT_SECRET='...'

curl -X POST https://iphoneai.oskarcode.com/v1/ask \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H 'content-type: application/json' \
  --data '{"text":"Explain Durable Objects in plain English."}'

curl -X POST https://iphoneai.oskarcode.com/v1/correct \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H 'content-type: application/json' \
  --data '{"text":"this are text copied from my clipboard"}'
```

## Troubleshooting Jump Table

- If input returns `400`, inspect `readTextBody()` or `validateChatMessages()` in `src/app.ts`.
- If grammar correction returns `502`, inspect `createGrammarRequest()`, `correctedTextFromAi()`, and AI Gateway logs.
- If the wrong route is selected, inspect `QUESTIONS`, `parseJevRoute()`, and `classifyWithJev()` in `src/tools/jev-router.ts`.
- If research fails, inspect `validatePublicUrl()` and `webResearch.run()` in `src/tools/web-research.ts`.
- If chat does not stream, inspect the `/chat/stream` handler, `projectConversationChunk()`, and browser network frames.
- If deployment fails after binding changes, run `npm run types`, then `npm run check`.
