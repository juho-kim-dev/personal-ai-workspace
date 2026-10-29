/** Deliberately small local grammar, shared by rendering and relationship analysis.
 * These are our supported forms, not an implementation of an upstream engine. */
export const WIKI_INLINE_DEPTH = 12;
export const WIKI_STYLE_BODY_LIMIT = 4096;
export const WIKI_STYLE_DEPTH = 4;
export const WIKI_ANCHOR_LIMIT = 256;
const colors = new Set(['black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'gray', 'grey', 'teal', 'navy', 'maroon', 'olive', 'silver']);
const sizes: Record<string, string> = {
  '+1': '1.1em', '+2': '1.2em', '+3': '1.3em', '+4': '1.4em', '+5': '1.5em',
  '-1': '0.9em', '-2': '0.8em', '-3': '0.7em', '-4': '0.6em', '-5': '0.5em',
};

export type WikiColor = { light: string; dark?: string };
export type WikiColorProperty = 'color' | 'backgroundColor' | 'borderColor';
type ColorStyle = Partial<Record<WikiColorProperty, string>> & { [key: `--wiki-${string}`]: string };
type InlineStyle = ColorStyle & { fontSize?: string };

/** Shared exact color grammar. No CSS functions, URLs, variables or declarations. */
export function wikiColor(value: string): WikiColor | null {
  const parts = value.split(',');
  if (parts.length > 2) return null;
  const parsed = parts.map(part => {
    if (/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(part)) return part;
    return /^[a-z]+$/i.test(part) && colors.has(part.toLowerCase()) ? part.toLowerCase() : null;
  });
  return parsed.every(part => part !== null)
    ? { light: parsed[0]!, ...(parts.length === 2 ? { dark: parsed[1]! } : {}) } : null;
}

/** Pair variables are assigned only on the element that uses them. */
export function wikiColorStyle(value: WikiColor, property: WikiColorProperty): ColorStyle {
  if (!value.dark) return { [property]: value.light };
  const name = `--wiki-${property}`;
  return {
    [property]: `var(${name}, ${value.light})`,
    [`${name}-light`]: value.light,
    [`${name}-dark`]: value.dark,
  };
}

function styleHeader(text: string, start: number): { bodyStart: number; style: InlineStyle } | null {
  const match = text.slice(start).match(/^\{\{\{(#[^\s]+|[+-][^\s]+)[ \t]+/);
  if (!match) return null;
  const attribute = match[1], bodyStart = start + match[0].length;
  if (Object.hasOwn(sizes, attribute)) return { bodyStart, style: { fontSize: sizes[attribute] } };
  // Inline names carry #; table option names do not. Each pair member follows
  // the same inline syntax, so an unprefixed second name is not a CSS escape.
  const members = attribute.split(',');
  if (!members.every(member => member.startsWith('#'))) return null;
  const color = wikiColor(members.map(member => /^#[a-z]+$/i.test(member) && colors.has(member.slice(1).toLowerCase()) ? member.slice(1) : member).join(','));
  return color ? { bodyStart, style: wikiColorStyle(color, 'color') } : null;
}

export function wikiInlineStyle(token: string): { body: string; style: InlineStyle } | null {
  // Reject large inputs before validation; the body budget includes nested markup.
  const header = styleHeader(token, 0);
  if (!header || token.length - header.bodyStart - 3 > WIKI_STYLE_BODY_LIMIT) return null;
  const parsed = scanBraces(token, 0);
  return parsed?.valid && parsed.end === token.length
    ? { body: token.slice(header.bodyStart, -3), style: header.style } : null;
}

export function wikiAnchorName(token: string): string | null {
  const match = token.match(/^\[anchor\(([^\r\n]*)\)\]$/i);
  const name = match?.[1].normalize('NFC');
  // Reserve generated document/section/note and current preview/discussion namespaces.
  if (!name || name.length > 64 || !/^[\p{L}\p{N}][\p{L}\p{M}\p{N}_-]*$/u.test(name)
    || /^(?:toc$|s-|note-|cell-\d+-\d+-\d+-|(?:include|fold|preview|discussion|comment)(?:-|$))/i.test(name)) return null;
  return name;
}

/** One iterative scanner owns both token boundaries and whole-style validity.
 * Raw triples are balanced but invalidate a containing style. Code and escaped
 * constructs inside styles are opaque, including any apparent brace delimiters.
 * No recursion is used even when a rejected input contains thousands of triples. */
function scanBraces(text: string, start: number): { end: number; valid: boolean } | null {
  const header = styleHeader(text, start);
  const stack = [{ header, literal: false, protectedBody: !!header }];
  const linkTargets: boolean[] = [];
  let valid = !!header;
  const delimiters = /\\.|`+|\[anchor\(|\[\[|\]\]|\||\{\{\{|\}\}\}/gi;
  delimiters.lastIndex = start + 3;
  let match: RegExpExecArray | null;
  while ((match = delimiters.exec(text))) {
    const parent = stack[stack.length - 1];
    const escaped = match[0].startsWith('\\');
    const position = match.index + (escaped ? 1 : 0);
    // Escaped brackets inside a link target are title characters, even when
    // they spell \[anchor(...)\]. Labels still participate in style validation.
    if (parent.protectedBody) {
      if (escaped && linkTargets.at(-1)) continue;
      if (text.startsWith('[[', position)) { linkTargets.push(true); delimiters.lastIndex = position + 2; continue; }
      if (!escaped && match[0] === ']]') { linkTargets.pop(); continue; }
      if (!escaped && match[0] === '|') { if (linkTargets.length) linkTargets[linkTargets.length - 1] = false; continue; }
    }
    if (parent.protectedBody && (text[position] === '`' || /^\[anchor\(/i.test(text.slice(position, position + 8)))) {
      delimiters.lastIndex = wikiLiteralEnd(text, position);
      continue;
    }
    if (escaped && !(parent.protectedBody && text.startsWith('{{{', position))) continue;
    if (match[0].startsWith('`')) {
      if (parent.protectedBody) delimiters.lastIndex = wikiLiteralEnd(text, position);
      continue;
    }
    if (text.startsWith('{{{', position)) {
      const nested = styleHeader(text, position);
      const literal = parent.literal || escaped;
      if (!literal && (!nested || stack.length >= WIKI_STYLE_DEPTH)) valid = false;
      stack.push({ header: nested, literal, protectedBody: parent.protectedBody && !!nested });
      delimiters.lastIndex = position + 3;
    } else if (match[0] === '}}}') {
      const frame = stack.pop()!;
      if (!frame.literal && frame.header) {
        const length = match.index - frame.header.bodyStart;
        if (length < 1 || length > WIKI_STYLE_BODY_LIMIT) valid = false;
        else {
          const body = text.slice(frame.header.bodyStart, match.index);
          if (!body.trim() || /[\r\n]/.test(body)) valid = false;
        }
      }
      if (!stack.length) return { end: delimiters.lastIndex, valid };
    }
  }
  return null;
}

/** Unclosed inline constructs consume the rest of their line. */
export function wikiBraceEnd(text: string, start: number): number | null {
  return scanBraces(text, start)?.end ?? null;
}

/** Links and notes cannot close inside an opaque style/code/anchor token. */
function bracketEnd(text: string, start: number, link: boolean): number | null {
  const delimiters = /\\.|`+|\{\{\{|\[anchor\(|\[\[|\]\]|\]|\|/gi;
  delimiters.lastIndex = start + 2;
  const targets = [link];
  let depth = 1, match: RegExpExecArray | null;
  while ((match = delimiters.exec(text))) {
    const escaped = match[0].startsWith('\\');
    const position = match.index + (escaped ? 1 : 0);
    if (targets[depth - 1] && escaped) continue;
    if (!escaped && match[0] === '|') targets[depth - 1] = false;
    if (/^(?:\{\{\{|`|\[anchor\()/i.test(text.slice(position, position + 8))) {
      delimiters.lastIndex = wikiLiteralEnd(text, position);
    } else if (text.startsWith('[[', position)) {
      if (link) { depth++; targets.push(true); delimiters.lastIndex = position + 2; }
      else delimiters.lastIndex = linkEnd(text, position) ?? text.length;
    } else if (!escaped && (link ? match[0] === ']]' : match[0].startsWith(']'))) {
      if (--depth === 0) return link ? delimiters.lastIndex : match.index + 1;
      targets.pop();
    }
  }
  return null;
}

function linkEnd(text: string, start: number): number | null {
  return bracketEnd(text, start, true);
}

export function wikiNoteBody(token: string): string | null {
  return bracketEnd(token, 0, false) === token.length ? token.slice(2, -1) : null;
}

export function wikiLinkBody(token: string): string | null {
  // A lone UTF-16 surrogate cannot be URI-encoded. Keep that source literal;
  // the Unicode regexp still permits valid astral characters/surrogate pairs.
  if (/[\uD800-\uDFFF]/u.test(token)) return null;
  return linkEnd(token, 0) === token.length ? token.slice(2, -2) : null;
}

export function wikiLiteralEnd(text: string, start: number): number {
  if (text.startsWith('{{{', start)) return wikiBraceEnd(text, start) ?? text.length;
  if (text.startsWith('[*', start)) return bracketEnd(text, start, false) ?? text.length;
  if (text.startsWith('[[', start)) return linkEnd(text, start) ?? text.length;
  if (text[start] === '`') {
    const delimiter = text.slice(start).match(/^`+/)![0];
    const close = text.indexOf(delimiter, start + delimiter.length);
    return close < 0 ? text.length : close + delimiter.length;
  }
  const close = text.indexOf(')]', start + 8);
  return close < 0 ? text.length : close + 2;
}

function emphasisEnd(text: string, start: number, delimiter: string): number | null {
  const protectedTokens = /\\.|\{\{\{|`+|\[\[|\[anchor\(/gi;
  let cursor = start + delimiter.length;
  while (cursor < text.length) {
    const close = text.indexOf(delimiter, cursor);
    if (close < 0) return null;
    protectedTokens.lastIndex = cursor;
    const next = protectedTokens.exec(text);
    if (!next || close < next.index) return close + delimiter.length;
    const literalStart = next.index + (next[0].startsWith('\\') ? 1 : 0);
    cursor = /^(?:\{\{\{|\[\[|`|\[anchor\()/i.test(text.slice(literalStart, literalStart + 8))
      ? wikiLiteralEnd(text, literalStart) : next.index + 2;
  }
  return null;
}

export function* wikiInlineTokens(text: string): Generator<{ token: string; index: number }> {
  const tokens = /\\.|\{\{\{|`+|\[anchor\(|\[\[|\[\*|\[(?:br|목차|tableofcontents)\]|'''''[^\n]+?'''''|'''[^\n]+?'''|''[^\n]+?''|\*\*[^\n]+?\*\*|~~[^\n]+?~~|--[^\n]+?--|__[^\n]+?__|\^\^[^\n]+?\^\^|,,[^\n]+?,,|\[https?:\/\/[^\]\n]+\]|https?:\/\/[^\s<>\[\]]+|(?<![\p{L}\p{N}_])#[1-9]\d{0,3}(?!\d)/giu;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(text))) {
    const index = match.index, escaped = match[0].startsWith('\\'), start = index + (escaped ? 1 : 0);
    let end = tokens.lastIndex;
    if (/^(?:\{\{\{|\[\[|`|\[anchor\()/i.test(text.slice(start, start + 8))) end = wikiLiteralEnd(text, start);
    else if (!escaped && match[0] === '[*') end = bracketEnd(text, start, false) ?? text.length;
    else if (!escaped) {
      const delimiter = match[0].match(/^(?:'''''|'''|''|\*\*|~~|--|__|\^\^|,,)/)?.[0];
      if (delimiter) {
        const close = emphasisEnd(text, index, delimiter);
        // An apparent closer inside code is not a real emphasis boundary.
        if (close === null) { tokens.lastIndex = index + delimiter.length; continue; }
        end = close;
      }
    }
    tokens.lastIndex = end;
    yield { token: text.slice(index, end), index };
  }
}

export function wikiEmphasisBody(token: string): string | null {
  const delimiter = token.match(/^(?:'''''|'''|''|\*\*|~~|--|__|\^\^|,,)/)?.[0];
  return delimiter ? token.slice(delimiter.length, -delimiter.length) : null;
}
