# iPhone AI Flue Agent

## Start Here (Python/Django Mental Model)

| This project | Django/Python equivalent |
|---|---|
| `src/app.ts` Hono routes | `urls.py` plus small `views.py` handlers |
| `src/agents/iphone-assistant.ts` | A durable service object that orchestrates an LLM and tools |
| `src/tools/*.ts` | Service functions with Pydantic-like runtime input validation |
| `src/chat-page.ts` | A Django template plus browser JavaScript, returned by one view |
| `wrangler.jsonc` | `settings.py` plus the hosting manifest and injected services |
| `package.json` | `pyproject.toml` scripts and dependencies |
| `test/*.test.ts` | pytest test modules |

## What You Actually Maintain

1. `src/app.ts`: HTTP routes, request validation, KV handoff, and SSE streaming.
2. `src/agents/iphone-assistant.ts`: model, tools, routing signal, retries, and response metadata.
3. `src/tools/`: Jev classification and combined web research behavior.
4. `src/chat-page.ts`: the self-contained browser chat UI.
5. `wrangler.jsonc`: models, bindings, Durable Object migration, and observability.

Generated/dependency folders (`dist/`, `.wrangler/`, `node_modules/`) and generated Worker types are excluded by `.gitignore`. Do not maintain them by hand.

## What This Project Does

- Preserves the iPhone Shortcut JSON contracts for explanation and universal questions.
- Uses Jev to select `direct_answer`, `web_research`, or `clarification` before generation.
- Runs answers through one durable Flue agent backed by GLM-5.2 and AI Gateway.
- Supports short-lived Shortcut-to-browser handoff and live SSE chat progress.

## Learning Guide

- [Detailed learning guide](docs/iphone-ai-flue-agent-learning-guide.html)
- [Interactive architecture diagram](docs/diagrams/index.html)
- [iPhone Shortcut migration guide](docs/SHORTCUT_GUIDE.md)
- Local guide agent: `cd "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/local-learning-guide-agent" && .venv/bin/python run_guide_agent.py "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/iphone-ai-flue-agent/docs/iphone-ai-flue-agent-learning-guide.html" --project-root "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/iphone-ai-flue-agent"`

## Architecture At A Glance

- One Cloudflare Worker receives Shortcut and browser requests through Hono.
- Flue dispatches the durable turn; the agent runs Jev before model generation and follows the selected route.
- Workers AI calls use the `iphone-flue-shortcut` AI Gateway.
- `web_research` can combine Browser Run page reading with DuckDuckGo or Wikipedia search in one tool call.
- Workers KV stores only ten-minute browser handoff payloads.

## Traffic Flow (Input -> Output)

1. Shortcut sends `{ "text": "..." }` to a compatibility route.
2. The Worker validates input and dispatches the durable Flue agent turn.
3. The agent runs Jev before generation; GLM may then make one or more retrieval tool calls.
4. The Worker returns JSON, or streams sanitized SSE progress to the browser chat.

## Hosting and Deployment

- Runtime: Cloudflare Workers, Flue Durable Object, Workers AI, AI Gateway, Browser Run, and Workers KV.
- Production: <https://iphone-ai-flue-agent.oskarmansanqu.workers.dev>
- Local: `npm install`, then `npm run dev`.
- Verify everything: `npm run check`.
- Deploy: `npm run deploy`.
- Environment: one production configuration; no separate staging environment is defined.

## Security Model

- Auth boundary: endpoints are public; this demo does not enforce Cloudflare Access or API authentication.
- Secrets used: none in the repository; account services are accessed through Worker bindings.
- Input controls: bounded text/history, runtime tool schemas, safe DOM rendering, and public-URL checks.
- Cost warning: any public caller can trigger Workers AI, Jev, Browser Run, and search traffic.
- URL limitation: `web_research` blocks obvious local/literal private targets but does not independently validate DNS resolution or redirect destinations.
- Handoff limitation: KV get/delete is best-effort one-time use, not an atomic consume operation.

## APIs and Interfaces

| Route | Purpose | Response |
|---|---|---|
| `GET /health` | Liveness and framework identity | Status JSON |
| `POST /v1/ask` | Universal one-shot Shortcut request | `answer`, `route` |
| `POST /v1/explain` | Explanation compatibility route | `explanation` |
| `POST /handoff` | Create a ten-minute browser handoff | `chat_url` |
| `POST /v1/chat-session` | Versioned handoff alias | `chat_url` |
| `GET /chat` | Self-contained browser UI | HTML |
| `GET /chat/session/:id` | Read and delete handoff text | `text` |
| `POST /chat/stream` | Live classification/tool/token events | SSE |
| `POST /chat/api` | Non-streaming browser-compatible chat | JSON |

## Quick Start

```bash
npm install
npm run check
npm run dev
```

After deployment:

```bash
curl https://iphone-ai-flue-agent.oskarmansanqu.workers.dev/health
curl -X POST https://iphone-ai-flue-agent.oskarmansanqu.workers.dev/v1/ask \
  -H 'content-type: application/json' \
  --data '{"text":"Explain Durable Objects in plain English."}'
```

## Troubleshooting Jump Table

- If input returns `400`, inspect `readTextBody()` or `validateChatMessages()` in `src/app.ts`.
- If the wrong path is selected, inspect `QUESTIONS`, `parseJevRoute()`, and `classifyWithJev()` in `src/tools/jev-router.ts`.
- If research fails, inspect `validatePublicUrl()` and `webResearch` in `src/tools/web-research.ts`, then Browser Run and search-provider availability.
- If chat does not stream, inspect `/chat/stream`, `projectConversationChunk()`, and the browser network response.
- If deployment fails after binding changes, run `npm run types`, `npm run check`, then inspect `wrangler.jsonc`.

## Current Cloudflare References

- [Browser Run Quick Actions](https://developers.cloudflare.com/browser-run/quick-actions/)
- [AI Gateway Worker bindings](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/)
- [Workers traces](https://developers.cloudflare.com/workers/observability/traces/)
- [Workers KV delete](https://developers.cloudflare.com/kv/api/delete-key-value-pairs/)
