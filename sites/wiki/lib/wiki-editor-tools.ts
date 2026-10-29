/** Textarea offsets and the limit use UTF-16 code units (String.length). */
import { wikiTitleReference } from './wiki-reference';
export const WIKI_EDITOR_LIMIT = 200_000;
export type WikiSourceSelection = { start: number; end: number };
export type WikiSourceChange = WikiSourceSelection & { value: string };
/** Textareas collapse CRLF to LF; retain stored source bytes when applying tools. */
export function wikiSourceOffset(value: string, domOffset: number): number {
  let source = 0, dom = 0;
  while (source < value.length && dom < domOffset) {
    source += value[source] === '\r' && value[source + 1] === '\n' ? 2 : 1;
    dom++;
  }
  return source;
}
export function wikiTextareaOffset(value: string, sourceOffset: number): number {
  const end = Math.max(0, Math.min(value.length, sourceOffset));
  let removed = 0;
  for (let i = 0; i < end; i++) if (value[i] === '\r' && value[i + 1] === '\n') { removed++; i++; }
  return end - removed;
}
export type WikiEditorAction =
  | { type: 'bold' | 'italic' | 'link' | 'list' | 'table' | 'footnote' | 'folding' | 'indent' | 'outdent' }
  | { type: 'find'; query: string; direction: 'next' | 'previous' }
  | { type: 'replace-current' | 'replace-all'; query: string; replacement: string };
export type WikiSearchSummary = { total: number; current: number; replaceable: number };
export type WikiEditorResult =
  | { ok: true; change: WikiSourceChange; message: string; replaced: number; search?: WikiSearchSummary }
  | { ok: false; error: string };

const limitError = '원문과 입력은 각각 200,000자 이하여야 합니다. 변경하지 않았습니다.';

/** Case-sensitive literal matches, including overlaps. Empty/oversized input has no matches. */
export function findWikiOccurrences(value: string, query: string): number[] {
  if (!query || query.length > WIKI_EDITOR_LIMIT || value.length > WIKI_EDITOR_LIMIT) return [];
  const positions: number[] = [];
  for (let from = 0; from <= value.length - query.length;) {
    const index = value.indexOf(query, from);
    if (index < 0) break;
    positions.push(index);
    from = index + 1;
  }
  return positions;
}

function nonOverlapping(positions: number[], length: number): number[] {
  const result: number[] = [];
  let end = 0;
  for (const index of positions) {
    if (index < end) continue;
    result.push(index);
    end = index + length;
  }
  return result;
}

export function wikiSearchSummary(value: string, query: string, selection?: WikiSourceSelection): WikiSearchSummary {
  const positions = findWikiOccurrences(value, query);
  return {
    total: positions.length,
    current: selection && selection.end - selection.start === query.length ? positions.indexOf(selection.start) + 1 : 0,
    replaceable: nonOverlapping(positions, query.length).length,
  };
}

type Splice = { start: number; end: number; text: string };

/** Applies ordered disjoint splices; endpoints follow their original source text. */
function spliceSource(value: string, splices: Splice[], selection: WikiSourceSelection): WikiSourceChange {
  const map = (offset: number) => {
    let shift = 0;
    for (const splice of splices) {
      if (offset < splice.start) break;
      if (offset < splice.end) return splice.start + shift + splice.text.length;
      shift += splice.text.length - (splice.end - splice.start);
    }
    return offset + shift;
  };
  const parts: string[] = [];
  let from = 0;
  for (const splice of splices) {
    parts.push(value.slice(from, splice.start), splice.text);
    from = splice.end;
  }
  parts.push(value.slice(from));
  return { value: parts.join(''), start: map(selection.start), end: map(selection.end) };
}

