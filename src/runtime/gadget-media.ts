import { WorkerEntrypoint } from "cloudflare:workers";

export const MAX_GADGET_MEDIA_BYTES = 25 * 1024 * 1024;
type Scope = { sessionId: string; gadgetId: string };
export type GadgetMediaAsset = { id: string; name: string; type: string; size: number };
const assetId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const prefix = (scope: Scope) => `sessions/${encodeURIComponent(scope.sessionId)}/gadgets/${encodeURIComponent(scope.gadgetId)}/`;
const key = (scope: Scope, id: string) => {
  if (!assetId.test(id)) throw new Error("Invalid gadget media ID");
  return prefix(scope) + id;
};
const summary = (object: R2Object): GadgetMediaAsset => ({
  id: object.key.slice(object.key.lastIndexOf("/") + 1),
  name: object.customMetadata?.name ?? "Media",
  type: object.httpMetadata?.contentType ?? "application/octet-stream",
  size: object.size,
});

/** A scoped media capability available only to one generated gadget's server Facet. */
export class LearningGadgetMedia extends WorkerEntrypoint<CloudflareBindings, Scope> {
  async put(input: { name: string; contentType: string; bytes: ArrayBuffer | Uint8Array }): Promise<GadgetMediaAsset> {
    if (typeof input?.name !== "string" || input.name.length < 1 || input.name.length > 180 ||
      typeof input.contentType !== "string" || input.contentType.length < 1 || input.contentType.length > 100 ||
      !(input.bytes instanceof ArrayBuffer || input.bytes instanceof Uint8Array)) throw new Error("Invalid gadget media");
    const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
    if (!bytes.byteLength || bytes.byteLength > MAX_GADGET_MEDIA_BYTES) throw new Error("Gadget media is too large");
    const id = crypto.randomUUID();
    const object = await this.env.GADGET_MEDIA.put(key(this.ctx.props, id), bytes, {
      customMetadata: { name: input.name }, httpMetadata: { contentType: input.contentType },
    });
    return summary(object);
  }
  async get(id: string): Promise<(GadgetMediaAsset & { bytes: ArrayBuffer }) | null> {
    const object = await this.env.GADGET_MEDIA.get(key(this.ctx.props, id));
    return object ? { ...summary(object), bytes: await object.arrayBuffer() } : null;
  }
  async list(): Promise<GadgetMediaAsset[]> {
    const assets: GadgetMediaAsset[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.env.GADGET_MEDIA.list({ prefix: prefix(this.ctx.props), cursor, limit: 1000, include: ["httpMetadata", "customMetadata"] });
      assets.push(...page.objects.map(summary));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return assets;
  }
  async delete(id: string): Promise<void> {
    await this.env.GADGET_MEDIA.delete(key(this.ctx.props, id));
  }
}

/** Do not leave detached blobs behind when a lesson or gadget is deleted. */
export async function deleteGadgetMedia(bucket: R2Bucket, scope: Scope): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: prefix(scope), cursor, limit: 1000 });
    if (page.objects.length) await bucket.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
