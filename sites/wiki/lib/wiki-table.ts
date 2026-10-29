import { parseWikiMedia } from './wiki-media';
import { wikiColor, wikiColorStyle, type WikiColor, type WikiColorProperty } from './wiki-inline-style';
import { wikiFenceAt } from './wiki-fence';
import { cellDirectives, protectedTokens } from './wiki-table-tokens';
import { parseWikiReference } from './wiki-reference';

// Local compatibility limits, not upstream Namumark limits. Reject rather than
// clamp so a misspelled directive never silently changes the table's geometry.
export const WIKI_TABLE_ROWS = 256;
export const WIKI_TABLE_COLUMNS = 64;
export const WIKI_TABLE_SPAN = 12;
export const WIKI_TABLE_ROW_LINES = 256;
export const WIKI_TABLE_ROW_CHARACTERS = 65536;
export const WIKI_TABLE_WIDTH_PX = 1600;

type CellStyle = {
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  backgroundColor?: string;
  color?: string;
  borderColor?: string;
  [key: `--wiki-${string}`]: string;
};
type Colors = Partial<Record<WikiColorProperty, WikiColor>>;
export type WikiTableCell = {
  text: string;
  role?: 'section' | 'caption';
  /** Only protected multiline cells create a local document scope. */
  block?: boolean;
  literal: string;
  column: number;
  colSpan: number;
  rowSpan: number;
  style: CellStyle;
};
// A small Wiki42 presentation extension, not arbitrary CSS classes or Namumark.
export type WikiTablePresentation = 'notice' | 'navbox' | 'infobox' | 'figure';
export type WikiTableLayout = { width?: string; align?: 'left' | 'center' | 'right' };
export type WikiTableBlock = {
  rows: WikiTableCell[][];
  presentation: WikiTablePresentation | null;
  variant?: 'plain' | 'grid' | 'columns';
  layout?: WikiTableLayout;
  style?: CellStyle;
};

type SourceCell = { text: string; block: boolean };
type SourceRow = { cells: SourceCell[]; end: number; valid: boolean };

/** A logical row extends only for an explicit cell-body fence. Token boundaries
 * come from the inline renderer; raw URLs alone do not protect separators. */
