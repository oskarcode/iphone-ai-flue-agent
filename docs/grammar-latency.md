# Grammar correction latency investigation

## Observed cause

`POST /v1/correct` already bypasses Flue agents, Jev, repository tools, chat history, and the review archive. It calls Workers AI through AI Gateway directly.

Production AI Gateway metadata for the latest observed grammar request showed:

- Model: `@cf/zai-org/glm-5.2`
- Inference duration: 15,296 ms
- User text length: 172 characters
- Corrected text length: 175 characters
- Generated tokens: 2,997
- Separate reasoning field: 5,308 characters
- Request already contained `reasoning_effort: "none"`

Only lengths and timings were inspected/reported here; copied user text and reasoning contents are not included.

The model was still generating hidden reasoning despite the top-level setting. The app returned only the correction, but waited for the entire model response.

## Controlled model API test

Same synthetic input, same prompt, same model, temperature 0, and the same 32,768-token ceiling. The only changed parameter was `chat_template_kwargs: { enable_thinking: false }`.

| Setting | API elapsed | Completion tokens | Reasoning characters |
| --- | ---: | ---: | ---: |
| `reasoning_effort: "none"` alone | 3,510 ms | 529 | 2,034 |
| Plus explicit template disable | 900 ms | 23 | 0 |

Both returned the same corrected text. Three additional short synthetic requests with explicit disable and a 512-token limit took 781–1,876 ms and returned corrections without reasoning. These are small-sample model API measurements, **not an iPhone latency guarantee**.

Smaller Llama models were also sampled, but exhibited correction/instruction-following errors, so this change keeps GLM-5.2.

## Fix

- Add `chat_template_kwargs: { enable_thinking: false }` alongside `reasoning_effort: "none"`.
- Size the output allowance to the UTF-8 input length, with a 256-token floor and the existing 32,768-token ceiling for long text.
- Continue rejecting truncated/incomplete provider output rather than returning a partial correction.
- Add `Server-Timing` and text-free structured logs for identity lookup, inference, and total route duration.
- Preserve the request/response contract: `{ text }` → `{ corrected_text }`.

Relevant code: `src/lib/grammar-correction.ts`, `src/app.ts`; regression tests: `test/grammar-correction.test.ts`, `test/grammar-route.test.ts`.

## Validation boundaries

- Production direct terminal request returned HTTP 403; no Access policy was changed or bypassed.
- Local real-binding smoke test could not start because installed workerd supports a maximum compatibility date of 2026-09-25, older than the project's 2026-10-13. Production compatibility was not lowered.
- Confirm the full authenticated Shortcut path using the next real request and its AI Gateway log/Server-Timing header.

Documentation: [GLM-5.2](https://developers.cloudflare.com/workers-ai/models/glm-5.2/) and [Workers AI chat-template options](https://developers.cloudflare.com/agents/models/ai-sdk/).
