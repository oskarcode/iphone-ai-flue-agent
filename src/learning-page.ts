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
    body { margin:0; color:var(--ink); background:linear-gradient(135deg, color-mix(in srgb,var(--teal) 8%,transparent),transparent 32rem),var(--canvas); font:16px/1.65 ui-rounded,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; -webkit-text-size-adjust:100%; }
    a { color:var(--teal); }
    button,textarea { font:inherit; }
    /* Main learning-page shell and repository header. */
    .shell { width:min(1180px,100%); margin:auto; padding-bottom:env(safe-area-inset-bottom); background:var(--paper); min-height:100dvh; box-shadow:0 22px 65px rgba(24,49,83,.1); }
    header { padding:clamp(28px,6vw,72px) clamp(18px,6vw,72px) 34px; border-bottom:1px solid var(--line); background:radial-gradient(circle at 85% 15%,color-mix(in srgb,var(--amber) 22%,transparent),transparent 20rem); }
    .eyebrow { color:var(--teal); font:800 .75rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.12em; text-transform:uppercase; }
    h1 { max-width:900px; margin:.2em 0 .15em; color:var(--navy); font-size:clamp(2.2rem,7vw,5.4rem); line-height:.98; letter-spacing:-.055em; }
    .subtitle { max-width:760px; color:var(--muted); font-size:1.08rem; }
    .repo { display:flex; flex-wrap:wrap; gap:8px; margin-top:22px; }
    .chip { padding:5px 10px; border:1px solid var(--line); border-radius:999px; background:color-mix(in srgb,var(--mint) 65%,var(--paper)); font:700 .75rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
    /* Sticky section navigation and readable guide content. */
    nav { position:sticky; top:0; z-index:4; display:flex; gap:8px; overflow:auto; padding:10px max(18px,env(safe-area-inset-left)); border-bottom:1px solid var(--line); background:color-mix(in srgb,var(--paper) 92%,transparent); backdrop-filter:blur(16px); scroll-snap-type:x proximity; scrollbar-width:none; }
    nav::-webkit-scrollbar { display:none; }
    nav a { flex:none; min-height:38px; display:inline-flex; align-items:center; padding:6px 11px; border-radius:999px; color:var(--ink); text-decoration:none; font-size:.82rem; font-weight:750; scroll-snap-align:start; }
    nav a:hover { background:var(--mint); color:var(--teal); }
    main { padding:30px clamp(16px,5vw,58px) 80px; }
    section { scroll-margin-top:72px; max-width:920px; margin:0 auto 28px; padding:clamp(20px,4vw,34px); border:1px solid var(--line); border-radius:24px; background:var(--paper); box-shadow:0 12px 34px color-mix(in srgb,var(--navy) 7%,transparent); }
    section h2 { margin:0 0 .45em; color:var(--navy); font-size:clamp(1.45rem,4vw,2.2rem); line-height:1.12; letter-spacing:-.03em; }
    section h3,section h4 { color:var(--navy); }
    section p { margin:.65em 0; }
    ul,ol { padding-left:1.35em; }
    li { margin:.35em 0; }
    code { padding:.12em .35em; border-radius:6px; background:var(--mint); color:var(--teal); font:85% ui-monospace,SFMono-Regular,Menlo,monospace; }
    pre { max-width:100%; overflow:auto; padding:16px; border:1px solid var(--line); border-radius:14px; background:var(--canvas); -webkit-overflow-scrolling:touch; }
    pre code { padding:0; background:none; color:var(--ink); }
    .summary { color:var(--muted); font-size:1.02rem; }
    .evidence { margin-top:22px; padding-top:15px; border-top:1px dashed var(--line); }
    .evidence strong { display:block; color:var(--teal); font-size:.76rem; letter-spacing:.08em; text-transform:uppercase; }
    .flow { display:block; margin:10px 0; padding:13px 15px; border-left:4px solid var(--amber); border-radius:0 14px 14px 0; background:color-mix(in srgb,var(--amber) 10%,var(--paper)); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
    details { margin:10px 0; padding:12px 14px; border:1px solid var(--line); border-radius:14px; background:color-mix(in srgb,var(--canvas) 45%,var(--paper)); }
    summary { cursor:pointer; color:var(--navy); font-weight:800; }
    /* Floating, commit-pinned tutor and session actions. */
    .session-card { border-color:color-mix(in srgb,var(--teal) 48%,var(--line)); background:linear-gradient(145deg,color-mix(in srgb,var(--mint) 48%,var(--paper)),var(--paper)); }
    .tutor-launcher { position:fixed; right:max(16px,env(safe-area-inset-right)); bottom:max(16px,env(safe-area-inset-bottom)); z-index:20; display:flex; align-items:center; gap:8px; min-height:52px; padding:10px 18px; box-shadow:0 16px 38px rgba(24,49,83,.28); }
    .tutor-panel { position:fixed; inset:16px 16px 16px auto; z-index:21; display:grid; grid-template-rows:auto auto minmax(0,1fr) auto; width:min(430px,calc(100vw - 32px)); overflow:hidden; border:1px solid color-mix(in srgb,var(--teal) 42%,var(--line)); border-radius:24px; background:color-mix(in srgb,var(--paper) 96%,transparent); box-shadow:0 28px 90px rgba(15,30,45,.32); backdrop-filter:blur(18px); }
    .tutor-panel[hidden] { display:none; }
    .tutor-panel.expanded { inset:10px; width:auto; }
    .tutor-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:16px 16px 13px; border-bottom:1px solid var(--line); }
    .tutor-header h2 { margin:0; color:var(--navy); font-size:1rem; }
    .tutor-header p { margin:3px 0 0; color:var(--muted); font-size:.76rem; }
    .tutor-header-actions,.selection-actions { display:flex; gap:7px; }
    .tutor-icon,.tutor-small { min-height:34px; padding:6px 10px; border-color:var(--line); color:var(--ink); background:var(--paper); font-size:.76rem; }
    .selection-context { display:grid; gap:8px; padding:11px 16px; border-bottom:1px solid var(--line); background:color-mix(in srgb,var(--mint) 38%,var(--paper)); }
    .selection-preview { max-height:78px; overflow:auto; padding:9px 10px; border-radius:12px; background:color-mix(in srgb,var(--canvas) 60%,var(--paper)); color:var(--muted); font-size:.78rem; white-space:pre-wrap; }
    #chat-log { display:flex; flex-direction:column; gap:10px; min-height:0; overflow:auto; padding:16px; }
    .chat-empty { margin:auto; max-width:280px; color:var(--muted); text-align:center; font-size:.9rem; }
    .message { padding:11px 13px; border:1px solid var(--line); border-radius:15px; white-space:pre-wrap; overflow-wrap:anywhere; font-size:.9rem; }
    .message.user { align-self:flex-end; max-width:88%; border-color:var(--navy); background:var(--navy); color:var(--paper); }
    .message.assistant { align-self:stretch; background:var(--paper); }
    .tutor-form { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; padding:12px; border-top:1px solid var(--line); background:color-mix(in srgb,var(--canvas) 50%,var(--paper)); }
    .tutor-form textarea { min-height:48px; max-height:130px; resize:vertical; padding:11px 12px; border:1px solid var(--line); border-radius:15px; color:var(--ink); background:var(--paper); }
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
    @media (max-width:640px) {
      body { font-size:15px; line-height:1.58; }
      .shell { box-shadow:none; }
      header { padding:28px 18px 22px; }
      h1 { font-size:clamp(2rem,12vw,3.35rem); }
      .subtitle { font-size:.96rem; }
      nav { padding-block:8px; }
      main { padding:18px 8px calc(104px + env(safe-area-inset-bottom)); }
      section { margin-bottom:16px; padding:18px 16px; border-radius:20px; box-shadow:0 8px 24px color-mix(in srgb,var(--navy) 6%,transparent); }
      section h2 { font-size:1.45rem; }
      pre { margin-inline:-6px; padding:13px; font-size:.78rem; }
      .flow { font-size:.8rem; }
      .tutor-launcher { right:12px; bottom:max(12px,env(safe-area-inset-bottom)); min-height:50px; }
      .tutor-panel { inset:auto 8px max(8px,env(safe-area-inset-bottom)); width:auto; height:min(82dvh,720px); border-radius:20px; }
      .tutor-panel.expanded { inset:8px 8px max(8px,env(safe-area-inset-bottom)); width:auto; height:auto; }
      .tutor-header { padding:13px 12px 11px; }
      .selection-context { padding:9px 12px; }
      #chat-log { padding:12px; }
      .tutor-form { padding:9px; }
    }
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
    ...guide.sections.map((section) => [section.id, section.title]), ['safe-changes', 'Change safely'], ['quiz', 'Quiz'],
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
    <section class="session-card" id="session"><div class="eyebrow">Keep learning</div><h2>Select any guide text to ask the tutor</h2><p class="summary">The floating Flue tutor stays pinned to commit <code>${escapeHtml(metadata.commitSha.slice(0, 12))}</code>. Highlight a sentence or code path and the tutor will prepare an explanation.</p><div class="actions"><button class="secondary" id="open-tutor-inline" type="button">Open repository tutor</button><button class="danger" id="delete-session" type="button">Delete session</button><a class="button-link" href="/chat">General assistant</a></div></section>
  </main>
  <button class="tutor-launcher" id="tutor-open" type="button" aria-controls="tutor-panel" aria-expanded="false">Ask repository tutor</button>
  <aside class="tutor-panel" id="tutor-panel" aria-label="Repository tutor chat" hidden>
    <div class="tutor-header"><div><h2>Repository tutor</h2><p>${escapeHtml(metadata.repository)} at ${escapeHtml(metadata.commitSha.slice(0, 12))}</p></div><div class="tutor-header-actions"><button class="tutor-icon" id="tutor-expand" type="button" aria-label="Expand tutor" aria-expanded="false">Expand</button><button class="tutor-icon" id="tutor-close" type="button" aria-label="Close tutor">Close</button></div></div>
    <div class="selection-context"><div class="selection-preview" id="selection-preview">Highlight guide text to prepare an explanation.</div><div class="selection-actions"><button class="tutor-small" id="ask-selection" type="button" disabled>Explain selection</button><button class="tutor-small" id="clear-selection" type="button" disabled>Clear</button></div></div>
    <div id="chat-log"><p class="chat-empty" id="chat-empty">Ask about a file, flow, test, or safe change. Your follow-up conversation remains attached to this repository session.</p></div>
    <form class="tutor-form" id="chat-form"><textarea id="question" maxlength="4000" placeholder="Ask about this guide or repository..." rows="2"></textarea><button id="send">Send</button></form>
  </aside>`;
  const script = `
    const sessionId=${JSON.stringify(metadata.id)};
    const log=document.querySelector('#chat-log');
    const form=document.querySelector('#chat-form');
    const question=document.querySelector('#question');
    const send=document.querySelector('#send');
    const panel=document.querySelector('#tutor-panel');
    const launcher=document.querySelector('#tutor-open');
    const preview=document.querySelector('#selection-preview');
    const askSelection=document.querySelector('#ask-selection');
    const clearSelectionButton=document.querySelector('#clear-selection');
    const empty=document.querySelector('#chat-empty');
    let selectedText='';
    let selectedSection='';
    let selectionTimer;
    /** Input: whether to focus the composer. Output: none. What this function does: opens the floating tutor without rebuilding conversation state. */
    function openTutor(focus=true){panel.hidden=false;launcher.setAttribute('aria-expanded','true');if(focus)question.focus();}
    /** Input: none. Output: none. What this function does: hides the drawer while preserving messages and selection context. */
    function closeTutor(){panel.hidden=true;launcher.setAttribute('aria-expanded','false');}
    /** Input: none. Output: none. What this function does: expands or restores the tutor without losing its scroll position. */
    function toggleTutorSize(){const top=log.scrollTop;const expanded=panel.classList.toggle('expanded');const button=document.querySelector('#tutor-expand');button.textContent=expanded?'Restore':'Expand';button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',expanded?'Restore tutor size':'Expand tutor');requestAnimationFrame(()=>{log.scrollTop=top;});}
    /** Input: a selection anchor node. Output: nearby guide context. What this function does: gives the tutor a bounded section label. */
    function sectionForNode(node){const element=node&&node.nodeType===Node.TEXT_NODE?node.parentElement:node;const section=element&&element.closest?element.closest('section'):null;const heading=(section&&section.querySelector('h2,h3'))||(element&&element.closest?element.closest('h1,h2,h3'):null);return heading?heading.textContent.trim().slice(0,240):document.title.slice(0,240);}
    /** Input: the browser's current selection. Output: bounded visible context. What this function does: opens the tutor with an explanation draft for selected guide text. */
    function captureSelection(){const selection=window.getSelection();const text=selection?selection.toString().trim():'';if(!text)return;const anchor=selection.anchorNode&&(selection.anchorNode.nodeType===Node.TEXT_NODE?selection.anchorNode.parentElement:selection.anchorNode);const focus=selection.focusNode&&(selection.focusNode.nodeType===Node.TEXT_NODE?selection.focusNode.parentElement:selection.focusNode);if((anchor&&panel.contains(anchor))||(focus&&panel.contains(focus)))return;selectedText=text.slice(0,5000);selectedSection=sectionForNode(selection.anchorNode);preview.textContent=selectedText;askSelection.disabled=false;clearSelectionButton.disabled=false;if(!question.value.trim())question.value='Explain this selected text and connect it to the repository.';openTutor(false);}
    /** Input: current selection state. Output: empty context. What this function does: prevents stale guide text from affecting later questions. */
    function clearSelection(){selectedText='';selectedSection='';preview.textContent='Highlight guide text to prepare an explanation.';askSelection.disabled=true;clearSelectionButton.disabled=true;}
    /** Input: message role and text. Output: the new message element. What this function does: appends escaped browser text and keeps the newest answer visible. */
    function add(role,text){empty?.remove();const item=document.createElement('div');item.className='message '+role;item.textContent=text;log.append(item);log.scrollTop=log.scrollHeight;return item;}
    /** Input: form submit event. Output: a completed follow-up request. What this function does: asks the same durable tutor and renders its text-only answer. */
    async function handleSubmit(event){event.preventDefault();const value=question.value.trim();if(!value&&!selectedText)return;const visibleQuestion=value||'Explain the selected guide text.';add('user',visibleQuestion);const answer=add('assistant','Reading the pinned repository context...');question.value='';question.disabled=true;send.disabled=true;try{const response=await fetch('/learn/'+encodeURIComponent(sessionId)+'/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:value,selectedText,sectionTitle:selectedSection})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Question failed');answer.textContent=data.answer;}catch(error){answer.classList.add('error');answer.textContent=error instanceof Error?error.message:String(error);}finally{question.disabled=false;send.disabled=false;question.focus();}}
    /** Input: none. Output: a completed delete request. What this function does: confirms and removes both temporary KV and durable conversation state. */
    async function handleDelete(){if(!confirm('Delete this guide and its durable conversation now?'))return;const response=await fetch('/v1/learning-sessions/'+encodeURIComponent(sessionId),{method:'DELETE'});if(response.ok)location.href='/chat';else alert('Session deletion failed.');}
    form.addEventListener('submit',handleSubmit);
    document.querySelector('#delete-session').addEventListener('click',handleDelete);
    launcher.addEventListener('click',()=>openTutor());
    document.querySelector('#open-tutor-inline').addEventListener('click',()=>openTutor());
    document.querySelector('#tutor-close').addEventListener('click',closeTutor);
    document.querySelector('#tutor-expand').addEventListener('click',toggleTutorSize);
    askSelection.addEventListener('click',()=>{if(!selectedText)return;question.value='Explain this selected text and connect it to the repository.';openTutor();});
    clearSelectionButton.addEventListener('click',clearSelection);
    question.addEventListener('keydown',(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();form.requestSubmit();}});
    document.addEventListener('selectionchange',()=>{clearTimeout(selectionTimer);selectionTimer=setTimeout(captureSelection,280);});
    document.addEventListener('pointerup',(event)=>{if(panel.contains(event.target)||launcher.contains(event.target))return;setTimeout(captureSelection,0);});
    document.addEventListener('touchend',(event)=>{if(panel.contains(event.target)||launcher.contains(event.target))return;setTimeout(captureSelection,320);},{passive:true});
    document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&!panel.hidden)closeTutor();});
  `;
  return pageShell(guide.title, metadata, body, script);
}
