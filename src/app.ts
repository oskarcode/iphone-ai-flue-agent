import { Hono, type Context } from "hono";
import { verifyIdentity, type Identity } from "./runtime/auth.ts";
import {
  PERSONAL_OWNER,
  SESSION_ID,
  type SessionMetadata,
} from "./runtime/contracts.ts";
import { projectLegacyMessages } from "./runtime/legacy.ts";
import { classifyWithJev, type JevRoute } from "./tools/jev-router.ts";
import {
  resolveGithubRepository,
  parseGithubRepositoryRequest,
  type GithubRepository,
} from "./tools/github-repository.ts";
import {
  getLearningSessionRecord,
  LEARNING_SESSION_TTL_SECONDS,
} from "./lib/learning-session.ts";
import {
  getVisualSession,
  putVisualSession,
  VISUAL_SESSION_TTL_SECONDS,
  type VisualSessionMetadata,
} from "./lib/visual-session.ts";
import { generateVisualExplainer } from "./lib/visual-explainer.ts";
import { renderVisualExplainerPage } from "./visual-page.ts";
import {
  createGrammarRequest,
  correctedTextFromAi,
  grammarModelFromConfiguredModel,
} from "./lib/grammar-correction.ts";
import { gatewayMetadata } from "./lib/gateway-metadata.ts";
import { LEARNING_RECAP_PROMPT } from "./lib/chat-presets.ts";
import { learningArchiveStub } from "./lib/learning-archive.ts";
import { renderReviewDetailPage } from "./review-page.ts";

type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: { identity: Identity; startedAt: number; identityMs: number };
};
const app = new Hono<AppEnv>();
const owner = (c: Context<AppEnv>) => c.get("identity").owner;
const session = (c: Context<AppEnv>, id: string) =>
  c.env.LEARNING_SESSIONS.getByName(id);
const library = (c: Context<AppEnv>) =>
  c.env.LEARNING_LIBRARY.getByName(owner(c));
const absolute = (c: Context<AppEnv>, path: string) =>
  new URL(path, c.req.url).toString();

app.use("*", async (c, next) => {
  c.set("startedAt", Date.now());
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!c.req.path.startsWith("/assets/")) c.header("Cache-Control", "no-store");
  if (c.res.headers.get("Content-Type")?.includes("text/html")) {
    // Nonce application scripts; the hostname-scoped Configuration Rule separately
    // disables Zaraz injection and Rocket Loader (the edge can add trusted nonces).
    const nonce = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
    );
    const url = new URL(c.req.url);
    c.header(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${url.protocol === "https:" ? "wss" : "ws"}://${url.host}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    );
    c.res = new HTMLRewriter()
      .on("script", {
        element(element) {
          element.setAttribute("nonce", nonce);
          element.setAttribute("data-cfasync", "false");
        },
      })
      .transform(c.res);
  }
});
app.get("/health", (c) =>
  c.json({ status: "ok", framework: "pi-durable", router: "jev" }),
);
app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/assets/")) return next();
  const identityStarted = Date.now();
  try {
    c.set("identity", await verifyIdentity(c.req.raw, c.env));
    c.set("identityMs", Date.now() - identityStarted);
  } catch {
    const page =
      c.req.method === "GET" &&
      c.req.path.match(
        /^\/(sessions|learn|review|visual)\/([a-zA-Z0-9_-]{8,100})$/,
      );
    if (page)
      return c.redirect(
        `/chat?${page[1] === "visual" ? "resume_visual" : "resume"}=${encodeURIComponent(page[2])}${page[1] === "visual" && c.req.query("artifact") ? "&resume_artifact=" + encodeURIComponent(c.req.query("artifact")!.slice(0, 160)) : ""}`,
      );
    if (c.req.method === "GET" && ["/", "/review"].includes(c.req.path))
      return c.redirect("/chat");
    return c.json({ error: "Authentication required" }, 401);
  }
  // Shortcuts do not send Origin. Browsers may mutate only from this app's origin.
  const origin = c.req.header("Origin");
  if (
    origin &&
    origin !== new URL(c.req.url).origin &&
    (c.req.method !== "GET" || c.req.header("Upgrade") === "websocket")
  )
    return c.json({ error: "Origin not allowed" }, 403);
  await next();
});
app.onError((error, c) => {
  if (new URL(c.req.url).hostname === "localhost") console.error(error);
  console.error(
    JSON.stringify({
      message: "Learning request failed",
      path: c.req.path,
      error: error.name,
    }),
  );
  return c.json(
    {
      error:
        error.message === "Session not found"
          ? "Session not found"
          : "Request failed. Please retry.",
    },
    error.message === "Session not found" ? 404 : 502,
  );
});

