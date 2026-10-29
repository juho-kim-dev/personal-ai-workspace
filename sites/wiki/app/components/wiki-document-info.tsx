'use client';
import { WikiDialog } from './wiki-dialog';
import { planWikiIncludes, type IncludeDocument, type IncludeResult } from '../../lib/wiki-include';
import { modifiedLinkClick, wikiHref } from '../../lib/wiki-navigation';
import { wikiCellKey } from '../../lib/wiki-source';
import { wikiDocumentPolicy } from '../../lib/wiki-document-policy';

type DocumentSource = {
    title: string;
    content: string;
    version: string;
    document_id?: string | null;
};
type DocumentIdentity = Pick<DocumentSource, 'title' | 'document_id'>;

function includeSources(plan: IncludeDocument): IncludeResult[] {
    const sources: IncludeResult[] = [], seen = new Set<string>();
    function walk(document: IncludeDocument) {
        const lines = [...new Set([...document.includes.keys(), ...document.source.blocks.keys()])].sort((a, b) => a - b);
        for (const line of lines) {
            const entry = document.includes.get(line);
            if (entry) {
                // Keep distinct failures and empty expansions visible even when a
                // title appears more than once with different parameters.
                const key = JSON.stringify([entry.title, entry.resolvedTitle, entry.error, !entry.document?.content.trim()]);
                if (!seen.has(key)) { seen.add(key); sources.push(entry); }
                if (entry.document) walk(entry.document);
            }
            const fold = document.folds.get(line);
            if (fold) walk(fold);
            const block = document.source.blocks.get(line);
            if (block?.kind === 'table' && block.table) block.table.rows.forEach((row, rowIndex) => {
                for (const cell of row) {
                    const child = document.cells.get(wikiCellKey(line, rowIndex, cell.column));
                    if (child) walk(child);
                }
            });
        }
    }
    walk(plan);
    return sources;
}

export function WikiDocumentInfo({ source, currentVersion, historical, documentTitle, sources, pages, open, onClose }: {
    source: DocumentSource;
    currentVersion?: string;
    historical: boolean;
    documentTitle: string;
    sources: Record<string, string>;
    pages: readonly DocumentIdentity[];
    open: (title: string, view?: string, extra?: Record<string, string>) => unknown;
    onClose: () => void;
}) {
    const includes = includeSources(planWikiIncludes(source.content, sources, documentTitle));
    const policy=wikiDocumentPolicy(source.title,source.content);
    function sourceLink(title: string) {
        if (!title.trim()) return <span>(빈 제목)</span>;
        const documentId = pages.find(page => page.title === title)?.document_id;
        const extra: Record<string, string> = documentId ? { document_id: documentId } : {};
        return <a href={wikiHref(title, 'read', extra)} onClick={event => {
            if (event.defaultPrevented || modifiedLinkClick(event)) return;
            event.preventDefault();
            if (open(title, 'read', extra) !== false) onClose();
        }}>{title}</a>;
    }
    return <WikiDialog label="문서 정보" onClose={onClose}>
        <div className="document-info">
            <div className="document-info-heading"><h2>문서 정보</h2><button type="button" onClick={onClose}>닫기</button></div>
            <dl className="document-info-fields">
                <dt>문서 이름</dt><dd>{source.title}</dd>
                <dt>문서 구분</dt><dd>{policy.kind} · 이름공간 {policy.namespace}{policy.roles.length?` · 역할 ${policy.roles.join(', ')}`:''}</dd>
                <dt>문서 ID</dt><dd>{source.document_id ? <code>{source.document_id}</code> : '확인되지 않음'}</dd>
                <dt>표시 중인 판</dt><dd>{historical ? '과거 판' : '현재 판'} · <code>{source.version}</code></dd>
                {historical && currentVersion && <><dt>현재 판</dt><dd><code>{currentVersion}</code></dd></>}
            </dl>
            <h3>포함된 틀</h3>
            {historical && <p className="document-info-hint">포함된 틀은 현재 원문 기준입니다.</p>}
            {includes.length ? <ul className="document-info-sources">{includes.map((entry, index) => <li key={index}>
                {sourceLink(entry.title)}
                {entry.resolvedTitle && entry.resolvedTitle !== entry.title && <> → {sourceLink(entry.resolvedTitle)}</>}
                {entry.error ? <p className="document-info-error">{entry.error}</p>
                    : !entry.document?.content.trim() && <p className="document-info-hint">빈 원문입니다.</p>}
            </li>)}</ul> : <p className="document-info-hint">포함된 틀이 없습니다.</p>}
        </div>
    </WikiDialog>;
}
