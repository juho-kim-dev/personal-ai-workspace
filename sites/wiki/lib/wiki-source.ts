import { wikiFenceAt, type WikiFence } from './wiki-fence';
import { wikiTableAt, type WikiTableBlock } from './wiki-table';

/** One shared recursion budget for include documents, folds and block cells. */
export const WIKI_STRUCTURE_DEPTH = 8;
export type WikiSourceBlock =
  | { kind: 'fence'; end: number; fence: WikiFence }
  | { kind: 'table'; end: number; table: WikiTableBlock | null };
export type WikiSource = { lines: string[]; blocks: Map<number, WikiSourceBlock>; depth: number };

/** Source positions always refer to original physical lines in this scope.
 * Rejected tables/fences still own their entire literal range. */
export function scanWikiSource(content: string, depth = 0): WikiSource {
  const lines = content.split('\n'), blocks = new Map<number, WikiSourceBlock>();
  for (let at = 0; at < lines.length;) {
    const fence = wikiFenceAt(lines, at);
    if (fence) {
      blocks.set(at, { kind: 'fence', end: fence.end, fence });
      at = fence.end;
      continue;
    }
    const table = wikiTableAt(lines, at);
    if (table) {
      if (depth >= WIKI_STRUCTURE_DEPTH && table.table?.rows.some(row => row.some(cell => cell.block))) table.table = null;
      blocks.set(at, { kind: 'table', ...table });
      at = table.end;
      continue;
    }
    at++;
  }
  return { lines, blocks, depth };
}

export function wikiCellKey(line: number, row: number, column: number): string {
  return `${line}-${row}-${column}`;
}