async function json<T>(
  c: Context<AppEnv>,
  maxBytes = 200_000,
): Promise<T | null> {
  if (Number(c.req.header("content-length") ?? 0) > maxBytes) return null;
  const reader = c.req.raw.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
async function textBody(c: Context<AppEnv>, preserve = false) {
  const body = await json<{ text?: unknown }>(c);
  if (
    typeof body?.text !== "string" ||
    !body.text.trim() ||
    body.text.length > 30_000
  )
    return null;
  return preserve ? body.text : body.text.trim();
}
function requestId(c: Context<AppEnv>) {
  const value = c.req.header("Idempotency-Key");
  return value && /^[a-zA-Z0-9:_-]{8,160}$/.test(value)
    ? value
    : crypto.randomUUID();
}
async function classify(text: string): Promise<JevRoute> {
  if (text === LEARNING_RECAP_PROMPT) return "direct_answer";
  // Deterministic repository recognition also covers .git and explanation-wrapper inputs.
  if (/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/i.test(text))
    return "github_learning";
  try {
    return await classifyWithJev(text, new AbortController().signal);
  } catch {
    return "direct_answer";
  }
}
async function create(
  c: Context<AppEnv>,
  text: string,
  route: JevRoute = "direct_answer",
  id: string = crypto.randomUUID(),
) {
  if (!SESSION_ID.test(id)) throw new Error("Invalid session ID");
  const stub = session(c, id);
  if (await stub.exists(owner(c))) {
    if (route === "github_learning") {
      const current = await stub.getMetadata(owner(c));
      const requested = parseGithubRepositoryRequest(text);
      if (
        current.repository?.fullName.toLowerCase() !==
        `${requested.owner}/${requested.repo}`.toLowerCase()
      )
        await stub.attachRepository(
          owner(c),
          await resolveGithubRepository(text),
        );
    }
    return id;
  }
  const repository =
    route === "github_learning"
      ? await resolveGithubRepository(text)
      : undefined;
  const now = new Date().toISOString();
  const metadata: SessionMetadata = {
    id,
    owner: owner(c),
    title:
      (repository?.fullName ?? text.replace(/\s+/g, " ")).slice(0, 100) ||
      "New learning",
    type: repository
      ? "repository"
      : route === "visual_explanation"
        ? "visual"
        : "general",
    private: Boolean(repository?.private),
    repository,
    createdAt: now,
    updatedAt: now,
    archived: false,
    pinned: false,
  };
  await stub.create(metadata);
  await stub.retainInput(owner(c), text);
  return id;
}
async function migrate(
  c: Context<AppEnv>,
  id: string,
  kind: "repository" | "general" = "repository",
  discovered = false,
) {
  if (!SESSION_ID.test(id)) throw new Error("Session not found");
  const stub = session(c, id);
  if (await stub.isDeleted(owner(c))) throw new Error("Session not found");
  if (await stub.exists(owner(c))) {
    const existing = await stub.getMetadata(owner(c));
    if (!existing.legacy || existing.legacy.complete) return;
  }
  const record = await getLearningSessionRecord(c.env.CHAT_SESSIONS, id);
  const archive = await learningArchiveStub(c.env).getSession(id);
  if (!record && !archive && !discovered) throw new Error("Session not found");
  const now = new Date().toISOString();
  await stub.create({
    id,
    owner: owner(c),
    title:
      record?.metadata.repository ??
      archive?.title ??
      archive?.repository ??
      "Imported learning session",
    type: record || kind === "repository" ? "repository" : "general",
    private: Boolean(record?.metadata.privateRepository ?? true),
    repository: record?.repository,
    createdAt: record?.metadata.createdAt ?? now,
    updatedAt: now,
    pinned: false,
    archived: false,
    legacy: { runtime: "flue", id, importedAt: now, complete: false },
  });
  const reader =
    record || (kind === "repository" && archive?.repositoryUrl !== "/chat")
      ? c.env.FLUE_GITHUB_LEARNING_AGENT.getByName(id)
      : c.env.FLUE_IPHONE_ASSISTANT_AGENT.getByName(id);
  const records: Record<string, unknown>[] = [];
  let after = 0;
  do {
    const page = JSON.parse(await reader.exportPage(after)) as {
      rows: { records: Record<string, unknown>[] }[];
      next?: number;
    };
    records.push(...page.rows.flatMap((row) => row.records));
    if (records.length > 100_000)
      throw new Error("Legacy session needs a paginated offline export");
    if (page.next === undefined) break;
    after = page.next;
  } while (true);
  const initial = records.find(
    (row) =>
      row.initialData &&
      typeof row.initialData === "object" &&
      "repository" in row.initialData,
  )?.initialData as { repository?: GithubRepository } | undefined;
  await stub.retainLegacy(
    owner(c),
    JSON.stringify({
      record,
      archive: archive ? { ...archive, events: [] } : null,
    }),
    record?.repository ?? initial?.repository,
  );
  for (const event of archive?.events ?? []) {
    await stub.retainLegacySource(
      owner(c),
      `legacy-event:${event.id}`,
      `Archived ${event.type}`,
      JSON.stringify(event.payload),
      event.createdAt,
    );
  }
  for (const row of records) {
    if (
      row.type !== "tool_outcome" ||
      ![
        "web_research",
        "read_repository_file",
        "list_repository_files",
      ].includes(String(row.toolName)) ||
      !Array.isArray(row.content)
    )
      continue;
    const content = row.content
      .flatMap((part) =>
        part?.type === "text" && typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n");
    if (content)
      await stub.retainLegacySource(
        owner(c),
        `legacy-tool:${row.id}`,
        `Saved ${row.toolName} evidence`,
        content,
        String(row.timestamp ?? now),
      );
  }
  const messages = projectLegacyMessages(records);
  await stub.importMessages(owner(c), "flue-v1", messages);
  await stub.markImported(owner(c), {
    messageCount: messages.length,
    recordCount: records.length,
    title: messages.find((message) => message.role === "user")?.content,
    createdAt: messages[0]?.createdAt,
  });
}
async function ensure(c: Context<AppEnv>, id: string) {
  if (!SESSION_ID.test(id)) throw new Error("Session not found");
  if (!(await session(c, id).exists(owner(c)))) await migrate(c, id);
  return session(c, id);
}

// Compatibility boundary: these URL paths and response fields remain unchanged.
app.post("/v1/correct", async (c) => {
  const started = c.get("startedAt");
  const text = await textBody(c, true);
  if (!text)
    return c.json(
      {
        error:
          "Send JSON with a non-empty text field of at most 30000 characters",
      },
      400,
    );
  const inference = Date.now();
  const model = grammarModelFromConfiguredModel(c.env.MODEL);
  const result = await c.env.AI.run(
    model as Parameters<Ai["run"]>[0],
    createGrammarRequest(text) as never,
    {
      signal: c.req.raw.signal,
      gateway: {
        id: c.env.AI_GATEWAY_ID,
        skipCache: true,
        metadata: gatewayMetadata("grammar-correction"),
      },
    },
  );
  const corrected = correctedTextFromAi(result);
  c.header(
    "Server-Timing",
    `identity;dur=${c.get("identityMs")}, inference;dur=${Date.now() - inference}, total;dur=${Date.now() - started}`,
  );
  console.info(
    JSON.stringify({
      message: "Grammar correction completed",
      model,
      inputChars: text.length,
      outputChars: corrected.length,
      totalMs: Date.now() - started,
    }),
  );
  return c.json({ corrected_text: corrected });
});
app.post("/v1/ask", async (c) => {
  const text = await textBody(c);
  if (!text)
    return c.json(
      {
        error:
          "Send JSON with a non-empty text field of at most 30000 characters",
      },
      400,
    );
  const route = await classify(text);
  const id = await create(c, text, route);
  if (route === "github_learning")
    return c.json(
      {
        route,
        status: "ready",
        learning_url: absolute(c, `/learn/${id}`),
        expires_in_seconds: LEARNING_SESSION_TTL_SECONDS,
      },
      202,
    );
  if (route === "visual_explanation")
    return c.json({
      route,
      status: "ready",
      visual_url: await visual(c, id, text),
      expires_in_seconds: VISUAL_SESSION_TTL_SECONDS,
    });
  return c.json({
    answer: await session(c, id).answer(owner(c), text, requestId(c)),
    route,
  });
});
async function visual(c: Context<AppEnv>, id: string, prompt: string) {
  const explainer = await generateVisualExplainer(
    c.env.AI,
    prompt,
    new AbortController().signal,
    c.env.AI_GATEWAY_ID,
    gatewayMetadata("visual-explainer"),
  );
  const artifact = await session(c, id).setVisual(owner(c), explainer);
  return absolute(c, `/visual/${id}?artifact=${encodeURIComponent(artifact)}`);
}
async function handoff(c: Context<AppEnv>) {
  const text = await textBody(c);
  if (!text)
    return c.json(
      {
        error:
          "Send JSON with a non-empty text field of at most 30000 characters",
      },
      400,
    );
  const id = await create(c, text);
  await c.env.CHAT_SESSIONS.put(`chat-session:${id}`, text, {
    expirationTtl: 600,
  });
  return c.json({
    chat_url: absolute(c, `/chat?session=${id}`),
    expires_in_seconds: 600,
  });
}
app.post("/handoff", handoff);
app.post("/v1/chat-session", handoff);
app.get("/chat/session/:id", async (c) => {
  const id = c.req.param("id");
  if (!SESSION_ID.test(id))
    return c.json({ error: "Invalid chat session" }, 400);
  const key = `chat-session:${id}`;
  const text = await c.env.CHAT_SESSIONS.get(key);
  if (text === null)
    return c.json({ error: "Chat session expired or was already used" }, 404);
  await create(c, text, "direct_answer", id);
  await c.env.CHAT_SESSIONS.delete(key);
  return c.json({ text });
});
app.get("/visual/:id", async (c) => {
  const id = c.req.param("id");
  if (!SESSION_ID.test(id))
    return c.json({ error: "Invalid visual session" }, 400);
  if (await session(c, id).exists(owner(c))) {
    const metadata = await session(c, id).getMetadata(owner(c));
    const artifact = c.req.query("artifact");
    if (artifact) {
      if (!/^visual:[\w-]{1,150}$/.test(artifact))
        return c.json({ error: "Invalid artifact" }, 400);
      const source = await session(c, id).source(owner(c), artifact);
      if (!source) return c.json({ error: "Artifact not found" }, 404);
      metadata.visual = JSON.parse(source.content);
    }
    if (metadata.visual)
      return c.html(
        renderVisualExplainerPage(
          {
            id,
            concept: metadata.visual.concept,
            createdAt: metadata.createdAt,
            expiresAt: "9999-12-31T23:59:59.999Z",
          },
          metadata.visual,
        ),
      );
  }
  const old = await getVisualSession(c.env.CHAT_SESSIONS, id);
  return old
    ? c.html(renderVisualExplainerPage(old.metadata, old.explainer))
    : c.json({ error: "Visual not found" }, 404);
});
app.get("/learn/:id/status", async (c) => {
  await ensure(c, c.req.param("id"));
  return c.json({ status: "ready", expires_at: "9999-12-31T23:59:59.999Z" });
});
app.get("/learn/:id/events", async (c) => {
  await ensure(c, c.req.param("id"));
  return new Response('event: ready\ndata: {"status":"ready"}\n\n', {
    headers: { "Content-Type": "text/event-stream" },
  });
});
app.post("/learn/:id/chat", async (c) => {
  const body = await json<{
    question?: unknown;
    selectedText?: unknown;
    sectionTitle?: unknown;
  }>(c, 32_000);
  const question =
    typeof body?.question === "string" ? body.question.trim() : "";
  const selection =
    typeof body?.selectedText === "string" ? body.selectedText.trim() : "";
  const title = typeof body?.sectionTitle === "string" ? body.sectionTitle : "";
  if (
    (!question && !selection) ||
    question.length > 4000 ||
    selection.length > 5000 ||
    title.length > 240
  )
    return c.json(
      {
        error:
          "Send a question or selected guide text within the supported limits",
      },
      400,
    );
  const stub = await ensure(c, c.req.param("id"));
  return c.json({
    answer: await stub.answer(
      owner(c),
      [
        question || "Explain this selection.",
        selection ? `Untrusted source selection (${title}):\n${selection}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      requestId(c),
    ),
  });
});
async function remove(c: Context<AppEnv>, id: string) {
  const stub = session(c, id);
  if (!(await stub.isDeleted(owner(c)))) await ensure(c, id);
  await stub.remove(owner(c));
  await c.env.CHAT_SESSIONS.delete(`visual-session:${id}:record`);
  await c.env.CHAT_SESSIONS.delete(`chat-session:${id}`);
  return c.body(null, 204);
}
app.delete("/v1/learning-sessions/:id", (c) => remove(c, c.req.param("id")));
app.get("/review", (c) => c.redirect("/chat"));
app.get("/review/:id", async (c) => {
  const id = c.req.param("id");
  if (!SESSION_ID.test(id)) return c.json({ error: "Invalid session" }, 400);
  if (await session(c, id).exists(owner(c)))
    return c.redirect(`/sessions/${id}`);
  const old = await learningArchiveStub(c.env).getSession(id);
  return old
    ? c.html(renderReviewDetailPage(old))
    : c.json({ error: "Not found" }, 404);
});

app.get("/api/sessions", (c) =>
  library(c)
    .list(
      c.req.query("q") ?? "",
      c.req.query("archived") === "true",
      Number(c.req.query("offset") ?? 0),
    )
    .then((result) => c.json(result)),
);
app.post("/api/sessions", async (c) => {
  const body = await json<{ text?: string; id?: string }>(c);
  if (
    !body ||
    typeof body.text !== "string" ||
    !body.text.trim() ||
    body.text.length > 30_000 ||
    (body.id !== undefined &&
      (typeof body.id !== "string" || !SESSION_ID.test(body.id)))
  )
    return c.json({ error: "Invalid session input" }, 400);
  const id = await create(c, body.text, "direct_answer", body.id);
  return c.json({ id, url: absolute(c, `/sessions/${id}`) }, 201);
});
app.get("/api/sessions/:id", async (c) =>
  (await ensure(c, c.req.param("id"))).snapshot(
    owner(c),
    c.req.query("cursor"),
  ),
);
app.get("/api/sessions/:id/socket", async (c) => {
  if (c.req.header("Upgrade") !== "websocket")
    return c.json({ error: "WebSocket required" }, 426);
  // WebSocket upgrade Responses must travel over fetch, not structured-clone RPC.
  return (await ensure(c, c.req.param("id"))).fetch(
    new Request("https://session.internal/socket", {
      headers: { Upgrade: "websocket", "X-Learning-Owner": owner(c) },
    }),
  );
});
app.post("/api/sessions/:id/messages", async (c) => {
  const body = await json<{ text?: unknown; requestId?: unknown }>(c);
  if (
    typeof body?.text !== "string" ||
    !body.text.trim() ||
    body.text.length > 30_000 ||
    typeof body.requestId !== "string" ||
    !/^[a-zA-Z0-9:_-]{8,160}$/.test(body.requestId)
  )
    return c.json({ error: "Invalid message" }, 400);
  return c.json(
    await (
      await ensure(c, c.req.param("id"))
    ).submit(owner(c), body.text, body.requestId),
    202,
  );
});
app.post("/api/sessions/:id/stop", async (c) => {
  await (await ensure(c, c.req.param("id"))).stop(owner(c));
  return c.json({ ok: true });
});
app.patch("/api/sessions/:id", async (c) => {
  const body = await json<{
    title?: string;
    pinned?: boolean;
    archived?: boolean;
  }>(c, 4000);
  if (!body) return c.json({ error: "Invalid metadata" }, 400);
  await (await ensure(c, c.req.param("id"))).edit(owner(c), body);
  return c.json({ ok: true });
});
app.delete("/api/sessions/:id", (c) => remove(c, c.req.param("id")));
app.get("/api/sessions/:id/sources/:source", async (c) => {
  const source = await (
    await ensure(c, c.req.param("id"))
  ).source(owner(c), c.req.param("source"));
  return source ? c.json(source) : c.json({ error: "Source not found" }, 404);
});
app.post("/api/sessions/:id/notes", async (c) => {
  const body = await json<{ text?: unknown; entryId?: unknown; id?: string }>(
    c,
    20_000,
  );
  if (typeof body?.text !== "string" || typeof body.entryId !== "string")
    return c.json({ error: "Invalid note" }, 400);
  await (
    await ensure(c, c.req.param("id"))
  ).note(owner(c), body.text, body.entryId, body.id);
  return c.json({ ok: true });
});
app.delete("/api/sessions/:id/notes/:note", async (c) => {
  await (
    await ensure(c, c.req.param("id"))
  ).deleteNote(owner(c), c.req.param("note"));
  return c.body(null, 204);
});
app.post("/api/sessions/:id/approvals/:approval", async (c) => {
  const body = await json<{ accept?: unknown }>(c, 1000);
  if (typeof body?.accept !== "boolean")
    return c.json({ error: "Explicit approval required" }, 400);
  return (await ensure(c, c.req.param("id"))).approve(
    owner(c),
    c.req.param("approval"),
    body.accept,
  );
});
app.get("/api/sessions/:id/export", async (c) => {
  const stub = await ensure(c, c.req.param("id"));
  const identity = owner(c);
  // NDJSON pages keep export memory bounded and include the complete retained Pi history.
  const stream = new ReadableStream({
    async start(controller) {
      let cursor: string | undefined;
      try {
        do {
          const page = await stub.exportPage(identity, cursor);
          controller.enqueue(new TextEncoder().encode(page + "\n"));
          cursor = (JSON.parse(page) as { nextCursor?: string }).nextCursor;
        } while (cursor);
      } catch {
        controller.error(new Error("Export interrupted"));
        return;
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": `attachment; filename="learning-${c.req.param("id")}.ndjson"`,
    },
  });
});
app.get("/api/preferences", async (c) =>
  c.json(await library(c).preferences()),
);
app.put("/api/preferences", async (c) => {
  const body = await json<{ text?: unknown; recall?: unknown }>(c, 20_000);
  if (
    typeof body?.text !== "string" ||
    body.text.length > 4000 ||
    typeof body.recall !== "boolean"
  )
    return c.json({ error: "Invalid preferences" }, 400);
  await library(c).setPreferences(body.text, body.recall);
  return c.json({ ok: true });
});
app.post("/api/migrate/object", async (c) => {
  const body = await json<{ kind?: unknown; objectId?: unknown }>(c, 2000);
  if (
    !body ||
    !["general", "repository"].includes(String(body.kind)) ||
    typeof body.objectId !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.objectId)
  )
    return c.json({ error: "Invalid legacy object" }, 400);
  const namespace =
    body.kind === "general"
      ? c.env.FLUE_IPHONE_ASSISTANT_AGENT
      : c.env.FLUE_GITHUB_LEARNING_AGENT;
  const identity = await namespace
    .get(namespace.idFromString(body.objectId))
    .identity();
  if (!identity) return c.json({ status: "empty" });
  const { instanceId } = JSON.parse(identity) as { instanceId?: string };
  if (!instanceId || !SESSION_ID.test(instanceId))
    return c.json({ status: "needs-review" });
  await migrate(c, instanceId, body.kind as "general" | "repository", true);
  const metadata = await session(c, instanceId).getMetadata(owner(c));
  return c.json({
    status: "imported",
    id: instanceId,
    messageCount: metadata.legacy?.messageCount,
    recordCount: metadata.legacy?.recordCount,
  });
});
app.post("/api/migrate", async (c) => {
  const body = await json<{ cursor?: string }>(c, 2000);
  const page = await c.env.CHAT_SESSIONS.list({
    prefix: "learning-session:",
    limit: 25,
    cursor: body?.cursor,
  });
  const results: { id: string; status: string }[] = [];
  for (const key of page.keys.filter((key) => key.name.endsWith(":record"))) {
    const id = key.name.slice("learning-session:".length, -":record".length);
    try {
      await migrate(c, id);
      results.push({ id, status: "imported" });
    } catch {
      results.push({ id, status: "needs-review" });
    }
  }
  return c.json({
    results,
    cursor: page.list_complete ? undefined : page.cursor,
  });
});

// Legacy browser JSON/SSE clients retain their accepted payload and response vocabulary.
async function legacyChat(c: Context<AppEnv>, streaming: boolean) {
  const body = await json<{
    conversation_id?: unknown;
    messages?: { role: unknown; content: unknown }[];
  }>(c);
  const messages = body?.messages;
  const id = body?.conversation_id;
  if (
    typeof id !== "string" ||
    !SESSION_ID.test(id) ||
    !Array.isArray(messages) ||
    !messages.length ||
    messages.length > 20 ||
    messages.some(
      (m) =>
        !m ||
        !["user", "assistant"].includes(String(m.role)) ||
        typeof m.content !== "string" ||
        !m.content.trim(),
    ) ||
    messages.reduce((n, m) => n + String(m.content).length, 0) > 36_000 ||
    messages.at(-1)?.role !== "user"
  )
    return c.json(
      {
        error:
          "Send a conversation_id and chat history ending with a user message",
      },
      400,
    );
  const text = String(messages.at(-1)!.content);
  const route = await classify(text);
  if (
    !(await session(c, id).exists(owner(c))) &&
    (await c.env.FLUE_IPHONE_ASSISTANT_AGENT.getByName(id).identity())
  )
    await migrate(c, id, "general", true);
  await create(c, text, route, id);
  if (!streaming && route === "github_learning") {
    const url = absolute(c, `/learn/${id}`);
    return c.json(
      {
        answer: `Your repository tutor is ready:\n\n${url}`,
        conversation_id: id,
        route,
        learning_url: url,
      },
      202,
    );
  }
  const run = async () => {
    if (route === "github_learning") {
      const metadata = await session(c, id).getMetadata(owner(c));
      return {
        text: "Opening repository tutor…",
        route,
        conversationId: id,
        repositorySession: {
          id,
          repository: metadata.repository?.fullName ?? metadata.title,
          private: metadata.private,
        },
      };
    }
    if (route === "visual_explanation") {
      const url = await visual(c, id, text);
      return {
        text: `I made a visual explainer:\n\n${url}`,
        route,
        conversationId: id,
        visualUrl: url,
      };
    }
    return {
      text: await session(c, id).answer(owner(c), text, requestId(c)),
      route,
      conversationId: id,
    };
  };
  if (!streaming) {
    const result = await run();
    return c.json({
      answer: result.text,
      conversation_id: id,
      route,
      ...("visualUrl" in result ? { visual_url: result.visualUrl } : {}),
    });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (!closed)
          try {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          } catch {
            closed = true;
          }
      };
      send("status", { type: "accepted" });
      const work = run()
        .then((result) => send("done", result))
        .catch(() => send("error", { error: "Assistant request failed" }))
        .finally(() => {
          if (!closed)
            try {
              controller.close();
            } catch {}
        });
      c.executionCtx.waitUntil(work);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
app.post("/chat/api", (c) => legacyChat(c, false));
app.post("/chat/stream", (c) => legacyChat(c, true));
async function shell(c: Context<AppEnv>) {
  return c.env.ASSETS.fetch(new Request(new URL("/", c.req.url), c.req.raw));
}
app.get("/learn/:id", async (c) => {
  await ensure(c, c.req.param("id"));
  return shell(c);
});
app.get("/sessions/:id", async (c) => {
  await ensure(c, c.req.param("id"));
  return shell(c);
});
app.get("/chat", shell);
app.get("/", shell);
app.get("/assets/*", (c) => c.env.ASSETS.fetch(c.req.raw));
app.notFound((c) => c.json({ error: "Not found" }, 404));
export default app;
