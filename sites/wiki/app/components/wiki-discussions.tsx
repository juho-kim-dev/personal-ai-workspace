'use client';
import {useEffect,useRef,useState} from 'react';
import {WikiMarkup} from '../wiki-markup';
import {contributionLabel,type ContributionSummary} from '../../lib/wiki-contribution-ui';
import {clearSubmittedDraft,discussionDraftKey,discussionDraftScope,emptyDiscussionDraft,parseDiscussionDraft,readDiscussionDraft,readLegacyDiscussionDrafts,sameDiscussionDraft,saveDiscussionDraft,type DiscussionDraft,type LegacyDiscussionDraft} from '../../lib/wiki-discussion-drafts';
import {modifiedLinkClick,wikiHref} from '../../lib/wiki-navigation';
import {WIKI_CLIENT_HEADERS} from '../../lib/wiki-client-protocol';
type Thread={id:string;title:string;document_id?:string|null;subject:string;status:'open'|'paused'|'closed';version:string;created_at:string;updated_at:string};
type Comment={contribution?:ContributionSummary;id:string;thread_id:string;number:number;body:string;created_at:string};
type Detail={thread:Thread;comments:Comment[]};
export type DiscussionRouteNormalization={
 fromTitle:string;title:string;threadId:string;anchor:string;documentId?:string|null;
 // Check immediately before replacing the route, including after any async guard.
 isCurrent:()=>boolean;
};
const storageWarning='초안 저장 공간을 사용할 수 없습니다. 이 화면의 초안만 유지됩니다.';
const submittedDraftNotice='요청은 서버에 반영되었습니다. 초안 보호를 위해 제출한 내용이 남아 있을 수 있습니다. 다시 제출하기 전에 토론을 확인하세요.';
const labels={open:'진행 중',paused:'일시 중지',closed:'종료'};
const displayTime=(value:string)=>new Date(value).toLocaleString('sv-SE',{timeZone:'Asia/Seoul'});
async function request<T = Detail>(op:string,data:Record<string,unknown>,write=false){const r=await fetch('/api/discussions'+(write?'':'?'+new URLSearchParams({op,...data as Record<string,string>})),write?{method:'POST',headers:{...WIKI_CLIENT_HEADERS,'Content-Type':'application/json'},body:JSON.stringify({op,...data})}:{cache:'no-store'});const j=await r.json() as T & {error?:string};if(!r.ok)throw new Error(j.error||'토론 요청 실패');return j;}
function checkedDetail(value:Detail,id?:string,documentId?:string|null){
 if(!value?.thread||!value.thread.id||(id&&value.thread.id!==id)||!value.thread.title||!value.thread.version||(value.thread.document_id!=null&&(typeof value.thread.document_id!=='string'||!value.thread.document_id))||(documentId&&value.thread.document_id!==documentId)||!Object.hasOwn(labels,value.thread.status)||!Array.isArray(value.comments)||value.comments.some(c=>c.thread_id!==value.thread.id))throw new Error('토론 응답을 확인할 수 없습니다. 다시 불러오세요.');
 return value;
}
const documentExtra=(documentId?:string|null):Record<string,string>=>documentId?{document_id:documentId}:{};
export function WikiDiscussions({title,threadId,documentId,datasetId,anchor='',open,known,normalizeRoute}:{title:string;threadId:string;documentId?:string|null;datasetId?:string|null;anchor?:string;open:(t:string,v?:string,e?:Record<string,string>)=>unknown;known:string[];normalizeRoute?:(route:DiscussionRouteNormalization)=>boolean}){
 const [threads,setThreads]=useState<Thread[]>([]),[loaded,setLoaded]=useState<{detail:Detail;visit:number}|null>(null),[filter,setFilter]=useState('all'),[subject,setSubject]=useState(''),[body,setBody]=useState(''),[summary,setSummary]=useState(''),[status,setStatus]=useState<Thread['status']>('open'),[error,setError]=useState(''),[reload,setReload]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [subjectFilter,setSubjectFilter]=useState(''),[preview,setPreview]=useState(false),[raw,setRaw]=useState<Record<string,boolean>>({}),[draftNotice,setDraftNotice]=useState(''),[storageNotice,setStorageNotice]=useState(''),[legacyDrafts,setLegacyDrafts]=useState<LegacyDiscussionDraft[]>([]);
 const [submissionNotices,setSubmissionNotices]=useState<Record<string,string>>({});
 const scope=discussionDraftScope(title,threadId,datasetId,documentId),routeScope=JSON.stringify([title,threadId,documentId??null,datasetId??null]);
 const identifiedCompose=!threadId&&!!documentId&&!!datasetId;
 const current=useRef({scope,routeScope,anchor,visit:0,navigation:0}),epoch=useRef(0),pending=useRef(new Set<string>()),drafts=useRef(new Map<string,DiscussionDraft>()),edits=useRef(new Map<string,number>()),normalizations=useRef(new Set<string>()),storageFailures=useRef(new Set<string>());
 if(current.current.routeScope!==routeScope)current.current={scope,routeScope,anchor,visit:current.current.visit+1,navigation:current.current.navigation+1};
 else if(current.current.anchor!==anchor)current.current={...current.current,anchor,navigation:current.current.navigation+1};
 const visit=current.current.visit,detail=loaded?.visit===visit?loaded.detail:null,detailRef=useRef(detail);detailRef.current=detail;
 const actualTitle=detail?.thread.title||title;
 function showDraft(d:DiscussionDraft){setSubject(d.subject);setBody(d.body);setSummary(d.summary);}
 function warnStorage(key:string){storageFailures.current.add(key);if(current.current.scope===key)setStorageNotice(storageWarning);}
 function persist(key:string,d:DiscussionDraft){
  drafts.current.set(key,d);
  try{saveDiscussionDraft(key,d);storageFailures.current.delete(key);if(current.current.scope===key)setStorageNotice('');return true;}catch{warnStorage(key);return false;}
 }
 function draft(patch:Partial<DiscussionDraft>){
  if(current.current.visit!==visit)return;
  const d={...(drafts.current.get(scope)||emptyDiscussionDraft()),...patch};
  setSubmissionNotices(notices=>({...notices,[scope]:''}));
  edits.current.set(scope,(edits.current.get(scope)||0)+1);persist(scope,d);showDraft(d);
 }
 function recoverDrafts(titles:string[]){
  let d=drafts.current.get(scope),failed=false;
  if(!d){try{d=readDiscussionDraft(scope)||undefined;}catch{failed=true;}}
  const legacy=threadId||identifiedCompose?readLegacyDiscussionDrafts(threadId,titles):{drafts:[],failed:false};
  // Memory (including new input or an explicit empty draft) takes precedence.
  // Legacy originals are never overwritten, removed, or silently merged.
  // Old new-discussion drafts carry no version/identity ownership evidence.
  // Expose them for inspection without assigning them to the loaded document.
  if(!d&&threadId)d=legacy.drafts[0]?.draft;
  if(d){drafts.current.set(scope,d);showDraft(d);}
  else showDraft(emptyDiscussionDraft());
  setLegacyDrafts(legacy.drafts);
  if(failed||legacy.failed)setDraftNotice('저장된 초안을 모두 읽을 수 없습니다. 현재 입력과 읽을 수 있는 초안은 유지합니다.');
  else if(d&&(d.subject||d.body||d.summary))setDraftNotice('저장된 초안을 복구했습니다.');
 }
 useEffect(()=>{
  setDraftNotice('');setStorageNotice(storageFailures.current.has(scope)?storageWarning:'');setLegacyDrafts([]);setPreview(false);setRaw({});recoverDrafts([title]);
 },[scope]);
 useEffect(()=>{
  const id=++epoch.current;let active=true;
  const valid=()=>active&&id===epoch.current&&current.current.visit===visit;
  setLoaded(null);setThreads([]);setError('');setLoading(true);setBusy(pending.current.has(scope));
  (threadId?request('read',{id:threadId}):request<Thread[]>('list',{title,...documentExtra(documentId)})).then(r=>{
   if(!valid())return;
   if(threadId){const next=checkedDetail(r as Detail,threadId);recoverDrafts([title,next.thread.title]);setLoaded({detail:next,visit});setStatus(next.thread.status);}
   else setThreads(r as Thread[]);
  }).catch(e=>{if(valid())setError(e.message);}).finally(()=>{if(valid())setLoading(false);});
  return()=>{active=false;epoch.current++;};
 },[routeScope,reload]);
 useEffect(()=>{
  if(!detail||!normalizeRoute||(actualTitle===title&&(detail.thread.document_id??null)===(documentId??null))||loading||error)return;
  const key=JSON.stringify([visit,title,actualTitle,threadId,detail.thread.document_id??null]);
  if(normalizations.current.has(key))return;
  const id=epoch.current,navigation=current.current.navigation;
  const isCurrent=()=>current.current.visit===visit&&current.current.navigation===navigation&&epoch.current===id&&detailRef.current===detail;
  // This is a guarded replace request, never a call to open/navigate. The
  // parent must keep this component mounted and retain its navigation guards.
  // A rejected guard remains retryable on fresh props/detail/anchor. This
  // effect changes no state, so rejection cannot schedule a render loop.
  if(normalizeRoute({fromTitle:title,title:actualTitle,threadId:detail.thread.id,documentId:detail.thread.document_id??null,anchor,isCurrent})===true)normalizations.current.add(key);
 },[detail,title,actualTitle,threadId,documentId,anchor,normalizeRoute,loading,error,visit]);
 useEffect(()=>{if(!detail||!anchor)return;const id=epoch.current;const timer=setTimeout(()=>{if(current.current.visit===visit&&current.current.anchor===anchor&&id===epoch.current)document.getElementById?.(anchor)?.scrollIntoView();},0);return()=>clearTimeout(timer);},[detail,anchor,visit]);
 async function write(op:'create'|'comment'|'status'){
  if(current.current.visit!==visit||pending.current.has(scope)||loading||error||(op!=='create'&&(!detail||detailRef.current!==detail||detail.thread.id!==threadId)))return;
  const origin=scope,requestEpoch=epoch.current,submitted={subject,body,summary},editAtSubmit=edits.current.get(origin)||0;
  let storedAtSubmit:string|null|undefined;try{storedAtSubmit=sessionStorage.getItem(discussionDraftKey(origin));}catch{warnStorage(origin);}
  pending.current.add(origin);setBusy(true);setError('');
  try{
   const r=checkedDetail(await request(op,op==='create'?{title,...documentExtra(documentId),subject:subject.trim(),body}:op==='comment'?{thread_id:detail!.thread.id,body,expected_version:detail!.thread.version}:{thread_id:detail!.thread.id,status,expected_version:detail!.thread.version,summary:summary.trim()},true),op==='create'?undefined:detail!.thread.id,op==='create'?documentId:detail!.thread.document_id);
   const edited=(edits.current.get(origin)||0)!==editAtSubmit;
   let retained=drafts.current.get(origin)||emptyDiscussionDraft(),storageMatches=false;
   if(storedAtSubmit===undefined)warnStorage(origin);
   else{
    try{
     const storedNow=sessionStorage.getItem(discussionDraftKey(origin)),saved=parseDiscussionDraft(storedNow);
     storageMatches=storedNow===storedAtSubmit;
     if(!storageMatches&&!edited)retained=saved||emptyDiscussionDraft();
    }catch{warnStorage(origin);}
   }
   // Only a successfully read/parsed, matching snapshot permits automatic
   // clearing. Compare and recover from the same bytes, without a second read.
   const canClear=storageMatches&&!edited;
   const next=canClear?clearSubmittedDraft(retained,submitted,op==='create'?['subject','body']:op==='comment'?['body']:['summary']):retained;
   // An intervening edit/discard already owns its storage state. In particular,
   // a successful response must not overwrite memory-only input after quota
   // failure with another instance's saved value, or rewrite that saved value.
   let persisted=false;
   if(canClear)persisted=persist(origin,next);else drafts.current.set(origin,next);
   setSubmissionNotices(notices=>({...notices,[origin]:canClear&&persisted?'':submittedDraftNotice}));
   // Acknowledging a submitted draft is independent of applying server detail.
   // Never let an old visit/read generation change the current route or version.
   if(current.current.scope===origin)showDraft(next);
   if(current.current.visit!==visit||epoch.current!==requestEpoch)return;
   epoch.current++;
   if(op==='create')open(r.thread.title,'discussions',{thread:r.thread.id,...documentExtra(r.thread.document_id)});
   else{recoverDrafts([title,r.thread.title]);setLoaded({detail:r,visit});setStatus(r.thread.status);}
  }catch(e){if(current.current.visit===visit&&epoch.current===requestEpoch)setError((e as Error).message+' 최신 토론을 다시 열어 기준 판을 확인하세요. 초안은 보관됩니다.');}
  finally{pending.current.delete(origin);if(current.current.scope===origin)setBusy(false);}
 }
 const extra=(anchor?:string)=>({thread:detail?.thread.id||threadId,...documentExtra(detail?.thread.document_id),...(anchor?{anchor}:{})});
 const otherDrafts=legacyDrafts.filter(d=>identifiedCompose||!sameDiscussionDraft(d.draft,{subject,body,summary}));
 return <section className="discussions"><p className="discussion-hint">이 문서에 연결된 비공개 토론입니다.</p>{draftNotice&&<p role="status">{draftNotice}</p>}{storageNotice&&<p role="status">{storageNotice}</p>}{submissionNotices[scope]&&<p role="status">{submissionNotices[scope]}</p>}{otherDrafts.length>0&&<aside aria-label="보관된 토론 초안"><p role="status">{identifiedCompose?'문서 소속을 확인할 수 없는 이전 새 토론 초안입니다. 자동으로 복구하지 않습니다. ':''}서로 다른 초안 {otherDrafts.length}개를 원래 저장 위치에 보관했습니다. 아래에서 내용을 확인하고 필요한 부분을 복사하세요. 작성 중인 초안을 버려도 이 원본은 삭제하지 않습니다.</p>{otherDrafts.map(d=><details key={d.scope}><summary>{d.title} — 보관된 초안</summary><pre>{'주제: '+d.draft.subject+'\n본문: '+d.draft.body+'\n변경 사유: '+d.draft.summary}</pre></details>)}</aside>}{detail&&actualTitle!==title&&<p role="status">이 토론의 현재 문서: {actualTitle} · <a href={wikiHref(actualTitle,'discussions',extra(anchor))} onClick={e=>{if(modifiedLinkClick(e))return;e.preventDefault();open(actualTitle,'discussions',extra(anchor));}}>현재 토론 열기</a></p>}{(subject||body||summary)&&<button onClick={()=>{setDraftNotice('작성 중인 초안을 버렸습니다. 보관된 이전 초안은 유지됩니다.');draft({subject:'',body:'',summary:''});}}>초안 버리기</button>}<button disabled={busy} onClick={()=>setReload(n=>n+1)}>새로고침</button>{error&&<div><p role="alert" className="error">{error}</p><button disabled={busy} onClick={()=>setReload(n=>n+1)}>최신 토론 다시 불러오기</button></div>}<div className="discussion-compose-tabs" role="group" aria-label="토론 작성 보기"><button aria-pressed={!preview} onClick={()=>setPreview(false)}>RAW 작성</button><button aria-pressed={preview} onClick={()=>setPreview(true)}>미리보기</button></div>{preview&&<div className="discussion-preview" aria-label="토론 작성 미리보기">{body?<WikiMarkup content={body} open={open} known={known} idPrefix="discussion-compose-preview-"/>:<p>미리 볼 내용이 없습니다.</p>}</div>}{loading?<p role="status">토론을 불러오는 중…</p>:!threadId?<><label>토론 상태<select aria-label="토론 상태 필터" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">전체</option>{Object.entries(labels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>주제 검색<input aria-label="토론 주제 필터" value={subjectFilter} onChange={e=>setSubjectFilter(e.target.value)}/></label>{!threads.some(t=>(filter==='all'||t.status===filter)&&t.subject.toLocaleLowerCase().includes(subjectFilter.toLocaleLowerCase()))&&<p role="status">조건에 맞는 토론이 없습니다.</p>}<ul>{threads.filter(t=>(filter==='all'||t.status===filter)&&t.subject.toLocaleLowerCase().includes(subjectFilter.toLocaleLowerCase())).map(t=><li key={t.id}><a href={wikiHref(t.title,'discussions',{thread:t.id,...documentExtra(t.document_id)})} onClick={e=>{if(modifiedLinkClick(e))return;e.preventDefault();open(t.title,'discussions',{thread:t.id,...documentExtra(t.document_id)});}}>{t.subject}</a> · {labels[t.status]}</li>)}</ul><h2>새 토론 시작</h2><label>주제<input aria-label="토론 주제" maxLength={180} disabled={busy} value={subject} onChange={e=>draft({subject:e.target.value})}/></label><label hidden={preview}>시작 글<textarea aria-label="토론 시작 글" maxLength={10000} disabled={busy} value={body} onChange={e=>draft({body:e.target.value})}/></label><button disabled={busy||!!error||!subject.trim()||!body.trim()} onClick={()=>void write('create')}>토론 시작</button></>:detail?<><a href={wikiHref(actualTitle,'discussions',documentExtra(detail.thread.document_id))} onClick={e=>{if(modifiedLinkClick(e))return;e.preventDefault();detail.thread.document_id?open(actualTitle,'discussions',documentExtra(detail.thread.document_id)):open(actualTitle,'discussions');}}>토론 목록</a><h2>{detail.thread.subject}</h2><p>{labels[detail.thread.status]} · 마지막 변경 {displayTime(detail.thread.updated_at)}</p>{detail.comments.map(c=><article className="discussion-comment" id={'comment-'+c.number} key={c.id}><header><a href={wikiHref(actualTitle,'discussions',extra('comment-'+c.number))}>#{c.number}</a> · {contributionLabel(c.contribution)} · <time>{displayTime(c.created_at)}</time></header><button aria-pressed={!!raw[c.id]} onClick={()=>setRaw(v=>({...v,[c.id]:!v[c.id]}))}>#{c.number} RAW</button>{raw[c.id]?<pre className="discussion-raw">{c.body}</pre>:<WikiMarkup content={c.body} open={open} known={known} commentHref={n=>detail.comments.some(c=>c.number===n)?wikiHref(actualTitle,'discussions',extra('comment-'+n)):null} idPrefix={'discussion-'+encodeURIComponent(detail.thread.id)+'-'+c.number+'-'}/>}<a href={wikiHref(actualTitle,'discussions',extra('discussion-reply'))}>댓글 작성 위치로</a><button disabled={busy||!!error||detail.thread.status!=='open'} onClick={()=>{draft({body:body+(body?'\n':'')+'#'+c.number+'에 답변\n'+c.body.split('\n').map(l=>'> '+l).join('\n')+'\n'});open(actualTitle,'discussions',extra('discussion-reply'));}}>#{c.number} 인용 답변</button></article>)}{detail.thread.status!=='open'&&<p role="status">{detail.thread.status==='closed'?'종료':'일시 중지'}된 토론에는 댓글을 쓸 수 없습니다. 사유와 함께 진행 중으로 변경하면 이어 쓸 수 있습니다.</p>}<label hidden={preview} id="discussion-reply">댓글<textarea aria-label="토론 댓글" maxLength={10000} disabled={detail.thread.status!=='open'} value={body} onChange={e=>draft({body:e.target.value})}/></label><button disabled={busy||!!error||detail.thread.status!=='open'||!body.trim()} onClick={()=>void write('comment')}>댓글 등록</button><h3>토론 상태 변경</h3><label>변경할 상태<select aria-label="변경할 토론 상태" disabled={busy} value={status} onChange={e=>setStatus(e.target.value as Thread['status'])}>{Object.entries(labels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>변경 사유<input aria-label="토론 상태 변경 사유" maxLength={300} disabled={busy} value={summary} onChange={e=>draft({summary:e.target.value})}/></label><button disabled={busy||!!error||status===detail.thread.status||!summary.trim()} onClick={()=>void write('status')}>사유와 함께 상태 변경</button></>:<p>토론을 표시할 수 없습니다. 토론 목록을 다시 여세요.</p>}</section>;
}
