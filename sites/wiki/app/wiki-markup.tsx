'use client';

import * as React from 'react';
import { useState } from 'react';
import { parseWikiHeadings, wikiLabelText as labelText } from '../lib/wiki-text';
import { modifiedLinkClick, splitWikiTarget, wikiHref } from '../lib/wiki-navigation';
import { planWikiIncludes, type IncludeDocument } from '../lib/wiki-include';
import { WIKI_ANCHOR_LIMIT, WIKI_INLINE_DEPTH, wikiAnchorName, wikiInlineStyle, wikiInlineTokens, wikiNoteBody } from '../lib/wiki-inline-style';
import { parseWikiReference, safeWikiURL as safeURL } from '../lib/wiki-reference';
import { type WikiTableBlock } from '../lib/wiki-table';
import { parseWikiMedia } from '../lib/wiki-media';
import { WikiMedia } from './components/wiki-media';
import { wikiCellKey } from '../lib/wiki-source';
import './wiki-markup.css';

export const headings = parseWikiHeadings;
export type WikiMarkupProps = {
  sources?: Record<string, string>;
  documentTitle?: string;
  content: string;
  open: (target: string, view?: string) => void;
  linkViews?: Record<string, string>;
  edit?: (line: number) => void;
  known?: string[];
  idPrefix?: string;
  commentHref?: (number: number) => string | null;
};
const tocMacro = /^\s*\[(?:목차|tableofcontents)\]\s*$/i;
const listPattern = /^(\s*)([*+-]|\d+[.)]|[aAiI]\.)\s+(.+)$/;

function categoryOnlyLine(line: string): boolean {
  let end = 0, found = false;
  for (const { token, index } of wikiInlineTokens(line)) {
    if (line.slice(end, index).trim() || parseWikiReference(token)?.kind !== 'category') return false;
    found = true;
    end = index + token.length;
  }
  return found && !line.slice(end).trim();
}

type Note = { number: number; name?: string; body: string; references: string[] };
type ListItem = { text: string; children: ListGroup[] };
type ListGroup = { ordered: boolean; style?: 'a' | 'A' | 'i' | 'I'; start?: number; items: ListItem[] };

export function WikiMarkup(props: WikiMarkupProps) {
  return <MarkupDocument {...props} layoutRoot includePlan={planWikiIncludes(props.content, props.sources, props.documentTitle)} />;
}

function tablePlacement(table: WikiTableBlock, allowFloat: boolean) {
  const infobox = table.presentation === 'infobox';
  const figure = table.presentation === 'figure';
  if (!table.layout && !infobox && !figure) return {};
  return {
    className: `wiki-table-layout${infobox ? ' wiki-infobox' : figure ? ' wiki-figure' : ''}${infobox && allowFloat ? ' wiki-infobox-float' : figure && allowFloat ? ' wiki-figure-float' : ''}`,
    'data-table-align': table.layout?.align ?? (infobox || figure ? 'right' : 'left'),
    style: { '--wiki-table-width': table.layout?.width ?? (infobox ? '320px' : figure ? '240px' : '100%') } as React.CSSProperties,
  };
}

/** Only the leading table in this document can opt its entire include into
 * layout. Never look through a nested include, fold, cell or rejected table. */
function leadingInfobox(document: IncludeDocument) {
  const { lines, blocks } = document.source;
  const start = lines.findIndex(line => line.trim() && !categoryOnlyLine(line));
  const block = blocks.get(start);
  return block?.kind === 'table' && (block.table?.presentation === 'infobox' || block.table?.presentation === 'figure')
    ? { start, table: block.table } : null;
}

