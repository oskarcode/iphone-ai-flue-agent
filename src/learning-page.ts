// Learning-session types define the only model-authored values this fixed renderer accepts.
import type { LearningGuide, LearningSessionMetadata } from './lib/learning-session.ts';

/**
 * Input:
 * - Untrusted text that may contain HTML syntax.
 *
 * Output:
 * - Text safe for insertion into generated HTML.
 *
 * What this function does:
 * - Escapes markup before any limited Markdown formatting is applied.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Input:
 * - One short untrusted Markdown-like string.
 *
 * Output:
 * - Escaped HTML supporting only inline code and bold text.
 *
 * What this function does:
 * - Keeps list items readable without allowing arbitrary model HTML.
 */
function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * Input:
 * - Untrusted guide prose using a small Markdown subset.
 *
 * Output:
 * - Escaped headings, paragraphs, lists, and fenced code blocks.
 *
 * What this function does:
 * - Renders predictable learning content without a client dependency or raw HTML support.
 */
function renderMarkdown(value: string): string {
  const output: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let code: string[] | null = null;
  /**
   * Input:
   * - No arguments; it closes over the active list and output buffer.
   *
   * Output:
   * - No value after closing any active list.
   *
   * What this function does:
   * - Keeps generated block-level HTML balanced across Markdown transitions.
   */
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = null;
  };

  for (const line of value.split('\n')) {
    if (line.startsWith('```')) {
      closeList();
      if (code) {
        output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      } else {
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(4, heading[1].length + 1);
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.]\s+(.+)$/);
    if (bullet || numbered) {
      const nextList = numbered ? 'ol' : 'ul';
      if (list !== nextList) {
        closeList();
        list = nextList;
        output.push(`<${list}>`);
      }
      output.push(`<li>${renderInline((bullet ?? numbered)![1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) output.push(`<p>${renderInline(line)}</p>`);
  }
  closeList();
  if (code) output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return output.join('');
}

/**
 * Input:
 * - Page title, trusted session metadata, pre-rendered body, and application-owned browser script.
 *
 * Output:
 * - One self-contained responsive HTML document.
 *
 * What this function does:
 * - Applies shared visual structure to queued, failed, and ready learning pages.
 */
function pageShell(title: string, metadata: LearningSessionMetadata, body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(title)}</title>
  <style>
    /* Theme tokens and document-wide behavior. */
    :root { color-scheme: light; --ink:#18201d; --muted:#68716c; --paper:#fffdf7; --canvas:#eee9dc; --line:#d8d3c5; --navy:#183153; --teal:#087f78; --mint:#dff3ec; --amber:#f4a340; --danger:#b42318; }
    @media (prefers-color-scheme: dark) { :root { color-scheme:dark; --ink:#edf5f0; --muted:#a7b8af; --paper:#18211d; --canvas:#0f1513; --line:#35433d; --navy:#a9c8f3; --teal:#63ddd0; --mint:#173b35; --amber:#ffc268; --danger:#ff8d84; } }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; color:var(--ink); background:linear-gradient(135deg, color-mix(in srgb,var(--teal) 8%,transparent),transparent 32rem),var(--canvas); font:16px/1.65 ui-rounded,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    a { color:var(--teal); }
    button,textarea { font:inherit; }
    /* Main learning-page shell and repository header. */
    .shell { width:min(1180px,100%); margin:auto; background:var(--paper); min-height:100dvh; box-shadow:0 22px 65px rgba(24,49,83,.1); }
    header { padding:clamp(28px,6vw,72px) clamp(18px,6vw,72px) 34px; border-bottom:1px solid var(--line); background:radial-gradient(circle at 85% 15%,color-mix(in srgb,var(--amber) 22%,transparent),transparent 20rem); }
    .eyebrow { color:var(--teal); font:800 .75rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.12em; text-transform:uppercase; }
    h1 { max-width:900px; margin:.2em 0 .15em; color:var(--navy); font-size:clamp(2.2rem,7vw,5.4rem); line-height:.98; letter-spacing:-.055em; }
    .subtitle { max-width:760px; color:var(--muted); font-size:1.08rem; }
    .repo { display:flex; flex-wrap:wrap; gap:8px; margin-top:22px; }
    .chip { padding:5px 10px; border:1px solid var(--line); border-radius:999px; background:color-mix(in srgb,var(--mint) 65%,var(--paper)); font:700 .75rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
    /* Sticky section navigation and readable guide content. */
    nav { position:sticky; top:0; z-index:4; display:flex; gap:8px; overflow:auto; padding:10px 18px; border-bottom:1px solid var(--line); background:color-mix(in srgb,var(--paper) 92%,transparent); backdrop-filter:blur(16px); }
    nav a { flex:none; padding:6px 10px; border-radius:999px; color:var(--ink); text-decoration:none; font-size:.82rem; font-weight:750; }
    nav a:hover { background:var(--mint); color:var(--teal); }
    main { padding:30px clamp(16px,5vw,58px) 80px; }
    section { scroll-margin-top:72px; max-width:920px; margin:0 auto 42px; padding:clamp(20px,4vw,34px); border:1px solid var(--line); border-radius:24px; background:var(--paper); }
    section h2 { margin:0 0 .45em; color:var(--navy); font-size:clamp(1.45rem,4vw,2.2rem); line-height:1.12; letter-spacing:-.03em; }
    section h3,section h4 { color:var(--navy); }
    section p { margin:.65em 0; }
    ul,ol { padding-left:1.35em; }
    li { margin:.35em 0; }
    code { padding:.12em .35em; border-radius:6px; background:var(--mint); color:var(--teal); font:85% ui-monospace,SFMono-Regular,Menlo,monospace; }
    pre { overflow:auto; padding:16px; border:1px solid var(--line); border-radius:14px; background:var(--canvas); }
    pre code { padding:0; background:none; color:var(--ink); }
    .summary { color:var(--muted); font-size:1.02rem; }
    .evidence { margin-top:22px; padding-top:15px; border-top:1px dashed var(--line); }
    .evidence strong { display:block; color:var(--teal); font-size:.76rem; letter-spacing:.08em; text-transform:uppercase; }
    .flow { display:block; margin:10px 0; padding:13px 15px; border-left:4px solid var(--amber); background:color-mix(in srgb,var(--amber) 10%,var(--paper)); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
    details { margin:10px 0; padding:12px 14px; border:1px solid var(--line); border-radius:14px; }
    summary { cursor:pointer; color:var(--navy); font-weight:800; }
    /* Durable follow-up chat and session actions. */
    .chat { border-color:color-mix(in srgb,var(--teal) 55%,var(--line)); background:linear-gradient(145deg,color-mix(in srgb,var(--mint) 56%,var(--paper)),var(--paper)); }
    #chat-log { display:grid; gap:10px; max-height:520px; overflow:auto; margin:18px 0; }
    .message { padding:12px 14px; border:1px solid var(--line); border-radius:15px; white-space:pre-wrap; overflow-wrap:anywhere; }
    .message.user { margin-left:min(12%,80px); background:color-mix(in srgb,var(--navy) 10%,var(--paper)); }
    .message.assistant { margin-right:min(8%,60px); background:var(--paper); }
    form { display:grid; grid-template-columns:1fr auto; gap:10px; }
    textarea { min-height:78px; resize:vertical; padding:12px; border:1px solid var(--line); border-radius:14px; color:var(--ink); background:var(--paper); }
    button { min-height:44px; padding:8px 16px; border:1px solid var(--navy); border-radius:999px; color:var(--paper); background:var(--navy); cursor:pointer; font-weight:800; }
    button.secondary { border-color:var(--line); color:var(--ink); background:var(--paper); }
    .button-link { display:inline-flex; align-items:center; min-height:44px; padding:8px 16px; border:1px solid var(--line); border-radius:999px; color:var(--ink); background:var(--paper); text-decoration:none; font-weight:800; }
    button.danger { border-color:var(--danger); color:var(--danger); background:transparent; }
    button:disabled,textarea:disabled { opacity:.55; cursor:not-allowed; }
    .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:20px; }
    /* Queued and terminal generation status. */
    .waiting { max-width:620px; margin:10vh auto; text-align:center; }
    .spinner { width:54px; height:54px; margin:20px auto; border:5px solid var(--line); border-top-color:var(--teal); border-radius:50%; animation:spin .9s linear infinite; }
    .error { color:var(--danger); }
    @keyframes spin { to { transform:rotate(360deg); } }
    @media (max-width:640px) { form { grid-template-columns:1fr; } header { padding-top:34px; } section { border-radius:18px; } }
  </style>
</head>
<body><div class="shell">
  <!-- Repository identity and immutable session boundary. -->
  <header>
    <div class="eyebrow">Temporary code learning session</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="subtitle">${escapeHtml(metadata.repository)} at an immutable commit. This session expires at ${escapeHtml(new Date(metadata.expiresAt).toLocaleString())}.</p>
    <div class="repo"><span class="chip">${escapeHtml(metadata.defaultBranch)}</span><span class="chip">${escapeHtml(metadata.commitSha.slice(0, 12))}</span><span class="chip">1 hour</span></div>
  </header>
  ${body}
</div><script>${script}</script></body></html>`;
}

/**
 * Input:
 * - Queued or failed learning-session metadata.
 *
 * Output:
 * - A self-contained status page that watches generation while queued.
 *
 * What this function does:
 * - Uses SSE first and status polling as a reconnect fallback.
 * - Stops all polling after ready, failure, expiry, or deletion.
 */
export function renderLearningWaitingPage(metadata: LearningSessionMetadata): string {
  const sessionId = JSON.stringify(metadata.id);
  const failed = metadata.status === 'failed';
  const body = `<main><section class="waiting">${failed ? '' : '<div class="spinner"></div>'}<h2>${failed ? 'Guide generation stopped' : 'Reading the repository'}</h2><p id="status"${failed ? ' class="error"' : ''}>${escapeHtml(failed ? metadata.error || 'Guide generation failed.' : 'The durable Flue agent is mapping files, architecture, flows, tests, and safe extension points.')}</p><p class="summary">${failed ? 'Start a new session from the general assistant to try again.' : 'You can leave this page and return to the same URL while the session remains active.'}</p></section></main>`;
  if (failed) return pageShell(`Learning ${metadata.repository}`, metadata, body, '');
  const script = `
    const sessionId=${sessionId};
    const statusEl=document.querySelector('#status');
    const source=new EventSource('/learn/'+encodeURIComponent(sessionId)+'/events');
    let pollTimer;
    /** Input: optional error text. Output: none. What this function does: stops watchers and shows terminal failure. */
    function showFailure(error){source.close();clearInterval(pollTimer);statusEl.className='error';statusEl.textContent=error||'Guide generation failed.';}
    /** Input: none. Output: none. What this function does: stops watchers and reloads the published guide. */
    function showReady(){source.close();clearInterval(pollTimer);location.reload();}
    source.addEventListener('ready',showReady);
    source.addEventListener('failed',(event)=>{const data=JSON.parse(event.data);showFailure(data.error);});
    source.onerror=()=>{source.close();};
    /** Input: none. Output: a completed status request. What this function does: recovers when SSE disconnects or admission is still pending. */
    async function poll(){
      const response=await fetch('/learn/'+encodeURIComponent(sessionId)+'/status');
      if(response.status===404){showFailure('This learning session expired or was deleted.');return;}
      const data=await response.json().catch(()=>({}));
      if(data.status==='ready') showReady();
      if(data.status==='failed') showFailure(data.error);
    }
    pollTimer=setInterval(()=>void poll(),3000);
  `;
  return pageShell(`Learning ${metadata.repository}`, metadata, body, script);
}

/**
 * Input:
 * - Ready session metadata and its validated structured guide.
 *
 * Output:
 * - A self-contained guide with safe content, follow-up chat, and deletion controls.
 *
 * What this function does:
 * - Converts the fixed guide schema into navigable HTML pinned to one commit.
 * - Uses textContent for follow-up answers so model output cannot become browser markup.
 */
export function renderLearningGuidePage(metadata: LearningSessionMetadata, guide: LearningGuide): string {
  const navigation = [
    ['overview', 'Overview'], ['quick-start', 'Start'], ['architecture', 'Architecture'], ['flows', 'Flows'],
    ...guide.sections.map((section) => [section.id, section.title]), ['safe-changes', 'Change safely'], ['quiz', 'Quiz'], ['ask', 'Ask'],
  ].map(([id, label]) => `<a href="#${escapeHtml(id)}">${escapeHtml(label)}</a>`).join('');
  const sections = guide.sections.map((section) => `<section id="${escapeHtml(section.id)}"><div class="eyebrow">Code walkthrough</div><h2>${escapeHtml(section.title)}</h2><p class="summary">${escapeHtml(section.summary)}</p>${renderMarkdown(section.content)}<div class="evidence"><strong>Repository evidence</strong><ul>${section.evidence.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('')}</ul></div></section>`).join('');
  const body = `<nav>${navigation}</nav><main>
    <section id="overview"><div class="eyebrow">Repository orientation</div><h2>${escapeHtml(guide.title)}</h2><p class="summary">${escapeHtml(guide.subtitle)}</p>${renderMarkdown(guide.overview)}<p><a href="${escapeHtml(metadata.repositoryUrl)}" target="_blank" rel="noreferrer">Open repository at GitHub</a></p></section>
    <section id="quick-start"><div class="eyebrow">Developer quick start</div><h2>Operate it before reading every file</h2><ol>${guide.quickStart.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol></section>
    <section id="architecture"><div class="eyebrow">Architecture</div><h2>Components and responsibilities</h2><ul>${guide.architecture.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul></section>
    <section id="flows"><div class="eyebrow">Runtime order</div><h2>Request and data flows</h2>${guide.requestFlows.map((item) => `<span class="flow">${escapeHtml(item)}</span>`).join('')}</section>
    ${sections}
    <section id="safe-changes"><div class="eyebrow">Extension map</div><h2>Change the system safely</h2><ul>${guide.safeChanges.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul></section>
    <section id="quiz"><div class="eyebrow">Explain it back</div><h2>Knowledge check</h2>${guide.quiz.map((item) => `<details><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join('')}</section>
    <section class="chat" id="ask"><div class="eyebrow">Durable Flue tutor</div><h2>Ask about this repository</h2><p class="summary">Follow-up answers stay pinned to commit <code>${escapeHtml(metadata.commitSha.slice(0, 12))}</code>.</p><div id="chat-log"></div><form id="chat-form"><textarea id="question" required placeholder="Ask about a flow, file, symbol, test, or safe change..."></textarea><button id="send">Ask</button></form><div class="actions"><button class="danger" id="delete-session" type="button">Delete session</button><a class="button-link" href="/chat">General assistant</a></div></section>
  </main>`;
  const script = `
    const sessionId=${JSON.stringify(metadata.id)};
    const log=document.querySelector('#chat-log');
    const form=document.querySelector('#chat-form');
    const question=document.querySelector('#question');
    const send=document.querySelector('#send');
    /** Input: message role and text. Output: the new message element. What this function does: appends escaped browser text and keeps the newest answer visible. */
    function add(role,text){const item=document.createElement('div');item.className='message '+role;item.textContent=text;log.append(item);log.scrollTop=log.scrollHeight;return item;}
    /** Input: form submit event. Output: a completed follow-up request. What this function does: asks the same durable tutor and renders its text-only answer. */
    async function handleSubmit(event){event.preventDefault();const value=question.value.trim();if(!value)return;add('user',value);const answer=add('assistant','Reading the pinned repository context...');question.value='';question.disabled=true;send.disabled=true;try{const response=await fetch('/learn/'+encodeURIComponent(sessionId)+'/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Question failed');answer.textContent=data.answer;}catch(error){answer.classList.add('error');answer.textContent=error instanceof Error?error.message:String(error);}finally{question.disabled=false;send.disabled=false;question.focus();}}
    /** Input: none. Output: a completed delete request. What this function does: confirms and removes both temporary KV and durable conversation state. */
    async function handleDelete(){if(!confirm('Delete this guide and its durable conversation now?'))return;const response=await fetch('/v1/learning-sessions/'+encodeURIComponent(sessionId),{method:'DELETE'});if(response.ok)location.href='/chat';else alert('Session deletion failed.');}
    form.addEventListener('submit',handleSubmit);
    document.querySelector('#delete-session').addEventListener('click',handleDelete);
  `;
  return pageShell(guide.title, metadata, body, script);
}
