import { wikiInlineTokens } from './wiki-inline-style';

export function* protectedTokens(source: string): Generator<{ token: string; index: number }> {
  let offset = 0;
  while (offset < source.length) {
    let restart = false;
    for (const { token, index } of wikiInlineTokens(source.slice(offset))) {
      if (/^https?:\/\//i.test(token)) {
        const separator = token.indexOf('||');
        if (separator >= 0) {
          // The inline URL scanner can swallow following cells, including code.
          // Resume after that delimiter so those cells get their own tokens.
          offset += index + separator + 2;
          restart = true;
          break;
        }
      } else yield { token, index: offset + index };
    }
    if (!restart) break;
  }
}

export function cellDirectives(value: string) {
  const attributes: string[] = [];
  let tokens: ReturnType<typeof protectedTokens> | undefined;
  let token: { token: string; index: number } | undefined;
  let length = 0;
  while (value[length] === '<') {
    const remaining = value.slice(length);
    // All complete prefixes are opaque, including unsupported directives.
    // A > inside code, a link or a note cannot expose a hidden active body.
    if (!tokens) { tokens = protectedTokens(value); token = tokens.next().value; }
    let close = -1;
    for (const marker of remaining.matchAll(/[<>\r\n]/g)) {
      if (!marker.index) continue;
      const at = length + marker.index;
      while (token && token.index + token.token.length <= at) token = tokens.next().value;
      if (token && token.index <= at && token.index + token.token.length > at) continue;
      if (marker[0] === '>') close = marker.index;
      break;
    }
    if (close < 0) {
      // Preserve the legacy incomplete plain-text prefix behavior. Recognized
      // role/layout/color names have no safe body boundary when unterminated.
      const malformedDirective = /^<(?:#|[a-z][a-z0-9_-]*[ \t]*=|(?:table(?:class|width|align|bgcolor|color|bordercolor)|(?:row|col)?(?:bgcolor|color|bordercolor))\b)/i.test(remaining);
      return { prefix: value.slice(0, length), attributes, malformedDirective };
    }
    const end = close + 1 + (remaining.slice(close + 1).match(/^[ \t]*/)?.[0].length || 0);
    attributes.push(remaining.slice(1, close));
    length += end;
  }
  return { prefix: value.slice(0, length), attributes, malformedDirective: false };
}

/** Opaque directive ranges in a physical table row, for enclosing fold fences.
 * Uses the same token/separator/prefix rules as cell parsing; no role regex copy. */
export function tableDirectiveRanges(line: string, offset = 0): { start: number; end: number }[] {
  const first = line.slice(offset).match(/^\s*\|\|/);
  if (!first) return [];
  const bodyStart = offset + first[0].length;
  const ranges: { start: number; end: number }[] = [];
  const source = line.slice(bodyStart);
  const tokens = protectedTokens(source);
  let token = tokens.next().value, start = 0;
  function cell(end: number) {
    const raw = source.slice(start, end), value = raw.trimStart();
    if (!value.startsWith('<')) return;
    const directives = cellDirectives(value);
    const length = directives.malformedDirective ? value.length : directives.prefix.length;
    if (length) {
      const at = bodyStart + start + raw.length - value.length;
      ranges.push({ start: at, end: at + length });
    }
  }
  for (let at = source.indexOf('||'); at >= 0;) {
    while (token && token.index + token.token.length <= at) token = tokens.next().value;
    if (token && token.index < at + 2 && token.index + token.token.length > at) {
      at = source.indexOf('||', token.index + token.token.length);
      continue;
    }
    cell(at);
    start = at + 2;
    at = source.indexOf('||', start);
  }
  if (start < source.length) cell(source.length);
  return ranges;
}
