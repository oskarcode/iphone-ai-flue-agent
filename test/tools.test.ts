// Vitest assertions exercise retrieval input safety and provider response parsing without network calls.
import { describe, expect, it, vi } from 'vitest';
import {
  boundMarkdown,
  parseDuckDuckGoResults,
  readPageWithBrowser,
  selectArticleCandidate,
  validatePublicUrl,
} from '../src/tools/web-research.ts';

describe('retrieval tools', () => {
  it('accepts a public HTTPS URL', () => {
    expect(validatePublicUrl('https://developers.cloudflare.com/workers/').hostname).toBe('developers.cloudflare.com');
  });

  it.each([
    'http://localhost/test',
    'http://127.0.0.1/test',
    'http://10.1.2.3/test',
    'http://[::1]/test',
    'http://[fc00::1]/test',
    'http://[fe80::1]/test',
    'http://[::ffff:7f00:1]/test',
    'http://[64:ff9b::7f00:1]/test',
    'ftp://example.com/file',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => validatePublicUrl(url)).toThrow();
  });

  it('accepts a public IPv6 URL', () => {
    expect(validatePublicUrl('https://[2606:4700:4700::1111]/').hostname).toBe('[2606:4700:4700::1111]');
  });

  it('parses DuckDuckGo result HTML', () => {
    const html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com">Example</a><a class="result__snippet">Useful result</a>';
    expect(parseDuckDuckGoResults(html)).toEqual([{ title: 'Example', url: 'https://example.com', snippet: 'Useful result' }]);
  });

  it('prefers focused article content over a longer main container', () => {
    const articleText = 'Article paragraph. '.repeat(50);
    const mainText = `Navigation ${'link '.repeat(400)}${articleText}`;
    expect(selectArticleCandidate([
      { selector: 'main', results: [{ html: `<main>${mainText}</main>`, text: mainText }] },
      { selector: 'article', results: [{ html: `<article>${articleText}</article>`, text: articleText }] },
    ])).toMatchObject({ selector: 'article', text: articleText });
  });

  it('uses a main container when no focused article container exists', () => {
    const text = 'Documentation content. '.repeat(30);
    expect(selectArticleCandidate([
      { selector: 'main', results: [{ html: `<main>${text}</main>`, text }] },
    ])).toMatchObject({ selector: 'main', text });
  });

  it('prefers a complete main body over multiple article cards', () => {
    const card = 'Article card content. '.repeat(30);
    const main = `Complete page body. ${card}${card}${'More content. '.repeat(100)}`;
    expect(selectArticleCandidate([
      { selector: 'article', results: [
        { html: `<article>${card}</article>`, text: card },
        { html: `<article>${card}</article>`, text: card },
      ] },
      { selector: 'main', results: [{ html: `<main>${main}</main>`, text: main }] },
    ])).toMatchObject({ selector: 'main', text: main });
  });

  it('preserves the beginning and conclusion when bounding long Markdown', () => {
    const result = boundMarkdown(`START-${'x'.repeat(2_000)}-END`, 1_000);
    expect(result.truncated).toBe(true);
    expect(result.markdown).toContain('START-');
    expect(result.markdown).toContain('middle content omitted');
    expect(result.markdown).toContain('-END');
    expect(result.returnedCharacters).toBeLessThanOrEqual(1_000);
  });

  it('returns short Markdown unchanged', () => {
    expect(boundMarkdown('Complete article', 100)).toEqual({
      markdown: 'Complete article',
      sourceCharacters: 16,
      returnedCharacters: 16,
      truncated: false,
    });
  });

  it('extracts focused article HTML and supplies relative-link context', async () => {
    const articleText = 'Useful article content. '.repeat(30);
    const quickAction = vi.fn()
      .mockResolvedValueOnce(Response.json({
        success: true,
        result: [{ selector: 'article', results: [{ html: `<article><a href="/docs">${articleText}</a></article>`, text: articleText }] }],
        meta: { title: 'Useful article', finalUrl: 'https://example.com/post' },
      }))
      .mockResolvedValueOnce(Response.json({ success: true, result: `[Useful article](/docs)\n\n${articleText}` }));
    const page = await readPageWithBrowser(
      'https://example.com/post?campaign=test',
      { quickAction } as unknown as CloudflareBindings['BROWSER'],
    );

    expect(page).toMatchObject({
      url: 'https://example.com/post',
      title: 'Useful article',
      extraction: 'article',
      selector: 'article',
      truncated: false,
    });
    expect(quickAction).toHaveBeenNthCalledWith(2, 'markdown', expect.objectContaining({
      html: expect.stringContaining('<base href="https://example.com/post">'),
      setJavaScriptEnabled: false,
    }));
  });

  it('keeps complete scraped text when Markdown conversion is implausibly short', async () => {
    const articleText = 'Complete article content. '.repeat(40);
    const quickAction = vi.fn()
      .mockResolvedValueOnce(Response.json({
        success: true,
        result: [{ selector: 'article', results: [{ html: `<article>${articleText}</article>`, text: articleText }] }],
        meta: { finalUrl: 'https://example.com/post' },
      }))
      .mockResolvedValueOnce(Response.json({ success: true, result: 'Partial' }));
    const page = await readPageWithBrowser(
      'https://example.com/post',
      { quickAction } as unknown as CloudflareBindings['BROWSER'],
    );

    expect(page.markdown).toBe(articleText.trim());
  });

  it('falls back to whole-page Markdown when focused scraping fails', async () => {
    const quickAction = vi.fn()
      .mockRejectedValueOnce(new Error('scrape unavailable'))
      .mockResolvedValueOnce(Response.json({
        success: true,
        result: '# Fallback page',
        meta: { finalUrl: 'https://example.com/final' },
      }));
    const page = await readPageWithBrowser(
      'https://example.com/start',
      { quickAction } as unknown as CloudflareBindings['BROWSER'],
    );

    expect(page).toMatchObject({
      url: 'https://example.com/final',
      extraction: 'full_page',
      markdown: '# Fallback page',
      truncated: false,
    });
  });

  it('enforces positive Markdown limits', () => {
    expect(() => boundMarkdown('Long content', 0)).toThrow('positive integer');
  });
});
