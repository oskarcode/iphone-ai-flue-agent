# iPhone AI Flue Agent

A separate successor to `iphone-ai-text-api`. It preserves the existing Shortcut-compatible HTTP contracts while moving every generated response through one durable Flue agent backed by Workers AI.

## Architecture

```text
iPhone Shortcut or browser
        |
        v
Hono compatibility route
        |
        v
Jev intent classification
        |
        v
One Flue IphoneAssistant agent
        |
        +-- direct GLM response
        +-- read_url via Browser Run
        +-- web_search, optionally followed by read_url
```

The model is `@cf/zai-org/glm-5.2`. Jev selects `correct`, `direct_answer`, `read_url`, `web_search`, or `clarification` before the first model turn.

## Routes

| Route | Request | Response |
| --- | --- | --- |
| `GET /health` | None | Worker status |
| `POST /v1/ask` | `{ "text": "..." }` | `{ "answer": "..." }` |
| `POST /v1/correct` | `{ "text": "..." }` | `{ "corrected_text": "..." }` |
| `POST /v1/explain` | `{ "text": "..." }` | `{ "explanation": "..." }` |
| `POST /handoff` | `{ "text": "..." }` | One-time browser chat URL |
| `GET /chat` | None | Browser chat UI |

Use `/v1/ask` for one universal Shortcut. Keep the compatibility routes when you want stable field names for an existing Shortcut.

## Local setup

```bash
npm install
npm run check
npm run dev
```

Workers AI, Jev, and Browser Run use Cloudflare bindings, so no provider secret is required. Browser Run Quick Actions use a remote binding during local development.

## Deploy

```bash
npm run deploy
```

## Testing

```bash
npm run typecheck
npm test
npm run build
npm run check
```

After deployment:

```bash
curl https://iphone-ai-flue-agent.oskarmansanqu.workers.dev/health
curl -X POST https://iphone-ai-flue-agent.oskarmansanqu.workers.dev/v1/ask \
  -H 'content-type: application/json' \
  --data '{"text":"Explain Durable Objects in plain English."}'
```

## Current Cloudflare references

- [Browser Run Quick Actions](https://developers.cloudflare.com/browser-run/quick-actions/)
- [GLM-5.2 on Workers AI](https://developers.cloudflare.com/workers-ai/models/glm-5.2/)
- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)

## Data behavior

Flue conversations use Durable Object storage. Browser chat reuses one conversation ID for follow-up turns. One-shot requests use a new random conversation ID per request.
