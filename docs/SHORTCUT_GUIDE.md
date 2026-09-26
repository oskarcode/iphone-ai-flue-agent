# iPhone Shortcut Migration Guide

Duplicate your Shortcut before changing it so rollback is immediate. The custom domain requires the configured Cloudflare Access service-token headers.

## New base URL

```text
https://iphoneai.oskarcode.com
```

## Recommended universal Shortcut

This version lets Jev choose a direct answer, combined web research, or one clarification question.

1. Add **Ask for Input** with prompt `What should the assistant do?`.
2. Add **Get Contents of URL**.
3. Set URL to `https://iphoneai.oskarcode.com/v1/ask`.
4. Set Method to `POST`.
5. Set Request Body to `JSON`.
6. Add the JSON field `text` and set its value to **Provided Input**.
7. Add the `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers using the service-token values.
8. Add **Get Dictionary Value** and select the key `answer`.
9. Add **Show Result**, **Copy to Clipboard**, or another output action.

Example inputs:

```text
Explain the difference between Workers KV and Durable Objects.
```

```text
https://developers.cloudflare.com/workers/ Explain this page simply.
```

```text
What are the latest Workers AI GLM models?
```

## Dedicated grammar correction Shortcut

This path performs one stateless correction. It does not create a chat, call Jev, use research tools, or write durable conversation state.

The route is deployed on the production custom domain.

1. Add **Get Clipboard** or use the Shortcut input from the Share Sheet.
2. Add **Get Contents of URL**.
3. Set URL to `https://iphoneai.oskarcode.com/v1/correct`.
4. Set Method to `POST`.
5. Set Request Body to `JSON`.
6. Add the JSON field `text` and set it to **Clipboard** or **Shortcut Input**.
7. Add the `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers using the service-token values.
8. Add **Get Dictionary Value** with key `corrected_text`.
9. Add **Copy to Clipboard**, **Show Result**, or **Replace Text** using that value.

The route accepts non-whitespace text up to 30,000 JavaScript UTF-16 code units and returns:

```json
{"corrected_text":"This is corrected text."}
```

## Update an existing explanation Shortcut

Only two values matter:

- URL: `https://iphoneai.oskarcode.com/v1/ask`
- Result dictionary key: `answer`

Make the intent explicit in the `text` field, for example: `Explain this pasted text in plain English: ...`. The same endpoint also handles general questions, URLs, and current-information requests.

## Update the browser handoff Shortcut

1. Change the URL to `https://iphoneai.oskarcode.com/handoff`.
2. Keep Method as `POST` and Request Body as JSON.
3. Add the `CF-Access-Client-Id` and `CF-Access-Client-Secret` service-token headers.
4. Keep the `text` field mapped to the selected or copied text.
5. Keep **Get Dictionary Value** with key `chat_url`.
6. Keep **Open URLs** using that value; the browser completes interactive Access authentication.

The handoff URL expires after ten minutes. The Worker deletes its KV value after the browser reads it, which provides best-effort one-time use for normal Shortcut workflows. The browser conversation then continues in one durable Flue session.

## Rollback

Restore the duplicated Shortcut or its previous action configuration. The old `workers.dev` route is intentionally disabled and is not a rollback endpoint.
