/** Active pages only. Comparison keys are NFC; stored titles remain untouched. */
export type HierarchyPage = { title: string };
export type HierarchyEntry = { title: string; label: string; exists: boolean; descendantCount: number };
export type WikiHierarchyData = { ancestors: HierarchyEntry[]; children: HierarchyEntry[]; descendantCount: number };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function path(title: string): string | null {
    const normalized = title.normalize('NFC');
    return normalized.split('/').some(segment => !segment.trim()) ? null : normalized;
}
export function wikiHierarchy(title: string, pages: readonly HierarchyPage[]): WikiHierarchyData {
    const current = path(title);
    if (current === null) return { ancestors: [], children: [], descendantCount: 0 };
    const active = new Map<string, string>();
    // Choose a stable representative even if callers supply canonical duplicates.
    for (const page of [...pages].sort((a, b) => compare(a.title, b.title))) {
        const key = path(page.title);
        if (key !== null && (!active.has(key) || page.title === key)) active.set(key, page.title);
    }
    const keys = [...active.keys()];
    const count = (key: string) => keys.filter(candidate => candidate.startsWith(key + '/')).length;
    const entry = (key: string): HierarchyEntry => ({
        title: active.get(key) ?? key,
        label: key.slice(key.lastIndexOf('/') + 1),
        exists: active.has(key),
        descendantCount: count(key),
    });
    const segments = current.split('/');
    const ancestors = segments.slice(0, -1).map((_, index) => entry(segments.slice(0, index + 1).join('/')));
    const descendants = keys.filter(key => key.startsWith(current + '/'));
    const children = descendants.filter(key => !key.slice(current.length + 1).includes('/')).sort(compare).map(entry);
    return { ancestors, children, descendantCount: descendants.length };
}
