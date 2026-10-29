'use client';
import { useEffect, useRef, useState } from 'react';
import { loadBlame, type BlameResult } from '../../lib/wiki-blame';
import { wikiHref } from '../../lib/wiki-navigation';
const date = (value: string) => new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });

export function WikiBlame({ title, revision = '', documentId }: { title: string; revision?: string; documentId?: string | null }) {
    const [state, setState] = useState<{ key: string; result?: BlameResult; error?: string } | null>(null);
    const [attempt, setAttempt] = useState(0);
    const queryKey = JSON.stringify([title, revision, documentId ?? null, attempt]);
    const request = useRef({queryKey, generation:0});
    if (request.current.queryKey !== queryKey) request.current = {queryKey, generation:request.current.generation + 1};
    const key = JSON.stringify([queryKey, request.current.generation]);
    useEffect(() => {
        const controller = new AbortController();
        void loadBlame(title, revision, controller.signal, fetch, documentId).then(result => {
            if (!controller.signal.aborted) setState({ key, result });
        }).catch((error: Error) => {
            if (!controller.signal.aborted) setState({ key, error: error.message });
        });
        return () => controller.abort();
    }, [title, revision, documentId, key]);
    const active = state?.key === key ? state : null, result = active?.result;
    const identity = (id?: string | null): Record<string, string> => id ? { document_id: id } : {};
    const targetTitle = result?.target.title || title, targetIdentity = identity(result?.target.document_id || documentId);
    return <section className="blame-panel" aria-label="줄별 편집 이력">
        <div className="result-heading"><a href={wikiHref(targetTitle, 'history', targetIdentity)}>역사로 돌아가기</a><a href={wikiHref(targetTitle, 'blame', targetIdentity)}>현재 판 줄별 이력</a><button onClick={() => setAttempt(n => n + 1)}>새로고침</button></div>
        <p className="notice">각 줄이 마지막으로 바뀐 판을 확인합니다. 출처를 확인할 수 없는 줄은 ‘기원 불명’으로 표시합니다.</p>
        <details className="blame-help"><summary>추적 범위와 읽는 방법</summary><p>최근 이력 40개까지 비교합니다. 내용이 같은 줄은 이전 판의 정보를 이어받고, 삭제 후 다시 추가된 줄은 새 편집으로 표시합니다. 같은 줄이 반복되거나 위치가 바뀌면 실제 편집 의도와 다를 수 있습니다.</p><p>‘최초 확인 판’은 조회한 범위에서 가장 먼저 확인한 판이며 처음 작성한 판이라는 뜻은 아닙니다. 이전 판에 작성자 정보가 저장돼 있지 않으면 작성자를 표시할 수 없습니다. 문서가 크면 일부 출처를 확인하지 못할 수 있으며 원문은 RAW로 읽을 수 있습니다.</p></details>
        {!active && <p role="status">선택한 판의 줄별 편집 이력을 불러오는 중입니다.</p>}
        {active?.error && <p className="error" role="alert">{active.error} <a href={wikiHref(title, 'raw', { ...targetIdentity, ...(revision ? { rev: revision } : {}) })}>RAW 보기</a></p>}
        {result && <>
            <p className="blame-target">{revision ? '선택한 판' : '조회 시점의 현재 판'}: <a href={wikiHref(result.target.title, 'read', { ...targetIdentity, rev: result.target.id })}><code>{result.target.id}</code></a> · <time dateTime={result.target.created_at}>{date(result.target.created_at)}</time> · {result.inspected}개 판 비교 <a href={wikiHref(result.target.title, 'blame', { ...targetIdentity, rev: result.target.id })}>이 판의 고정 주소</a></p>
            {result.notices.map((notice, i) => <p className="notice" role="status" key={i}>{notice}</p>)}
            {!result.lines.length ? <p role="status">이 판의 원문은 비어 있습니다.</p> : <div className="blame-scroll" role="region" aria-label="줄 번호와 원문 이력" tabIndex={0}><table className="blame-table"><thead><tr><th scope="col">줄</th><th scope="col">편집 정보 / 확인한 판</th><th scope="col">원문</th></tr></thead><tbody>{result.lines.map((line, i) => <tr key={i}>
                <th scope="row" className="blame-number">{i + 1}</th>
                <td className="blame-attribution"><span>{line.known ? '변경 판' : '기원 불명 · 최초 확인 판'}</span> <a href={wikiHref(line.revision.title, 'read', { ...identity(line.revision.document_id), rev: line.revision.id })} title={line.revision.id}><code>{line.revision.id.slice(0, 8)}</code></a><div>작성자 정보 없음 · <time dateTime={line.revision.created_at}>{date(line.revision.created_at)}</time></div><div>{line.revision.summary || '편집 요약 없음'}</div></td>
                <td className="blame-source"><pre>{line.text || '\u200b'}</pre></td>
            </tr>)}</tbody></table></div>}
        </>}
    </section>;
}
