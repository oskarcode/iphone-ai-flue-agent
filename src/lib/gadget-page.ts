/** Generated gadget HTML is never trusted as an application page. */
export const GADGET_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; object-src 'none'; img-src 'none'; connect-src 'none'; frame-ancestors 'none'";

export function gadgetPage(
  html: string,
  actionUrl: string,
  backUrl: string,
): Response {
  const nav = `<nav style="padding:1rem;background:#fff;color:#17201d;font:16px system-ui"><a data-gadget-back href="${backUrl}">← Back to lesson</a></nav>`;
  const page = /<body\b/i.test(html)
    ? html
    : `<!doctype html><html><body>${html}</body></html>`;
  const document = /<head\b/i.test(page)
    ? page
    : page.replace(/<body\b/i, "<head></head><body");
  const response = new Response(document, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": GADGET_CSP,
      "Cache-Control": "no-store",
    },
  });
  return new HTMLRewriter()
    .on("head", {
      element(element) {
        element.prepend(
          '<meta name="viewport" content="width=device-width,initial-scale=1">',
          { html: true },
        );
      },
    })
    .on("body", {
      element(element) {
        element.prepend(nav, { html: true });
      },
    })
    .on("*", {
      element(element) {
        for (const attribute of [...element.attributes]) {
          const name = Array.isArray(attribute) ? attribute[0] : attribute.name;
          if (
            /^on/i.test(name) ||
            [
              "action",
              "method",
              "formaction",
              "target",
              "src",
              "srcset",
              "href",
              "http-equiv",
            ].includes(name.toLowerCase())
          )
            element.removeAttribute(name);
        }
        if (
          element.tagName === "a" &&
          element.getAttribute("data-gadget-back") !== null
        )
          element.setAttribute("href", backUrl);
        if (element.tagName === "form") {
          element.setAttribute("action", actionUrl);
          element.setAttribute("method", "post");
        }
        if (element.tagName === "meta") {
          if (element.getAttribute("name") === "viewport")
            element.setAttribute(
              "content",
              "width=device-width,initial-scale=1",
            );
          else element.remove();
        }
        if (
          ["script", "iframe", "base", "object", "embed", "link"].includes(
            element.tagName,
          )
        )
          element.remove();
      },
    })
    .transform(response);
}

export async function gadgetForm(
  request: Request,
): Promise<{ action: string; data: Record<string, string> }> {
  if (Number(request.headers.get("Content-Length") ?? 0) > 16_384)
    throw new Error("Gadget form too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Empty gadget form");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      await reader.cancel();
      throw new Error("Gadget form too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const form = await new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": request.headers.get("Content-Type") ?? "" },
    body,
  }).formData();
  const action = form.get("_action");
  if (typeof action !== "string" || !/^[a-zA-Z][\w-]{0,63}$/.test(action))
    throw new Error("Invalid gadget action");
  const data: Record<string, string> = {};
  for (const [key, value] of form) {
    if (key === "_action") continue;
    if (
      !/^[a-zA-Z][\w-]{0,63}$/.test(key) ||
      typeof value !== "string" ||
      value.length > 4096 ||
      key in data
    )
      throw new Error("Invalid gadget form");
    data[key] = value;
  }
  if (JSON.stringify(data).length > 16_384)
    throw new Error("Gadget form too large");
  return { action, data };
}
