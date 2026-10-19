// Vitest exercises retrieval safety and Cloudflare retrieval adapters without network calls.
import { describe, expect, it, vi } from 'vitest';
import {
  boundMarkdown,
  readPageWithAi,
  searchPublicWeb,
  validatePublicUrl,
} from '../src/tools/web-research.ts';

function mockAi(overrides: Record<string, unknown> = {}) {
  return {
    websearch: vi.fn(),
    toMarkdown: vi.fn(),
    ...overrides,
  } as unknown as Ai & { websearch(request: Record<string, unknown>): Promise<Response> };
}

describe('retrieval tools', () => {
  it('accepts public HTTPS and IPv6 URLs', () => {
    expect(validatePublicUrl('https://developers.cloudflare.com/workers/').hostname).toBe('developers.cloudflare.com');
    expect(validatePublicUrl('https://[2606:4700:4700::1111]/').hostname).toBe('[2606:4700:4700::1111]');
  });

  it.each([
    'http://localhost/test',
    'http://service.internal/test',
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

  it('preserves the beginning and conclusion when bounding long Markdown', () => {
    const result = boundMarkdown(`START-${'x'.repeat(2_000)}-END`, 1_000);
    expect(result.truncated).toBe(true);
    expect(result.markdown).toContain('START-');
    expect(result.markdown).toContain('middle content omitted');
    expect(result.markdown).toContain('-END');
    expect(result.omittedRegion).toBe('middle');
    expect(result.returnedCharacters).toBeLessThanOrEqual(1_000);
  });

  it('returns short Markdown unchanged and rejects invalid limits', () => {
    expect(boundMarkdown('Complete article', 100)).toEqual({
      markdown: 'Complete article',
      sourceCharacters: 16,
      returnedCharacters: 16,
      truncated: false,
      omittedRegion: 'none',
    });
    expect(() => boundMarkdown('Long content', 0)).toThrow('positive integer');
  });

  it('uses Cloudflare Web Search with Exa and the configured AI Gateway', async () => {
    vi.stubEnv('AI_GATEWAY_ID', 'iphone-flue-shortcut');
    const websearch = vi.fn().mockResolvedValue(Response.json({
      items: [
        { title: 'Cloudflare docs', url: 'https://developers.cloudflare.com/workers-ai/features/web-search/', description: 'Official documentation.' },
        { title: 'Unsafe', url: 'http://127.0.0.1/private', description: 'Discard me.' },
      ],
      metadata: { requestId: 'request-1', latencyMs: 42 },
    }));
    const search = await searchPublicWeb('Cloudflare Web Search', mockAi({ websearch }), new AbortController().signal);

    expect(websearch).toHaveBeenCalledWith({
      gatewayId: 'iphone-flue-shortcut',
      provider: 'exa',
      query: 'Cloudflare Web Search',
      limit: 8,
    });
    expect(search).toEqual({
      provider: 'cloudflare-web-search-exa',
      results: [{
        title: 'Cloudflare docs',
        url: 'https://developers.cloudflare.com/workers-ai/features/web-search/',
        snippet: 'Official documentation.',
      }],
      metadata: { requestId: 'request-1', latencyMs: 42 },
    });
    vi.unstubAllEnvs();
  });

  it('converts HTML through Workers AI and applies the requested evidence limit', async () => {
    const text = `START ${'detail '.repeat(500)} END`;
    const toMarkdown = vi.fn().mockResolvedValue({
      id: 'document-1',
      name: 'post',
      mimeType: 'text/html',
      format: 'markdown',
      tokens: 500,
      data: text,
    });
    const fetcher = vi.fn().mockResolvedValue(new Response('<html>article</html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })) as unknown as typeof fetch;
    const page = await readPageWithAi(
      'https://example.com/post',
      mockAi({ toMarkdown }),
      1_000,
      new AbortController().signal,
      fetcher,
    );

    expect(toMarkdown).toHaveBeenCalledWith(expect.objectContaining({ name: 'post', blob: expect.any(Blob) }));
    expect(page).toMatchObject({
      url: 'https://example.com/post',
      extraction: 'full_page',
      rendering: 'workers_ai_converted',
      truncated: true,
      omittedRegion: 'middle',
    });
    expect(page.markdown).toContain('middle content omitted');
  });

  it('prefers Markdown negotiated directly from the origin', async () => {
    const toMarkdown = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(new Response('# Direct Markdown', {
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
    })) as unknown as typeof fetch;
    const page = await readPageWithAi(
      'https://example.com/article',
      mockAi({ toMarkdown }),
      2_000,
      new AbortController().signal,
      fetcher,
    );

    expect(page).toMatchObject({ markdown: '# Direct Markdown', rendering: 'markdown_negotiated', truncated: false });
    expect(toMarkdown).not.toHaveBeenCalled();
  });

  it('validates every redirect before following it', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private' },
    })) as unknown as typeof fetch;

    await expect(readPageWithAi(
      'https://example.com/start',
      mockAi(),
      2_000,
      new AbortController().signal,
      fetcher,
    )).rejects.toThrow('Private network URLs');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
