// Vitest assertions exercise retrieval input safety and provider response parsing without network calls.
import { describe, expect, it } from 'vitest';
import { parseDuckDuckGoResults, validatePublicUrl } from '../src/tools/web-research.ts';

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
});