function tableRowAt(lines: string[], start: number): SourceRow {
  const cells: SourceCell[] = [];
  let line = start, offset = lines[start].indexOf('||') + 2;
  let source = lines[line].slice(offset).trimEnd();
  let from = 0, cursor = 0, parts: string[] = [], block = false, valid = true;
  let tokens = protectedTokens(source), token = tokens.next().value;
  let lastSeparator = false;
  let eligible: { body: boolean; malformed: boolean } | undefined;
  let separator = source.indexOf('||');
  for (;;) {
    if (token && (separator < 0 || token.index < separator + 2)) {
      const at = token.index;
      // Deliberately narrow openers: arbitrary unclosed inline triples, links,
      // notes and backticks never claim following document lines.
      if (/^\{\{\{(?:#!|[ \t]*$)/.test(token.token)) {
        if (!eligible) {
          const prefix = source.slice(from, at).trim();
          const directives = cellDirectives(prefix);
          eligible = { body: !prefix || directives.prefix.length === prefix.length, malformed: directives.malformedDirective };
        }
        if (eligible.body || eligible.malformed) {
          const fence = wikiFenceAt(lines, line, offset + at);
          if (fence) {
            valid &&= !eligible.malformed;
            if (!fence.closed) return { cells: [], end: fence.end, valid: false };
            parts.push(source.slice(from, at), lines[line].slice(offset + at));
            for (let next = line + 1; next < fence.end - 1; next++) parts.push('\n', lines[next]);
            parts.push('\n', lines[fence.end - 1].slice(0, fence.closeColumn));
            line = fence.end - 1;
            offset = fence.closeColumn;
            if (!/^\s*\}\}\}$/.test(lines[line].slice(0, offset))) valid = false;
            source = lines[line].slice(offset).trimEnd();
            // A block must finish its cell. Reject ambiguous suffixes visibly.
            if (source.trimStart() && !source.trimStart().startsWith('||')) valid = false;
            from = cursor = 0; block = true; lastSeparator = false; eligible = { body: false, malformed: false };
            tokens = protectedTokens(source); token = tokens.next().value;
            separator = source.indexOf('||');
            continue;
          }
        }
      }
      if (eligible) eligible.body = false;
      cursor = at + token.token.length;
      // A token before the next separator does not change that separator.
      // Search again only when the token actually owns/skips it; otherwise a
      // long one-cell row would rescan the same suffix for every inline token.
      if (separator >= 0 && separator < cursor) separator = source.indexOf('||', cursor);
      token = tokens.next().value;
      continue;
    }
    if (separator < 0) break;
    cells.push({ text: parts.join('') + source.slice(from, separator), block });
    parts = []; block = false; eligible = undefined;
    from = cursor = separator + 2;
    separator = source.indexOf('||', cursor);
    lastSeparator = from === source.length;
    if (cells.length > WIKI_TABLE_COLUMNS) valid = false;
    // Keep scanning rejected input to its structural end, without accumulating
    // unbounded cell objects. The caller still retains all original source.
    if (cells.length > WIKI_TABLE_COLUMNS + 1) cells.length = WIKI_TABLE_COLUMNS + 1;
  }
  if (!lastSeparator || !cells.length) cells.push({ text: parts.join('') + source.slice(from), block });
  const end = line + 1;
  if (end - start > WIKI_TABLE_ROW_LINES) valid = false;
  let characters = end - start - 1;
  for (let at = start; at < end; at++) characters += lines[at].length;
  // Preserve legacy single-line tables, including huge rejected prefixes.
  if (end - start > 1 && characters > WIKI_TABLE_ROW_CHARACTERS) valid = false;
  return { cells, end, valid: valid && cells.length <= WIKI_TABLE_COLUMNS };
}

/** Shared physical-line boundary. No consumer independently guesses table ends. */
export function wikiTableAt(lines: string[], start: number): { end: number; table: WikiTableBlock | null } | null {
  if (!/^\s*\|\|/.test(lines[start])) return null;
  const rows: SourceCell[][] = [];
  let end = start, valid = true;
  while (end < lines.length && /^\s*\|\|/.test(lines[end])) {
    const row = tableRowAt(lines, end);
    end = row.end;
    valid &&= row.valid;
    if (rows.length <= WIKI_TABLE_ROWS) rows.push(row.cells);
  }
  return { end, table: valid ? parseRows(rows) : null };
}

function tableWidth(value: string): string | null {
  const match = value.match(/^([1-9]\d{0,3})(px|%)?$/);
  if (!match || Number(match[1]) > (match[2] === '%' ? 100 : WIKI_TABLE_WIDTH_PX)) return null;
  return match[1] + (match[2] || 'px');
}

function parseCell(raw: string, implicitSpan: number, allowTableOptions: boolean) {
  const value = raw.trim();
  const { prefix, attributes, malformedDirective } = cellDirectives(value);
  const text = value.slice(prefix.length).trim();
  const style: CellStyle = {};
  const tableColors: Colors = {}, rowColors: Colors = {}, columnColors: Colors = {};
  const layout: WikiTableLayout = {};
  let presentation: WikiTablePresentation | null = null;
  let variant: WikiTableBlock['variant'];
  let role: WikiTableCell['role'];
  let colSpan = implicitSpan, rowSpan = 1, horizontal = false, vertical = false;
  let valid = implicitSpan <= WIKI_TABLE_SPAN && !malformedDirective;
  for (const attribute of attributes) {
    const horizontalSpan = attribute.match(/^(?:-|colspan=)([1-9]\d{0,4})$/);
    const verticalSpan = attribute.match(/^([\^v]?)\|([1-9]\d{0,4})$/);
    if (attribute === 'tableclass=notice' || attribute === 'tableclass=navbox' || attribute === 'tableclass=infobox' || attribute === 'tableclass=figure') {
      if (!allowTableOptions || presentation) valid = false;
      presentation = attribute.slice('tableclass='.length) as WikiTablePresentation;
    } else if (attribute.startsWith('tablestyle=')) {
      const value = attribute.slice('tablestyle='.length);
      if (!allowTableOptions || variant || !['plain', 'grid', 'columns'].includes(value)) valid = false;
      else variant = value as WikiTableBlock['variant'];
    } else if (attribute.startsWith('cellrole=')) {
      const value = attribute.slice('cellrole='.length);
      if (role || !['section', 'caption'].includes(value)) valid = false;
      else role = value as WikiTableCell['role'];
    } else if (attribute.startsWith('tablewidth=')) {
      const width = tableWidth(attribute.slice('tablewidth='.length));
      if (!allowTableOptions || layout.width || !width) valid = false;
      else layout.width = width;
    } else if (attribute.startsWith('tablealign=')) {
      const align = attribute.slice('tablealign='.length);
      if (!allowTableOptions || layout.align || !/^(?:left|center|right)$/.test(align)) valid = false;
      else layout.align = align as WikiTableLayout['align'];
    } else if (horizontalSpan) {
      const count = Number(horizontalSpan[1]);
      if (horizontal || count > WIKI_TABLE_SPAN) valid = false;
      horizontal = true;
      colSpan = count;
    } else if (verticalSpan) {
      const count = Number(verticalSpan[2]);
      if (vertical || count > WIKI_TABLE_SPAN) valid = false;
      vertical = true;
      rowSpan = count;
      style.verticalAlign = verticalSpan[1] === '^' ? 'top' : verticalSpan[1] === 'v' ? 'bottom' : 'middle';
    } else if (attribute === '(') style.textAlign = 'left';
    else if (attribute === ':') style.textAlign = 'center';
    else if (attribute === ')') style.textAlign = 'right';
    else if (attribute === '^') style.verticalAlign = 'top';
    else if (attribute === 'v') style.verticalAlign = 'bottom';
    else {
      const color = attribute.match(/^(table|row|col)?(bgcolor|color|bordercolor)=(.*)$/);
      const parsed = wikiColor(color ? color[3] : attribute.startsWith('#') ? attribute : '');
      if (!parsed) { valid = false; continue; }
      const property = color?.[2] === 'color' ? 'color' : color?.[2] === 'bordercolor' ? 'borderColor' : 'backgroundColor';
      const scope = color?.[1];
      // Borders are table-wide only; cell/row/column border dialects stay literal.
      if (property === 'borderColor' && scope !== 'table') { valid = false; continue; }
      if (!scope) Object.assign(style, wikiColorStyle(parsed, property));
      else {
        const target = scope === 'table' ? tableColors : scope === 'row' ? rowColors : columnColors;
        if ((scope === 'table' && !allowTableOptions) || target[property]) valid = false;
        else target[property] = parsed;
      }
    }
  }
  // Do not consume table options ahead of an incomplete directive.
  // Existing plain-cell prefix behavior is unchanged.
  if ((presentation || Object.keys(layout).length || Object.keys(tableColors).length) && text.startsWith('<')) valid = false;
  // Rejected prefixes stay React text, never pass through the inline tokenizer.
  // A malformed directive has no body boundary, so keep the entire cell opaque.
  const rejected = (): WikiTableCell => ({
    text: malformedDirective ? '' : text,
    literal: '||'.repeat(implicitSpan - 1) + (malformedDirective ? value : prefix),
    column: 0, colSpan: 1, rowSpan: 1, style: {},
  });
  return {
    cell: { text, literal: '', column: 0, colSpan, rowSpan, style, ...(role ? { role } : {}) } as WikiTableCell,
    presentation, variant, layout, tableColors, rowColors, columnColors, valid, rejected,
  };
}

/** null means render the complete original table as literal text. No truncation.
 * Each row starts at the first free slot; a colspan may not bridge a live rowspan.
 * Reject conflicting cell directives together, preserving their literal spelling.
 */
function parseRows(lines: SourceCell[][]): WikiTableBlock | null {
  if (lines.length > WIKI_TABLE_ROWS) return null;
  const occupiedUntil = Array<number>(WIKI_TABLE_COLUMNS).fill(0);
  const rows: WikiTableCell[][] = [];
  let presentation: WikiTablePresentation | null = null;
  let variant: WikiTableBlock['variant'];
  let layout: WikiTableLayout | undefined;
  let tableColors: Colors = {};
  const columnColors = new Map<number, Colors>();
  for (let row = 0; row < lines.length; row++) {
    const source = lines[row];
    if (!source) return null;
    const cells: WikiTableCell[] = [];
    const rowColors: Colors = {};
    let column = 0, implicitSpan = 1;
    for (let index = 0; index < source.length; index++) {
      if (!source[index].text && index < source.length - 1) { implicitSpan++; continue; }
      while (column < WIKI_TABLE_COLUMNS && occupiedUntil[column] > row) column++;
      if (column >= WIKI_TABLE_COLUMNS) return null;
      // The literal first source cell owns the declaration, including when
      // empty source cells would otherwise become an implicit colspan.
      const parsed = parseCell(source[index].text, implicitSpan, row === 0 && index === 0);
      let cell = parsed.cell;
      if (!parsed.valid || Object.keys(parsed.rowColors).some(property => Object.hasOwn(rowColors, property))
        || row + cell.rowSpan > lines.length
        || column + cell.colSpan > WIKI_TABLE_COLUMNS
        || occupiedUntil.slice(column, column + cell.colSpan).some(until => until > row)) cell = parsed.rejected();
      else {
        if (parsed.presentation) presentation = parsed.presentation;
        if (parsed.variant) variant = parsed.variant;
        if (Object.keys(parsed.layout).length) layout = parsed.layout;
        if (Object.keys(parsed.tableColors).length) tableColors = parsed.tableColors;
        Object.assign(rowColors, parsed.rowColors);
        // A column declaration starts here and continues down this actual grid
        // column. A merged cell selects its starting column, not hidden slots.
        if (Object.keys(parsed.columnColors).length) columnColors.set(column, { ...columnColors.get(column), ...parsed.columnColors });
      }
      if (source[index].block && cell.text) cell.block = true;
      cell.column = column;
      for (let slot = column; slot < column + cell.colSpan; slot++) occupiedUntil[slot] = row + cell.rowSpan;
      column += cell.colSpan;
      cells.push(cell);
      implicitSpan = 1;
    }
    for (const cell of cells) {
      // Resolve each property independently. Header defaults remain CSS defaults
      // when no source color exists; alignment never disables those defaults.
      const inherited = { ...tableColors, ...rowColors, ...columnColors.get(cell.column) };
      for (const property of Object.keys(inherited) as WikiColorProperty[]) {
        if (cell.style[property] === undefined) Object.assign(cell.style, wikiColorStyle(inherited[property]!, property));
      }
    }
    rows.push(cells);
  }
  const columns = Math.max(0, ...rows.flat().map(cell => cell.column + cell.colSpan));
  if (rows.some(row => row.some(cell => cell.role && (presentation !== 'infobox'
    || row.length !== 1 || cell.column !== 0 || cell.colSpan !== columns || cell.rowSpan !== 1)))) return null;
  if (variant === 'columns') {
    // Column navigation has label/content pairs, never merged data cells.
    if (presentation !== 'navbox' || rows.some(row => row.length !== 2
      || row.some(cell => cell.colSpan !== 1 || cell.rowSpan !== 1 || cell.role))) return null;
  } else if (variant && presentation !== 'infobox') return null;
  if (presentation === 'figure') {
    // Keep scanning and rendering aligned: one local image or validated video and one inline caption.
    if (rows.length !== 2 || rows.some(row => row.length !== 1 || row[0].colSpan !== 1
      || row[0].rowSpan !== 1 || row[0].block || row[0].literal)) return null;
    const image = parseWikiReference(rows[0][0].text);
    if (!parseWikiMedia(rows[0][0].text) && (image?.kind !== 'file' || !/\.(png|jpe?g|webp|gif)$/i.test(image.target.slice(3).trim()))) return null;
  }
  return {
    rows, presentation, ...(variant ? { variant } : {}), ...(layout ? { layout } : {}),
    ...(tableColors.borderColor ? { style: wikiColorStyle(tableColors.borderColor, 'borderColor') } : {}),
  };
}

/** Accept physical source lines, preserving the established rows/null API. */
export function parseWikiTableBlock(lines: string[]): WikiTableBlock | null {
  if (!lines.length) return { rows: [], presentation: null };
  const block = wikiTableAt(lines, 0);
  return block?.end === lines.length ? block.table : null;
}

/** Compatibility API for consumers that only need the table grid. */
export function parseWikiTable(lines: string[]): WikiTableCell[][] | null {
  return parseWikiTableBlock(lines)?.rows ?? null;
}
