'use client';
import {useRef, useState} from 'react';
import {WIKI_CLIENT_HEADERS} from '../../lib/wiki-client-protocol';
const LIMIT = 24 * 1024 * 1024;
type Counts = Record<string, number>;
type Preview = {fingerprint:string; counts:Counts; conflicts:{kind:string;key:string;reason:string}[];warnings:string[];can_apply:boolean;total_counts?:Counts;skipped?:number};
async function request<T = Preview>(body?:unknown) {
    const r = await fetch('/api/backup', body ? {method:'POST', headers:{...WIKI_CLIENT_HEADERS,'Content-Type':'application/json'},body:JSON.stringify(body)} : {cache:'no-store'});
    const data = await r.json() as T & {error?:string}; if (!r.ok) throw new Error(data.error || '백업 요청 실패'); return data;
}
export function WikiBackup({changed}:{changed:()=>unknown}) {
    const [backup,setBackup]=useState<unknown>(null), [preview,setPreview]=useState<Preview|null>(null), [error,setError]=useState(''), [busy,setBusy]=useState(false), [review,setReview]=useState(false), [result,setResult]=useState<{imported:Counts;skipped:number}|null>(null), [legacy,setLegacy]=useState(false);
    const epoch=useRef(0), pending=useRef(false);
    async function select(file?:File) {
        const id=++epoch.current; setPreview(null);setBackup(null);setResult(null);setReview(false);setError('');setLegacy(false);
        if (!file) return;
        try { if(file.size>LIMIT) throw new Error('JSON 파일은 최대 24 MiB까지 지원합니다.'); const text=await file.text(); if(new TextEncoder().encode(text).length>LIMIT)throw new Error('JSON 파일은 최대 24 MiB까지 지원합니다.');const data=JSON.parse(text); if(id===epoch.current){setBackup(data);setLegacy(data.format==='my-wiki-v1');} }
        catch(e){if(id===epoch.current)setError((e as Error).message);}
    }
    async function inspect() {
        if(pending.current || !backup)return;pending.current=true;setBusy(true);setError('');setReview(false);setPreview(null);const id=epoch.current;
        try {const p=await request({op:'preview',backup});if(id===epoch.current)setPreview(p);}catch(e){if(id===epoch.current)setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
    }
    async function apply() {
        if(pending.current||!preview?.can_apply||!review)return;pending.current=true;setBusy(true);setError('');
        try {setResult(await request<{imported:Counts;skipped:number}>({op:'apply',backup,fingerprint:preview.fingerprint}));setPreview(null);setReview(false);void changed();}
        catch(e){setError((e as Error).message+' 변경된 상태를 확인하려면 다시 미리보기 하세요.');setPreview(null);setReview(false);}
        finally{pending.current=false;setBusy(false);}
    }
    async function download(){if(pending.current)return;pending.current=true;setBusy(true);setError('');try{const data=await request<unknown>();const blob=new Blob([JSON.stringify(data)],{type:'application/json'});if(blob.size>LIMIT)throw new Error('전체 백업이 24 MiB를 초과합니다.');const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='PAW Wiki-전체백업-'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date())+'.json';a.click();URL.revokeObjectURL(url);}catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}}
    return <section className="settings-block"><h2>전체 백업 및 가져오기</h2><p>문서·이력·메모·즐겨찾기·휴지통·토론·첨부파일과 근거·검토 기록을 포함합니다. JSON 최대 24 MiB이며 첨부파일의 base64 크기도 포함됩니다. 기존 자료는 덮어쓰지 않는 병합 방식입니다.</p><div className="settings-operation"><h3>내보내기</h3><button disabled={busy} onClick={()=>void download()}>전체 백업 내보내기</button></div><div className="settings-operation"><h3>가져오기</h3><label className="settings-file">백업 JSON 선택<input type="file" accept="application/json,.json" aria-label="백업 JSON 선택" disabled={busy} onChange={e=>void select(e.target.files?.[0])}/></label>{legacy&&<p role="status">이전 my-wiki-v1 백업은 문서 현재 원문만 포함합니다. 이력·메모·첨부파일은 복구되지 않습니다.</p>}<button disabled={busy||!backup} onClick={()=>void inspect()}>가져오기 미리보기</button></div>{busy&&<p role="status">백업 처리 중…</p>}{error&&<p role="alert" className="error">{error}</p>}{preview&&<><h3>가져오기 검토</h3><h4>추가할 자료</h4><CountsView counts={preview.counts}/>{preview.total_counts&&<p>백업 전체 {Object.values(preview.total_counts).reduce((sum,n)=>sum+n,0)}건 · 동일 자료 건너뜀 {preview.skipped||0}건</p>}{preview.warnings.map((w,i)=><p key={i}>{w}</p>)}<h4>충돌 {preview.conflicts.length}건</h4><ul>{preview.conflicts.map((c,i)=><li key={i}>{c.kind} · {c.key}: {c.reason}</li>)}</ul><p>동일 자료는 건너뜁니다. 기존 자료와 내용이 다른 충돌이 있으면 전체 가져오기를 적용하지 않습니다. 적용 직전 상태가 바뀌면 다시 미리보기 해야 합니다.</p><label><input type="checkbox" checked={review} disabled={busy||!preview.can_apply} onChange={e=>setReview(e.target.checked)}/>항목 수·경고·충돌을 검토했습니다.</label><button disabled={busy||!review||!preview.can_apply} onClick={()=>void apply()}>검토한 백업 병합 적용</button>{!preview.can_apply&&<p>적용할 수 없는 백업입니다. 경고와 충돌을 확인하세요.</p>}</>}{result&&<div role="status"><h3>가져오기 완료</h3><CountsView counts={result.imported}/><p>건너뜀 {result.skipped}건</p></div>}</section>;
}
function CountsView({counts}:{counts:Counts}){const labels:Record<string,string>={pages:'문서',revisions:'이력',notes:'메모',bookmarks:'즐겨찾기',threads:'토론',comments:'댓글',trash:'휴지통',files:'파일',knowledge:'근거·검토 기록'};return <dl className="backup-counts">{Object.entries(counts).map(([k,v])=><div key={k}><dt>{labels[k]||k}</dt><dd>{v}</dd></div>)}</dl>;}
