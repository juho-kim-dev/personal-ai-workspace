'use client';
import { useEffect, useRef, useState } from 'react';
import type { ActivityResult } from '../../lib/wiki';
import { wikiHref } from '../../lib/wiki-navigation';

const pageSize = 30;
const displayTime = (value: string) => new Date(value).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const excerpt = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const identity = (documentId?: string | null): Record<string, string> => documentId ? { document_id: documentId } : {};
function checkedActivity(result: ActivityResult, documentId: string | null, type: ActivityResult['type'], offset: number) {
    const validId = (id: unknown) => id == null || typeof id === 'string' && !!id;
    if (!result || typeof result.title !== 'string' || !validId(result.document_id) ||
        (documentId && result.document_id !== documentId) || result.type !== type || result.offset !== offset ||
        result.limit !== pageSize || typeof result.has_more !== 'boolean' || !Array.isArray(result.items) || result.items.length > pageSize)
        throw new Error('활동 응답의 문서 식별 범위를 확인할 수 없습니다. 다시 불러오세요.');
    const owner = result.document_id || documentId;
    for (const item of result.items) {
        if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.created_at !== 'string' ||
            !validId(item.document_id) || owner && item.document_id !== owner ||
            (item.type === 'edit' ? typeof item.summary !== 'string' || !Number.isFinite(item.size) || item.size < 0 :
                item.type !== 'discussion' || typeof item.thread_id !== 'string' || typeof item.subject !== 'string' ||
                typeof item.excerpt !== 'string' || !Number.isSafeInteger(item.number) || item.number < 1))
            throw new Error('활동 기록의 문서 식별 범위가 다릅니다. 다시 불러오세요.');
    }
    return result;
}