function MarkupDocument({ content, documentTitle, open, edit, known = [], idPrefix = '', commentHref, linkViews, includePlan, layoutRoot = false, ownedTable }: WikiMarkupProps & {
  includePlan: IncludeDocument;
  layoutRoot?: boolean;
  ownedTable?: number;
}) {
  const prefix = idPrefix ? `${encodeURIComponent(idPrefix)}-` : '';
  const notePrefix = `${prefix}note-`;
  const id = (value: string) => prefix + value;
  const hs = parseWikiHeadings(content, includePlan.source);
  const byLine = new Map(hs.map(h => [h.index, h]));
  const { lines, blocks: sourceBlocks } = includePlan.source;
  const existing = new Set(known.map(title => title.normalize('NFC')));
  const notes: Note[] = [];
  const namedNotes = new Map<string, Note>();
  const namedAnchors = new Set<string>();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expandedFolds, setExpandedFolds] = useState<Set<number>>(() => new Set());
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const tocId = id('toc');
  let tocPlaced = false;

  function renderToc() {
    return hs.length > 0 ? <nav className="toc" id={tocId} key="toc" aria-label="문서 목차"><div className="toc-heading"><strong className="toc-label">목차</strong><button type="button" aria-expanded={!tocCollapsed} aria-controls={id('toc-list')} onClick={() => setTocCollapsed(value => !value)}>{tocCollapsed ? '펼치기' : '숨기기'}</button></div><ol id={id('toc-list')} hidden={tocCollapsed}>{hs.map(h => <li key={h.id} style={{ paddingInlineStart: (h.level - 1) * 17 }}><a href={`#${encodeURIComponent(id(h.id))}`} onClick={event => localClick(event, id(h.id))}>{h.number}. {labelText(h.text)}</a></li>)}</ol></nav> : null;
  }

  function scrollTo(anchor: string) {
    if (anchor === tocId) setTocCollapsed(false);
    const target = document.getElementById(anchor);
    if (!target) return;
    // Reveal each independent fold containing the target before scrolling.
    const ancestors: string[] = [];
    let parent: HTMLElement | null = target;
    while (parent) {
      if (parent.dataset.wikiSection) ancestors.push(parent.dataset.wikiSection);
      parent.querySelector?.<HTMLButtonElement>(':scope > .folding-controls > button[aria-expanded="false"]')?.click();
      parent = parent.parentElement;
    }
    setCollapsed(previous => new Set([...previous].filter(value => !ancestors.includes(value))));
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: 'instant' }));
  }
  function localClick(event: React.MouseEvent<HTMLAnchorElement>, target: string) {
    if (modifiedLinkClick(event)) return;
    event.preventDefault();
    scrollTo(target);
  }
  function internalLink(target: string, label: React.ReactNode, key: string) {
    const { title, anchor } = splitWikiTarget(target);
    const local = !title && !!anchor;
    const targetId = id(anchor);
    const view = !anchor ? linkViews?.[title] : undefined;
    return <a key={key} href={local ? `#${encodeURIComponent(targetId)}` : wikiHref(target, view)}
      data-wiki-preview={!local && !view ? target : undefined}
      className={title && !view && !existing.has(title) ? 'missing' : undefined}
      aria-current={title === documentTitle && !anchor ? 'page' : undefined}
      onClick={event => {
        if (modifiedLinkClick(event)) return;
        event.preventDefault();
        if (local) scrollTo(targetId); else open(target, view);
      }}>{label}</a>;
  }
  function externalLink(href: string, label: React.ReactNode, key: string) {
    return <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="external-link">
      {label}<span className="wiki-external-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7M21 3 10 14"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg></span>
      <span className="wiki-link-hint"> (외부 링크, 새 탭에서 열림)</span>
    </a>;
  }
  function fileLink(target: string, options: string | undefined, key: string) {
    const name = target.slice(3).trim();
    if (!name) return <span key={key}>[[{target}]]</span>;
    const href = `/api/files?name=${encodeURIComponent(name)}`;
    const widthOption = options?.match(/(?:^|&)width=(\d{1,5})(%?)(?:&|$)/i);
    const width = widthOption ? Math.max(1, Math.min(Number(widthOption[1]), widthOption[2] ? 100 : 1600)) : undefined;
    if (/\.(?:png|jpe?g|webp|gif)$/i.test(name)) return <a key={key} href={href} className="wiki-file" target="_blank" rel="noopener noreferrer">
      <img src={href} alt={name} loading="lazy" decoding="async" style={width ? { width: widthOption?.[2] ? `${width}%` : width } : undefined} />
    </a>;
    return <a key={key} href={href} className="wiki-attachment" download={name}>{name}</a>;
  }

  function inline(text: string, keyPrefix: string, nesting = 0, allowNotes = true, links = true): React.ReactNode[] {
    if (nesting >= WIKI_INLINE_DEPTH) return [text];
    const output: React.ReactNode[] = [];
    // Only this allowlist produces elements. Everything else remains React text.
    let last = 0;
    for (const { token, index: at } of wikiInlineTokens(text)) {
      const key = `${keyPrefix}-${at}`;
      if (at > last) output.push(text.slice(last, at));
      last = at + token.length;
      const child = (value: string) => inline(value, key, nesting + 1, allowNotes, links);
      if (token.startsWith('\\')) output.push(token.slice(1));
      else if (token.startsWith('{{{')) {
        const styled = wikiInlineStyle(token);
        if (styled) output.push(<span key={key} className="wiki-inline-style" style={styled.style}>{child(styled.body)}</span>);
        else output.push(<code key={key}>{/^\{\{\{[#+-][^\s]*[ \t]/.test(token) || !token.endsWith('}}}') ? token : token.slice(3, -3)}</code>);
      }
      else if (token.startsWith('`')) {
        const delimiter = token.match(/^`+/)![0];
        const closed = token.length >= delimiter.length * 2 && token.endsWith(delimiter);
        output.push(<code key={key}>{closed ? token.slice(delimiter.length, -delimiter.length) : token}</code>);
      }
      else if (/^\[anchor\(/i.test(token)) {
        const name = wikiAnchorName(token);
        if (links && name && namedAnchors.size < WIKI_ANCHOR_LIMIT && !namedAnchors.has(name)) {
          namedAnchors.add(name);
          output.push(<span key={key} id={id(name)} className="wiki-named-anchor" />);
        } else output.push(token);
      }
      else if (token.startsWith('#')) { const href=links&&commentHref?.(Number(token.slice(1))); output.push(href ? <a key={key} href={href}>{token}</a> : token); }
      else if (token.startsWith('[[')) {
        const reference = parseWikiReference(token);
        if (!reference) { output.push(token); continue; }
        const { target, label, kind } = reference;
        if (kind === 'category') continue;
        if (!links) { output.push(label ?? target); continue; }
        if (kind === 'invalid') { output.push(token); continue; }
        if (kind === 'file') { output.push(fileLink(target, label, key)); continue; }
        const children = label === undefined ? target : inline(label, key, nesting + 1, false, false);
        if (kind === 'external') output.push(externalLink(safeURL(target)!, children, key));
        else output.push(internalLink(target, children, key));
      } else if (token.startsWith('[*') && allowNotes && links) {
        const value = wikiNoteBody(token);
        if (value === null) { output.push(token); continue; }
        const definition = value.match(/^(\S+)(?:\s+([\s\S]*))?$/);
        const name = /^\s/.test(value) ? undefined : definition?.[1];
        const body = name ? definition?.[2] || '' : value.trim();
        let note = name ? namedNotes.get(name) : undefined;
        if (!note) {
          note = { number: notes.length + 1, name, body, references: [] };
          notes.push(note);
          if (name) namedNotes.set(name, note);
        } else if (!note.body && body) note.body = body;
        const ref = `${notePrefix}ref-${note.number}-${note.references.length + 1}`;
        note.references.push(ref);
        const destination = `${notePrefix}${note.number}`;
        output.push(<sup key={key} id={ref} className="wiki-note-ref"><a href={`#${encodeURIComponent(destination)}`} data-wiki-note={destination} onClick={event => localClick(event, destination)}>[{note.number}]</a></sup>);
      } else if (/^\[br\]$/i.test(token)) output.push(<br key={key} />);
      else if (/^\[(?:목차|tableofcontents)\]$/i.test(token)) output.push(links ? <a key={key} href={`#${encodeURIComponent(tocId)}`} onClick={event => localClick(event, tocId)}>목차</a> : token);
      else if (token.startsWith("'''''")) output.push(<strong key={key}><em>{child(token.slice(5, -5))}</em></strong>);
      else if (token.startsWith("'''") || token.startsWith('**')) output.push(<strong key={key}>{child(token.slice(token.startsWith("'''") ? 3 : 2, token.startsWith("'''") ? -3 : -2))}</strong>);
      else if (token.startsWith("''")) output.push(<em key={key}>{child(token.slice(2, -2))}</em>);
      else if (token.startsWith('~~') || token.startsWith('--')) output.push(<del key={key}>{child(token.slice(2, -2))}</del>);
      else if (token.startsWith('__')) output.push(<u key={key}>{child(token.slice(2, -2))}</u>);
      else if (token.startsWith('^^')) output.push(<sup key={key}>{child(token.slice(2, -2))}</sup>);
      else if (token.startsWith(',,')) output.push(<sub key={key}>{child(token.slice(2, -2))}</sub>);
      else if (/^\[?https?:\/\//i.test(token) && links) {
        const bracket = token.startsWith('['), value = bracket ? token.slice(1, -1) : token;
        const parts = value.match(/^(\S+)(?:\s+([\s\S]+))?$/)!;
        const trailing = bracket ? '' : parts[1].match(/[.,;!?]+$/)?.[0] || '';
        const address = trailing ? parts[1].slice(0, -trailing.length) : parts[1];
        const url = safeURL(address);
        output.push(url ? externalLink(url, parts[2] ? inline(parts[2], key, nesting + 1, false, false) : address, key) : token);
        if (trailing && url) output.push(trailing);
      } else output.push(token);
    }
    if (last < text.length) output.push(text.slice(last));
    return output;
  }

  function renderLists(start: number, end: number): React.ReactNode {
    const roots: ListGroup[] = [];
    const stack: { indent: number; group: ListGroup }[] = [];
    for (let line = start; line < end; line++) {
      const match = lines[line].match(listPattern)!;
      const indent = match[1].replace(/\t/g, '    ').length;
      const ordered = !/^[*+-]$/.test(match[2]);
      const style = /^[aAiI]/.test(match[2]) ? match[2][0] as ListGroup['style'] : undefined;
      while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
      const previous = stack[stack.length - 1];
      if (!previous || previous.indent < indent || previous.group.ordered !== ordered || previous.group.style !== style) {
        if (previous?.indent === indent) stack.pop();
        const parent = stack[stack.length - 1];
        const group: ListGroup = { ordered, style, start: ordered && /^\d/.test(match[2]) ? Math.min(1000000, Number.parseInt(match[2], 10)) : undefined, items: [] };
        if (parent && stack.length < 16) parent.group.items[parent.group.items.length - 1].children.push(group);
        else roots.push(group);
        if (stack.length >= 16) stack.length = 0;
        stack.push({ indent, group });
      }
      stack[stack.length - 1].group.items.push({ text: match[3], children: [] });
    }
    function groupNode(group: ListGroup, key: string): React.ReactNode {
      const children = group.items.map((item, i) => <li key={i}>{inline(item.text, `${key}-${i}`)}{item.children.map((nested, j) => groupNode(nested, `${key}-${i}-${j}`))}</li>);
      return group.ordered ? <ol className="wiki-body-list" key={key} type={group.style} start={group.start}>{children}</ol> : <ul className="wiki-body-list" key={key}>{children}</ul>;
    }
    return <React.Fragment key={start}>{roots.map((group, i) => groupNode(group, `list-${start}-${i}`))}</React.Fragment>;
  }
  function renderTable(start: number, end: number, table: WikiTableBlock | null) {
    const source = lines.slice(start, end);
    if (!table) return <pre className="wiki-table-literal" key={start}><code>{source.join('\n')}</code></pre>;
    const placement = ownedTable === start ? {} : tablePlacement(table, layoutRoot);
    if (table.presentation === 'figure') {
      return <div {...placement} className={`wiki-figure-wrap${placement.className ? ` ${placement.className}` : ''}`} key={start}>
        <figure style={table.style}>
          <div className="wiki-figure-image" style={table.rows[0][0].style}>{parseWikiMedia(table.rows[0][0].text) ? <WikiMedia source={table.rows[0][0].text}/> : inline(table.rows[0][0].text, `figure-${start}-image`)}</div>
          <figcaption style={table.rows[1][0].style}>{inline(table.rows[1][0].text, `figure-${start}-caption`)}</figcaption>
        </figure>
      </div>;
    }
    function cellContent(cell: WikiTableBlock['rows'][number][number], row: number) {
      const cellKey = wikiCellKey(start, row, cell.column);
      const cellPlan = includePlan.cells.get(cellKey);
      return <>{cell.literal}{cellPlan
        ? <div className="wiki-table-cell-block"><MarkupDocument documentTitle={documentTitle} content={cellPlan.content} includePlan={cellPlan}
          open={open} linkViews={linkViews} known={known} commentHref={commentHref} idPrefix={`${idPrefix ? `${idPrefix}-` : ''}cell-${cellKey}`} /></div>
        : !cell.literal && parseWikiMedia(cell.text) ? <WikiMedia source={cell.text}/> : inline(cell.text, `table-${start}-${row}-${cell.column}`)}</>;
    }
    if (table.presentation === 'navbox' && table.variant === 'columns') {
      return <nav className="wiki-nav-columns" aria-label="문서 둘러보기" key={start}
        data-table-align={table.layout?.align ?? 'center'}
        style={{ ...table.style, '--wiki-nav-width': table.layout?.width ?? '100%' } as React.CSSProperties}>
        <dl>{table.rows.map(([label, value], row) => <div className="wiki-nav-group" key={row}>
          <dt style={label.style}>{cellContent(label, row)}</dt>
          <dd style={value.style}>{cellContent(value, row)}</dd>
        </div>)}</dl>
      </nav>;
    }
    // A notice may reserve its first column for one optional image spanning
    // all rows. Only this exact shape can omit an empty column; ordinary empty
    // table cells, text, invalid directives and block content remain intact.
    const first = table.rows[0]?.[0];
    const mediaSlot = table.presentation === 'notice' && table.rows.length > 1
      && table.rows[0].length === 2 && first.column === 0 && first.colSpan === 1
      && first.rowSpan === table.rows.length && !first.literal && !first.block
      && table.rows.slice(1).every(row => row.length === 1 && row[0].column === 1 && row[0].colSpan === 1)
      && (!first.text.trim() || /^\[\[파일:[^\]\n]+\]\]$/.test(first.text.trim()));
    const emptyMedia = mediaSlot && (!first.text.trim() || /^\[\[파일:\s*(?:\|[^\]\n]*)?\]\]$/.test(first.text.trim()));
    return <div {...placement} className={`table-wrap${placement.className ? ` ${placement.className}` : ''}`} key={start} role="region" aria-label="문서 표 · 가로로 이동할 수 있습니다" tabIndex={0}><table
      className={`wiki-table${table.presentation ? ` wiki-table-${table.presentation}` : ''}`} data-table-style={table.variant} style={table.style}><tbody>{table.rows.map((cells, row) => {
      return <tr key={row}>{cells.map(cell => {
        if (emptyMedia && cell === first) return null;
        const label = ((table.presentation === 'navbox' && cells.length > 1) || (table.presentation === 'infobox' && cells.length > 1 && row > 0)) && cell.column === 0 && cell.colSpan === 1;
        const header = row === 0 && (table.presentation !== 'navbox' || !label && cells.length === 1);
        const Tag = header || label || cell.role === 'section' ? 'th' : 'td';
        return <Tag key={cell.column} scope={cell.role === 'section' ? 'colgroup' : label ? 'row' : header ? 'col' : undefined}
          className={cell.role ? `wiki-table-${cell.role}` : mediaSlot && cell === first ? 'wiki-notice-media' : !table.presentation && cell.column === 0 && cell.colSpan === 1 ? 'wiki-table-first-column' : undefined}
          colSpan={cell.colSpan > 1 ? cell.colSpan : undefined} rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
          style={cell.style}>{cellContent(cell, row)}</Tag>;
      })}</tr>;
    })}</tbody></table></div>;
  }

  function renderRange(start: number, end: number): React.ReactNode[] {
    const blocks: React.ReactNode[] = [];
    for (let i = start; i < end;) {
      const line = lines[i], h = byLine.get(i), sourceBlock = sourceBlocks.get(i);
      const fence = sourceBlock?.kind === 'fence' ? sourceBlock.fence : null;
      const inclusion = includePlan.includes.get(i);
      if (inclusion) {
        const owner = layoutRoot && inclusion.document ? leadingInfobox(inclusion.document) : null;
        const placement = owner ? tablePlacement(owner.table, true) : {};
        blocks.push(<aside {...placement} className={`wiki-include${placement.className ? ` ${placement.className}` : ''}`} key={i} aria-label={`포함된 틀: ${inclusion.title}`}>
          {inclusion.error && <><p className="wiki-include-error" role="note">{inclusion.error}</p><pre className="wiki-include-literal"><code>{line}</code></pre></>}
          {inclusion.document && !inclusion.document.content.trim() && <p className="wiki-include-empty" role="note">빈 틀입니다.</p>}
          {inclusion.document && <MarkupDocument documentTitle={documentTitle} content={inclusion.document.content} includePlan={inclusion.document}
            ownedTable={owner?.start} open={open} linkViews={linkViews} known={known} commentHref={commentHref} idPrefix={`${idPrefix ? `${idPrefix}-` : ''}include-${i}`} />}
        </aside>);
        i++; continue;
      }
      if (h) {
        const sectionEnd = Math.min(h.end ?? end, end), sectionId = id(h.id), bodyId = `${sectionId}-body`;
        const Tag = `h${Math.min(6, h.level + 1)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        const hidden = collapsed.has(h.id);
        // Parse in source order so notes in headings precede notes in their body.
        const title = inline(h.text, `heading-${i}`);
        const body = renderRange(i + 1, sectionEnd);
        blocks.push(<section key={i} className="wiki-section" data-wiki-section={h.id}>
          <Tag id={sectionId} className={`section-title${hidden ? ' collapsed' : ''}`}>
            <button type="button" className="section-toggle" aria-expanded={!hidden} aria-controls={bodyId} aria-label={`${labelText(h.text)} ${hidden ? '펼치기' : '접기'}`} onClick={() => setCollapsed(previous => {
              const next = new Set(previous); if (next.has(h.id)) next.delete(h.id); else next.add(h.id); return next;
            })}>{hidden ? '›' : '⌄'}</button>
            <a href={`#${encodeURIComponent(tocId)}`} onClick={event => localClick(event, tocId)}>{h.number}.</a>
            <span className="section-label">{title}</span>
            {edit && <button type="button" className="section-edit" onClick={() => edit(h.index)}>[편집]</button>}
          </Tag>
          <div id={bodyId} className="wiki-section-body" hidden={hidden}>{body}</div>
        </section>);
        i = sectionEnd; continue;
      }
      if (fence) {
        if (includePlan.folds.has(i)) {
          const start = i, expanded = expandedFolds.has(start), bodyId = id(`fold-${start}-body`);
          const label = labelText(fence.title || '추가 내용');
          blocks.push(<section className="folding" key={start} aria-label={label}>
            <div className="folding-title">{inline(fence.title || '추가 내용', `fold-title-${start}`)}</div>
            <div id={bodyId} hidden={!expanded}><MarkupDocument documentTitle={documentTitle} includePlan={includePlan.folds.get(start)!} content={fence.body} open={open} linkViews={linkViews} known={known} commentHref={commentHref} idPrefix={`${idPrefix ? `${idPrefix}-` : ''}fold-${start}`} /></div>
            <div className="folding-controls"><button type="button" aria-label={`${label} ${expanded ? '접기' : '펼치기'}`} aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpandedFolds(previous => { const next = new Set(previous); if (next.has(start)) next.delete(start); else next.add(start); return next; })}>{expanded ? '내용 접기' : '내용 펼치기'}</button></div>
          </section>);
        }
        else blocks.push(<pre key={i}><code>{fence.kind === 'folding' ? lines.slice(i, fence.end).join('\n') : fence.body}</code></pre>);
        i = fence.end; continue;
      }
      if (tocMacro.test(line)) {
        if (!tocPlaced) { blocks.push(renderToc()); tocPlaced = true; }
        i++; continue;
      }
      if (!line.trim() || categoryOnlyLine(line)) { i++; continue; }
      if (parseWikiMedia(line)) { blocks.push(<WikiMedia key={i} source={line}/>); i++; continue; }
      if (sourceBlock?.kind === 'table') {
        blocks.push(renderTable(i, sourceBlock.end, sourceBlock.table));
        i = sourceBlock.end; continue;
      }
      if (listPattern.test(line)) {
        const from = i++; while (i < end && listPattern.test(lines[i])) i++;
        blocks.push(renderLists(from, i)); continue;
      }
      if (/^\s*>/.test(line)) {
        const from = i++, quote = [line.replace(/^\s*>\s?/, '')];
        while (i < end && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        blocks.push(<blockquote key={from}>{quote.map((text, index) => <React.Fragment key={index}>{index > 0 && <br />}{inline(text, `quote-${from}-${index}`)}</React.Fragment>)}</blockquote>); continue;
      }
      if (/^\s*-{4,}\s*$/.test(line)) { blocks.push(<hr key={i++} />); continue; }
      const from = i++, paragraph = [line];
      while (i < end && !includePlan.includes.has(i) && lines[i].trim() && !byLine.has(i) && !sourceBlocks.has(i) && !tocMacro.test(lines[i]) && !parseWikiMedia(lines[i]) && !listPattern.test(lines[i]) && !/^\s*(?:\|\||>|-{4,}\s*$|\[\[분류:)/.test(lines[i])) paragraph.push(lines[i++]);
      blocks.push(<p key={from}>{paragraph.map((text, index) => <React.Fragment key={index}>{index > 0 && <br />}{inline(text, `p-${from}-${index}`)}</React.Fragment>)}</p>);
    }
    return blocks;
  }

  const blocks = renderRange(0, lines.length);
  const markup = <div className="markup">
    {!tocPlaced && renderToc()}
    {blocks}
    {notes.length > 0 && <section className="footnotes" aria-label="각주"><ol>{notes.map(note => <li id={`${notePrefix}${note.number}`} key={note.number}>
      <span className="wiki-note-number">[{note.number}]</span> <span className="wiki-note-body">{inline(note.body || `[정의되지 않은 각주: ${note.name || note.number}]`, `note-${note.number}`, 0, false)}</span>
      <span className="wiki-note-backlinks">{note.references.map((ref, index) => <a key={ref} href={`#${encodeURIComponent(ref)}`} aria-label={`각주 ${note.number}의 ${index + 1}번째 위치로 돌아가기`} onClick={event => localClick(event, ref)}>↩{note.references.length > 1 ? index + 1 : ''}</a>)}</span>
    </li>)}</ol></section>}
  </div>;
  return layoutRoot ? <div className="wiki-layout-scope">{markup}</div> : markup;
}
