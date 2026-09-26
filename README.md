# iPhone AI Flue Agent

A Cloudflare Worker that turns iPhone Shortcuts into a secure AI assistant. It can answer questions, research public webpages, correct grammar, and hand selected text to a browser chat with durable follow-up conversation.

The reference deployment is available at <https://iphoneai.oskarcode.com> and is protected by Cloudflare Access.

## What It Does

This project supports three main experiences:

1. **Universal AI Shortcut**: send a question or selected text to `POST /v1/ask`. Jev chooses whether the request needs a direct answer, web research, or clarification.
2. **Grammar Shortcut**: send clipboard or Share Sheet text to `POST /v1/correct`. This stateless path returns corrected text without creating a conversation or invoking research tools.
3. **Browser handoff**: send selected text to `POST /handoff`, open the returned URL, and continue in a streamed browser chat backed by a durable Flue conversation.

Example requests:

```text
Explain Durable Objects in plain English.
```

```text
https://developers.cloudflare.com/workers/ Summarize this page.
```

```text
Correct the grammar in text copied from my clipboard.
```

## How It Works

### Routed assistant flow

```text
iPhone Shortcut
  -> Cloudflare Access service-token check
  -> Hono route in src/app.ts
  -> Jev route classification
  -> Flue durable agent
  -> Workers AI through AI Gateway
  -> optional Browser Run and public search
  -> JSON answer or streamed browser response
```

### Grammar flow

```text
iPhone Shortcut
  -> Cloudflare Access service-token check
  -> POST /v1/correct
  -> deterministic grammar prompt
  -> Workers AI through AI Gateway
  -> {"corrected_text":"..."}
```

### Browser handoff flow

```text
iPhone Shortcut
  -> POST /handoff
  -> selected text stored in Workers KV for 10 minutes
  -> browser opens /chat?session=<id>
  -> browser consumes and deletes the KV value
  -> follow-up messages stream from one Flue Durable Object conversation
```

## Technology Stack

