/** Read-only, bounded provenance over the revision order returned by history. */
export const BLAME_LIMITS = {
    revisions: 40, bytes: 2 * 1024 * 1024, responseBytes: 512 * 1024,
    chars: 200000, lines: 2000, pairCells: 250000, totalCells: 2000000,
} as const;
export type BlameRevision = { id: string; title: string; content: string; summary: string; created_at: string; document_id?: string | null; dataset_id?: string | null };
export type BlameLine = { text: string; revision: BlameRevision; known: boolean };
export type BlameResult = { target: BlameRevision; lines: BlameLine[]; inspected: number; notices: string[] };
class LimitError extends Error {}
const checkAbort = (signal: AbortSignal) => { signal.throwIfAborted(); };
function sourceLines(content: string) {
    if (content.length > BLAME_LIMITS.chars) throw new LimitError('원문 200,000자 제한을 초과했습니다. RAW에서 확인하세요.');
    const lines = content === '' ? [] : content.split('\n');
    if (lines.length > BLAME_LIMITS.lines) throw new LimitError('원문 2,000줄 제한을 초과했습니다. RAW에서 확인하세요.');
    return lines;
}
function revision(value: unknown, owner: string | null = null): BlameRevision {
    const r = value as BlameRevision | null;
    if (!r || !['id', 'title', 'content', 'summary', 'created_at'].every(k => typeof r[k as keyof BlameRevision] === 'string') || !r.id)
        throw new Error('판 응답을 확인할 수 없습니다.');
    checkedOwner(r, owner);
    sourceLines(r.content);
    return r;
}
function checkedOwner(value: { document_id?: unknown }, expected: string | null) {
    const id = value.document_id;
    if (id != null && (typeof id !== 'string' || !id) || expected && id !== expected)
        throw new Error('요청한 문서와 판의 식별자가 다릅니다. 다시 불러오세요.');
    return typeof id === 'string' ? id : null;
}

/** Oldest to newest, contiguous snapshots only. Baseline never claims an original author. */
export function attributeLines(revisions: BlameRevision[], limits = { pairCells: BLAME_LIMITS.pairCells as number, totalCells: BLAME_LIMITS.totalCells as number }) {
    if (!revisions.length || revisions.length > BLAME_LIMITS.revisions) throw new LimitError('검사할 판 수가 범위를 벗어났습니다.');
    if (revisions.reduce((n, r) => n + new TextEncoder().encode(r.content).byteLength, 0) > BLAME_LIMITS.bytes) throw new LimitError('원문 합계 제한을 초과했습니다.');
    let lines: BlameLine[] = [], work = 0, fallback = false;
    for (let index = 0; index < revisions.length; index++) {
        const current = revisions[index], next = sourceLines(current.content);
        if (!index) { lines = next.map(text => ({ text, revision: current, known: false })); continue; }
        if (current.content === revisions[index - 1].content) continue;
        const cells = (lines.length + 1) * (next.length + 1);
        if (cells > limits.pairCells || work + cells > limits.totalCells) {
            lines = next.map(text => ({ text, revision: current, known: false }));
            fallback = true;
            continue;
        }
        work += cells;
        // Intern exact strings once, keeping long-line comparison outside the quadratic loop.
        const ids = new Map<string, number>();
        const intern = (s: string) => { if (!ids.has(s)) ids.set(s, ids.size + 1); return ids.get(s)!; };
        const a = lines.map(l => intern(l.text)), b = next.map(intern), width = b.length + 1;
        const lcs = new Uint16Array(cells);
        for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
            lcs[i * width + j] = a[i] === b[j] ? 1 + lcs[(i + 1) * width + j + 1] : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
        const attributed = next.map(text => ({ text, revision: current, known: true }));
        let i = 0, j = 0;
        while (i < a.length && j < b.length) {
            if (a[i] === b[j]) { attributed[j] = lines[i]; i++; j++; }
            else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) i++;
            else j++;
        }
        lines = attributed;
    }
    return { lines, fallback, work };
}

