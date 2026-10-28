import { isMap, isScalar, parseDocument, stringify } from 'yaml';

// Keep the pure composition module usable by Node's strip-only test runner; api.ts
// contains a runtime parameter property. Transport writes also validate these paths.
function validatePath(path: string): void {
  if (!path || path.length > 1024 || /^[\/\\]/.test(path) || /[\x00-\x1f\x7f\\]/.test(path) || /^[a-z]:/i.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('유효한 보관함 상대 경로를 입력하세요.');
}
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function safeYaml(text: string): unknown {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors.map(e => e.message).join('\n'));
  const value = doc.toJS({ maxAliasCount: 50 });
  try { JSON.stringify(value); } catch { throw new Error('순환 YAML 별칭은 이 뷰에서 지원하지 않습니다.'); }
  return value;
}
export type PropertyEntry = { key: string; value: unknown };
export function propertyDocument(text: string) {
  const match = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(text);
  // The frontmatter delimiter must be at the very beginning, never inside the body.
  const found = match?.index === 0 ? match : null;
  if (!found && /^\uFEFF?---[ \t]*\r?\n/.test(text)) throw new Error('속성 YAML의 닫는 --- 구분자가 없습니다.');
  const yaml = found?.[2] || '';
  const doc = parseDocument(yaml, { keepSourceTokens: true, uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors.map(e => e.message).join('\n'));
  if (doc.contents && !isMap(doc.contents)) throw new Error('속성은 YAML 객체여야 합니다.');
  const values = doc.toJS({ maxAliasCount: 50 }) as Record<string, unknown> | null;
  try { JSON.stringify(values); } catch { throw new Error('순환 YAML 별칭은 속성 뷰에서 지원하지 않습니다.'); }
  const entries: PropertyEntry[] = [];
  if (isMap(doc.contents)) for (const pair of doc.contents.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new Error('문자열 속성 이름만 편집할 수 있습니다.');
    entries.push({ key: pair.key.value, value: values && Object.hasOwn(values, pair.key.value) ? values[pair.key.value] : null });
  }
  return { found, yaml, doc, entries, body: found ? text.slice(found[0].length) : text, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}
/** Splice only the changed YAML pair. Unknown properties, comments, and body bytes survive. */
export function setProperty(text: string, key: string, value: unknown, remove = false): string {
  if (!key.trim() || /[\r\n\x00-\x1f]/.test(key) || forbidden.has(key)) throw new Error('유효하고 안전한 속성 이름을 입력하세요.');
  const source = propertyDocument(text), { yaml, doc, eol } = source;
  const pair = isMap(doc.contents) ? doc.contents.items.find(p => isScalar(p.key) && p.key.value === key) : undefined;
  const replacement = remove ? '' : stringify(new Map([[key, value]]), { lineWidth: 0 }).replace(/\n/g, eol);
  let next: string;
  // For single-line scalar edits, replace only the value token. Keep key spacing,
  // anchors and trailing comments byte-for-byte rather than rewriting the row.
  if (!remove && pair && isScalar(pair.value) && pair.value.range && pair.value.range[1] > pair.value.range[0] && !yaml.slice(pair.value.range[0],pair.value.range[1]).includes('\n') && !replacement.trimEnd().includes('\n')) {
    const encoded = parseDocument(replacement).contents;
    if (isMap(encoded) && isScalar(encoded.items[0]?.value) && encoded.items[0].value.range) {
      const range = encoded.items[0].value.range;
      const scalarText = replacement.slice(range[0],range[1]);
      next = yaml.slice(0,pair.value.range[0]) + scalarText + yaml.slice(pair.value.range[1]);
      const offset = source.found?.[1].length ?? 0;
      const result = text.slice(0,offset) + next + text.slice(offset+yaml.length);
      propertyDocument(result); return result;
    }
  }
  if (isMap(doc.contents) && doc.contents.flow) {
    const scalar = (item: unknown) => stringify(item, { collectionStyle: 'flow', lineWidth: 0 }).trimEnd();
    if (pair && isScalar(pair.key) && pair.key.range) {
      let start = pair.key.range[0];
      const node = pair.value as { range?: [number, number, number] } | null;
      let end = node?.range?.[1] ?? (yaml.indexOf(':', pair.key.range[1]) + 1);
      if (remove) {
        const trailing = yaml.slice(end).match(/^[ \t\r\n]*,[ \t]*/);
        if (trailing) end += trailing[0].length;
        else { const leading = yaml.slice(0, start).match(/,[ \t\r\n]*$/); if (leading) start -= leading[0].length; }
      }
      next = yaml.slice(0, start) + (remove ? '' : `${scalar(key)}: ${scalar(value)}`) + yaml.slice(end);
    } else {
      if (remove) return text;
      const close = yaml.lastIndexOf('}', (doc.contents.range?.[1] || yaml.length) - 1);
      next = yaml.slice(0, close) + (doc.contents.items.length ? ', ' : '') + `${scalar(key)}: ${scalar(value)}` + yaml.slice(close);
    }
  } else if (pair && isScalar(pair.key) && pair.key.range) {
    const start = yaml.lastIndexOf('\n', pair.key.range[0] - 1) + 1;
    const node = pair.value as { range?: [number, number, number] } | null;
    const newline = yaml.indexOf('\n', pair.key.range[2]);
    let end = node?.range?.[2] ?? (newline < 0 ? yaml.length : newline + 1);
    if (end && yaml[end - 1] !== '\n') { const lineEnd = yaml.indexOf('\n', end); end = lineEnd < 0 ? yaml.length : lineEnd + 1; }
    next = yaml.slice(0, start) + replacement + yaml.slice(end);
  } else {
    if (remove) return text;
    next = yaml + (yaml && !yaml.endsWith('\n') ? eol : '') + replacement;
  }
  if (!source.found) { const result = `---${eol}${next}---${eol}${text}`; propertyDocument(result); return result; }
  const offset = source.found[1].length;
  const result = text.slice(0, offset) + next + text.slice(offset + yaml.length);
  propertyDocument(result); // Refuse edits that would orphan a YAML alias or corrupt a flow map.
  return result;
}

