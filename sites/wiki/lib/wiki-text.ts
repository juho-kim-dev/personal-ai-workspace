/** Pure source analysis shared by the renderer, editor and relationship index. */
import { WIKI_INLINE_DEPTH, wikiAnchorName, wikiEmphasisBody, wikiInlineStyle, wikiInlineTokens, wikiNoteBody } from './wiki-inline-style';
import { parseWikiReference, wikiTargetKind, type WikiReference } from './wiki-reference';
import { normalizeWikiTitle, validWikiTitle } from './wiki-title';
import { scanWikiSource, WIKI_STRUCTURE_DEPTH, type WikiSource } from './wiki-source';
export type WikiHeading = {
  index: number;
  level: number;
  text: string;
  number: string;
  id: string;
  end?: number;
};

export { wikiFenceAt, type WikiFence } from './wiki-fence';

/** One standalone macro, exact template prefix, comma-separated key=value fields.
 * Only the title supports \,; parameters retain the existing restricted grammar. */
export function parseWikiInclude(line: string): { title: string; parameters: Record<string, string>; valid: boolean } | null {
  const match = line.match(/^\s*\[include\((.*)\)\]\s*$/i);
  if (!match) return null;
  let separator = match[1].length;
  for (let at = 0; at < match[1].length; at++) {
    if (match[1][at] === '\\' && match[1][at + 1] === ',') { at++; continue; }
    if (match[1][at] === ',') { separator = at; break; }
  }
  const title = normalizeWikiTitle(match[1].slice(0, separator).replace(/\\,/g, ','));
  const fields = separator === match[1].length ? [] : match[1].slice(separator + 1).split(',');
  const parameters: Record<string, string> = Object.create(null);
  let valid = /^틀:[^\[\]()#@\\]+$/.test(title) && !!title.slice(2).trim() && validWikiTitle(title);
  for (const field of fields) {
    const parameter = field.trim().match(/^([A-Za-z0-9_가-힣-]+)=(.*)$/);
    if (!parameter || /[\[\](),\\]/.test(parameter[2])) { valid = false; continue; }
    if (Object.hasOwn(parameters, parameter[1])) valid = false;
    parameters[parameter[1]] = parameter[2];
  }
  return { title, parameters, valid };
}

/** Only actual standalone includes, excluding raw/fenced/escaped examples. */
export function wikiIncludes(content: string): string[] {
  const titles: string[] = [];
  function scan(source: string, depth: number) {
    const { lines, blocks } = scanWikiSource(source, depth);
    for (let i = 0; i < lines.length;) {
      const block = blocks.get(i);
      if (block) {
        if (block.kind === 'fence') {
          const fence = block.fence;
          if (fence.kind === 'folding' && depth < WIKI_STRUCTURE_DEPTH) scan(fence.body, depth + 1);
        } else if (block.table) {
          for (const row of block.table.rows) for (const cell of row) if (cell.block) scan(cell.text, depth + 1);
        }
        i = block.end;
      } else {
        const include = parseWikiInclude(lines[i++]);
        if (include?.valid) titles.push(include.title);
      }
    }
  }
  scan(content, 0);
  return [...new Set(titles)];
}

export function parseWikiHeadings(content: string, source: WikiSource = scanWikiSource(content)): WikiHeading[] {
  const lines = source.lines;
  const result: WikiHeading[] = [], stack: number[] = [], counters: number[] = [];
  let skipUntil = 0;
  lines.forEach((line, index) => {
    const block = source.blocks.get(index);
    if (block) skipUntil = block.end;
    if (index < skipUntil) return;
    const match = line.match(/^(={1,6})\s+(.+?)\s+\1\s*$/) || line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) return;
    const raw = match[1].length;
    while (stack.length && stack[stack.length - 1] > raw) stack.pop();
    if (!stack.length || stack[stack.length - 1] < raw) stack.push(raw);
    const level = stack.length;
    counters.length = level;
    counters[level - 1] = (counters[level - 1] || 0) + 1;
    const number = counters.join('.');
    result.push({ index, level, text: match[2], number, id: `s-${number}` });
  });
  const pending: WikiHeading[] = [];
  for (const heading of result) {
    while (pending.length && pending[pending.length - 1].level >= heading.level) pending.pop()!.end = heading.index;
    pending.push(heading);
  }
  for (const heading of pending) heading.end = lines.length;
  return result;
}