export function WikiActivity({ title, documentId }: { title: string; documentId?: string | null }) {
    const scope = JSON.stringify([title, documentId ?? null]);
    const [selection, setSelection] = useState<{ scope: string; type: ActivityResult['type']; offset: number }>({ scope, type: 'all', offset: 0 });
    // Reset in render so even a rapid A → B → A switch cannot revive A's old offset.
    const current = selection.scope === scope ? selection : { scope, type: selection.type, offset: 0 };
    if (selection.scope !== scope) setSelection(current);
    const owner = useRef({ scope, id: documentId || null });
    if (owner.current.scope !== scope) owner.current = { scope, id: documentId || null };
    const { type, offset } = current;
    const [attempt, setAttempt] = useState(0);
    const [from,setFrom]=useState(''),[before,setBefore]=useState('');
    const [state, setState] = useState<{ key: string; result?: ActivityResult; error?: string } | null>(null);
    const queryKey = JSON.stringify([scope, type, offset, attempt,from,before]);
    const request = useRef({ queryKey, generation: 0 });
    if (request.current.queryKey !== queryKey) request.current = { queryKey, generation: request.current.generation + 1 };
    const lease = request.current;
    const key = JSON.stringify([queryKey, request.current.generation]);
    useEffect(() => {
        const controller = new AbortController();
        const documentId = owner.current.id;
        const params = new URLSearchParams({ op: 'activity', title, ...identity(documentId), type, offset: String(offset), limit: String(pageSize),...(from?{from:new Date(from+'+09:00').toISOString()}:{}),...(before?{before:new Date(before+'+09:00').toISOString()}:{}) });
        void (async () => {
            try {
                const response = await fetch('/api/wiki?' + params, { signal: controller.signal, cache: 'no-store' });
                const result = await response.json() as ActivityResult & { error?: string };
                if (!response.ok) throw new Error(result.error || '활동 기록을 불러오지 못했습니다.');
                checkedActivity(result, documentId, type, offset);
                if (!controller.signal.aborted && request.current === lease) {
                    owner.current.id = result.document_id || documentId;
                    setState({ key, result });
                }
            } catch (error) {
                if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : '활동 기록을 불러오지 못했습니다.' });
            }
        })();
        return () => controller.abort();
    }, [title, documentId, type, offset, key,from,before]);
    const active = state?.key === key ? state : null;
    const result = active?.result;
    const targetTitle = result?.title || title, targetIdentity = identity(result?.document_id || owner.current.id);
    return <section className="activity-panel" aria-label="문서 활동 기록">
        <nav className="activity-links" aria-label="문서 관련 보기">
            <a href={wikiHref(targetTitle, 'read', targetIdentity)}>문서</a><a href={wikiHref(targetTitle, 'history', targetIdentity)}>역사</a><a href={wikiHref(targetTitle, 'discussions', targetIdentity)}>토론</a>
        </nav>
        <p className="notice">{targetIdentity.document_id ? '이 문서의 편집·토론 기록을 이름 변경 전후에 걸쳐 최신순으로 확인합니다. 삭제된 문서의 남아 있는 기록도 포함합니다.' : '이 제목에 저장된 편집·토론 기록을 최신순으로 확인합니다. 삭제된 문서의 남아 있는 기록도 포함하며, 이동한 기록은 저장된 제목에서 확인할 수 있습니다.'} 시간은 한국 시간입니다.</p>
        <div className="activity-controls">
            <label>기록 종류 <select aria-label="활동 종류" value={type} onChange={e => setSelection({ scope, type: e.target.value as ActivityResult['type'], offset: 0 })}>
                <option value="all">전체</option><option value="edits">편집</option><option value="discussions">토론</option>
            </select></label>
            <label>기간 시작 (한국 시간)<input type="datetime-local" aria-label="활동 기간 시작" value={from} onChange={e=>{setFrom(e.target.value);setSelection({scope,type,offset:0});}}/></label>
            <label>이 시각 이전 (한국 시간)<input type="datetime-local" aria-label="활동 기간 끝" value={before} onChange={e=>{setBefore(e.target.value);setSelection({scope,type,offset:0});}}/></label>
            <button onClick={() => setAttempt(n => n + 1)}>새로고침</button>
        </div>
        <div aria-busy={!active}>
            {!active && <p role="status">활동 기록을 불러오는 중입니다.</p>}
            {active?.error && <div><p className="error" role="alert">{active.error}</p><button onClick={() => setAttempt(n => n + 1)}>다시 시도</button></div>}
            {result && (!result.items.length ? <p role="status">조건에 맞는 저장된 기록이 없습니다.</p> : <ol className="activity-list" aria-label="저장된 활동 기록">{result.items.map(item => <li key={item.type + ':' + item.id}>
                <div className="activity-meta"><strong>{item.type === 'edit' ? '편집 기록' : '토론 기록'}</strong><time dateTime={item.created_at}>{displayTime(item.created_at)}</time></div>
                {item.type === 'edit' ? <>
                    <p className="activity-excerpt">{excerpt(item.summary) || '편집 요약 없음'}</p>
                    <div className="activity-detail">문서 크기 {item.size.toLocaleString('ko-KR')}자 · 판 <code title={item.id}>{item.id.slice(0, 8)}</code></div>
                    <div className="activity-links"><a href={wikiHref(item.title, 'read', { ...identity(item.document_id), rev: item.id })}>이 판 읽기</a><a href={wikiHref(item.title, 'raw', { ...identity(item.document_id), rev: item.id })}>RAW</a><a href={wikiHref(item.title, 'blame', { ...identity(item.document_id), rev: item.id })}>Blame · 줄별 이력</a></div>
                </> : <>
                    <a className="activity-subject" href={wikiHref(item.title, 'discussions', { ...identity(item.document_id), thread: item.thread_id, anchor: 'comment-' + item.number })}>{excerpt(item.subject) || '토론'} · #{item.number}</a>
                    <p className="activity-excerpt"><span className="activity-detail">댓글 발췌: </span>{excerpt(item.excerpt) || '표시할 내용 없음'}</p>
                </>}
            </li>)}</ol>)}
        </div>
        <nav className="activity-pagination" aria-label="활동 기록 페이지">
            <button disabled={!active || offset === 0} onClick={() => setSelection({ scope, type, offset: Math.max(0, offset - pageSize) })}>이전</button>
            <span>{Math.floor(offset / pageSize) + 1}페이지</span>
            <button disabled={!result?.has_more} onClick={() => setSelection({ scope, type, offset: offset + pageSize })}>다음</button>
        </nav>
    </section>;
}
