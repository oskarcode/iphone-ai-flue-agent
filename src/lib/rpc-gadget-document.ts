// Browser bundle only: the workerd export of capnweb imports cloudflare:workers.
import CAPNWEB_BUNDLE from "../../node_modules/capnweb/dist/index.js?raw";

function moduleUrl(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:text/javascript;base64,${btoa(binary)}`;
}
const rpcModule = moduleUrl(CAPNWEB_BUNDLE);

/** Standalone document so the parent application's CSP is not inherited by an srcdoc iframe. */
export function rpcGadgetDocument(clientCode: string): Response {
  const entry = moduleUrl(clientCode);
  const script = `
import { newMessagePortRpcSession } from ${JSON.stringify(rpcModule)};
try {
  const { port1, port2 } = new MessageChannel();
  parent.postMessage('learning.gadget.connect', '*', [port2]);
  const bridge = newMessagePortRpcSession(port1);
  const gadget = await bridge.connectToGadget();
  const client = await import(${JSON.stringify(entry)});
  if (!client.default || typeof client.default.main !== 'function') throw new Error('client.js must export main(gadget)');
  await client.default.main(gadget);
  parent.postMessage('learning.gadget.ready', '*');
} catch { parent.postMessage('learning.gadget.error', '*'); }`;
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><script type="module">${script.replaceAll("</script", "<\\/script")}</script></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src data: 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
    },
  });
}
