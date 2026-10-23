// Rendering consumes normalized data types; model output never supplies executable page markup.
import type { VisualExplainer, VisualExplainerPart, VisualSessionMetadata } from './lib/visual-session.ts';

/** Input: untrusted label/text. Output: HTML-safe text.
 * What this function does: escapes values before interpolation into renderer-owned markup.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Fixed geometry belongs to the app; model data selects labels and meaning, not arbitrary SVG.
const partSlots = [
  { x: 238, y: 332, w: 132, h: 74, tone: 'blue', shape: 'drawer' },
  { x: 410, y: 256, w: 142, h: 78, tone: 'white', shape: 'carriage' },
  { x: 610, y: 326, w: 146, h: 82, tone: 'green', shape: 'rack' },
  { x: 455, y: 430, w: 156, h: 78, tone: 'amber', shape: 'vise' },
  { x: 335, y: 462, w: 138, h: 70, tone: 'purple', shape: 'recorder' },
  { x: 635, y: 218, w: 116, h: 66, tone: 'red', shape: 'lock' },
  { x: 495, y: 176, w: 126, h: 70, tone: 'blue', shape: 'bay' },
  { x: 190, y: 428, w: 124, h: 66, tone: 'green', shape: 'panel' },
] as const;

/** Input: renderer-owned palette name. Output: CSS classes.
 * What this function does: keeps part shading connected to fixed palette rules.
 */
function toneClass(tone: string): string {
  return `part ${tone}`;
}

/** Input: fixed geometry slot. Output: three shaded polygons.
 * What this function does: builds the isometric solid in consistent painter order.
 */
function partPath(slot: typeof partSlots[number]): string {
  const x = slot.x;
  const y = slot.y;
  const w = slot.w;
  const h = slot.h;
  return [
    `<polygon class="top" points="${x},${y} ${x + w * 0.52},${y - h * 0.5} ${x + w},${y - h * 0.18} ${x + w * 0.45},${y + h * 0.34}"/>`,
    `<polygon class="left" points="${x},${y} ${x + w * 0.45},${y + h * 0.34} ${x + w * 0.45},${y + h * 0.72} ${x},${y + h * 0.38}"/>`,
    `<polygon class="right" points="${x + w * 0.45},${y + h * 0.34} ${x + w},${y - h * 0.18} ${x + w},${y + h * 0.2} ${x + w * 0.45},${y + h * 0.72}"/>`,
  ].join('');
}

/** Input: normalized part and index. Output: escaped interactive SVG group.
 * What this function does: combines fixed geometry with accessible labels and readout data.
 */
function renderPart(part: VisualExplainerPart, index: number): string {
  const slot = partSlots[index % partSlots.length];
  const cx = slot.x + slot.w * 0.5;
  const cy = slot.y + slot.h * 0.05;
  return `<g class="${toneClass(slot.tone)}" data-label="${escapeHtml(part.label)}" data-meaning="${escapeHtml(part.meaning)}" data-role="${escapeHtml(part.role)}" tabindex="0" role="button" aria-label="${escapeHtml(`${part.label}: ${part.meaning}`)}">
    ${partPath(slot)}
    <circle cx="${Math.round(cx - 20)}" cy="${Math.round(cy + 18)}" r="4" class="bolt"/><circle cx="${Math.round(cx + 20)}" cy="${Math.round(cy - 6)}" r="4" class="bolt"/>
    <text x="${Math.round(cx)}" y="${Math.round(cy + 7)}" text-anchor="middle" class="part-label">${escapeHtml(part.label)}</text>
  </g>`;
}

/** Input: normalized diagram. Output: ordered flow explanation or empty text.
 * What this function does: renders explanatory labels without trusting model HTML.
 */
function renderFlow(explainer: VisualExplainer): string {
  if (explainer.flow.length === 0) return '';
  return `<section class="flow-card"><h2>How work moves</h2><ol>${explainer.flow.map((item) => `<li><span>${escapeHtml(item.label)}</span></li>`).join('')}</ol></section>`;
}

/** Input: illustrative code text. Output: escaped code block.
 * What this function does: displays the mental model without executing it.
 */
function renderCode(code: string): string {
  return `<section class="code-card"><h2>TypeScript mental model</h2><pre><code>${escapeHtml(code)}</code></pre></section>`;
}

/** Input: retention metadata and normalized visual. Output: self-contained interactive HTML.
 * What this function does: assembles fixed SVG/CSS/script with escaped model data and accurate retention wording.
 */
