import { describe, expect, it, vi } from 'vitest';
import { createWebRender } from '../src/tools/web-render.ts';

const run = (browser: Pick<BrowserRun, 'quickAction'>, url: string) =>
  createWebRender(browser).run({ data: { url }, log: { info: () => {} } });
const browser = (response: Response) => {
  const quickAction = vi.fn(async () => response);
  return { quickAction: quickAction as unknown as BrowserRun['quickAction'] };
};

describe('web_render', () => {
  it('renders public JavaScript pages as bounded untrusted evidence through Kitesurf', async () => {
    const binding = browser(Response.json({
      success: true, result: '# Dynamic dashboard\nLoaded by JavaScript',
      meta: { title: 'Dashboard', finalUrl: 'https://example.com/dashboard', status: 200 },
    }));
    const result = await run(binding, 'https://example.com/app');
    expect(binding.quickAction).toHaveBeenCalledWith('markdown', expect.objectContaining({
      url: 'https://example.com/app', browser: 'kitesurf', cacheTTL: 0,
    }));
    expect(result.output).toMatchObject({ finalUrl: 'https://example.com/dashboard', engine: 'kitesurf', truncated: false });
    expect(result.output.markdown).toContain('Loaded by JavaScript');
    expect(result.output.notice).toContain('Untrusted');
  });

  it('truncates oversized page text and limits service response bytes', async () => {
    const long = await run(browser(Response.json({ success: true, result: 'x'.repeat(21_000) })), 'https://example.com');
    expect(long.output.truncated).toBe(true);
    expect(long.output.returnedCharacters).toBeLessThanOrEqual(20_000);
    await expect(run(browser(Response.json({ success: true, result: 'x'.repeat(2_100_000) })), 'https://example.com'))
      .rejects.toThrow('size limit');
  });

  it.each(['http://localhost/admin', 'http://127.0.0.1/admin', 'http://10.0.0.1/admin',
    'https://user:pass@example.com', 'file:///etc/passwd', 'https://example.local/admin'])
  ('rejects unsafe initial URLs before calling Browser Run: %s', async (url) => {
    const binding = browser(Response.json({ success: true, result: 'ok' }));
    await expect(run(binding, url)).rejects.toThrow();
    expect(binding.quickAction).not.toHaveBeenCalled();
  });

  it('rejects private redirects, HTTPS downgrades and failure payloads without leaking service errors', async () => {
    await expect(run(browser(Response.json({ success: true, result: 'secret', meta: { finalUrl: 'http://127.0.0.1/private' } })), 'https://example.com'))
      .rejects.toThrow(/Private network|private or local/i);
    await expect(run(browser(Response.json({ success: true, result: 'text', meta: { finalUrl: 'http://example.com' } })), 'https://example.com'))
      .rejects.toThrow('HTTPS pages cannot redirect');
    await expect(run(browser(Response.json({ success: false, errors: [{ message: 'secret provider details' }] })), 'https://example.com'))
      .rejects.toThrow('could not read');
  });
});
