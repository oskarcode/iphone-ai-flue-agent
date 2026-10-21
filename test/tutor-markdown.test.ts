import { describe, expect, it } from 'vitest';
import { renderTutorMarkdown } from '../src/lib/tutor-markdown.ts';

describe('tutor answer formatting', () => {
  it('renders language-labelled code verbatim with a copy control', () => {
    const html = renderTutorMarkdown('```typescript\nconst node = "<button>";\n// **not bold**\n```');
    expect(html).toContain('<span>typescript</span>');
    expect(html).toContain('data-copy-code');
    expect(html).toContain('const node = &quot;&lt;button&gt;&quot;;');
    expect(html).toContain('// **not bold**');
    expect(html).not.toContain('<strong>');
  });

  it('renders scrollable semantic tables, inline code, and escaped pipes', () => {
    const html = renderTutorMarkdown('| File | Purpose |\n| --- | :---: |\n| `src/app.ts` | **Routes** |\n| a \\| b | Choice |');
    expect(html).toContain('class="table-scroll"');
    expect(html).toContain('<th scope="col">File</th>');
    expect(html).toContain('<td><code>src/app.ts</code></td>');
    expect(html).toContain('<td><strong>Routes</strong></td>');
    expect(html).toContain('<td>a | b</td>');
  });

  it('formats learning steps, headings, tips, and emphasis', () => {
    const html = renderTutorMarkdown('## Request flow\n1. Receive input\n2. Validate\n\n> Watch for errors\n\n- **Try it** with *one* request\n\nUse `**literal**` here.');
    expect(html).toContain('<h3>Request flow</h3>');
    expect(html).toContain('<ol><li>Receive input</li><li>Validate</li></ol>');
    expect(html).toContain('<blockquote>Watch for errors</blockquote>');
    expect(html).toContain('<ul><li><strong>Try it</strong> with <em>one</em> request</li></ul>');
    expect(html).toContain('<code>**literal**</code>');
  });

  it('never emits model HTML, executable links, or remote images', () => {
    const html = renderTutorMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[click](javascript:alert(1))\n![secret](https://example.com/track)\n```<svg/onload=alert(1)>\n</code><img src=x>\n```');
    expect(html).not.toMatch(/<(script|img|svg|a)\b/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;/code&gt;&lt;img src=x&gt;');
  });

  it('handles incomplete fences and plain text without breaking markup', () => {
    expect(renderTutorMarkdown('```bash\nnpm test')).toContain('<pre><code>npm test</code></pre>');
    expect(renderTutorMarkdown('a | b\nnot a table')).not.toContain('<table>');
    expect(renderTutorMarkdown('')).toBe('');
  });

  it('runs independently when embedded in the generated browser script', () => {
    const browserRender = new Function('text', `return (${renderTutorMarkdown.toString()})(text);`);
    const input = '## Learn\n```js\nlet x = 1;\n```\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(browserRender(input)).toBe(renderTutorMarkdown(input));
  });
});
