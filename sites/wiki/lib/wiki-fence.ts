import { wikiBraceEnd, wikiInlineTokens, wikiLiteralEnd } from './wiki-inline-style';
import { tableDirectiveRanges } from './wiki-table-tokens';

export type WikiFence = { kind: 'code' | 'folding'; end: number; body: string; title: string; closed: boolean; closeColumn: number };

/** A summary uses inline boundaries too: a literal }}} in its code/link/note
 * cannot turn a multiline fold into a one-line raw token. */
function foldingOpener(line: string): boolean {
  if (!/^\{\{\{#!folding(?:\s|$)/.test(line)) return false;
  const title = line.slice(13);
  let from = 0;
  for (const { token, index } of wikiInlineTokens(title)) {
    if (title.slice(from, index).includes('}}}')) return false;
    from = index + token.length;
  }
  return !title.slice(from).includes('}}}');
}

/** end is exclusive; unclosed fences consume the remaining source. */
export function wikiFenceAt(lines: string[], index: number, column = 0): WikiFence | null {
  const line = lines[index].slice(column).trimStart();
  const markdown = line.match(/^(`{3,}|~{3,})(.*)$/);
  if (markdown) {
    let end = index + 1;
    const close = new RegExp(`^\\s*${markdown[1][0]}{${markdown[1].length},}\\s*$`);
    while (end < lines.length && !close.test(lines[end])) end++;
    return { kind: 'code', end: Math.min(end + 1, lines.length), body: lines.slice(index + 1, end).join('\n'), title: '', closed: end < lines.length, closeColumn: lines[end]?.length ?? 0 };
  }
  const folding = foldingOpener(line);
  if (!line.startsWith('{{{') || (!folding && wikiBraceEnd(line, 0) !== null)) return null;
  const contexts: ('code' | 'folding')[] = [folding ? 'folding' : 'code'];
  let end = index + 1, closeColumn = 0;
  for (; end < lines.length; end++) {
    // A Markdown code fence inside folding can contain arbitrary triple braces.
    if (contexts[contexts.length - 1] === 'folding' && /^\s*(`{3,}|~{3,})/.test(lines[end])) {
      const nested = wikiFenceAt(lines, end)!;
      end = nested.end - 1;
      continue;
    }
    let directives = contexts.at(-1) === 'folding' ? tableDirectiveRanges(lines[end]) : [];
    let cursor = 0, directiveIndex = 0;
    while (cursor < lines[end].length) {
      const inFold = contexts[contexts.length - 1] === 'folding';
      const delimiters = inFold ? /\\.|`+|\[\*|\[\[|\[anchor\(|\{\{\{|\}\}\}/gi : /\{\{\{|\}\}\}/g;
      delimiters.lastIndex = cursor;
      const token = delimiters.exec(lines[end]);
      if (!token) break;
      cursor = delimiters.lastIndex;
      if (inFold && token[0] !== '{{{' && token[0] !== '}}}') {
        const start = token.index + (token[0].startsWith('\\') ? 1 : 0);
        if (/^(?:\{\{\{|\[\[|\[\*|`|\[anchor\()/i.test(lines[end].slice(start, start + 8))) cursor = wikiLiteralEnd(lines[end], start);
        continue;
      }
      while (directives[directiveIndex]?.end <= token.index) directiveIndex++;
      const directive = directives[directiveIndex];
      if (inFold && directive && directive.start <= token.index && token.index < directive.end) {
        // An unclosed block in a rejected role remains opaque, but its close
        // still belongs to that rejected block, not the enclosing fold.
        if (token[0] === '{{{') {
          if (foldingOpener(lines[end].slice(token.index))) {
            contexts.push('folding');
            cursor = lines[end].length;
            continue;
          }
          const inlineEnd = wikiBraceEnd(lines[end], token.index);
          if (inlineEnd !== null) cursor = inlineEnd;
          else if (/^\{\{\{(?:#!|[ \t]*$)/.test(lines[end].slice(token.index))) contexts.push('code');
          else cursor = directive.end;
        }
        continue;
      }
      if (token[0] === '{{{') {
        // A complete inline token owns its code/escape/nested-style boundaries.
        // Do not count brace-looking text inside it as folding delimiters.
        const nestedFolding = inFold && foldingOpener(lines[end].slice(token.index));
        if (nestedFolding) {
          contexts.push('folding');
          cursor = lines[end].length;
          continue;
        }
        const inlineEnd = inFold ? wikiBraceEnd(lines[end], token.index) : null;
        if (inlineEnd !== null) { cursor = inlineEnd; continue; }
        contexts.push('code');
      } else {
        contexts.pop();
        // Closing a multiline nested cell can reveal sibling directive prefixes
        // on this same physical line, including after an opaque raw-code cell.
        if (contexts.at(-1) === 'folding') {
          directives = tableDirectiveRanges(lines[end], cursor);
          directiveIndex = 0;
        }
      }
      if (!contexts.length) { closeColumn = cursor; break; }
    }
    if (!contexts.length) break;
  }
  const initial = line.slice(3);
  const body = lines.slice(index + 1, end);
  if (!folding && initial && !/^#!syntax(?:\s|$)/.test(initial)) body.unshift(initial);
  return { kind: folding ? 'folding' : 'code', end: Math.min(end + 1, lines.length), body: body.join('\n'), title: folding ? line.slice(13).trim() : '', closed: !contexts.length, closeColumn };
}
