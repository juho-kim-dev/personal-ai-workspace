import { parseWikiInclude, redirectTarget } from './wiki-text';
import { splitWikiTarget } from './wiki-navigation';
import { validWikiTitle } from './wiki-title';
import { scanWikiSource, wikiCellKey, WIKI_STRUCTURE_DEPTH, type WikiSource } from './wiki-source';

export const INCLUDE_LIMITS = { depth: 8, count: 50, characters: 500000, redirects: 8, sourceCharacters: 500000 } as const;
export type IncludeResult = {
  /** The original call title, including for redirects and failures. */
  title: string;
  /** Final source title for expanded-source links, after resolving a redirected call. */
  resolvedTitle?: string;
  /** Followed destinations in order, excluding the call title; also kept on failure. */
  redirects?: string[];
  error?: string;
  document?: IncludeDocument;
};
export type IncludeDocument = { content: string; includes: Map<number, IncludeResult>; folds: Map<number, IncludeDocument>; cells: Map<string, IncludeDocument>; source: WikiSource };

function templateTitle(target: string): string | null {
  const { title } = splitWikiTarget(target);
  // Do not trim the local name: "틀: A" and "틀:A" are different stored titles.
  // redirectTarget already decodes link syntax; validate the exact stored title.
  // Reject even a trailing empty # rather than silently including the whole page.
  if (target.includes('#') || !validWikiTitle(title) ||
    !title.startsWith('틀:') || !title.slice(2).trim()) return null;
  return title;
}

/** Build a deterministic bounded plan before React renders children. Never fetches.
 * Values become wiki source, never HTML. Parameter delimiter escapes/engine functions are
 * deliberately unsupported. Unknown parameters stay literal without a default. */
export function planWikiIncludes(content: string, sources: Record<string, string> = {}, documentTitle?: string): IncludeDocument {
  let count = 0, characters = 0, sourceCharacters = 0;
  function resolve(entry: IncludeResult, stack: string[]) {
    let title = templateTitle(entry.title);
    if (!title) { entry.error = '지원하지 않는 틀 포함 문법입니다.'; return; }
    const path: string[] = [];
    while (true) {
      if (stack.includes(title) || path.includes(title)) { entry.error = '순환하는 틀 포함 또는 넘겨주기입니다.'; return; }
      path.push(title);
      const template = Object.hasOwn(sources, title) ? sources[title] : undefined;
      if (typeof template !== 'string') { entry.error = '틀 원문을 찾을 수 없습니다.'; return; }
      // Charge every source before parsing, including failed redirects and sources
      // whose parameters shrink them. Repeated calls cannot reset this work budget.
      if (template.length > INCLUDE_LIMITS.sourceCharacters - sourceCharacters) { entry.error = '틀 원문 처리 분량 제한을 초과했습니다.'; return; }
      if (template.length > INCLUDE_LIMITS.characters - characters) { entry.error = '틀 포함 분량 제한을 초과했습니다.'; return; }
      sourceCharacters += template.length;
      const target = redirectTarget(template);
      if (target === null) {
        // redirectTarget returns null for both ordinary text and unsafe/empty
        // directives. The latter must produce a notice instead of rendering as text.
        if (/^\s*#(?:redirect|넘겨주기)(?=\s|$)/i.test(template)) {
          characters += template.length;
          entry.error = '지원하지 않는 틀 넘겨주기 대상입니다.'; return;
        }
        if (entry.redirects) entry.resolvedTitle = title;
        return { template, stack: [...stack, ...path] };
      }
      // Redirect bodies are not rendered, but still consume the shared expansion
      // allowance in full, including ignored lines after the directive.
      characters += template.length;
      const destination = templateTitle(target);
      if (!destination) { entry.error = '지원하지 않는 틀 넘겨주기 대상입니다. 틀 이름공간의 전체 문서만 포함할 수 있습니다.'; return; }
      if ((entry.redirects?.length ?? 0) >= INCLUDE_LIMITS.redirects) { entry.error = '틀 넘겨주기 횟수 제한을 초과했습니다.'; return; }
      (entry.redirects ??= []).push(destination);
      title = destination;
    }
  }
  function document(source: string, stack: string[], includeDepth: number, structureDepth: number): IncludeDocument {
    const scanned = scanWikiSource(source, structureDepth);
    const result: IncludeDocument = { content: source, includes: new Map(), folds: new Map(), cells: new Map(), source: scanned };
    const { lines, blocks } = scanned;
    for (let i = 0; i < lines.length;) {
      const block = blocks.get(i);
      if (block) {
        if (block.kind === 'fence') {
          const fence = block.fence;
          if (fence.kind === 'folding' && structureDepth < WIKI_STRUCTURE_DEPTH) {
            result.folds.set(i, document(fence.body, stack, includeDepth, structureDepth + 1));
          }
        } else if (block.table) {
          block.table.rows.forEach((row, rowIndex) => {
            for (const cell of row) if (cell.block) {
              result.cells.set(wikiCellKey(i, rowIndex, cell.column), document(cell.text, stack, includeDepth, structureDepth + 1));
            }
          });
        }
        i = block.end; continue;
      }
      const at = i++, call = parseWikiInclude(lines[at]);
      if (!call) continue;
      const entry: IncludeResult = { title: call.title };
      result.includes.set(at, entry);
      if (!call.valid) { entry.error = '지원하지 않는 틀 포함 문법입니다.'; continue; }
      if (count >= INCLUDE_LIMITS.count) { entry.error = '틀 포함 개수 제한을 초과했습니다.'; continue; }
      count++;
      if (stack.includes(call.title.trim().normalize('NFC'))) { entry.error = '순환하는 틀 포함입니다.'; continue; }
      // Redirect aliases and the host participate in cycles, but not include depth.
      if (includeDepth >= INCLUDE_LIMITS.depth || structureDepth >= WIKI_STRUCTURE_DEPTH) { entry.error = '틀 포함 깊이 제한을 초과했습니다.'; continue; }
      const resolved = resolve(entry, stack);
      if (!resolved) continue;
      let size = 0, over = false;
      const expanded = resolved.template.replace(/@([A-Za-z0-9_가-힣-]+)(?:=([^@\n]*))?@/g, (token, key: string, fallback: string | undefined) => {
        const value = Object.hasOwn(call.parameters, key) ? call.parameters[key] : fallback ?? token;
        size += value.length;
        if (size > INCLUDE_LIMITS.characters - characters) { over = true; return ''; }
        return value;
      });
      if (over || expanded.length > INCLUDE_LIMITS.characters - characters) { entry.error = '틀 포함 분량 제한을 초과했습니다.'; continue; }
      characters += expanded.length;
      entry.document = document(expanded, resolved.stack, includeDepth + 1, structureDepth + 1);
    }
    return result;
  }
  return document(content, documentTitle ? [documentTitle.trim().normalize('NFC')] : [], 0, 0);
}