/** Pure, synchronous, and transactional: errors never carry a change to apply. */
export function editWikiSource(value: string, action: WikiEditorAction, selection: WikiSourceSelection): WikiEditorResult {
  if (value.length > WIKI_EDITOR_LIMIT) return { ok: false, error: limitError };
  if (!Number.isFinite(selection.start) || !Number.isFinite(selection.end)) {
    return { ok: false, error: '선택 범위를 확인할 수 없습니다. 원문에서 다시 선택해 주세요.' };
  }
  const clamp = (offset: number) => Math.max(0, Math.min(value.length, Math.trunc(offset)));
  const start = Math.min(clamp(selection.start), clamp(selection.end));
  const end = Math.max(clamp(selection.start), clamp(selection.end));
  const range = { start, end };
  const finish = (change: WikiSourceChange, message: string, replaced = 0, query?: string): WikiEditorResult => {
    if (change.value.length > WIKI_EDITOR_LIMIT) return { ok: false, error: limitError };
    return { ok: true, change, message, replaced,
      ...(query === undefined ? {} : { search: wikiSearchSummary(change.value, query, change) }) };
  };

  if ('query' in action) {
    if (!action.query.length) return { ok: false, error: '찾을 내용을 입력해 주세요.' };
    if (action.query.length > WIKI_EDITOR_LIMIT || ('replacement' in action && action.replacement.length > WIKI_EDITOR_LIMIT)) {
      return { ok: false, error: limitError };
    }
    const { query } = action;
    const positions = findWikiOccurrences(value, query);
    if (!positions.length) return finish({ value, ...range }, '일치하는 내용이 없습니다. 0개.', 0, query);
    const current = end - start === query.length ? positions.indexOf(start) : -1;
    const navigate = (direction: 'next' | 'previous', selectFirst = false): WikiEditorResult => {
      let index: number;
      if (current >= 0) index = (current + (direction === 'next' ? 1 : positions.length - 1)) % positions.length;
      else if (direction === 'next') {
        index = positions.findIndex(position => position >= end);
        if (index < 0) index = 0;
      } else {
        index = positions.length - 1;
        while (index >= 0 && positions[index] >= start) index--;
        if (index < 0) index = positions.length - 1;
      }
      return finish({ value, start: positions[index], end: positions[index] + query.length },
        `${selectFirst ? '바꾸지 않고 다음 일치를 선택했습니다. ' : ''}전체 ${positions.length}개 중 ${index + 1}번째.`, 0, query);
    };
    if (action.type === 'find') return navigate(action.direction);
    if (action.type === 'replace-current') {
      if (current < 0) return navigate('next', true);
      const resultLength = value.length - query.length + action.replacement.length;
      if (resultLength > WIKI_EDITOR_LIMIT) return { ok: false, error: limitError };
      const change = { value: value.slice(0, start) + action.replacement + value.slice(end), start, end: start + action.replacement.length };
      return finish(change, '선택한 일치 1개를 바꿨습니다.', 1, query);
    }
    const targets = nonOverlapping(positions, query.length);
    // Check growth before building the replacement, including pathological repeated matches.
    if (value.length + targets.length * (action.replacement.length - query.length) > WIKI_EDITOR_LIMIT) {
      return { ok: false, error: limitError };
    }
    const splices = targets.map(position => ({ start: position, end: position + query.length, text: action.replacement }));
    return finish(spliceSource(value, splices, range), `겹치지 않는 일치 ${targets.length}개를 모두 바꿨습니다.`, targets.length, query);
  }

  if (action.type === 'indent' || action.type === 'outdent') {
    const first = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
    // A selection ending at the next line's start does not include that next line.
    const last = end > start ? end - 1 : end;
    const splices: Splice[] = [];
    for (let position = first; position <= last;) {
      if (action.type === 'indent') splices.push({ start: position, end: position, text: ' ' });
      else if (value[position] === ' ' || value[position] === '\t') splices.push({ start: position, end: position + 1, text: '' });
      const newline = value.indexOf('\n', position);
      if (newline < 0) break;
      position = newline + 1;
    }
    if (value.length + (action.type === 'indent' ? splices.length : -splices.length) > WIKI_EDITOR_LIMIT) {
      return { ok: false, error: limitError };
    }
    return finish(spliceSource(value, splices, range), `${splices.length}개 줄을 ${action.type === 'indent' ? '들여썼습니다' : '내어썼습니다'}.`);
  }

  const selected = value.slice(start, end);
  const newline = value.includes('\r\n') ? '\r\n' : '\n';
  const block = action.type === 'list' || action.type === 'table' || action.type === 'folding';
  const leading = block && start > 0 && value[start - 1] !== '\n' ? newline : '';
  const trailing = block && end < value.length && value[end] !== '\n' && !value.slice(end).startsWith('\r\n') ? newline : '';
  let body: string, selectedStart: number, selectedEnd: number;
  if (action.type === 'folding') {
    const content = selected || '내용';
    const prefix = `{{{#!folding 제목${newline}`;
    body = prefix + content + (content.endsWith('\n') ? '' : newline) + '}}}';
    selectedStart = prefix.length;
    selectedEnd = selectedStart + content.length;
  } else {
    const wrappers = {
      bold: ["'''", "'''", '강조'], italic: ["''", "''", '기울임'], link: ['[[', ']]', '문서 제목'],
      list: [' * ', '', '항목'], table: ['|| ', ' ||', '내용'], footnote: ['[* ', ']', '각주 내용'],
    } as const;
    const [prefix, suffix, placeholder] = wrappers[action.type];
    // Each source line gets supported single-line markup. Preserve every original
    // character and line separator, including blank lines and CRLF, without trimming.
    const content = selected || placeholder;
    const lines = content.split('\n');
    body = lines.map((line, index) => {
      const cr = index < lines.length - 1 && line.endsWith('\r') ? '\r' : '';
      const text = cr ? line.slice(0, -1) : line;
      return text.length ? (action.type === 'link' ? wikiTitleReference(text) : prefix + text + suffix) + cr : line;
    }).join('\n');
    const firstLine = lines.length > 1 && lines[0].endsWith('\r') ? lines[0].slice(0, -1) : lines[0];
    selectedStart = firstLine.length ? prefix.length : 0;
    selectedEnd = body.length - (lines[lines.length - 1].length ? suffix.length : 0);
  }
  return finish({ value: value.slice(0, start) + leading + body + trailing + value.slice(end),
    start: start + leading.length + selectedStart, end: start + leading.length + selectedEnd }, '선택한 원문에 서식을 넣었습니다.');
}
