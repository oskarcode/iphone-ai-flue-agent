// Learning-session types define the only model-authored values this fixed renderer accepts.
import type { LearningGuide, LearningSessionMetadata } from './lib/learning-session.ts';
import { renderTutorMarkdown } from './lib/tutor-markdown.ts';

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
function pageShell(title: string, metadata: LearningSessionMetadata, body: string, script: string, chatOnly = false): string {
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
    .prompt-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; margin-top:18px; }
    .prompt-card { min-height:unset; padding:12px 14px; border-color:var(--line); border-radius:16px; color:var(--ink); background:color-mix(in srgb,var(--mint) 42%,var(--paper)); text-align:left; font-weight:800; }
    .prompt-card span { display:block; margin-top:4px; color:var(--muted); font-size:.78rem; font-weight:600; }
    .repo-tutor-card { max-width:980px; }
    .repo-tutor-card #chat-log { min-height:360px; max-height:62dvh; border:1px solid var(--line); border-radius:18px; background:color-mix(in srgb,var(--canvas) 35%,var(--paper)); }
    .repo-tutor-card .tutor-form { margin-top:12px; border:1px solid var(--line); border-radius:18px; }
    .repo-tutor-card .chat-empty { margin:80px auto; }
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
    /* Ready sessions contain only a viewport-sized conversation and composer. */
    .chat-only { height:100dvh; min-height:0; max-width:960px; display:flex; flex-direction:column; overflow:hidden; box-shadow:none; }
    .chat-only main { min-height:0; flex:1; display:flex; flex-direction:column; padding:0; }
    .chat-only #chat-log { flex:1; padding:clamp(16px,4vw,36px); gap:20px; }
    .chat-only .message { flex-shrink:0; min-width:0; font-size:1rem; }
    .chat-only .message.assistant { white-space:normal; border:0; padding:0; }
    .message.assistant p { margin:.6em 0; }
    .message.assistant h3 { margin:1.2em 0 .4em; font-size:1.12rem; }
    .message.assistant > :first-child { margin-top:0; }
    .message.assistant blockquote { margin:16px 0; padding:10px 16px; border-left:3px solid var(--teal); background:var(--mint); }
    .code-block { max-width:100%; margin:16px 0; overflow:hidden; border:1px solid var(--line); border-radius:12px; }
    .code-toolbar { display:flex; justify-content:space-between; align-items:center; padding:6px 12px; color:var(--muted); background:var(--canvas); font-size:.75rem; }
    .code-toolbar button { min-height:32px; padding:2px 10px; border-color:var(--line); color:var(--ink); background:var(--paper); font-size:.75rem; }
    .code-block pre { margin:0; border:0; border-radius:0; white-space:pre; font-size:.86rem; }
    .table-scroll { max-width:100%; overflow-x:auto; margin:16px 0; }
    .table-scroll table { width:100%; border-collapse:collapse; font-size:.9rem; }
    .table-scroll th,.table-scroll td { min-width:120px; padding:10px 12px; border:1px solid var(--line); text-align:left; vertical-align:top; }
    .table-scroll th { background:var(--mint); }
    .chat-only .prompt-grid { display:flex; flex-wrap:nowrap; flex-shrink:0; gap:8px; margin:0; padding:10px 16px; overflow-x:auto; }
    .chat-only .prompt-card { flex:none; min-height:44px; padding:8px 12px; border-radius:999px; font-size:.8rem; }
    .chat-only .tutor-form { flex-shrink:0; padding:12px max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left)); background:var(--paper); }
    .chat-only textarea { font-size:16px; }
    :focus-visible { outline:2px solid var(--teal); outline-offset:3px; }
  </style>
</head>
<body><div class="shell${chatOnly ? ' chat-only' : ''}">
  ${chatOnly ? '' : `<!-- Repository identity and immutable session boundary. -->
  <header>
    <div class="eyebrow">Repository tutor session</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="subtitle">${escapeHtml(metadata.repository)} at an immutable commit. Keep this browser page open and use the repository tutor when it is ready.</p>
    <div class="repo"><span class="chip">${escapeHtml(metadata.defaultBranch)}</span><span class="chip">${escapeHtml(metadata.commitSha.slice(0, 12))}</span><span class="chip">chat-first</span></div>
  </header>`}
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
 * - A chat-only page with starter prompts and safely formatted tutor answers.
 *
 * The legacy guide argument is accepted for route compatibility but never rendered.
 */