/** Stream limits apply before JSON parsing, including errors and discarded history entries. */
export async function loadBlame(title: string, selected: string, signal: AbortSignal, fetcher: typeof fetch = fetch, documentId?: string | null): Promise<BlameResult> {
    let remaining = BLAME_LIMITS.bytes as number;
    let owner = documentId || null;
    async function get(op: string, documentTitle: string, extra: Record<string, string> = {}) {
        checkAbort(signal);
        if (remaining <= 0) throw new LimitError('응답 합계 2 MiB 제한에 도달했습니다.');
        const response = await fetcher('/api/wiki?' + new URLSearchParams({ op, title: documentTitle, ...extra, ...(owner ? { document_id: owner } : {}) }), { cache: 'no-store', signal });
        checkAbort(signal);
        const cap = Math.min(remaining, BLAME_LIMITS.responseBytes);
        if (Number(response.headers.get('content-length')) > cap) {
            await response.body?.cancel();
            throw new LimitError('응답 크기 제한에 도달했습니다.');
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('빈 응답입니다.');
        const decoder = new TextDecoder(); let body = '', bytes = 0;
        try {
            while (true) {
                checkAbort(signal);
                const part = await reader.read();
                checkAbort(signal);
                if (part.done) break;
                bytes += part.value.byteLength; remaining -= part.value.byteLength;
                if (bytes > cap) throw new LimitError('응답 크기 제한에 도달했습니다.');
                body += decoder.decode(part.value, { stream: true });
            }
            body += decoder.decode();
        } finally { await reader.cancel(); reader.releaseLock(); }
        const value = JSON.parse(body);
        if (!response.ok) throw new Error(value.error || '판을 불러오지 못했습니다.');
        return value;
    }
    let id = selected;
    if (!id) {
        const page = await get('read', title);
        if (!page || typeof page.version !== 'string' || !page.version) throw new Error('현재 판을 찾을 수 없습니다.');
        owner = checkedOwner(page, owner);
        id = page.version;
    }
    const target = revision(await get('revision', title, { id }), owner);
    if (target.id !== id) throw new Error('요청한 판과 응답이 다릅니다.');
    owner = checkedOwner(target, owner);
    const snapshots: BlameRevision[] = [], seen = new Set<string>(), notices: string[] = [];
    let found = false, exhausted = false, head = '', previous: BlameRevision | undefined, unstable = false;
    // Small pages avoid one network round trip per short revision. Large current
    // sources use single-entry pages so the per-response safety cap stays useful.
    const pageSize = Math.max(1, Math.min(5, Math.floor(128000 / Math.max(1, new TextEncoder().encode(target.content).byteLength))));
    for (let offset = 0; offset < BLAME_LIMITS.revisions;) {
        try {
            const limit = Math.min(pageSize, BLAME_LIMITS.revisions - offset);
            const batch = await get('history', target.title, { offset: String(offset), limit: String(limit) });
            if (!Array.isArray(batch) || batch.length > limit) throw new Error('이력 응답을 확인할 수 없습니다.');
            if (!batch.length) { exhausted = true; break; }
            for (const value of batch) {
                const row = revision(value, owner);
                if (!head) head = row.id;
                if ((!owner && row.title !== target.title) || seen.has(row.id) || (previous && (row.created_at > previous.created_at || (row.created_at === previous.created_at && row.id >= previous.id)))) { unstable = true; break; }
                seen.add(row.id); previous = row;
                if (row.id === id) {
                    if (row.content !== target.content) { unstable = true; break; }
                    found = true;
                }
                if (found) snapshots.push(row);
            }
            if (unstable) break;
            offset += batch.length;
            if (batch.length < limit) { exhausted = true; break; }
        } catch (e) {
            checkAbort(signal);
            // Authentication/server/network failures are errors, not fabricated partial success.
            if (!(e instanceof LimitError)) throw e;
            notices.push(e.message + ' 이전 구간의 기원은 알 수 없습니다.');
            break;
        }
    }
    if (!exhausted) notices.push('최근 이력 최대 40개까지만 조회합니다. 그보다 이전 이력은 확인하지 않았습니다.');
    if (head && remaining > 0) {
        try {
            const latest = await get('history', target.title, { offset: '0', limit: '1' });
            if (Array.isArray(latest)) for (const value of latest) revision(value, owner);
            if (!Array.isArray(latest) || latest.length !== 1 || latest[0]?.id !== head) unstable = true;
        } catch (e) { checkAbort(signal); if (!(e instanceof LimitError)) throw e; unstable = true; }
    } else if (head) unstable = true;
    if (unstable) {
        snapshots.length = 0;
        notices.push('조회 중 이력이 달라졌거나 일관성을 확인하지 못했습니다. 선택한 판만 표시합니다.');
    } else if (!found) notices.push('선택한 판이 조회 범위에 없습니다. 선택한 판만 표시하며 모든 줄의 기원은 불명입니다.');
    if (!snapshots.length) snapshots.push(target);
    const result = attributeLines([...snapshots].reverse());
    if (result.fallback) notices.push('줄 정렬 계산 한도를 초과한 구간은 기원 불명으로 표시합니다.');
    checkAbort(signal);
    return { target, lines: result.lines, inspected: snapshots.length, notices };
}
