import { defineTool } from '@flue/runtime';
import * as v from 'valibot';

const MAX_RESPONSE_BYTES = 750_000;

type SearchResult = { title: string; url: string; snippet: string };

function decodeHtml(value: string): string {
  const entities: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => entities[name.toLowerCase()] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error('Search response exceeded the size limit.');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Search response exceeded the size limit.');
    }
    text += decoder.decode(value, { stream: true });
  }
}

export function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const pattern = /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    try {
      const redirect = new URL(decodeHtml(match[1]).replace(/^\/\//, 'https://'));
      const url = redirect.hostname.endsWith('duckduckgo.com') ? redirect.searchParams.get('uddg') : redirect.href;
      if (!url || !/^https?:\/\//.test(url)) continue;
      results.push({ title: decodeHtml(match[2]), url, snippet: decodeHtml(match[3]) });
    } catch {
      continue;
    }
    if (results.length === 5) break;
  }
  return results;
}

async function searchDuckDuckGo(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'Cloudflare-iPhone-Assistant/1.0' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (!response.ok) throw new Error(`DuckDuckGo returned HTTP ${response.status}.`);
  return parseDuckDuckGoResults(await readBoundedText(response));
}

async function searchWikipedia(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: query, gsrlimit: '5',
    prop: 'info|extracts', inprop: 'url', exintro: '1', explaintext: '1', format: 'json', origin: '*',
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
  if (!response.ok) throw new Error(`Wikipedia returned HTTP ${response.status}.`);
  const payload = await response.json<{ query?: { pages?: Record<string, { title?: string; fullurl?: string; extract?: string }> } }>();
  return Object.values(payload.query?.pages ?? {})
    .filter((page) => page.title && page.fullurl)
    .slice(0, 5)
    .map((page) => ({ title: page.title!, url: page.fullurl!, snippet: page.extract ?? '' }));
}

export const webSearch = defineTool({
  name: 'web_search',
  description: 'Search the current public web. Use for recent, live, current, or externally verified information.',
  input: v.object({ query: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(500)) }),
  async run({ data, signal, log }) {
    log.info(`Searching public web for: ${data.query}`);
    const requestSignal = signal ?? new AbortController().signal;
    let provider = 'duckduckgo';
    let results: SearchResult[] = [];
    try {
      results = await searchDuckDuckGo(data.query, requestSignal);
    } catch {
      provider = 'wikipedia';
      results = await searchWikipedia(data.query, requestSignal);
    }
    return { output: { query: data.query, provider, results } };
  },
});
