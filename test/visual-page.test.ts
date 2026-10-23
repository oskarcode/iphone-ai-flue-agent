// Exercise only renderer output: no model call, network access or durable mutation is needed.
import { describe, expect, it } from 'vitest';
import { renderVisualExplainerPage } from '../src/visual-page.ts';
import type { VisualExplainer, VisualSessionMetadata } from '../src/lib/visual-session.ts';

const visual: VisualExplainer = {
  title: 'Transactions', concept: 'Atomicity', analogy: 'A workbench',
  summary: 'All changes commit together.', caption: 'Follow the parts.',
  parts: [{ id: 'input', label: '<script>unsafe</script>', meaning: 'Input', role: 'Receive' }],
  flow: [], codeExample: 'await transaction.commit();',
};
const metadata: VisualSessionMetadata = {
  id: 'visual-fixture', concept: 'Atomicity', createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '9999-12-31T23:59:59.999Z',
};

describe('visual retention labels', () => {
  /** Input: persistent visual metadata. Output: HTML assertions.
   * What this function does: prevents a fictional expiration time on new Pi artifacts and checks escaping.
   */
  it('labels durable visuals as saved until deleted', () => {
    const html = renderVisualExplainerPage(metadata, visual);
    expect(html).toContain('Saved until deleted');
    expect(html).not.toContain('class="chip">expires ');
    expect(html).not.toContain('<script>unsafe</script>');
  });
  /** Input: finite legacy expiration. Output: HTML assertions.
   * What this function does: keeps old expiring KV visuals distinct from durable artifacts.
   */
  it('retains the expiry label for legacy visuals', () => {
    const html = renderVisualExplainerPage({ ...metadata, expiresAt: '2026-01-01T01:00:00.000Z' }, visual);
    expect(html).toContain('class="chip">expires ');
    expect(html).not.toContain('Saved until deleted');
  });
});