/** Plain heading/note labels use the same opaque boundaries and depth budget as
 * rendering. Never run replacements over the contents of a rejected style. */
export function wikiLabelText(value: string, depth = 0, links = true): string {
  if (depth >= WIKI_INLINE_DEPTH) return value;
  let result = '', last = 0;
  for (const { token, index } of wikiInlineTokens(value)) {
    result += value.slice(last, index);
    last = index + token.length;
    if (token.startsWith('\\')) result += token.slice(1);
    else if (token.startsWith('{{{')) {
      const styled = wikiInlineStyle(token);
      result += styled ? wikiLabelText(styled.body, depth + 1, links)
        : /^\{\{\{[#+-][^\s]*[ \t]/.test(token) || !token.endsWith('}}}') ? token : token.slice(3, -3);
    } else if (token.startsWith('`')) {
      const delimiter = token.match(/^`+/)![0];
      result += token.length >= delimiter.length * 2 && token.endsWith(delimiter)
        ? token.slice(delimiter.length, -delimiter.length) : token;
    } else if (token.startsWith('[[')) {
      const reference = parseWikiReference(token);
      if (!reference) { result += token; continue; }
      const { target, label, kind } = reference;
      if (kind === 'category') continue;
      if (kind === 'file') result += target;
      else if (!links) result += label ?? target;
      else if (kind === 'invalid') result += token;
      else result += label === undefined ? target : wikiLabelText(label, depth + 1, false);
    } else if (links && (wikiAnchorName(token) || (token.startsWith('[*') && wikiNoteBody(token) !== null))) continue;
    else if (/^\[br\]$/i.test(token)) result += ' ';
    else {
      const body = wikiEmphasisBody(token);
      result += body === null ? token : wikiLabelText(body, depth + 1, links);
    }
  }
  return result + value.slice(last);
}

/** A reading excerpt, never a replacement for stored source. Reuse the source
 * scanner so table attributes, includes and fenced examples keep their boundaries. */
export function wikiSearchText(content: string, depth = 0): string {
  if (depth >= WIKI_STRUCTURE_DEPTH) return wikiLabelText(content);
  const { lines, blocks } = scanWikiSource(content, depth);
  const text: string[] = [];
  for (let i = 0; i < lines.length;) {
    const block = blocks.get(i);
    if (block) {
      if (block.kind === 'fence') {
        text.push(block.fence.kind === 'folding'
          ? wikiSearchText(block.fence.body, depth + 1) : block.fence.body);
      } else if (block.table) {
        for (const row of block.table.rows) for (const cell of row)
          text.push(cell.block ? wikiSearchText(cell.text, depth + 1) : wikiLabelText(cell.text));
      } else text.push(lines.slice(i, block.end).join(' '));
      i = block.end;
      continue;
    }
    const line = lines[i++];
    if (parseWikiInclude(line) || /^\s*\[(?:목차|tableofcontents)\]\s*$/i.test(line)) continue;
    text.push(wikiLabelText(line.replace(/^(={1,6})\s+(.+?)\s+\1\s*$/, '$2')
      .replace(/^\s*(?:#{1,6}|[*+>-]|\d+[.)])\s+/, '')));
  }
  return text.join(' ').replace(/https?:\/\/[^\s<>]+/g, url => {
    try { return new URL(url).hostname; } catch { return url; }
  }).replace(/\s+/g, ' ').trim();
}

export function redirectTarget(content: string): string | null {
  const first = content.replace(/^\uFEFF/, '').split('\n').find(line => line.trim());
  const match = first?.trim().match(/^#(?:redirect|넘겨주기)\s+(.+?)\s*$/i);
  if (!match) return null;
  const raw = match[1];
  if (raw.startsWith('[[')) {
    const reference = parseWikiReference(raw);
    return reference && reference.kind !== 'invalid' && reference.kind !== 'external' ? reference.target : null;
  }
  const target = normalizeWikiTitle(raw);
  return target && wikiTargetKind(target) === 'internal' ? target : null;
}

function sourceLinks(content: string): WikiReference[] {
  const result: WikiReference[] = [];
  function document(source: string, structureDepth: number) {
    const notes: { body: string }[] = [], namedNotes = new Map<string, { body: string }>();
    function inline(value: string, depth = 0, allowNotes = true) {
      if (depth >= WIKI_INLINE_DEPTH) return;
      for (const { token } of wikiInlineTokens(value)) {
        if (token.startsWith('\\') || token.startsWith('`') || /^\[anchor\(/i.test(token)) continue;
        if (token.startsWith('{{{')) {
          const styled = wikiInlineStyle(token);
          if (styled) inline(styled.body, depth + 1, allowNotes);
        } else if (token.startsWith('[[')) {
          // Labels are rendered with links disabled, so never scan them again.
          const reference = parseWikiReference(token);
          if (reference) result.push(reference);
        } else if (token.startsWith('[*') && allowNotes) {
          const value = wikiNoteBody(token);
          if (value === null) continue;
          const definition = value.match(/^(\S+)(?:\s+([\s\S]*))?$/);
          const name = /^\s/.test(value) ? undefined : definition?.[1];
          const body = name ? definition?.[2] || '' : value.trim();
          const previous = name ? namedNotes.get(name) : undefined;
          if (previous) { if (!previous.body && body) previous.body = body; }
          else {
            const note = { body };
            notes.push(note);
            if (name) namedNotes.set(name, note);
          }
        } else {
          const body = wikiEmphasisBody(token);
          if (body !== null) inline(body, depth + 1, allowNotes);
        }
      }
    }
    const { lines, blocks } = scanWikiSource(source, structureDepth);
    for (let i = 0; i < lines.length;) {
      const block = blocks.get(i);
      if (block) {
        if (block.kind === 'fence') {
          const fence = block.fence;
          if (fence.kind === 'folding' && structureDepth < WIKI_STRUCTURE_DEPTH) {
            inline(fence.title);
            document(fence.body, structureDepth + 1);
          }
        } else if (block.table) {
          for (const row of block.table.rows) for (const cell of row) {
            if (cell.block) document(cell.text, structureDepth + 1);
            else inline(cell.text);
          }
        }
        i = block.end;
        continue;
      }
      const line = lines[i++];
      if (!parseWikiInclude(line)) inline(line);
    }
    // Only the retained definition is visible; duplicates cannot add relationships.
    for (const note of notes) inline(note.body, 0, false);
  }
  document(content, 0);
  return result;
}
export function wikiLinks(content: string): string[] {
  const redirect = redirectTarget(content);
  const references = sourceLinks(content).filter(value => value.kind === 'internal' || value.kind === 'file').map(value => value.target);
  return [...new Set([...(redirect ? [redirect] : []), ...references, ...wikiIncludes(content)]
    .map(value => value.split('#')[0].trim()).filter(Boolean))];
}
export function wikiCategories(content: string): string[] {
  return [...new Set(sourceLinks(content).filter(value => value.kind === 'category')
    .map(value => normalizeWikiTitle(value.target.split('#')[0]).slice(3)).filter(value => !!value.trim()))];
}
export function sectionRange(content: string, line: number): { start: number; end: number; content: string } {
  const lines = content.split('\n');
  const heading = parseWikiHeadings(content).find(h => h.index === line);
  if (!heading) throw new RangeError('No editable heading at this source line');
  const end = heading.end ?? lines.length;
  return { start: heading.index, end, content: lines.slice(heading.index, end).join('\n') };
}