| Technology | Role |
|---|---|
| [Cloudflare Workers](https://developers.cloudflare.com/workers/) | HTTP runtime and deployment unit |
| [Hono](https://hono.dev/) | Worker routing and request handling |
| [Flue](https://www.npmjs.com/package/@flue/runtime) | Durable AI-agent dispatch, model integration, tools, and conversation state |
| [Workers AI](https://developers.cloudflare.com/workers-ai/) | Jev classification, grammar correction, and answer generation |
| [AI Gateway](https://developers.cloudflare.com/ai-gateway/) | AI request logs, metadata, caching controls, and observability |
| [Durable Objects](https://developers.cloudflare.com/durable-objects/) | SQLite-backed state for browser follow-up conversations |
| [Workers KV](https://developers.cloudflare.com/kv/) | Short-lived text transfer from Shortcut to browser |
| [Browser Run](https://developers.cloudflare.com/browser-run/) | Converts public webpages into Markdown for research |
| [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/) | Protects API and browser routes for users and service tokens |
| TypeScript, Vite, Vitest | Development, build, type checking, and tests |

## Project Structure

```text
src/app.ts                         Worker entrypoint, routes, validation, KV, and SSE
src/agents/iphone-assistant.ts    Flue agent, model, tools, routing signal, and retries
src/lib/configured-message.ts     Trusted route context passed into durable agent turns
src/lib/gateway-metadata.ts       Pseudonymous Access identity for AI Gateway logs
src/lib/grammar-correction.ts     Stateless grammar request and response handling
src/lib/chat-events.ts            Safe projection of internal Flue events to the browser
src/tools/jev-router.ts           Jev route classification
src/tools/web-research.ts         Browser Run, DuckDuckGo, and Wikipedia research
src/chat-page.ts                  Self-contained browser chat HTML, CSS, and JavaScript
src/prompts.ts                    Model instructions
test/                             Unit and route tests
wrangler.jsonc                    Cloudflare resources, bindings, routes, and variables
```

## API Overview

The Worker does not implement its own authentication middleware, so the deployment should place its hostname behind Cloudflare Access. `GET /health` does not invoke AI or return private data and may be left public if your Access policy explicitly allows it.

| Method and path | Purpose | Main response |
|---|---|---|
| `GET /health` | Public liveness check | `{status, framework, router}` |
| `POST /v1/ask` | New routed assistant request | `{answer, route?}` |
| `POST /v1/correct` | Stateless grammar correction | `{corrected_text}` |
| `POST /handoff` | Create a temporary browser handoff | `{chat_url, expires_in_seconds}` |
| `POST /v1/chat-session` | Alias for handoff creation | `{chat_url, expires_in_seconds}` |
| `GET /chat` | Serve the browser chat | HTML |
| `GET /chat/session/:id` | Consume temporary handoff text | `{text}` |
| `POST /chat/stream` | Continue a conversation with SSE | `status`, `progress`, `done`, or `error` events |
| `POST /chat/api` | Non-streaming durable chat | `{answer, conversation_id, route?}` |

Text endpoints accept JSON with a non-empty `text` field. Chat endpoints accept a bounded conversation ID and message history ending with a user message.

## Run It Locally

### Prerequisites

- Node.js and npm.
- A Cloudflare account with Workers AI, Browser Run, Workers KV, and Durable Objects available.
- Wrangler authenticated to your account.

```bash
git clone https://github.com/oskarcode/iphone-ai-flue-agent.git
cd iphone-ai-flue-agent
npm install
npx wrangler login
npm run check
npm run dev
```

Workers AI and Browser Run use remote bindings in this project. Local requests can therefore call real Cloudflare account resources and may incur usage.

## Deploy Your Own Copy

### 1. Fork and configure the Worker

Fork the repository, then update these values in `wrangler.jsonc`:

| Setting | What to change |
|---|---|
| `name` | Your Worker name |
| `routes[0].pattern` | A hostname in a Cloudflare-managed zone, such as `iphone-ai.example.com` |
| `MODEL` | The Workers AI model used by the Flue agent and grammar route |
| `AI_GATEWAY_ID` | Your AI Gateway ID, or `default` to let Cloudflare create the default gateway on the first authenticated request |
| `JEV_MODEL` | The Workers AI model used for route classification |
| `kv_namespaces[0].id` | Your own KV namespace ID |

The configured custom domain must belong to an active Cloudflare zone. Cloudflare creates the DNS record and certificate when Wrangler deploys the Custom Domain.

### 2. Create the KV namespace

```bash
npx wrangler kv namespace create CHAT_SESSIONS
```

Copy the returned namespace ID into the `CHAT_SESSIONS` entry in `wrangler.jsonc`. Keep the binding name as `CHAT_SESSIONS` unless you also update the code.

### 3. Review the Cloudflare bindings

The Worker expects these binding names:

```jsonc
{
  "ai": { "binding": "AI", "remote": true },
  "browser": { "binding": "BROWSER", "remote": true },
  "kv_namespaces": [
    { "binding": "CHAT_SESSIONS", "id": "<YOUR_KV_NAMESPACE_ID>" }
  ]
}
```

The existing Durable Object migration creates the SQLite-backed `FlueIphoneAssistantAgent` namespace during deployment. Do not rename or remove an applied migration tag casually.

### 4. Deploy

```bash
npm run deploy
```

The deploy script runs type checking, all tests, and a production build before calling Wrangler.

Verify the public health route:

```bash
curl https://iphone-ai.example.com/health
```

### 5. Protect the hostname with Cloudflare Access

Create a self-hosted Access application for your hostname. Add:

- An interactive policy for people who may use browser chat.
- A **Service Auth** policy that includes a service token for iPhone Shortcuts.

Create the token under **Zero Trust > Access controls > Service credentials > Service Tokens**. Save the Client Secret when it is generated because Cloudflare displays it only once. Do not commit either credential.

Non-browser clients authenticate with these headers:

```text
CF-Access-Client-Id: <CLIENT_ID>
CF-Access-Client-Secret: <CLIENT_SECRET>
```

## Build The iPhone Shortcuts

Replace `https://iphone-ai.example.com` with your deployed hostname and add your Access service-token headers to every API request.

### Universal assistant Shortcut

1. Add **Ask for Input** with a prompt such as `What should the assistant do?`.
2. Add **Get Contents of URL**.
3. Set the URL to `https://iphone-ai.example.com/v1/ask`.
4. Set the method to `POST` and the request body to `JSON`.
5. Add a `text` field using **Provided Input**.
6. Add `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.
7. Add **Get Dictionary Value** for `answer`.
8. Show, speak, or copy the result.

### Grammar correction Shortcut

1. Start with **Get Clipboard** or Share Sheet input.
2. Add **Get Contents of URL** for `https://iphone-ai.example.com/v1/correct`.
3. Use `POST` with a JSON `text` field containing the clipboard or Shortcut input.
4. Add both Access service-token headers.
5. Read the `corrected_text` dictionary value.
6. Copy, display, or replace text with the result.

### Browser handoff Shortcut

1. Start with selected text, Share Sheet input, or clipboard content.
2. POST it as the JSON `text` field to `https://iphone-ai.example.com/handoff`.
3. Add both Access service-token headers.
4. Read the returned `chat_url` dictionary value.
5. Open that URL. The browser completes interactive Access authentication and loads the selected text.

The handoff expires after ten minutes and uses best-effort one-time consumption. The browser then continues in one durable conversation.

## Customize It

| Goal | Main files |
|---|---|
| Change API contracts or validation | `src/app.ts` |
| Change the AI model or gateway | `wrangler.jsonc`, `src/app.ts`, `src/agents/iphone-assistant.ts` |
| Change route-selection criteria | `src/tools/jev-router.ts` |
| Change assistant or grammar behavior | `src/prompts.ts`, `src/lib/grammar-correction.ts` |
| Add or change research providers | `src/tools/web-research.ts` |
| Change browser chat UI | `src/chat-page.ts` |
| Change which identity appears in Gateway logs | `src/lib/gateway-metadata.ts`, `src/lib/configured-message.ts` |

Run the complete verification suite after changes:

```bash
npm run check
```

This runs TypeScript checking, 64 tests, and the production Vite build.

## Security Notes

- Cloudflare Access should protect every AI and chat route. `/health` is the only route designed to be safe for an optional public liveness check.
- Service-token secrets belong in iPhone Shortcut headers or another secret store, never in Git.
- Human AI Gateway requests use pseudonymous `access_user_id`; service-token calls use `service_token_id`. The application does not add email addresses to Gateway metadata.
- The app bounds request sizes and chat history, validates model tool inputs, and avoids inserting raw model HTML into the browser.
- Before broader production use, add application-level rate limiting and stronger DNS/redirect-aware SSRF protection for web research.
- KV handoff consumption uses separate read and delete operations, so it is not strictly atomic under concurrent access.

## Troubleshooting

| Symptom | First place to check |
|---|---|
| `400` response | Request JSON and `readTextBody()` or `validateChatMessages()` in `src/app.ts` |
| `403` or Access login | Access application policies and service-token headers |
| Grammar route returns `502` | AI Gateway logs and `src/lib/grammar-correction.ts` |
| Wrong route is selected | `src/tools/jev-router.ts` and `JEV_MODEL` |
| Research fails | `validatePublicUrl()` and provider calls in `src/tools/web-research.ts` |
| Browser chat does not stream | `/chat/stream`, `src/lib/chat-events.ts`, and browser network frames |
| Binding or deployment failure | `wrangler.jsonc`, then `npm run types` and `npm run check` |

For live Worker logs:

```bash
npx wrangler tail
```

## Official Cloudflare References

- [Workers AI with AI Gateway](https://developers.cloudflare.com/ai-gateway/integrations/aig-workers-ai-binding/)
- [Workers KV namespaces](https://developers.cloudflare.com/kv/concepts/kv-namespaces/)
- [Browser Run Quick Actions](https://developers.cloudflare.com/browser-run/quick-actions/)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)

## License

No open-source license is currently included. Add a license before redistributing this project as an open-source package.
