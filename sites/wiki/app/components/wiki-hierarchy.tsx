'use client';
import { wikiHierarchy, type HierarchyEntry, type HierarchyPage } from '../../lib/wiki-hierarchy';
import { modifiedLinkClick, wikiHref } from '../../lib/wiki-navigation';

type Props = {
    title: string;
    pages: readonly HierarchyPage[];
    open: (title: string, view?: string, extra?: Record<string, string>) => unknown;
};
export function WikiHierarchy({ title, pages, open }: Props) {
    const { ancestors } = wikiHierarchy(title, pages);
    function link(entry: HierarchyEntry) {
        return <a href={wikiHref(entry.title)} className={entry.exists ? undefined : 'wiki-hierarchy-missing'} onClick={event => {
            if (modifiedLinkClick(event)) return;
            event.preventDefault();
            open(entry.title, 'read');
        }}>{entry.label}{!entry.exists && <span> (없는 문서)</span>}</a>;
    }
    if (!ancestors.length) return null;
    return <nav className="wiki-hierarchy" aria-label="문서 계층">
        {ancestors.length > 0 && <div className="wiki-hierarchy-ancestors"><span>상위 문서:</span><ol>{ancestors.map(parent => <li key={parent.title}>{link(parent)}</li>)}</ol></div>}
    </nav>;
}
