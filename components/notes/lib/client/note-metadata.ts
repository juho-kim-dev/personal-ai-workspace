import { Marked, Tokenizer, type Token, type Tokens } from 'marked';
import { parseDocument } from 'yaml';

export function parseFrontmatter(text: string) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { properties: {} as Record<string, unknown>, body: text, raw: '', error: '' };
  try {
    const doc = parseDocument(match[1], { uniqueKeys: true });
    if (doc.errors.length) throw doc.errors[0];
    const value = doc.toJS({ maxAliasCount: 30 });
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('속성은 YAML 객체여야 합니다.');
    return { properties: value as Record<string, unknown>, body: text.slice(match[0].length), raw: match[0], error: '' };
  } catch (error) { return { properties: {} as Record<string, unknown>, body: text, raw: match[0], error: `YAML: ${String(error)}` }; }
}

export type NoteLink = { raw: string; embed: boolean; target: string; heading: string; alias: string; kind: 'wiki' | 'markdown' };
export type NoteMetadata = { links: NoteLink[]; tags: string[] };
const name = (path: string) => (path.split('/').pop() || path).replace(/\.md$/i, '');
export const validTag = (s: string) => /^[\p{L}\p{N}_/-]+$/u.test(s) && /[\p{L}_/-]/u.test(s);
const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
function destination(value: string) {
  // Split before percent decoding: %23 can be part of a literal filename.
  const hash = value.indexOf('#');
  return { target: (hash < 0 ? value : value.slice(0, hash)).trim(), heading: hash < 0 ? '' : decode(value.slice(hash + 1)) };
}
export function safeNotePath(path: string) {
  return !!path && path.length <= 1024 && !/^[\/\\]|^[a-z][a-z\d+.-]*:|[\x00-\x1f\x7f\\]/i.test(path) && !path.split('/').some(p => !p || p === '.' || p === '..');
}
const external = (target: string) => /^[a-z][a-z\d+.-]*:/i.test(decode(target)) || decode(target).startsWith('//');
// A local lexer instance keeps renderer/editor tokenization unchanged. Marked handles
// escapes, code, comments, titles, balanced destinations and reference definitions.
const lexer = new Marked({ tokenizer: { reflink(src, definitions) {
  const token = Tokenizer.prototype.reflink.call(this, src, definitions);
  return token ? Object.assign(token, { nativeReference: true }) : token;
} }, extensions: [{
  name: 'noteWiki', level: 'inline',
  start: src => src.search(/!?\[\[/),
  tokenizer(src) {
    const match = /^(!?)\[\[([^\]\n]+)\]\]/.exec(src);
    if (!match) return;
    const pipe = match[2].indexOf('|'), value = pipe < 0 ? match[2] : match[2].slice(0, pipe);
    const dest = destination(value);
    const link: NoteLink = { raw: match[0], embed: !!match[1], ...dest, alias: (pipe < 0 ? '' : match[2].slice(pipe + 1)) || dest.heading || name(dest.target), kind: 'wiki' };
    return { type: 'noteWiki', raw: match[0], link };
  },
}, {
  name: 'noteComment', level: 'inline', start: src => src.indexOf('%%'),
  tokenizer(src) { const match = /^%%[\s\S]*?(?:%%|$)/.exec(src); if (match) return { type: 'noteComment', raw: match[0] }; },
}, {
  name: 'noteCommentBlock', level: 'block', start: src => src.search(/^ {0,3}%%/m),
  tokenizer(src) { const match = /^ {0,3}%%[\s\S]*?(?:%%(?:\r?\n)?|$)/.exec(src); if (match) return { type: 'noteCommentBlock', raw: match[0] }; },
}] });

/** Pure Markdown metadata; HTML/Canvas references deliberately have no link semantics. */
export function extractNoteMetadata(text: string): NoteMetadata {
  const parsed = parseFrontmatter(text), links: NoteLink[] = [], tags = new Set<string>();
  for (const [key, value] of Object.entries(parsed.properties)) if (key.toLowerCase() === 'tags') {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : [];
    for (const v of values) if (typeof v === 'string' && validTag(v.replace(/^#/, ''))) tags.add(v.replace(/^#/, ''));
  }
  // Native observation covers ordinary string/string-list properties only. Reserved
  // tag/alias values retain their own semantics; nested objects are not inferred.
  for (const [key, value] of Object.entries(parsed.properties)) {
    if (['tags', 'tag', 'aliases', 'alias'].includes(key.toLowerCase())) continue;
    for (const item of Array.isArray(value) ? value : [value]) if (typeof item === 'string') {
      for (const token of lexer.lexer(item)) collectProperty(token);
    }
  }
  function collectProperty(token: Token) {
    if (token.type === 'noteWiki') {
      const link = (token as Tokens.Generic).link as NoteLink;
      if (!external(link.target)) links.push(link);
    } else if ('tokens' in token && Array.isArray(token.tokens)) token.tokens.forEach(collectProperty);
  }
  function walk(tokens: Token[], source: string, before = '') {
    let cursor = 0;
    for (const token of tokens) {
      // Keep the source boundary across escapes/HTML and nested formatting. A text
      // token starting with # is not necessarily at the start of the source.
      const offset = source.indexOf(token.raw, cursor);
      const prefix = offset > 0 ? source[offset - 1] : before;
      cursor = offset < 0 ? cursor : offset + token.raw.length;
      if (['code', 'codespan', 'escape', 'html', 'noteComment', 'noteCommentBlock'].includes(token.type)) continue;
      if (token.type === 'noteWiki') {
        const link = (token as Tokens.Generic).link as NoteLink;
        if (!external(link.target)) links.push(link);
        continue;
      }
      if (token.type === 'link' || token.type === 'image') {
        const link = token as Tokens.Link | Tokens.Image;
        if (!(token as Tokens.Generic).nativeReference && !external(link.href)) links.push({ kind: 'markdown', raw: link.raw, embed: link.type === 'image', ...destination(link.href), alias: link.text });
      }
      if ('tokens' in token && Array.isArray(token.tokens)) walk(token.tokens, token.raw, prefix);
      else if (token.type === 'text') {
        let tagEnd = -1;
        for (const m of token.raw.matchAll(/#([\p{L}\p{N}_/-]+)/gu)) {
          const previous = m.index ? token.raw[m.index - 1] : prefix;
          // Observed native boundaries: whitespace, square bracket, emphasis;
          // a slash also permits the next # when consumed by a valid tag.
          if ((!previous || /[\s[*]/u.test(previous) || (previous === '/' && tagEnd === m.index)) && validTag(m[1])) {
            tags.add(m[1]);
            tagEnd = m.index + m[0].length;
          }
        }
      }
      if (token.type === 'list') for (const item of (token as Tokens.List).items) walk(item.tokens, item.raw, prefix);
      if (token.type === 'table') {
        const table = token as Tokens.Table;
        for (const cell of [...table.header, ...table.rows.flat()]) walk(cell.tokens, cell.text);
      }
    }
  }
  // Invalid YAML is excluded from body metadata too; preserve the original text elsewhere.
  const body = parsed.raw ? text.slice(parsed.raw.length) : parsed.body;
  walk(lexer.lexer(body), body);
  return { links, tags: [...tags] };
}

export type LinkResolution = { path?: string; candidates: string[]; missing?: string };
/** One resolver per file snapshot; ambiguous basenames never select an arbitrary file. */
export function createLinkResolver(files: readonly { path: string }[]) {
  const paths = new Set(files.map(f => f.path).filter(safeNotePath)), names = new Map<string, string[]>();
  for (const path of paths) { const base = path.split('/').pop()!; names.set(base, [...names.get(base) || [], path]); }
  const normalize = (path: string) => {
    const parts: string[] = [];
    for (const p of path.split('/')) { if (p === '..') { if (!parts.length) return; parts.pop(); } else if (p && p !== '.') parts.push(p); }
    return parts.join('/');
  };
  const variants = (p: string) => /\.[^/]+$/.test(p) ? [p] : [p, `${p}.md`];
  return (target: string, from: string): LinkResolution => {
    const raw = decode(target.trim());
    if (!raw) return paths.has(from) ? { path: from, candidates: [from] } : { candidates: [] };
    if (external(raw) || /^[\/\\]|[\x00-\x1f\x7f\\]/.test(raw)) return { candidates: [] };
    const parent = from.split('/').slice(0, -1).join('/'), joined = normalize(parent ? `${parent}/${raw}` : raw);
    if (joined === undefined) return { candidates: [] };
    for (const candidate of [joined, normalize(raw)]) {
      if (!candidate) continue;
      const exact = variants(candidate).filter(p => paths.has(p));
      if (exact.length) return { path: exact.length === 1 ? exact[0] : undefined, candidates: exact };
    }
    // Explicit paths cannot silently resolve to an unrelated basename.
    const candidates = raw.includes('/') ? [] : [...new Set(variants(raw).flatMap(p => names.get(p) || []))].sort();
    return { path: candidates.length === 1 ? candidates[0] : undefined, candidates, missing: !candidates.length && safeNotePath(joined) ? (raw.startsWith('.') ? joined : raw) : undefined };
  };
}

export function noteBacklinks(index: Record<string, string>, target: string, resolve: ReturnType<typeof createLinkResolver>, metadata?: Record<string, NoteMetadata>) {
  return Object.entries(index).filter(([path, text]) => path !== target && (metadata?.[path] || extractNoteMetadata(text)).links.some(link => resolve(link.target, path).path === target)).map(([path]) => path);
}
