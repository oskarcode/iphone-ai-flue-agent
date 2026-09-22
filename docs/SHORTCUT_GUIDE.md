# iPhone Shortcut Migration Guide

The original Worker remains available. Duplicate your Shortcut before changing its URL so rollback is immediate.

## New base URL

```text
https://iphone-ai-flue-agent.oskarmansanqu.workers.dev
```

## Recommended universal Shortcut

This version lets Jev decide whether the request needs correction, a direct answer, URL reading, or web search.

1. Add **Ask for Input** with prompt `What should the assistant do?`.
2. Add **Get Contents of URL**.
3. Set URL to `https://iphone-ai-flue-agent.oskarmansanqu.workers.dev/v1/ask`.
4. Set Method to `POST`.
5. Set Request Body to `JSON`.
6. Add the JSON field `text` and set its value to **Provided Input**.
7. Add **Get Dictionary Value** and select the key `answer`.
8. Add **Show Result**, **Copy to Clipboard**, or another output action.

Example inputs:

```text
Correct this text and return only the corrected version: this are a test
```

```text
https://developers.cloudflare.com/workers/ Explain this page simply.
```

```text
What are the latest Workers AI GLM models?
```

## Update the existing correction Shortcut

Only two values change:

- URL: `https://iphone-ai-flue-agent.oskarmansanqu.workers.dev/v1/correct`
- Result dictionary key: keep `corrected_text`

The request remains:

```json
{
  "text": "Shortcut Input"
}
```

## Update the existing explanation Shortcut

Only two values matter:

- URL: `https://iphone-ai-flue-agent.oskarmansanqu.workers.dev/v1/explain`
- Result dictionary key: keep `explanation`

You can now submit ordinary text, a complete URL, or a current-information question through the same explanation action.

## Update the browser handoff Shortcut

1. Change the URL to `https://iphone-ai-flue-agent.oskarmansanqu.workers.dev/handoff`.
2. Keep Method as `POST` and Request Body as JSON.
3. Keep the `text` field mapped to the selected or copied text.
4. Keep **Get Dictionary Value** with key `chat_url`.
5. Keep **Open URLs** using that value.

The handoff URL expires after ten minutes. The Worker deletes its KV value after the browser reads it, which provides best-effort one-time use for normal Shortcut workflows. The browser conversation then continues in one durable Flue session.

## Rollback

Change the URL back to your current production hostname:

```text
https://iphoneai.oskarcode.com
```

No change is made to the existing Worker while testing this project.


cd "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/local-learning-guide-agent" && .venv/bin/python run_guide_agent.py "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/iphone-ai-flue-agent/docs/iphone-ai-flue-agent-learning-guide.html" --project-root "/Users/oskarablimit/Desktop/Clouddlare SE/Demos (frequently used)/iphone-ai-flue-agent"