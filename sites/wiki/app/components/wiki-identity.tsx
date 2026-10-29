'use client';

import { useRef, useState } from 'react';
import { WIKI_CLIENT_HEADERS } from '../../lib/wiki-client-protocol';

type Action = 'start' | 'step' | 'verify' | 'activate' | 'reopen' | 'backup';
type Status = {
    state: string;
    schema_ready?: boolean;
    dataset_id?: string;
    phase?: string;
    cursor?: string | number | null;
    generation?: number;
    source_epoch?: number | null;
    source_fingerprint?: string | null;
    source_backup_fingerprint?: string | null;
    backup_fingerprint?: string | null;
    backup_epoch?: number | null;
    verified_epoch?: number | null;
    counts?: Record<string, number>;
    errors?: string[];
};
type Download = {
    checkpoint: string; filename: string; bytes: number; sha256: string; format: string;
    datasetId: string; backupEpoch: number; backupFingerprint: string;
};
type ActivationExpectation = {
    expected_generation: number;
    expected_backup_epoch: number;
    expected_backup_fingerprint: string;
    expected_dataset_id: string;
};
type Verification = { valid: boolean; records: number; problems: string[] };

const LIMIT = 24 * 1024 * 1024;
const pausedStates = new Set(['frozen', 'migrating', 'verified', 'maintenance']);
const stateLabels: Record<string, string> = {
    legacy: '기존 제목 방식',
    frozen: '편집 중지 · 이관 준비',
    migrating: '편집 중지 · 이관 진행',
    verified: '편집 중지 · 서버 검증됨',
    active: '문서 ID 사용 중',
    maintenance: '편집 잠시 중지',
};
const countLabels: Record<string, string> = {
    pages: '문서', revisions: '판', trash: '휴지통', notes: '메모', bookmarks: '즐겨찾기',
    threads: '토론', comments: '댓글', files: '첨부', documents: '문서 ID',
};

function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function parseStatus(value: unknown): Status {
    if (!object(value) || typeof value.state !== 'string') throw new Error('서버의 문서 식별 상태를 확인할 수 없습니다.');
    if (['dataset_id', 'phase'].some(key => value[key] !== undefined && typeof value[key] !== 'string')
        || ['source_fingerprint', 'source_backup_fingerprint', 'backup_fingerprint'].some(key => value[key] != null && typeof value[key] !== 'string')
        || ['generation', 'source_epoch', 'backup_epoch', 'verified_epoch'].some(key => value[key] != null && (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0))
        || value.schema_ready !== undefined && typeof value.schema_ready !== 'boolean'
        || value.cursor != null && typeof value.cursor !== 'string' && typeof value.cursor !== 'number'
        || value.counts !== undefined && (!object(value.counts) || Object.values(value.counts).some(count => !Number.isSafeInteger(count) || Number(count) < 0))
        || value.errors !== undefined && (!Array.isArray(value.errors) || value.errors.some(detail => typeof detail !== 'string'))) {
        throw new Error('서버의 문서 식별 상태 형식이 올바르지 않습니다.');
    }
    return value as Status;
}
function checkpoint(status: Status): string | null {
    if (!pausedStates.has(status.state) || !status.dataset_id || !status.backup_fingerprint || status.backup_epoch == null) return null;
    if (status.verified_epoch != null && status.verified_epoch !== status.backup_epoch) return null;
    return JSON.stringify([status.dataset_id, status.source_epoch, status.source_fingerprint, status.phase, status.cursor, status.backup_fingerprint, status.backup_epoch]);
}
async function request(action?: Action, generation?: number, expectation?: ActivationExpectation): Promise<unknown> {
    const response = await fetch('/api/identity', action ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...WIKI_CLIENT_HEADERS },
        body: JSON.stringify({
            action,
            ...(action === 'step' ? { limit: 100, generation } : {}),
            ...(action === 'activate' ? expectation : {}),
        }),
    } : { cache: 'no-store' });
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new Error(`문서 식별 응답을 확인할 수 없습니다. (${response.status})`); }
    if (!response.ok) throw new Error(object(data) && typeof data.error === 'string' ? data.error : `문서 식별 요청 실패 (${response.status})`);
    return data;
}
function backupBlob(value: unknown): Blob {
    const tables = ['pages', 'revisions', 'trash', 'notes', 'bookmarks', 'threads', 'comments', 'files'];
    if (!object(value) || !['my-wiki-v2', 'my-wiki-v3'].includes(String(value.format)) || !tables.every(table => Array.isArray(value[table]))) {
        throw new Error('서버가 완전한 백업 형식을 반환하지 않았습니다. 활성화 전에 백업을 다시 확인하세요.');
    }
    if (value.format === 'my-wiki-v3' && (!object(value.identity) || typeof value.identity.dataset_id !== 'string'
        || !['documents', 'events', 'imports'].every(key => Array.isArray((value.identity as Record<string, unknown>)[key])))) {
        throw new Error('v3 백업에 문서 식별 자료가 없습니다.');
    }
    const blob = new Blob([JSON.stringify(value)], { type: 'application/json' });
    if (blob.size > LIMIT) throw new Error('전체 백업이 24 MiB를 초과합니다.');
    return blob;
}

