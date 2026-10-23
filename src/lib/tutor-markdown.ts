/** Small, HTML-disabled Markdown renderer. Self-contained for use in the browser script.
 * Model text is escaped; only renderer-owned tags are emitted. No images or links
 * are loaded, so private repository answers cannot trigger external requests.
 */
/** Input: untrusted message text. Output: escaped renderer-owned HTML.
 * What this function does: recognizes code, tables, lists and emphasis without executing HTML or loading remote images.
 */
export function renderTutorMarkdown(text: string): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Escape ordinary text before adding supported inline tags; code spans take precedence.
  const inline = (value: string): string => value.split(/(`[^`]+`)/g).map(
    /** Input: one inline-code or prose segment. Output: escaped, application-owned markup.
     * What this function does: preserves code literally and applies emphasis only to escaped prose.
     */
    (part) => {
    if (part.startsWith('`') && part.endsWith('`')) return '<code>' + escape(part.slice(1, -1)) + '</code>';
    return escape(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }).join('');
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const code: string[] = [];
      const marker = fence[1][0];
      const length = fence[1].length;
      const language = fence[2].trim().split(/\s/)[0] || 'code';
      i++;
      while (i < lines.length && !(lines[i].trim().length >= length && [...lines[i].trim()].every((char) => char === marker))) code.push(lines[i++]);
      if (i < lines.length) i++;
      output.push('<div class="code-block"><div class="code-toolbar"><span>' + escape(language) + '</span><button type="button" data-copy-code aria-label="Copy code">Copy</button></div><pre><code>' + escape(code.join('\n')) + '</code></pre></div>');
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && cells(lines[i + 1]).every((cell) => /^:?-{3,}:?$/.test(cell)) && cells(line).length === cells(lines[i + 1]).length) {
      const headers = cells(line);
      output.push('<div class="table-scroll" role="region" aria-label="Answer table" tabindex="0"><table><thead><tr>' + headers.map((cell) => '<th scope="col">' + inline(cell) + '</th>').join('') + '</tr></thead><tbody>');
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const row = cells(lines[i++]);
        output.push('<tr>' + headers.map((_, index) => '<td>' + inline(row[index] || '') + '</td>').join('') + '</tr>');
      }
      output.push('</tbody></table></div>');
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) { output.push('<h3>' + inline(heading[1]) + '</h3>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(inline(lines[i++].replace(/^\s*>\s?/, '')));
      output.push('<blockquote>' + quote.join('<br>') + '</blockquote>');
      continue;
    }
    const listItem = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);
    if (listItem) {
      const ordered = Boolean(listItem[2]);
      const tag = ordered ? 'ol' : 'ul';
      output.push('<' + tag + '>');
      while (i < lines.length) {
        const item = lines[i].match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        output.push('<li>' + inline(item[3]) + '</li>');
        i++;
      }
      output.push('</' + tag + '>');
      continue;
    }
    output.push('<p>' + inline(line) + '</p>');
    i++;
  }
  return output.join('');
}
