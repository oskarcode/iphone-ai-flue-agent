import { describe, expect, it } from 'vitest';

import { visualExplainerFromAi } from '../src/lib/visual-explainer.ts';
import { renderVisualExplainerPage } from '../src/visual-page.ts';

const visualJson = {
  title: 'Durable Objects as a lock room',
  concept: 'Durable Objects',
  analogy: 'a keyed workshop cabinet',
  summary: 'One object owns one piece of state and serializes access to it.',
  caption: 'Tap each part to see which runtime responsibility it represents.',
  parts: [
    { id: 'request-slot', label: 'Request slot', meaning: 'Incoming requests enter here.', role: 'Accepts work.' },
    { id: 'lock-core', label: 'Lock core', meaning: 'The object ID selects one instance.', role: 'Routes to the right owner.' },
    { id: 'state-drawer', label: 'State drawer', meaning: 'Persistent storage lives here.', role: 'Stores durable data.' },
  ],
  flow: [
    { from: 'request-slot', to: 'lock-core', label: 'Request chooses an object ID.' },
    { from: 'lock-core', to: 'state-drawer', label: 'The instance reads and writes state.' },
  ],
  codeExample: 'class Counter {\n  async fetch() {\n    return new Response("ok");\n  }\n}',
};

describe('visual explainer generation and rendering', () => {
  it('parses a Workers AI visual JSON response', () => {
    const explainer = visualExplainerFromAi({ response: JSON.stringify(visualJson), finish_reason: 'stop' });

    expect(explainer.title).toBe('Durable Objects as a lock room');
    expect(explainer.parts).toHaveLength(3);
    expect(explainer.flow[0].label).toBe('Request chooses an object ID.');
  });

  it('rejects too few visual parts', () => {
    expect(() => visualExplainerFromAi({ response: JSON.stringify({ ...visualJson, parts: visualJson.parts.slice(0, 2) }), finish_reason: 'stop' })).toThrow('at least three parts');
  });

  it('escapes model-authored visual content in the fixed renderer', () => {
    const html = renderVisualExplainerPage({
      id: 'visual-1',
      concept: '<img src=x onerror=alert(1)>',
      createdAt: '2026-10-12T00:00:00.000Z',
      expiresAt: '2026-10-12T01:00:00.000Z',
    }, {
      ...visualJson,
      title: '<script>alert(1)</script>',
      parts: [{ ...visualJson.parts[0], label: '<b>Unsafe</b>' }, ...visualJson.parts.slice(1)],
    });

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;Unsafe&lt;/b&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<b>Unsafe</b>');
  });
});
