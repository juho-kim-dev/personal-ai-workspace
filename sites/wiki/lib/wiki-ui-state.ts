import { wikiSearchText } from './wiki-text';
import { splitWikiTarget } from './wiki-navigation';
import { wikiNamespace } from './wiki-title';
export const HOME = 'PAW Wiki:대문';
export type Section = {
    start: number;
    end: number;
    content: string;
};
export type EditorDraft = {
    title?: string;
    document_id?: string | null;
    dataset_id?: string | null;
    draft: string;
    baseline: string;
    fullBaseline: string;
    version: string | null;
    summary: string;
    section: Section | null;
    sectionTitle: string;
};
export function draftKey(title: string, line?: number | null) { return 'wiki-draft:' + JSON.stringify([title.normalize('NFC'), line ?? null]); }
export function documentDraftKey(title: string, line: number | null | undefined, identity?: { document_id?: string | null; dataset_id?: string | null }) {
    return identity?.document_id && identity.dataset_id ? 'wiki-draft-id:' + JSON.stringify([identity.dataset_id, identity.document_id, line ?? null]) : draftKey(title, line);
}
export type LegacyEditorDraft = { key: string; title: string; line: number | null; value: EditorDraft };
export function legacyEditorDrafts(title: string, line: number | null): LegacyEditorDraft[] {
    const keys = new Set([draftKey(title, line)]);
    try { for (let i = 0; i < sessionStorage.length; i++) { const key = sessionStorage.key(i); if (key?.startsWith('wiki-draft:')) keys.add(key); } } catch { /* The known key remains available. */ }
    const result: LegacyEditorDraft[] = [];
    for (const key of keys) {
        try {
            const scope = JSON.parse(key.slice('wiki-draft:'.length));
            if (!Array.isArray(scope) || scope.length !== 2 || typeof scope[0] !== 'string' || scope[1] !== line) continue;
            const value = readSessionDraft(key);
            if (value && (value.draft !== value.baseline || value.summary)) result.push({key, title: scope[0], line, value});
        } catch { /* Invalid keys cannot establish ownership. */ }
    }
    return result;
}
export function movedEditorDrafts(title: string, line: number | null, datasetId: string, documentId: string) {
    const result: {documentId:string; value:EditorDraft}[] = [];
    try {
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (!key?.startsWith('wiki-draft-id:')) continue;
            try {
                const scope = JSON.parse(key.slice('wiki-draft-id:'.length)), value = readSessionDraft(key);
                if (Array.isArray(scope) && scope.length === 3 && scope[0] === datasetId && typeof scope[1] === 'string' && scope[1] !== documentId && scope[2] === line && value?.title === title && value.document_id === scope[1] && value.dataset_id === datasetId && (value.draft !== value.baseline || value.summary))
                    result.push({documentId:scope[1], value});
            } catch { /* Malformed scopes cannot establish ownership. */ }
        }
    } catch { /* The original drafts remain untouched. */ }
    return result;
}
export function parseRoute(hash: string) {
    const p = new URLSearchParams(hash.replace(/^#/, '')), raw = p.get('doc') || HOME, target = p.get('view') === 'search' ? { title: raw.trim().normalize('NFC'), anchor: '' } : splitWikiTarget(raw);
    const section = p.get('section');
    return { documentId: p.get('document_id') || '', sectionVersion: p.get('section_version') || '', thread: p.get('thread') || '', title: target.title || HOME, view: p.get('view') || 'read', anchor: p.get('anchor') || target.anchor, revision: p.get('rev') || '', section: section !== null && /^\d+$/.test(section) ? Number(section) : null, bypass: p.get('redirect') === 'no' };
}
export function spliceSection(value: EditorDraft) {
    if (!value.section)
        return value.draft;
    const lines = value.fullBaseline.split('\n');
    return [...lines.slice(0, value.section.start), ...value.draft.split('\n'), ...lines.slice(value.section.end)].join('\n');
}
export function savedDraft(value: EditorDraft, content: string, version: string, submitted: string): EditorDraft {
    return { ...value, baseline: submitted, fullBaseline: content, version, section: value.section ? { ...value.section, end: value.section.start + submitted.split('\n').length, content: submitted } : null };
}
export function readSessionDraft(key: string): EditorDraft | null {
    try {
        const d = JSON.parse(sessionStorage.getItem(key) || 'null');
        return d && typeof d.draft === 'string' && typeof d.baseline === 'string' && typeof d.fullBaseline === 'string' && typeof d.summary === 'string' && (d.version === null || typeof d.version === 'string') && (d.section === null || (Number.isInteger(d.section?.start) && Number.isInteger(d.section?.end) && d.section.start >= 0 && d.section.end >= d.section.start)) ? d : null;
    }
    catch {
        return null;
    }
}
export function writeSessionDraft(key: string, value: EditorDraft | null) { try {
    if (value)
        sessionStorage.setItem(key, JSON.stringify(value));
    else if (key.startsWith('wiki-draft-id:'))
        sessionStorage.setItem(key, JSON.stringify({ discarded: true }));
    else
        sessionStorage.removeItem(key);
    return true;
}
catch {
    return false;
} }
export function namespace(title: string) { return wikiNamespace(title) || '문서'; }
export function exactFirst<T extends {
    title: string;
}>(pages: T[], query: string) { const q = query.trim().normalize('NFC').toLocaleLowerCase(); return [...pages].sort((a, b) => Number(b.title.toLocaleLowerCase() === q) - Number(a.title.toLocaleLowerCase() === q) || Number(b.title.toLocaleLowerCase().includes(q)) - Number(a.title.toLocaleLowerCase().includes(q))); }
export function snippet(content: string, query: string) { content = wikiSearchText(content); const at = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()), start = Math.max(0, at - 70); return (start ? '…' : '') + content.slice(start, start + 230) + (start + 230 < content.length ? '…' : ''); }
export function relativeTime(value: string) { const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000)); return seconds < 60 ? '방금 전' : seconds < 3600 ? `${Math.floor(seconds / 60)}분 전` : seconds < 86400 ? `${Math.floor(seconds / 3600)}시간 전` : `${Math.floor(seconds / 86400)}일 전`; }
export type DiffLine = {
    before?: string;
    after?: string;
    left?: number;
    right?: number;
    kind: 'same' | 'change';
};
// Linear-space LCS rows; bounded work prevents large documents freezing the editor.
export function lineDiff(before: string, after: string): {
    rows: DiffLine[];
    fallback: boolean;
} {
    const a = before.split('\n'), b = after.split('\n');
    if (a.length * b.length > 1000000 || a.length + b.length > 6000)
        return { fallback: true, rows: [] };
    function scores(x: string[], y: string[]) { let row = new Uint32Array(y.length + 1); for (const item of x) {
        const next = new Uint32Array(y.length + 1);
        for (let j = 0; j < y.length; j++)
            next[j + 1] = item === y[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]);
        row = next;
    } return row; }
    function matches(x: string[], y: string[], i: number, j: number): [
        number,
        number
    ][] {
        if (!x.length || !y.length)
            return [];
        if (x.length === 1) {
            const at = y.indexOf(x[0]);
            return at < 0 ? [] : [[i, j + at]];
        }
        const mid = Math.floor(x.length / 2), l = scores(x.slice(0, mid), y), r = scores(x.slice(mid).reverse(), [...y].reverse());
        let split = 0, best = -1;
        for (let k = 0; k <= y.length; k++) {
            const score = l[k] + r[y.length - k];
            if (score > best) {
                best = score;
                split = k;
            }
        }
        return [...matches(x.slice(0, mid), y.slice(0, split), i, j), ...matches(x.slice(mid), y.slice(split), i + mid, j + split)];
    }
    const rows: DiffLine[] = [];
    let i = 0, j = 0;
    for (const [ai, bj] of [...matches(a, b, 0, 0), [a.length, b.length]]) {
        while (i < ai || j < bj) {
            const left = i < ai ? ++i : undefined, right = j < bj ? ++j : undefined;
            rows.push({ before: left ? a[left - 1] : undefined, after: right ? b[right - 1] : undefined, left, right, kind: 'change' });
        }
        if (ai < a.length) {
            rows.push({ before: a[i], after: b[j], left: ++i, right: ++j, kind: 'same' });
        }
    }
    return { rows, fallback: false };
}