export function renderLearningGuidePage(metadata: LearningSessionMetadata, _guide: LearningGuide): string {
  const learningPrompts = [
    ['High-level purpose', 'Explain this codebase at a high level: what problem it solves, who uses it, the main runtime entry points, and the 5 most important concepts I should understand first.'],
    ['Architecture map', 'Map the architecture of this repository. Show the major components, their responsibilities, and how state/data moves between them. Cite the files I should read.'],
    ['Traffic flow', 'Walk me through the main traffic/request flow from entry point to response. Include API routes, background work, durable/stateful parts, and external services.'],
    ['API → backend → frontend', 'Explain how the API/backend/frontend pieces map together. For each important user action, show the frontend file, backend route/handler, state/storage used, and response path.'],
    ['Folder and file tour', 'Teach me the folder and file structure. For each important directory, explain why it exists, what files matter, and what order I should read them in.'],
    ['Main code walkthrough', 'Teach me the main code files in learning order. For each file: purpose, important functions/classes, key control flow, and beginner-friendly explanation of the syntax and design choices.'],
    ['Safe change plan', 'If I wanted to make a small feature or fix, where should I start? Give safe extension points, tests/checks to run, and files to avoid changing casually.'],
  ] as const;
  const promptButtons = learningPrompts.map(([title, prompt]) => `<button class="prompt-card" type="button" data-prompt="${escapeHtml(prompt)}">${escapeHtml(title)}</button>`).join('');
  const body = `<main aria-label="Repository tutor">
    <div id="chat-log" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"></div>
    <div class="prompt-grid" role="group" aria-label="Starter prompts">${promptButtons}</div>
    <form class="tutor-form" id="chat-form"><textarea id="question" aria-label="Your question" maxlength="4000" placeholder="Ask about this repository..." rows="2"></textarea><button id="send" type="submit">Send</button></form>
  </main>`;
  const script = `
    const sessionId=${JSON.stringify(metadata.id)};
    const log=document.querySelector('#chat-log');
    const form=document.querySelector('#chat-form');
    const question=document.querySelector('#question');
    const send=document.querySelector('#send');
    const renderAnswer=${renderTutorMarkdown.toString()};
    let busy=false;
    function add(role,text){const item=document.createElement('div');item.className='message '+role;item.setAttribute('aria-label',role==='user'?'You':'Tutor');item.textContent=text;log.append(item);log.scrollTop=log.scrollHeight;return item;}
    async function handleSubmit(event){
      event.preventDefault();
      const value=question.value.trim();
      if(!value||busy)return;
      busy=true;
      add('user',value);
      const answer=add('assistant','Thinking…');
      question.value='';question.disabled=true;send.disabled=true;
      document.querySelectorAll('[data-prompt]').forEach(button=>button.disabled=true);
      try{
        const response=await fetch('/learn/'+encodeURIComponent(sessionId)+'/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:value})});
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||'Question failed');
        if(typeof data.answer!=='string')throw new Error('No answer received. Please try again.');
        answer.innerHTML=renderAnswer(data.answer);
      }catch(error){
        answer.classList.add('error');answer.textContent=error instanceof Error?error.message:String(error);
        question.value=value;
      }finally{
        busy=false;question.disabled=false;send.disabled=false;
        document.querySelectorAll('[data-prompt]').forEach(button=>button.disabled=false);
        question.focus({preventScroll:true});
      }
    }
    log.addEventListener('click',async(event)=>{
      const button=event.target.closest('[data-copy-code]');
      if(!button)return;
      try{await navigator.clipboard.writeText(button.closest('.code-block').querySelector('code').textContent);button.textContent='Copied';}
      catch{button.textContent='Copy failed';}
      setTimeout(()=>button.textContent='Copy',1800);
    });
    form.addEventListener('submit',handleSubmit);
    document.querySelectorAll('[data-prompt]').forEach((button)=>button.addEventListener('click',()=>{if(busy)return;question.value=button.dataset.prompt||'';question.focus();}));
    question.addEventListener('keydown',(event)=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit();}});
  `;
  return pageShell(`Repository tutor: ${metadata.repository}`, metadata, body, script, true);
}
