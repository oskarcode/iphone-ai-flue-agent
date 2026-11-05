import { WorkerEntrypoint } from "cloudflare:workers";
import { PERSONAL_OWNER } from "./contracts.ts";

export const CURRENT_BLOG_DRAFT = "/workspace/blog-drafts/current.md";

/** Only a Worker bound to this named entrypoint can read the single shared handoff. */
export async function currentBlogDraft(
  request: Request,
  skills: Pick<CloudflareBindings, "LEARNING_SKILLS">,
): Promise<Response> {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/current")
    return new Response(null, { status: 404 });
  try {
    const draft = await skills.LEARNING_SKILLS.getByName(PERSONAL_OWNER).read(
      PERSONAL_OWNER,
      CURRENT_BLOG_DRAFT,
    );
    return Response.json(
      { content: draft.content, revision: draft.revision },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && /not found|no such (?:file|path)|enoent/i.test(error.message))
      return Response.json({ error: "No learning blog draft saved yet" }, { status: 404 });
    throw error;
  }
}

export class BlogDraftReader extends WorkerEntrypoint<CloudflareBindings> {
  fetch(request: Request): Promise<Response> {
    return currentBlogDraft(request, this.env);
  }
}
