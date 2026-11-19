import React, { useEffect, useRef, useState } from "react";
import { RpcTarget, newWebSocketRpcSession, newMessagePortRpcSession } from "capnweb";
type GadgetBackend = { getUiBundle(): Promise<{ code: string }>; connectToGadget(): Promise<unknown> };

class GadgetFrameApi extends RpcTarget {
  constructor(private readonly gadget: unknown) { super(); }
  connectToGadget() { return this.gadget; }
}

/** Authenticated parent owns the socket; generated client runs in a network-isolated opaque-origin frame. */
export function RpcGadgetPage({ sessionId, gadgetId }: { sessionId: string; gadgetId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const backend = useRef<ReturnType<typeof newWebSocketRpcSession<GadgetBackend>> | null>(null);
  const bridge = useRef<{ [Symbol.dispose](): void } | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const url = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/gadgets/${encodeURIComponent(gadgetId)}/rpc`, location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const session = newWebSocketRpcSession<GadgetBackend>(url.href);
    backend.current = session;
    let cancelled = false;
    void session.getUiBundle().then(() => {
      if (!cancelled) setConnected(true);
    }).catch(() => { if (!cancelled) setError("Could not open this gadget."); });
    return () => {
      cancelled = true;
      bridge.current?.[Symbol.dispose]();
      bridge.current = null;
      session[Symbol.dispose]();
      backend.current = null;
    };
  }, [sessionId, gadgetId]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== "null") return;
      if (event.data === "learning.gadget.ready") { setReady(true); return; }
      if (event.data === "learning.gadget.error") { setError("The gadget could not start. Refresh to try again."); return; }
      if (event.data !== "learning.gadget.connect" || !event.ports[0] || !backend.current) return;
      const port = event.ports[0];
      void backend.current.connectToGadget().then((gadget: unknown) => {
        bridge.current?.[Symbol.dispose]();
        bridge.current = newMessagePortRpcSession(port, new GadgetFrameApi(gadget));
      }).catch(() => { port.close(); setError("Could not connect this gadget."); });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  return <main className="rpc-gadget-page">
    <nav><a href={`/sessions/${encodeURIComponent(sessionId)}`}>← Back to lesson</a></nav>
    {error ? <p role="alert">{error}</p> : !connected ? <p role="status">Opening interactive gadget…</p> : <>
      {!ready && <p role="status">Loading interactive lesson…</p>}
      <iframe ref={frame} sandbox="allow-scripts" title="Interactive learning gadget" src={`/api/sessions/${encodeURIComponent(sessionId)}/gadgets/${encodeURIComponent(gadgetId)}/ui`} />
    </>}
  </main>;
}