export function renderVisualExplainerPage(metadata: VisualSessionMetadata, explainer: VisualExplainer): string {
  const parts = explainer.parts.map(renderPart).join('');
  const partList = explainer.parts.map((part) => `<button class="part-button" type="button" data-label="${escapeHtml(part.label)}" data-meaning="${escapeHtml(part.meaning)}" data-role="${escapeHtml(part.role)}"><strong>${escapeHtml(part.label)}</strong><span>${escapeHtml(part.role)}</span></button>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(explainer.title)}</title>
<style>
:root { color-scheme:light; --ink:#17201d; --muted:#64706a; --paper:#fffdf7; --canvas:#eee9dc; --line:#d8d3c5; --navy:#183153; --teal:#087f78; --mint:#dff3ec; --amber:#f4a340; --danger:#b42318; }
@media (prefers-color-scheme:dark) { :root { color-scheme:dark; --ink:#edf5f0; --muted:#a7b8af; --paper:#18211d; --canvas:#0f1513; --line:#35433d; --navy:#a9c8f3; --teal:#63ddd0; --mint:#173b35; --amber:#ffc268; --danger:#ff8d84; } }
* { box-sizing:border-box; }
body { margin:0; color:var(--ink); background:radial-gradient(circle at 78% 0,color-mix(in srgb,var(--teal) 12%,transparent),transparent 28rem),var(--canvas); font:16px/1.55 ui-rounded,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; -webkit-text-size-adjust:100%; }
.shell { width:min(1120px,100%); min-height:100dvh; margin:auto; background:var(--paper); box-shadow:0 22px 65px rgba(24,49,83,.1); }
header { padding:clamp(28px,6vw,64px) clamp(18px,6vw,66px) 22px; border-bottom:1px solid var(--line); }
.eyebrow { color:var(--teal); font:800 .75rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.12em; text-transform:uppercase; }
h1 { margin:.2em 0 .18em; max-width:900px; color:var(--navy); font-size:clamp(2.1rem,7vw,5rem); line-height:.98; letter-spacing:-.055em; }
.subtitle { max-width:760px; color:var(--muted); font-size:1.05rem; }
.chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
.chip { padding:5px 10px; border:1px solid var(--line); border-radius:999px; background:color-mix(in srgb,var(--mint) 65%,var(--paper)); font:700 .75rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
main { padding:24px clamp(12px,4vw,54px) 72px; }
.visual-card,.flow-card,.code-card { max-width:980px; margin:0 auto 22px; padding:clamp(16px,3vw,28px); border:1px solid var(--line); border-radius:24px; background:var(--paper); box-shadow:0 12px 34px color-mix(in srgb,var(--navy) 7%,transparent); }
.visual-header { display:grid; gap:8px; margin-bottom:16px; }
.visual-header h2,.flow-card h2,.code-card h2 { margin:0; color:var(--navy); font-size:clamp(1.35rem,4vw,2rem); letter-spacing:-.03em; }
.visual-wrap { overflow:hidden; border:1px solid var(--line); border-radius:20px; background:linear-gradient(180deg,color-mix(in srgb,var(--navy) 12%,var(--canvas)),var(--canvas)); }
svg { display:block; width:100%; height:auto; min-height:360px; }
.base-top { fill:#334765; stroke:#61708a; }.base-left { fill:#1d2a40; stroke:#556176; }.base-right { fill:#263650; stroke:#5f6d83; }
.part { cursor:pointer; outline:none; transition:opacity .18s ease, filter .18s ease, transform .18s ease; }.dim .part { opacity:.34; }.dim .part.hot { opacity:1; filter:drop-shadow(0 0 9px color-mix(in srgb,var(--teal) 70%,transparent)); }
.top { fill:#eef4ff; stroke:#76849a; }.left { fill:#cdd8e8; stroke:#6b778c; }.right { fill:#d9e4f2; stroke:#6b778c; }
.blue .top { fill:#bfdbfe; }.blue .left { fill:#7aa7d9; }.blue .right { fill:#94bff0; }
.green .top { fill:#bbf7d0; }.green .left { fill:#70bf8a; }.green .right { fill:#8bd9a4; }
.amber .top { fill:#fde68a; }.amber .left { fill:#d79831; }.amber .right { fill:#efb84b; }
.purple .top { fill:#ddd6fe; }.purple .left { fill:#9f8dd2; }.purple .right { fill:#b8a9ef; }
.red .top { fill:#fecdd3; }.red .left { fill:#d67683; }.red .right { fill:#f08d99; }
.bolt { fill:#111827; stroke:#f8fafc; stroke-width:1; }.part-label { fill:#0f172a; font:700 11px ui-rounded,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; pointer-events:none; }
.wire { fill:none; stroke:#087f78; stroke-width:3; stroke-linecap:round; stroke-dasharray:7 9; animation:dash 2s linear infinite; }.arrow { fill:#087f78; }
@keyframes dash { to { stroke-dashoffset:-32; } }
.readout { min-height:96px; margin:12px 0 0; padding:13px 14px; border:1px solid var(--line); border-radius:16px; background:color-mix(in srgb,var(--mint) 40%,var(--paper)); }
.readout strong { display:block; color:var(--navy); font-size:1.02rem; }.readout span { display:block; color:var(--muted); margin-top:4px; }
.parts-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px; margin-top:14px; }.part-button { display:grid; gap:2px; min-height:70px; padding:11px 12px; border:1px solid var(--line); border-radius:16px; color:var(--ink); background:var(--paper); text-align:left; cursor:pointer; }.part-button:hover { border-color:var(--teal); }.part-button strong { color:var(--navy); }.part-button span { color:var(--muted); font-size:.86rem; }
ol { padding-left:1.35em; } li { margin:.5em 0; } li span { color:var(--ink); }
pre { max-width:100%; overflow:auto; padding:16px; border:1px solid var(--line); border-radius:14px; background:var(--canvas); -webkit-overflow-scrolling:touch; } code { font:85% ui-monospace,SFMono-Regular,Menlo,monospace; }
@media (max-width:640px) { body { font-size:15px; } .shell { box-shadow:none; } header { padding:28px 18px 20px; } main { padding:16px 8px 60px; } .visual-card,.flow-card,.code-card { padding:16px; border-radius:20px; } svg { min-height:330px; } .part-label { font-size:9px; } pre { margin-inline:-6px; font-size:.78rem; } }
@media (prefers-reduced-motion:reduce) { .wire { animation:none; } .part { transition:none; } }
</style>
</head>
<body><div class="shell">
<header><div class="eyebrow">Visual tech explainer</div><h1>${escapeHtml(explainer.title)}</h1><p class="subtitle">${escapeHtml(explainer.summary)}</p><div class="chips"><span class="chip">${escapeHtml(explainer.concept)}</span><span class="chip">${escapeHtml(explainer.analogy)}</span><span class="chip">${metadata.expiresAt.startsWith('9999-') ? 'Saved until deleted' : `expires ${escapeHtml(new Date(metadata.expiresAt).toLocaleTimeString())}`}</span></div></header>
<main>
<section class="visual-card"><div class="visual-header"><div class="eyebrow">Interactive anatomy</div><h2>${escapeHtml(explainer.analogy)}</h2><p>${escapeHtml(explainer.caption)}</p></div><div class="visual-wrap"><svg id="visual" viewBox="0 0 1000 640" role="img" aria-label="${escapeHtml(explainer.title)}"><ellipse cx="510" cy="514" rx="330" ry="58" fill="#020617" opacity=".22"/><polygon class="base-top" points="210,360 545,170 805,320 470,512"/><polygon class="base-left" points="210,360 470,512 470,548 210,396"/><polygon class="base-right" points="470,512 805,320 805,356 470,548"/><path class="wire" d="M300 420 C390 345 478 304 560 270 S710 255 760 340"/><path class="wire" d="M714 392 C632 448 530 492 398 496 S247 477 235 438"/><polygon class="arrow" points="760,340 744,337 753,353"/>${parts}</svg></div><div class="readout" id="readout"><strong>Tap a part</strong><span>Each physical part maps to one responsibility in the concept.</span></div><div class="parts-grid">${partList}</div></section>
${renderFlow(explainer)}
${renderCode(explainer.codeExample)}
</main></div><script>
const visual=document.querySelector('#visual');
const readout=document.querySelector('#readout');
const items=[...document.querySelectorAll('.part,.part-button')];
function show(item){const label=item.dataset.label||'Part';const meaning=item.dataset.meaning||'';const role=item.dataset.role||'';visual.classList.add('dim');document.querySelectorAll('.part').forEach(part=>part.classList.toggle('hot',part.dataset.label===label));readout.innerHTML='<strong></strong><span></span><span></span>';readout.querySelector('strong').textContent=label;readout.querySelectorAll('span')[0].textContent=meaning;readout.querySelectorAll('span')[1].textContent=role;}
function reset(){visual.classList.remove('dim');document.querySelectorAll('.part').forEach(part=>part.classList.remove('hot'));readout.innerHTML='<strong>Tap a part</strong><span>Each physical part maps to one responsibility in the concept.</span>';}
items.forEach(item=>{item.addEventListener('click',()=>show(item));item.addEventListener('mouseenter',()=>show(item));item.addEventListener('focus',()=>show(item));});
visual.addEventListener('mouseleave',reset);
</script></body></html>`;
}
