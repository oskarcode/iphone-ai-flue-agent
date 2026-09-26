/**
 * Input:
 * - No arguments; the page calls same-origin Worker routes at runtime.
 *
 * Output:
 * - A complete self-contained HTML document for the browser chat.
 *
 * What this function does:
 * - Keeps the demo UI deployable inside the Worker without a separate frontend build.
 * - Renders live SSE progress, safe Markdown-like formatting, and follow-up chat state.
 */
export function renderChatPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>iPhone AI Assistant</title>
  <style>
    /* Theme tokens and page shell */
    :root {
      color-scheme: light;
      --canvas: #f2efe6;
      --paper: #fffdf7;
      --ink: #18201d;
      --muted: #68716c;
      --line: #d8d8ce;
      --navy: #183153;
      --teal: #087f78;
      --mint: #dff3ec;
      --amber: #f4a340;
      --user: #e2ebf8;
      --danger: #b42318;
      --shadow: 0 18px 50px rgba(24, 49, 83, .09);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --canvas: #111715;
        --paper: #19211e;
        --ink: #f2f3ed;
        --muted: #a7b0aa;
        --line: #34413c;
        --navy: #94b9ee;
        --teal: #58d4c8;
        --mint: #173b35;
        --amber: #ffc268;
        --user: #223b5a;
        --danger: #ff8d84;
        --shadow: none;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      background: radial-gradient(circle at 15% 0%, color-mix(in srgb, var(--teal) 10%, transparent), transparent 32rem), var(--canvas);
      color: var(--ink);
      font: 16px/1.6 ui-rounded, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(100%, 980px);
      min-height: 100dvh;
      margin: auto;
      display: grid;
      grid-template-rows: auto 1fr auto;
      background: var(--paper);
      box-shadow: var(--shadow);
    }

    /* Sticky application header */
    header {
      position: sticky;
      top: 0;
      z-index: 3;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: calc(15px + env(safe-area-inset-top)) 18px 14px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--paper) 90%, transparent);
      backdrop-filter: blur(18px);
    }
    .brand { display: flex; align-items: center; gap: 11px; }
    .mark {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border-radius: 12px;
      background: var(--navy);
      color: var(--paper);
      font-weight: 900;
    }
    h1 { margin: 0; font-size: 1.08rem; letter-spacing: -.02em; }
    header p { margin: 0; color: var(--muted); font-size: .76rem; }
    button {
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 7px 14px;
      background: var(--paper);
      color: var(--ink);
      font: inherit;
      cursor: pointer;
    }

    /* Conversation cards and live activity timeline */
    #messages { display: flex; flex-direction: column; gap: 18px; padding: 24px 16px 130px; }
    .empty {
      margin: 10vh auto;
      max-width: 36rem;
      padding: 30px;
      text-align: center;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: color-mix(in srgb, var(--paper) 78%, var(--mint));
    }
    .empty strong { display: block; margin-bottom: 6px; color: var(--navy); font-size: 1.25rem; }
    .empty span { color: var(--muted); }
    article {
      max-width: min(94%, 810px);
      border: 1px solid var(--line);
      border-radius: 22px;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    article.user {
      align-self: flex-end;
      padding: 13px 16px;
      background: var(--user);
      border-bottom-right-radius: 7px;
      white-space: pre-wrap;
    }
    article.assistant {
      align-self: flex-start;
      width: min(94%, 810px);
      background: var(--paper);
      border-bottom-left-radius: 7px;
    }
    article.error {
      align-self: center;
      padding: 12px 15px;
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 8%, var(--paper));
    }
    .message-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 15px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: .74rem;
      font-weight: 800;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .badges { display: flex; gap: 7px; flex-wrap: wrap; justify-content: flex-end; }
    .badge {
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--mint);
      color: var(--teal);
      letter-spacing: 0;
      text-transform: none;
    }
    details.trace { border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--mint) 42%, var(--paper)); }
    details.trace summary {
      padding: 10px 15px;
      color: var(--navy);
      cursor: pointer;
      font-size: .82rem;
      font-weight: 800;
      list-style: none;
    }
    details.trace summary::-webkit-details-marker { display: none; }
    details.trace summary::before { content: '›'; display: inline-block; margin-right: 8px; transform: rotate(90deg); }
    details.trace:not([open]) summary::before { transform: none; }
    .timeline { display: grid; gap: 7px; padding: 0 15px 13px 18px; }
    .activity {
      display: grid;
      grid-template-columns: 10px 1fr auto;
      align-items: center;
      gap: 9px;
      color: var(--muted);
      font-size: .78rem;
    }
    .dot { width: 8px; height: 8px; border: 2px solid var(--teal); border-radius: 50%; }
    .activity.running .dot { background: var(--amber); border-color: var(--amber); animation: pulse 1.2s ease-in-out infinite; }
    .activity.error .dot { background: var(--danger); border-color: var(--danger); }
    .duration { font-variant-numeric: tabular-nums; }
    @keyframes pulse { 50% { transform: scale(1.55); opacity: .55; } }

    /* Safe answer formatting generated with DOM APIs, never innerHTML */
    .answer { padding: 15px 17px 17px; }
    .answer:empty::after { content: 'Preparing an answer…'; color: var(--muted); }
    .answer h2, .answer h3, .answer h4 { margin: 1.15em 0 .35em; color: var(--navy); line-height: 1.25; }
    .answer h2:first-child, .answer h3:first-child { margin-top: 0; }
    .answer p { margin: .65em 0; }
    .answer ul, .answer ol { margin: .6em 0; padding-left: 1.35em; }
    .answer li { margin: .25em 0; }
    .answer pre {
      margin: .8em 0;
      padding: 13px;
      overflow: auto;
      border-radius: 12px;
      background: var(--canvas);
      border: 1px solid var(--line);
      font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: pre-wrap;
    }
    .answer table { width: 100%; margin: .9em 0; border-collapse: collapse; font-size: .88rem; }
    .answer th, .answer td { padding: 8px 9px; border: 1px solid var(--line); text-align: left; vertical-align: top; }
    .answer th { color: var(--navy); background: var(--mint); }
    .caret {
      display: inline-block;
      width: 7px;
      height: 1.1em;
      margin-left: 2px;
      vertical-align: -2px;
      background: var(--teal);
      animation: blink .8s steps(1) infinite;
    }
    @keyframes blink { 50% { opacity: 0; } }
    .message-foot { display: flex; gap: 10px; padding: 8px 15px; border-top: 1px solid var(--line); color: var(--muted); font-size: .72rem; }

    /* Sticky composer respects iPhone safe areas */
    form {
      position: sticky;
      bottom: 0;
      z-index: 3;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
      border-top: 1px solid var(--line);
      background: color-mix(in srgb, var(--paper) 94%, transparent);
      backdrop-filter: blur(18px);
    }
    textarea {
      width: 100%;
      min-height: 48px;
      max-height: 180px;
      resize: none;
      border: 1px solid var(--line);
      border-radius: 17px;
      padding: 12px 14px;
      background: var(--canvas);
      color: var(--ink);
      font: inherit;
    }
    textarea:focus { outline: 3px solid color-mix(in srgb, var(--teal) 22%, transparent); border-color: var(--teal); }
    .primary { min-width: 72px; border-color: var(--navy); background: var(--navy); color: var(--paper); font-weight: 800; }
    button:disabled, textarea:disabled { opacity: .58; cursor: not-allowed; }
    @media (max-width: 600px) {
      #messages { padding-inline: 10px; }
      article, article.assistant { max-width: 98%; width: auto; }
      article.assistant { width: 98%; }
      .message-head { align-items: flex-start; }
      form { grid-template-columns: 1fr; }
      .primary { width: 100%; }
    }
  </style>