export function WikiIdentity({ changed }: { changed?: () => unknown }) {
    const [status, setStatus] = useState<Status | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [validation, setValidation] = useState('');
    const [verification, setVerification] = useState<Verification | null>(null);
    const [download, setDownload] = useState<Download | null>(null);
    const [reviewed, setReviewed] = useState(false);
    const pending = useRef(false);
    const downloaded = useRef<Download | null>(null);

    function clearDownload() {
        downloaded.current = null;
        setDownload(null);
        setReviewed(false);
    }
    async function readStatus() {
        const next = parseStatus(await request());
        setStatus(next);
        if (downloaded.current && downloaded.current.checkpoint !== checkpoint(next)) clearDownload();
        return next;
    }
    async function refresh() {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError('');
        try { await readStatus(); }
        catch (cause) { setStatus(null); clearDownload(); setError((cause as Error).message); }
        finally { pending.current = false; setBusy(false); }
    }
    async function run(action: Action) {
        if (pending.current || !status) return;
        const paused = pausedStates.has(status.state);
        const prepared = !!status.source_fingerprint;
        const readyToVerify = ['migrating', 'verified', 'maintenance'].includes(status.state) && status.phase === 'done';
        if (action === 'start' && (status.schema_ready === false || status.state !== 'legacy' && (status.state !== 'frozen' || prepared))
            || action === 'reopen' && status.state !== 'active'
            || action === 'step' && (!['frozen', 'migrating'].includes(status.state) || !prepared || !status.source_backup_fingerprint || status.phase === 'done')
            || action === 'verify' && !readyToVerify
            || action === 'backup' && (!paused || status.state === 'frozen' && !prepared)
            || action === 'activate' && (status.state !== 'verified' || status.phase !== 'done' || status.verified_epoch == null
                || status.backup_epoch !== status.verified_epoch || !reviewed || downloaded.current?.format !== 'my-wiki-v3'
                || downloaded.current.checkpoint !== checkpoint(status))) return;
        pending.current = true;
        setBusy(true);
        setError('');
        setMessage('');
        if (['start', 'reopen', 'step', 'backup'].includes(action)) clearDownload();
        if (['start', 'reopen', 'step', 'verify'].includes(action)) { setValidation(''); setVerification(null); }
        try {
            let expectation: ActivationExpectation | undefined;
            if (action === 'activate') {
                const approved = downloaded.current;
                const current = await readStatus();
                if (!approved || current.state !== 'verified' || current.phase !== 'done' || current.verified_epoch == null || current.generation == null
                    || current.backup_epoch !== current.verified_epoch || approved.checkpoint !== checkpoint(current)) {
                    throw new Error('백업 또는 검증 체크포인트가 변경되었습니다. 최신 백업을 다운로드하고 별도로 검증한 뒤 다시 활성화하세요.');
                }
                expectation = {
                    expected_generation: current.generation,
                    expected_backup_epoch: approved.backupEpoch,
                    expected_backup_fingerprint: approved.backupFingerprint,
                    expected_dataset_id: approved.datasetId,
                };
            }
            const result = await request(action, status.generation, expectation);
            if (action === 'backup') {
                const blob = backupBlob(result);
                const bytes = await blob.arrayBuffer();
                const digest = await crypto.subtle.digest('SHA-256', bytes);
                const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
                const next = await readStatus();
                const key = checkpoint(next);
                if (!key) throw new Error('서버의 고정 백업 체크포인트를 확인할 수 없습니다. 상태를 확인한 뒤 다시 다운로드하세요.');
                // The endpoint returns the portable file, not an envelope. Its
                // checkpoint must be the single generation advanced by this
                // backup; otherwise another admin action may have intervened.
                if (status.generation === undefined || next.generation !== status.generation + 1 || next.dataset_id !== status.dataset_id) {
                    throw new Error('백업 이후 서버 체크포인트가 변경되었습니다. 상태를 확인한 뒤 다시 다운로드하세요.');
                }
                const format = (result as Record<string, unknown>).format as string;
                if (next.phase === 'done' && format !== 'my-wiki-v3') throw new Error('이관 완료 후에는 문서 ID를 포함한 v3 백업이 필요합니다.');
                if (format === 'my-wiki-v3' && (result as { identity: { dataset_id: string } }).identity.dataset_id !== next.dataset_id) {
                    throw new Error('백업과 현재 문서 데이터 집합이 일치하지 않습니다.');
                }
                const filename = `PAW Wiki-고정백업-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                try {
                    anchor.href = url;
                    anchor.download = filename;
                    document.body.appendChild(anchor);
                    anchor.click();
                } finally {
                    anchor.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
                const saved = {
                    checkpoint: key, filename, bytes: blob.size, sha256, format,
                    datasetId: next.dataset_id!, backupEpoch: next.backup_epoch!, backupFingerprint: next.backup_fingerprint!,
                };
                downloaded.current = saved;
                setDownload(saved);
                setMessage('파일 다운로드를 요청했습니다. 로컬 저장 완료와 파일 내용·첨부 보존을 별도로 검증한 뒤 아래 확인란을 선택하세요.');
            } else {
                await readStatus();
                if (action === 'verify') {
                    setValidation(JSON.stringify(result, null, 2));
                    const check = object(result) ? result.validation : null;
                    if (object(check) && typeof check.valid === 'boolean' && Number.isSafeInteger(check.records)
                        && Number(check.records) >= 0 && Array.isArray(check.problems) && check.problems.every(problem => typeof problem === 'string')) {
                        setVerification({ valid: check.valid, records: Number(check.records), problems: check.problems });
                    }
                    setMessage('서버 보존 검증 응답을 받았습니다. 아래 검증 결과를 확인하세요.');
                } else if (action === 'activate') {
                    setValidation(JSON.stringify(result, null, 2));
                    setMessage('활성화 요청의 서버 응답을 받았습니다. 아래 결과와 새로 조회한 서버 상태를 확인하세요.');
                } else {
                    setMessage('요청의 서버 응답을 받고 현재 상태를 다시 조회했습니다.');
                }
                // Ordinary reads are deliberately paused during maintenance.
                // Refresh them only after normal editing has reopened.
                if (action === 'activate') void changed?.();
            }
        } catch (cause) {
            setError((cause as Error).message);
            // A failed response can follow a committed operation. Read the state;
            // never repeat a mutation automatically.
            try { await readStatus(); }
            catch { setStatus(null); clearDownload(); }
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }

    const paused = !!status && pausedStates.has(status.state);
    const canActivate = status?.state === 'verified' && status.phase === 'done' && status.verified_epoch != null
        && status.backup_epoch === status.verified_epoch && download?.format === 'my-wiki-v3'
        && reviewed && download.checkpoint === checkpoint(status);
    const canStep = !!status && ['frozen', 'migrating'].includes(status.state) && !!status.source_fingerprint
        && !!status.source_backup_fingerprint && status.phase !== 'done';
    const canVerify = !!status && ['migrating', 'verified', 'maintenance'].includes(status.state) && status.phase === 'done';
    const counts = Object.entries(status?.counts || {}).filter(([, count]) => Number.isSafeInteger(count) && count >= 0);
    return <section className="settings-block">
        <div className="settings-identity-content">
            <h2>문서 식별 관리</h2>
            <p>문서 ID 이관과 유지 관리를 수동으로 진행합니다. 편집을 멈춘 뒤 고정 백업을 저장하고, 이관·보존 검증 결과를 확인하여 편집을 다시 엽니다.</p>
            <button disabled={busy} onClick={() => void refresh()}>식별 상태 새로고침</button>
            {status && <>
                <p role="status">서버 상태: {stateLabels[status.state] || `알 수 없는 상태 (${status.state})`}</p>
                {status.phase && <p>이관 단계: {status.phase}{status.cursor !== undefined && status.cursor !== null && <> · 처리 위치: {status.cursor}</>}{status.generation !== undefined && <> · 체크포인트: {status.generation}</>}</p>}
                {counts.length > 0 && <dl className="backup-counts">{counts.map(([kind, count]) => <div key={kind}><dt>{countLabels[kind] || kind}</dt><dd>{count}</dd></div>)}</dl>}
                {status.errors?.map((detail, index) => <p key={index} role="alert" className="error">{detail}</p>)}
                {status.state === 'legacy' && <button disabled={busy || status.schema_ready === false} onClick={() => void run('start')}>편집 멈추고 이관 시작</button>}
                {status.schema_ready === false && <p>서버에 추가 스키마를 적용한 뒤 이관을 시작할 수 있습니다.</p>}
                {status.state === 'frozen' && !status.source_fingerprint && <button disabled={busy} onClick={() => void run('start')}>이관 준비 재개</button>}
                {status.state === 'active' && <>
                    <p>현재 ID와 이후 저장된 내용을 유지한 채 편집을 잠시 멈춥니다. 다시 열려면 고정 백업과 서버 보존 검증을 진행하세요.</p>
                    <button disabled={busy} onClick={() => void run('reopen')}>편집 잠시 멈추기</button>
                </>}
                {paused && <>
                    <p><button disabled={busy || status.state === 'frozen' && !status.source_fingerprint} onClick={() => void run('backup')}>고정 스냅샷 다운로드</button></p>
                    {['frozen', 'migrating'].includes(status.state) && <>
                        <p>한 번에 최대 100건씩 처리합니다. 중단 후에는 현재 서버 체크포인트에서 이어갑니다.</p>
                        {!status.source_backup_fingerprint && <p>이관을 시작하기 전에 최초 고정 스냅샷을 다운로드하세요.</p>}
                        <button disabled={busy || !canStep} onClick={() => void run('step')}>다음 묶음 이관·재개</button>
                    </>}
                    <p><button disabled={busy || !canVerify} onClick={() => void run('verify')}>서버 보존 검증</button></p>
                    {download && <>
                        <p>다운로드 요청 파일: {download.filename} · {download.bytes.toLocaleString()}바이트</p>
                        <section className="settings-result"><h3>다운로드 파일 SHA-256</h3><code>{download.sha256}</code></section>
                    </>}
                    <p><label><input type="checkbox" aria-label="고정 백업 독립 검증 확인" checked={reviewed} disabled={busy || !download} onChange={event => setReviewed(event.target.checked)}/> 다운로드한 파일의 로컬 저장 완료와 내용·첨부 보존을 별도로 검증했습니다.</label></p>
                    <button disabled={busy || !canActivate} onClick={() => void run('activate')}>검증한 ID 사용 활성화</button>
                    <p>모든 묶음 이관 후 서버 검증을 진행하고 최신 v3 고정 백업을 다시 다운로드하여 별도로 검증하세요. 활성화 시 서버가 백업과 검증의 저장소 세대가 같은지 다시 검사합니다.</p>
                </>}
            </>}
            {busy && <p role="status">문서 식별 요청 처리 중…</p>}
            {message && <p role="status">{message}</p>}
            {error && <p role="alert" className="error">{error}</p>}
            {verification && <>
                <p role="status">마지막 서버 보존 검증: {verification.valid ? '통과' : '실패'} · 검사 레코드 {verification.records.toLocaleString()}건</p>
                {verification.problems.map((problem, index) => <p key={index} role="alert" className="error">{problem}</p>)}
            </>}
            {validation && <section className="settings-result"><h3>마지막 서버 응답 상세</h3><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{validation}</pre></section>}
        </div>
    </section>;
}
