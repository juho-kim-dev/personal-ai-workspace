/** Runtime address contract. Exact prefixes only; the main namespace has no prefix. */
export const WIKI_NAMESPACES = ['PAW Wiki', '틀', '분류', '파일', '템플릿', '프로젝트'] as const;
export type WikiNamespace = '' | typeof WIKI_NAMESPACES[number];

export function normalizeWikiTitle(value: string): string { return value.trim().normalize('NFC'); }

/** Preserve the existing storage limits, including pipes, brackets and backslashes. */
export function validWikiTitle(value: string): boolean {
  return !!value && value.length <= 180 && !/[\x00-\x1f\x7f#<>]/.test(value);
}

export function isWikiNamespace(value: string): value is Exclude<WikiNamespace, ''> {
  return (WIKI_NAMESPACES as readonly string[]).includes(value);
}

export function wikiNamespace(value: string): WikiNamespace {
  const title = normalizeWikiTitle(value), at = title.indexOf(':');
  const prefix = at < 0 ? '' : title.slice(0, at);
  return isWikiNamespace(prefix) ? prefix : '';
}
