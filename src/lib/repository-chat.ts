/** Browser-side adapter: reuse the existing tutor endpoints inside the main chat.
 * Self-contained so the Worker can embed it without a separate client bundle.
 */
export async function askRepositoryTutor(sessionId: string, question: string, signal: AbortSignal): Promise<string> {
  const base = '/learn/' + encodeURIComponent(sessionId);
  while (true) {
    signal.throwIfAborted();
    const response = await fetch(base + '/status', { signal });
    const status = await response.json() as { status?: string; error?: string };
    if (!response.ok) throw new Error(status.error || 'Repository session is unavailable.');
    if (status.status === 'failed') throw new Error(status.error || 'Repository setup failed.');
    if (status.status === 'ready') break;
    // Reading the setup receipt also records terminal failures for the status endpoint.
    const events = await fetch(base + '/events', { signal });
    if (!events.ok && events.status !== 425) throw new Error('Could not prepare the repository tutor.');
    if (events.ok) await events.text();
    else await events.body?.cancel();
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 750);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
    });
  }
  const response = await fetch(base + '/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
    signal,
  });
  const data = await response.json() as { answer?: string; error?: string };
  if (!response.ok) throw new Error(data.error || 'Repository question failed.');
  if (typeof data.answer !== 'string') throw new Error('No repository answer received.');
  return data.answer;
}
