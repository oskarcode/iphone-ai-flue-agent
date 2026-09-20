import { describe, expect, it } from 'vitest';
import { validatePublicUrl } from '../src/tools/read-url.ts';
import { parseDuckDuckGoResults } from '../src/tools/web-search.ts';

describe('retrieval tools', () => {
  it('accepts a public HTTPS URL', () => {
    expect(validatePublicUrl('https://developers.cloudflare.com/workers/').hostname).toBe('developers.cloudflare.com');
  });

  it.each(['http://localhost/test', 'http://127.0.0.1/test', 'http://10.1.2.3/test', 'ftp://example.com/file'])('rejects unsafe URL %s', (url) => {
    expect(() => validatePublicUrl(url)).toThrow();
  });

  it('parses DuckDuckGo result HTML', () => {
    const html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com">Example</a><a class="result__snippet">Useful result</a>';
    expect(parseDuckDuckGoResults(html)).toEqual([{ title: 'Example', url: 'https://example.com', snippet: 'Useful result' }]);
  });
});
