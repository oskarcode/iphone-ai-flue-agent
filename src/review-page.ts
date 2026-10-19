import type { LearningArchiveEvent, LearningArchiveSessionDetail, LearningArchiveSessionSummary } from './lib/learning-archive.ts';
import type { ShareDraft } from './lib/share-draft.ts';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; --bg:#f8fafc; --card:#fff; --ink:#102033; --muted:#667085; --line:#d9e2ec; --teal:#0f766e; --danger:#b42318; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1220; --card:#111827; --ink:#e6edf6; --muted:#9aa8bb; --line:#243143; --teal:#5eead4; --danger:#fca5a5; } }
* { box-sizing:border-box; }
body { margin:0; color:var(--ink); background:radial-gradient(circle at 80% 0,color-mix(in srgb,var(--teal) 13%,transparent),transparent 30rem),var(--bg); font:16px/1.58 ui-rounded,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
a { color:var(--teal); }
main { width:min(1120px,100%); margin:0 auto; padding:28px 16px 56px; }
.header, .card, .event { background:color-mix(in srgb,var(--card) 93%,transparent); border:1px solid var(--line); border-radius:22px; box-shadow:0 18px 50px color-mix(in srgb,#0f172a 10%,transparent); }
.header { padding:22px; margin-bottom:16px; }
.card { padding:18px; margin:14px 0; }
.eyebrow { color:var(--teal); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.12em; }
h1, h2, h3 { line-height:1.15; margin:.35rem 0 .75rem; }
p { margin:.45rem 0; }
.muted { color:var(--muted); }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
.session { display:grid; grid-template-columns:1.8fr 1fr .7fr .5fr; gap:12px; align-items:center; padding:14px 0; border-top:1px solid var(--line); }
.session:first-child { border-top:0; }
.badge { display:inline-flex; align-items:center; padding:4px 9px; border:1px solid var(--line); border-radius:999px; font-size:12px; color:var(--muted); }
pre { white-space:pre-wrap; overflow:auto; padding:14px; background:color-mix(in srgb,var(--bg) 76%,var(--card)); border:1px solid var(--line); border-radius:14px; }
.event { padding:14px; margin:10px 0; }
.event-header { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:space-between; }
.share-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px; }
.share-box { border:1px solid var(--line); border-radius:16px; padding:14px; background:color-mix(in srgb,var(--bg) 46%,var(--card)); }
.share-text { width:100%; min-height:150px; resize:vertical; border:1px solid var(--line); border-radius:12px; padding:12px; color:var(--ink); background:var(--card); font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
.copy { margin-top:8px; border:1px solid var(--line); border-radius:999px; padding:8px 12px; color:var(--ink); background:var(--card); font:inherit; cursor:pointer; }
ul { padding-left:1.2rem; }
@media (max-width:760px) { .session { grid-template-columns:1fr; } main { padding-top:18px; } }
</style>
</head>
<body><main>${body}</main><script>document.addEventListener('click',async(event)=>{const button=event.target.closest('[data-copy]');if(!button)return;const box=button.closest('.share-box');const text=box&&box.querySelector('textarea');if(!text)return;try{await navigator.clipboard.writeText(text.value);button.textContent='Copied';setTimeout(()=>button.textContent='Copy',1200);}catch{button.textContent='Copy failed';}});</script></body>
</html>`;
}

function eventLabel(type: LearningArchiveEvent['type']): string {
  return type.replace(/_/g, ' ');
}

function payloadText(payload: unknown): string {
  return JSON.stringify(payload, null, 2) ?? '';
}

function isShareDraft(value: unknown): value is ShareDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.x === 'string'
    && typeof draft.linkedin === 'string'
    && typeof draft.topic === 'string';
}

function renderShareDrafts(events: LearningArchiveEvent[]): string {
  const drafts = events.filter((event) => event.type === 'share_draft' && isShareDraft(event.payload));
  if (!drafts.length) return '';
  const newest = [...drafts].reverse().slice(0, 3);
  const cards = newest.map((event) => {
    const draft = event.payload as ShareDraft;
    const tags = draft.hashtags.join(' ');
    return `<div class="share-box"><div class="eyebrow">${escapeHtml(draft.source === 'guide' ? 'Guide share draft' : 'Follow-up share draft')}</div><h3>${escapeHtml(draft.topic)}</h3><p class="muted">Created ${escapeHtml(formatDate(event.createdAt))}</p><label>X draft<textarea class="share-text" readonly>${escapeHtml(`${draft.x}\n\n${tags}`)}</textarea></label><button class="copy" type="button" data-copy>Copy</button><label>LinkedIn draft<textarea class="share-text" readonly>${escapeHtml(`${draft.linkedin}\n\n${tags}`)}</textarea></label><button class="copy" type="button" data-copy>Copy</button></div>`;
  }).join('');
  return `<section class="card"><div class="eyebrow">Share what you learned</div><h2>Ready-to-edit drafts</h2><p class="muted">Short drafts are generated automatically from the guide and tutor follow-ups. Review before posting.</p><div class="share-grid">${cards}</div></section>`;
}

export function renderReviewIndexPage(sessions: LearningArchiveSessionSummary[]): string {
  const rows = sessions.map((session) => `<div class="session">
    <div><strong><a href="/review/${encodeURIComponent(session.id)}">${escapeHtml(session.repository)}</a></strong><p class="muted">${escapeHtml(session.title || 'Learning guide')}</p><span class="badge">${escapeHtml(shortSha(session.commitSha))}</span></div>
    <div><span class="muted">Created</span><br>${escapeHtml(formatDate(session.createdAt))}</div>
    <div><span class="badge">${escapeHtml(session.status)}</span>${session.publicDeletedAt ? ' <span class="badge">public deleted</span>' : ''}</div>
    <div><span class="muted">${escapeHtml(formatDate(session.lastEventAt))}</span></div>
  </div>`).join('') || '<p class="muted">No learning sessions have been archived yet.</p>';
  return shell('Learning archive', `<section class="header"><div class="eyebrow">Learning archive</div><h1>Saved assistant sessions</h1><p class="muted">Temporary pages and chats can expire, but this archive keeps learning guides, web research, direct answers, visual explainers, follow-up tutor answers, and share drafts for later review.</p></section><section class="card">${rows}</section>`);
}

export function renderReviewDetailPage(session: LearningArchiveSessionDetail): string {
  const guide = session.guide;
  const guideHtml = guide ? `<section class="card"><div class="eyebrow">Published guide</div><h2>${escapeHtml(guide.title)}</h2><p class="muted">${escapeHtml(guide.subtitle)}</p><h3>Overview</h3><p>${escapeHtml(guide.overview)}</p><h3>Sections</h3><ul>${guide.sections.map((section) => `<li><strong>${escapeHtml(section.title)}</strong><br><span class="muted">${escapeHtml(section.summary)}</span><br><code>${section.evidence.map(escapeHtml).join('</code>, <code>')}</code></li>`).join('')}</ul></section>` : '<section class="card"><p class="muted">No published guide was archived for this session.</p></section>';
  const shareHtml = renderShareDrafts(session.events);
  const events = session.events.map((event) => `<article class="event"><div class="event-header"><strong>${escapeHtml(eventLabel(event.type))}</strong><span class="muted">${escapeHtml(formatDate(event.createdAt))}</span></div><pre>${escapeHtml(payloadText(event.payload))}</pre></article>`).join('');
  return shell(`Review ${session.repository}`, `<section class="header"><div class="eyebrow"><a href="/review">Learning archive</a></div><h1>${escapeHtml(session.repository)}</h1><p><a href="${escapeHtml(session.repositoryUrl)}">${escapeHtml(session.repositoryUrl)}</a></p><div class="grid"><div><span class="muted">Commit</span><br><code>${escapeHtml(session.commitSha)}</code></div><div><span class="muted">Created</span><br>${escapeHtml(formatDate(session.createdAt))}</div><div><span class="muted">Status</span><br><span class="badge">${escapeHtml(session.status)}</span></div></div></section>${shareHtml}${guideHtml}<section class="card"><div class="eyebrow">Timeline</div><h2>Session events</h2>${events || '<p class="muted">No events recorded.</p>'}</section>`);
}