</head>
<body>
<main>
  <!-- Application identity and conversation reset -->
  <header>
    <div class="brand">
      <div class="mark">AI</div>
      <div><h1>iPhone AI Assistant</h1><p>Flue agent · Jev routing · live execution</p></div>
    </div>
    <button id="new-chat">New chat</button>
  </header>

  <!-- Messages and agent activity are rendered here by the local script -->
  <section id="messages">
    <div class="empty">
      <strong>One place for every request</strong>
      <span>Paste text, share a URL, or ask a current question. Watch the route and tools as the answer streams in.</span>
    </div>
  </section>

  <!-- Primary chat input; Enter submits and Shift+Enter adds a line -->
  <form id="composer">
    <textarea id="input" placeholder="Ask, paste, or share something…" required></textarea>
    <button class="primary" id="send">Send</button>
  </form>
</main>
<script>
  // Browser-only conversation state. Flue persists the corresponding server conversation by ID.
  const messages = [];
  let conversationId = crypto.randomUUID();
  let activeController = null;
  let renderPending = false;
  const messagesEl = document.querySelector('#messages');
  const inputEl = document.querySelector('#input');
  const sendEl = document.querySelector('#send');

  // Server route/tool identifiers are translated into labels intended for a person.
  const routeNames = {
    direct_answer: 'Direct answer',
    web_research: 'Web research',
    clarification: 'Clarify request',
  };
  const toolNames = { web_research: 'Research the web' };

  /**
   * Input:
   * - No arguments; it uses the current browser message state.
   *
   * Output:
   * - One render scheduled for the next animation frame.
   *
   * What this function does:
   * - Coalesces rapid token events so the page does not rebuild more than once per frame.
   */
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      render();
    });
  }

  /**
   * Input:
   * - An assistant message plus stable key, label, state, and optional detail.
   *
   * Output:
   * - Updated in-memory activity state and a scheduled render.
   *
   * What this function does:
   * - Updates repeated lifecycle events instead of adding duplicate timeline rows.
   */
  function upsertActivity(message, key, label, state, detail) {
    const current = message.activities.find((item) => item.key === key);
    if (current) {
      current.label = label;
      current.state = state;
      current.detail = detail || '';
    } else {
      message.activities.push({ key, label, state, detail: detail || '' });
    }
    scheduleRender();
  }

  /**
   * Input:
   * - A duration in milliseconds or an absent value.
   *
   * Output:
   * - A short milliseconds/seconds label for the activity timeline.
   *
   * What this function does:
   * - Keeps diagnostic timing readable without exposing raw numbers.
   */
  function formatDuration(milliseconds) {
    if (typeof milliseconds !== 'number') return '';
    return milliseconds < 1000 ? Math.round(milliseconds) + ' ms' : (milliseconds / 1000).toFixed(1) + ' s';
  }

  /**
   * Input:
   * - A target DOM node and one line of model-generated text.
   *
   * Output:
   * - Text, strong, and inline-code child nodes appended safely.
   *
   * What this function does:
   * - Supports a deliberately small inline Markdown subset without using innerHTML.
   */
  function appendInline(parent, text) {
    let remaining = text;
    while (remaining) {
      const tick = String.fromCharCode(96);
      const boldIndex = remaining.indexOf('**');
      const codeIndex = remaining.indexOf(tick);
      let start = -1;
      let marker = '';

      if (boldIndex >= 0 && (codeIndex < 0 || boldIndex < codeIndex)) {
        start = boldIndex;
        marker = '**';
      } else if (codeIndex >= 0) {
        start = codeIndex;
        marker = tick;
      }
      if (start < 0) {
        parent.append(document.createTextNode(remaining));
        break;
      }
      if (start > 0) parent.append(document.createTextNode(remaining.slice(0, start)));

      const end = remaining.indexOf(marker, start + marker.length);
      if (end < 0) {
        parent.append(document.createTextNode(remaining.slice(start)));
        break;
      }
      const node = document.createElement(marker === '**' ? 'strong' : 'code');
      node.textContent = remaining.slice(start + marker.length, end);
      parent.append(node);
      remaining = remaining.slice(end + marker.length);
    }
  }

  /**
   * Input:
   * - One possible Markdown table row.
   *
   * Output:
   * - Trimmed cells, or an empty array when no table delimiter exists.
   *
   * What this function does:
   * - Normalizes optional leading/trailing pipes before table rendering.
   */
  function tableCells(line) {
    const value = line.trim();
    if (!value.includes('|')) return [];
    return value.replace(/^\\|/, '').replace(/\\|$/, '').split('|').map((cell) => cell.trim());
  }

  /**
   * Input:
   * - Model answer text and the DOM element that should contain it.
   *
   * Output:
   * - Safe DOM nodes for headings, lists, tables, code blocks, and paragraphs.
   *
   * What this function does:
   * - Implements only the formatting needed by this demo while keeping model text inert.
   */
  function renderFormatted(text, host) {
    const lines = text.split('\\n');
    const fence = String.fromCharCode(96).repeat(3);
    let list = null;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (line.startsWith(fence)) {
        const code = [];
        index++;
        while (index < lines.length && !lines[index].startsWith(fence)) {
          code.push(lines[index]);
          index++;
        }
        const pre = document.createElement('pre');
        pre.textContent = code.join('\\n');
        host.append(pre);
        list = null;
        continue;
      }

      const header = tableCells(line);
      const separator = index + 1 < lines.length ? tableCells(lines[index + 1]) : [];
      const isTable = header.length
        && separator.length === header.length
        && separator.every((cell) => /^:?-{3,}:?$/.test(cell));
      if (isTable) {
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        header.forEach((value) => {
          const th = document.createElement('th');
          appendInline(th, value);
          headRow.append(th);
        });
        thead.append(headRow);
        table.append(thead);

        const tbody = document.createElement('tbody');
        index += 2;
        while (index < lines.length) {
          const rowCells = tableCells(lines[index]);
          if (rowCells.length !== header.length) break;
          const row = document.createElement('tr');
          rowCells.forEach((value) => {
            const td = document.createElement('td');
            appendInline(td, value);
            row.append(td);
          });
          tbody.append(row);
          index++;
        }
        index--;
        table.append(tbody);
        host.append(table);
        list = null;
        continue;
      }

      const heading = line.match(/^(#{1,3}) (.+)$/);
      if (heading) {
        const element = document.createElement(heading[1].length === 1 ? 'h2' : heading[1].length === 2 ? 'h3' : 'h4');
        appendInline(element, heading[2]);
        host.append(element);
        list = null;
        continue;
      }

      const bullet = line.startsWith('- ') || line.startsWith('* ');
      const numbered = line.match(/^([0-9]+)[.] (.+)$/);
      if (bullet || numbered) {
        const type = numbered ? 'ol' : 'ul';
        if (!list || list.tagName.toLowerCase() !== type) {
          list = document.createElement(type);
          host.append(list);
        }
        const item = document.createElement('li');
        appendInline(item, numbered ? numbered[2] : line.slice(2));
        list.append(item);
        continue;
      }

      list = null;
      if (!line.trim()) continue;
      const paragraph = document.createElement('p');
      appendInline(paragraph, line);
      host.append(paragraph);
    }
  }

  /**
   * Input:
   * - The current in-memory messages array.
   *
   * Output:
   * - A rebuilt conversation view in #messages.
   *
   * What this function does:
   * - Renders user text, assistant route/activity metadata, formatted answers, and usage details.
   */
  function render() {
    messagesEl.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      const title = document.createElement('strong');
      title.textContent = 'One place for every request';
      const text = document.createElement('span');
      text.textContent = 'Paste text, share a URL, or ask a current question. Watch the route and tools as the answer streams in.';
      empty.append(title, text);
      messagesEl.append(empty);
      return;
    }

    for (const message of messages) {
      const article = document.createElement('article');
      article.className = message.role + (message.error ? ' error' : '');
      if (message.role === 'user') {
        article.textContent = message.content;
        messagesEl.append(article);
        continue;
      }

      const head = document.createElement('div');
      head.className = 'message-head';
      const role = document.createElement('span');
      role.textContent = 'Assistant';
      const badges = document.createElement('div');
      badges.className = 'badges';
      if (message.route) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = routeNames[message.route] || message.route;
        badges.append(badge);
      }
      head.append(role, badges);
      article.append(head);

      if (message.activities.length) {
        const trace = document.createElement('details');
        trace.className = 'trace';
        trace.open = message.streaming;
        const summary = document.createElement('summary');
        summary.textContent = message.streaming ? 'Working live' : 'How this answer was made';
        const timeline = document.createElement('div');
        timeline.className = 'timeline';
        for (const activity of message.activities) {
          const row = document.createElement('div');
          row.className = 'activity ' + activity.state;
          const dot = document.createElement('span');
          dot.className = 'dot';
          const label = document.createElement('span');
          label.textContent = activity.label;
          const detail = document.createElement('span');
          detail.className = 'duration';
          detail.textContent = activity.detail;
          row.append(dot, label, detail);
          timeline.append(row);
        }
        trace.append(summary, timeline);
        article.append(trace);
      }

      const answer = document.createElement('div');
      answer.className = 'answer';
      renderFormatted(message.content, answer);
      if (message.streaming) {
        const caret = document.createElement('span');
        caret.className = 'caret';
        answer.append(caret);
      }
      article.append(answer);

      if (message.meta) {
        const foot = document.createElement('div');
        foot.className = 'message-foot';
        if (message.meta.model) {
          const model = document.createElement('span');
          model.textContent = String(message.meta.model).replace('cloudflare/', '');
          foot.append(model);
        }
        if (message.meta.usage && typeof message.meta.usage.totalTokens === 'number') {
          const tokens = document.createElement('span');
          tokens.textContent = message.meta.usage.totalTokens + ' tokens';
          foot.append(tokens);
        }
        if (typeof message.meta.elapsedMs === 'number') {
          const elapsed = document.createElement('span');
          elapsed.textContent = formatDuration(message.meta.elapsedMs);
          foot.append(elapsed);
        }
        if (foot.childNodes.length) article.append(foot);
      }
      messagesEl.append(article);
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  /**
   * Input:
   * - A fetch Response containing SSE frames and a callback for parsed events.
   *
   * Output:
   * - A promise that resolves after the response stream ends.
   *
   * What this function does:
   * - Incrementally decodes SSE blocks without waiting for the complete response.
   */
  async function consumeEvents(response, onEvent) {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Chat request failed');
    }
    if (!response.body) throw new Error('Streaming is unavailable in this browser.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const result = await reader.read();
      buffer += decoder.decode(result.value || new Uint8Array(), { stream: !result.done });
      let boundary;
      while ((boundary = buffer.indexOf('\\n\\n')) >= 0) {
        const block = buffer.slice(0, boundary).replaceAll('\\r', '');
        buffer = buffer.slice(boundary + 2);
        let event = 'message';
        const data = [];
        for (const line of block.split('\\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data.push(line.slice(5).trim());
        }
        if (data.length) onEvent(event, JSON.parse(data.join('\\n')));
      }
      if (result.done) break;
    }
  }

  /**
   * Input:
   * - The pending assistant message, SSE event name, and parsed event payload.
   *
   * Output:
   * - Updated message text, route, metadata, and activity timeline.
   *
   * What this function does:
   * - Keeps network parsing separate from UI state transitions.
   * - Displays only the safe server event contract, never raw Flue events.
   */
  function handleChatEvent(assistant, event, data) {
    if (event === 'status') {
      if (data.type === 'accepted') upsertActivity(assistant, 'request', 'Request received', 'complete', '');
      if (data.type === 'queued') upsertActivity(assistant, 'agent', 'Flue agent started', 'complete', '');
      return;
    }
    if (event === 'progress') {
      if (data.type === 'classification') {
        const label = data.state === 'running'
          ? 'Jev is classifying the request'
          : 'Route: ' + (routeNames[data.route] || data.route || 'selected');
        upsertActivity(assistant, 'classification', label, data.state === 'running' ? 'running' : 'complete', formatDuration(data.durationMs));
        if (data.route) assistant.route = data.route;
      }
      if (data.type === 'planning') upsertActivity(assistant, 'planning', 'Planning the response', 'running', '');
      if (data.type === 'tool') {
        const label = toolNames[data.name] || data.name.replaceAll('_', ' ');
        upsertActivity(assistant, 'tool-' + data.name, label, data.state, formatDuration(data.durationMs));
      }
      if (data.type === 'response') {
        const label = data.state === 'running' ? 'Generating the answer' : 'Answer generated';
        upsertActivity(assistant, 'response', label, data.state === 'running' ? 'running' : 'complete', '');
      }
      if (data.type === 'token') {
        assistant.content += data.delta;
        upsertActivity(assistant, 'response', 'Streaming the answer', 'running', '');
      }
      return;
    }
    if (event === 'done') {
      assistant.content = data.text || assistant.content;
      assistant.route = data.route || assistant.route;
      assistant.meta = data.metadata || null;
      assistant.streaming = false;
      for (const activity of assistant.activities) {
        if (activity.state === 'running') activity.state = 'complete';
      }
      scheduleRender();
      return;
    }
    if (event === 'error') throw new Error(data.error || 'Assistant request failed');
  }

  /**
   * Input:
   * - Text entered by the user or prepared from a handoff session.
   *
   * Output:
   * - A streamed assistant message added to the current browser conversation.
   *
   * What this function does:
   * - Posts bounded history to /chat/stream and applies each SSE event to the UI.
   * - Re-enables the composer after success, failure, or cancellation.
   */
  async function sendMessage(value) {
    const content = value.trim();
    if (!content) return;

    messages.push({ role: 'user', content });
    const assistant = { role: 'assistant', content: '', activities: [], streaming: true, route: '', meta: null };
    messages.push(assistant);
    render();
    inputEl.value = '';
    inputEl.style.height = 'auto';
    inputEl.disabled = true;
    sendEl.disabled = true;
    sendEl.textContent = 'Streaming…';
    activeController = new AbortController();

    try {
      const history = messages
        .filter((message) => message !== assistant)
        .map((message) => ({ role: message.role, content: message.content }));
      const response = await fetch('/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ conversation_id: conversationId, messages: history }),
        signal: activeController.signal,
      });
      await consumeEvents(response, (event, data) => handleChatEvent(assistant, event, data));
    } catch (error) {
      assistant.streaming = false;
      assistant.error = true;
      assistant.content = error instanceof Error ? error.message : String(error);
      if (!(error instanceof DOMException && error.name === 'AbortError')) scheduleRender();
    } finally {
      activeController = null;
      inputEl.disabled = false;
      sendEl.disabled = false;
      sendEl.textContent = 'Send';
      inputEl.focus();
    }
  }

  /**
   * Input:
   * - The current browser URL.
   *
   * Output:
   * - An optional handoff session ID removed from the visible address bar.
   *
   * What this function does:
   * - Prevents accidental reuse when the page is refreshed or shared after loading.
   */
  function readSessionIdFromUrl() {
    const query = new URLSearchParams(location.search);
    const id = query.get('session');
    if (id) history.replaceState(null, '', location.pathname);
    return id;
  }

  /**
   * Input:
   * - A short-lived handoff session ID.
   *
   * Output:
   * - The stored text submitted as the first message, or an error card.
   *
   * What this function does:
   * - Consumes /chat/session/:id and starts the durable browser conversation automatically.
   */
  async function loadSession(id) {
    try {
      const response = await fetch('/chat/session/' + encodeURIComponent(id));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load copied text');
      conversationId = id;
      await sendMessage('Explain this pasted text in plain English:\\n\\n' + data.text);
    } catch (error) {
      messages.push({
        role: 'assistant',
        content: error instanceof Error ? error.message : String(error),
        activities: [],
        streaming: false,
        error: true,
      });
      render();
    }
  }

  // UI event wiring is intentionally local because this page has no frontend framework.
  /** Input: form submit event. Output: none. Starts a turn without reloading the page. */
  document.querySelector('#composer').addEventListener('submit', (event) => {
    event.preventDefault();
    void sendMessage(inputEl.value);
  });
  /** Input: New chat click. Output: none. Cancels work and resets local conversation state. */
  document.querySelector('#new-chat').addEventListener('click', () => {
    activeController?.abort();
    conversationId = crypto.randomUUID();
    messages.splice(0);
    render();
    inputEl.focus();
  });
  /** Input: textarea key event. Output: none. Submits Enter while preserving Shift+Enter. */
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      document.querySelector('#composer').requestSubmit();
    }
  });
  /** Input: textarea edit event. Output: none. Grows the composer up to its height limit. */
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
  });

  render();
  const sessionId = readSessionIdFromUrl();
  if (sessionId) void loadSession(sessionId);
</script>
</body>
</html>`;
}
