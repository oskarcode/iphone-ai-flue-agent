export function renderChatPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>iPhone AI Assistant</title>
  <style>
    :root { color-scheme: light dark; --bg:#f4f1e9; --panel:#fffdf8; --text:#23221f; --muted:#746f66; --line:#ded8cc; --accent:#155eef; --user:#e6efff; }
    @media (prefers-color-scheme:dark) { :root { --bg:#151515; --panel:#222; --text:#f4f2ed; --muted:#aaa59c; --line:#3a3936; --accent:#77a5ff; --user:#18345f; } }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100dvh; background:var(--bg); color:var(--text); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(100%,900px); min-height:100dvh; margin:auto; display:grid; grid-template-rows:auto 1fr auto; background:var(--panel); }
    header { position:sticky; top:0; z-index:2; display:flex; justify-content:space-between; align-items:center; padding:calc(14px + env(safe-area-inset-top)) 16px 14px; border-bottom:1px solid var(--line); background:color-mix(in srgb,var(--panel) 92%,transparent); backdrop-filter:blur(14px); }
    h1 { margin:0; font-size:1.15rem; } header p { margin:2px 0 0; color:var(--muted); font-size:.8rem; }
    button { min-height:44px; border:1px solid var(--line); border-radius:999px; padding:8px 14px; background:var(--panel); color:var(--text); font:inherit; }
    #messages { display:flex; flex-direction:column; gap:12px; padding:18px 12px 120px; }
    .empty { margin:12vh auto; max-width:34rem; padding:24px; color:var(--muted); text-align:center; border:1px dashed var(--line); border-radius:20px; }
    article { max-width:min(92%,780px); padding:13px 15px; border:1px solid var(--line); border-radius:18px; white-space:pre-wrap; overflow-wrap:anywhere; }
    article.user { align-self:flex-end; background:var(--user); } article.assistant { align-self:flex-start; } article.error { color:#d92d20; }
    .role { display:block; margin-bottom:5px; color:var(--muted); font-size:.7rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
    form { position:sticky; bottom:0; display:grid; grid-template-columns:1fr auto; gap:10px; padding:12px 12px calc(12px + env(safe-area-inset-bottom)); border-top:1px solid var(--line); background:var(--panel); }
    textarea { width:100%; min-height:48px; max-height:180px; resize:none; border:1px solid var(--line); border-radius:18px; padding:12px 14px; background:var(--bg); color:var(--text); font:inherit; }
    .primary { border-color:var(--accent); background:var(--accent); color:white; font-weight:700; } button:disabled,textarea:disabled { opacity:.55; }
  </style>
</head>
<body>
<main>
  <header><div><h1>iPhone AI Assistant</h1><p>Flue + Jev + Workers AI</p></div><button id="new-chat">New Chat</button></header>
  <section id="messages"><div class="empty">Paste text, a URL, or ask a current question. Jev will select the right path.</div></section>
  <form id="composer"><textarea id="input" placeholder="Ask or paste something..." required></textarea><button class="primary" id="send">Send</button></form>
</main>
<script>
  const messages = [];
  let conversationId = crypto.randomUUID();
  let activeController = null;
  const messagesEl = document.querySelector('#messages');
  const inputEl = document.querySelector('#input');
  const sendEl = document.querySelector('#send');

  function render() {
    messagesEl.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement('div'); empty.className='empty';
      empty.textContent='Paste text, a URL, or ask a current question. Jev will select the right path.';
      messagesEl.append(empty); return;
    }
    for (const message of messages) {
      const article=document.createElement('article'); article.className=message.role;
      const role=document.createElement('span'); role.className='role'; role.textContent=message.role;
      const content=document.createElement('span'); content.textContent=message.content;
      article.append(role,content); messagesEl.append(article);
    }
    window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
  }

  function showError(text) {
    const article=document.createElement('article'); article.className='error'; article.textContent=text; messagesEl.append(article);
  }

  async function sendMessage(value) {
    const content=value.trim(); if (!content) return;
    messages.push({role:'user',content}); render(); inputEl.value='';
    inputEl.disabled=true; sendEl.disabled=true; sendEl.textContent='Thinking...';
    activeController=new AbortController();
    try {
      const response=await fetch('/chat/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversation_id:conversationId,messages}),signal:activeController.signal});
      const data=await response.json();
      if (!response.ok) throw new Error(data.error||'Chat request failed');
      messages.push({role:'assistant',content:data.explanation}); render();
    } catch (error) {
      messages.pop(); render();
      if (!(error instanceof DOMException && error.name==='AbortError')) showError(error instanceof Error?error.message:String(error));
    } finally {
      activeController=null; inputEl.disabled=false; sendEl.disabled=false; sendEl.textContent='Send'; inputEl.focus();
    }
  }

  function readSessionIdFromUrl() {
    const query=new URLSearchParams(location.search); const id=query.get('session');
    if (id) history.replaceState(null,'',location.pathname); return id;
  }

  async function loadSession(id) {
    try {
      const response=await fetch('/chat/session/'+encodeURIComponent(id)); const data=await response.json();
      if (!response.ok) throw new Error(data.error||'Could not load copied text');
      conversationId=id; await sendMessage(data.text);
    } catch (error) { showError(error instanceof Error?error.message:String(error)); }
  }

  document.querySelector('#composer').addEventListener('submit',(event)=>{event.preventDefault();void sendMessage(inputEl.value);});
  document.querySelector('#new-chat').addEventListener('click',()=>{activeController?.abort();conversationId=crypto.randomUUID();messages.splice(0);render();inputEl.focus();});
  inputEl.addEventListener('input',()=>{inputEl.style.height='auto';inputEl.style.height=Math.min(inputEl.scrollHeight,180)+'px';});
  render(); const sessionId=readSessionIdFromUrl(); if (sessionId) void loadSession(sessionId);
</script>
</body>
</html>`;
}
