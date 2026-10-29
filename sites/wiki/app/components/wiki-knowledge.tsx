'use client';
import {useEffect,useRef,useState} from 'react';
import {WikiDiff} from './wiki-diff';
import {wikiHref,modifiedLinkClick} from '../../lib/wiki-navigation';
import {WIKI_CLIENT_HEADERS} from '../../lib/wiki-client-protocol';
import type {WorkContext} from '../../lib/wiki-knowledge-contract';

type Page={title:string;document_id?:string|null;version:string;content:string};
type Entry={id:string;document_id:string;revision_id:string;kind:string;subject_id:string|null;title:string;state:string;current_version:string;historical:boolean;closed:number;payload:Record<string,any>;work_context:WorkContext;principal:{channel:string};created_at:string};
const kinds:Record<string,string>={evidence:'근거',observation:'원본 관측',issue:'재검토 후보',proposal:'수정안',review:'검토',resolution:'종결',contribution:'기여',applied:'수정안 반영'};
const categories:Record<string,string>={source_changed:'새 원본 버전',stale:'확인 시점 경과',conflict:'다른 판단',missing_evidence:'근거 미연결',broken_reference:'참조 확인 필요',other:'기타'};
const results:Record<string,string>={reviewed:'검토함',changes_requested:'수정 요청',adopted:'채택함',resolved:'확인 완료',dismissed:'검토 대상에서 제외'};
async function request(input:Record<string,unknown>,signal?:AbortSignal,write=false) {
    const response=await fetch('/api/knowledge'+(write?'':'?'+new URLSearchParams(Object.entries(input).map(([k,v])=>[k,String(v)]))),{
        method:write?'POST':'GET',credentials:'same-origin',cache:'no-store',signal,
        ...(write?{headers:{...WIKI_CLIENT_HEADERS,'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});
    const data:any=await response.json();if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('기록 응답 형식이 올바르지 않습니다.');if(!response.ok)throw new Error(data.error||'기록을 처리하지 못했습니다.');return data;
}
function context(form:FormData):WorkContext {
    return Object.fromEntries(['session_id','actor_name','actor_kind','client','model','thread_url','project'].map(key=>[key,String(form.get(key)||'').trim()]).filter(([,v])=>v)) as WorkContext;
}
function WorkFields() {return <fieldset className="knowledge-context"><legend>작업 맥락 (선택)</legend><p>실제로 작성·수정·검토한 사람이나 AI의 맥락을 적습니다. 안내서의 화자와 구분하며, 입력한 정보는 로그인이나 실제 모델을 증명하지 않습니다.</p><div className="knowledge-fields">
    <label>작업 번호<input name="session_id" maxLength={200}/></label><label>작성 주체<input name="actor_name" maxLength={200}/></label>
    <label>주체 구분<select name="actor_kind" defaultValue="unknown"><option value="unknown">미확인</option><option value="person">사람 (직접 입력)</option><option value="ai">AI (직접 입력)</option></select></label>
    <label>사용 앱<input name="client" maxLength={200}/></label><label>모델<input name="model" maxLength={200}/></label><label>대화 주소<input type="url" name="thread_url" maxLength={2000}/></label><label>프로젝트<input name="project" maxLength={300}/></label>
    </div></fieldset>;}
export function WikiKnowledge({page,title,queue=false,revisionId,open,changed}:{page?:Page|null;title:string;queue?:boolean;revisionId?:string;open:(title:string,view?:string,extra?:Record<string,string>)=>unknown;changed:()=>void}) {
    const [items,setItems]=useState<Entry[]>([]),[available,setAvailable]=useState(true),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
    const [offset,setOffset]=useState(0),[more,setMore]=useState(false),[attempt,setAttempt]=useState(0),[onlyOpen,setOnlyOpen]=useState(queue),[session,setSession]=useState('');
    const [panel,setPanel]=useState('records');
    const [kind,setKind]=useState('evidence'),[selected,setSelected]=useState<Entry|null>(null),[comparison,setComparison]=useState<{event:Entry;before:string}|null>(null),[confirmed,setConfirmed]=useState(false);
    const pending=useRef<{key:string;id:string}|null>(null),active=useRef(0);
    const version=revisionId||page?.version;
    useEffect(()=>{const epoch=++active.current,controller=new AbortController();setLoading(true);setError('');
        const input:Record<string,unknown>={offset,limit:30,...(!queue?(page?.document_id?{document_id:page.document_id}:{title}):{}),...(onlyOpen?{queue:true}:{}),...(session?{session_id:session}:{}),...(revisionId?{revision_id:revisionId}:{})};
        request(input,controller.signal).then(data=>{if(epoch!==active.current)return;if(typeof data.available!=='boolean'||!Array.isArray(data.items))throw new Error('기록 응답을 확인할 수 없습니다.');
            if(!queue&&page?.document_id&&data.items.some((item:Entry)=>item.document_id!==page.document_id))throw new Error('다른 문서의 기록 응답입니다.');setAvailable(data.available);setItems(data.items);setMore(data.has_more);})
        .catch(e=>{if(!controller.signal.aborted&&epoch===active.current)setError(e.message);}).finally(()=>{if(epoch===active.current)setLoading(false);});
        return ()=>{active.current++;controller.abort();};
    },[page?.document_id,page?.version,title,queue,offset,onlyOpen,session,revisionId,attempt]);
    function Link({entry,view='read',children}:{entry:Entry;view?:string;children:React.ReactNode}) {
        const extra={document_id:entry.document_id,...(view==='read'?{rev:entry.revision_id}:{})};
        return <a href={wikiHref(entry.title,view,extra)} onClick={e=>{if(e.defaultPrevented||modifiedLinkClick(e))return;e.preventDefault();open(entry.title,view,extra);}}>{children}</a>;
    }
    async function mutate(input:Record<string,unknown>) {
        const epoch=active.current,key=JSON.stringify(input);if(pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()};
        setBusy(true);setError('');setMessage('');
        try{const result=await request({...input,request_id:pending.current.id},undefined,true);if(epoch!==active.current)return false;
            pending.current=null;setMessage(result.replayed?'같은 요청의 기존 결과를 확인했습니다.':'기록했습니다.');setAttempt(v=>v+1);changed();return true;
        }catch(e){if(epoch===active.current)setError((e as Error).message+' 결과가 불확실하면 기록을 다시 조회한 뒤 같은 요청으로 재시도하세요.');return false;}
        finally{setBusy(false);}
    }
    async function submit(event:React.FormEvent<HTMLFormElement>) {
        event.preventDefault();if(!page)return;const form=event.currentTarget,data=new FormData(form),value=(key:string)=>String(data.get(key)||'');
        let payload:Record<string,unknown>;
        if(kind==='evidence'||kind==='observation')payload={url:value('url'),label:value('label'),source_key:value('source_key'),source_version:value('source_version'),observed_at:new Date(value('observed_at')).toISOString(),scope:value('scope'),...(value('sha256')?{sha256:value('sha256')}:{}),...(kind==='evidence'?{relation:value('relation')}:{})};
        else if(kind==='proposal')payload={content:value('content'),summary:value('summary'),reason:value('reason'),scope:value('scope'),evidence_ids:data.getAll('evidence_ids')};
        else if(kind==='issue')payload={category:value('category'),reason:value('reason'),scope:value('scope')};
        else payload={result:value('result'),note:value('note'),...(kind==='review'?{scope:value('scope')}:{})};
        if(await mutate({op:'record',document_id:page.document_id,expected_version:page.version,revision_id:selected?.revision_id||version,kind,payload,work_context:context(data),...(selected?{subject_id:selected.id}:{})})){form.reset();setSelected(null);setPanel('records');}
    }
    async function compare(entry:Entry) {
        const epoch=active.current;setBusy(true);setError('');
        try{const full=await request({id:entry.id}),response=await fetch('/api/wiki?'+new URLSearchParams({op:'revision',title:entry.title,document_id:entry.document_id,id:entry.revision_id}),{credentials:'same-origin',cache:'no-store'}),base:any=await response.json();
            if(!response.ok||base.id!==entry.revision_id||base.document_id!==entry.document_id||full.event?.id!==entry.id||typeof full.event.payload.content!=='string')throw new Error('수정안과 기준 판을 확인할 수 없습니다.');
            if(epoch===active.current){setComparison({event:{...entry,...full.event},before:base.content});setConfirmed(false);}
        }catch(e){if(epoch===active.current)setError((e as Error).message);}finally{setBusy(false);}
    }
    return <section className="knowledge" aria-label={queue?'검토할 항목':'근거·검토'}>
        <p>근거와 변경 이유를 보존하고, 특정 판의 검토와 수정안을 연결합니다. 오래됨·새 원본·다른 판단은 재검토의 단서입니다.</p>
        {!queue&&page?.document_id&&<nav className="knowledge-actions" aria-label="근거·검토 메뉴">{[['records','기록 보기'],['evidence','출처 연결'],['review','검토 남기기'],['proposal','수정안 작성'],['scan','재검토 후보 찾기']].map(([id,label])=><button key={id} aria-pressed={panel===id} disabled={busy} onClick={()=>{setPanel(id);setSelected(null);if(['evidence','review','proposal'].includes(id))setKind(id);}}>{label}</button>)}</nav>}
        <div hidden={panel!=='records'} className="knowledge-toolbar"><label><input type="checkbox" checked={onlyOpen} onChange={e=>{setOnlyOpen(e.target.checked);setOffset(0);}}/>열린 항목만</label><label>작업 번호로 찾기<input value={session} maxLength={200} onChange={e=>{setSession(e.target.value);setOffset(0);}}/></label><button disabled={loading||busy} onClick={()=>setAttempt(v=>v+1)}>다시 조회</button></div>
        {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="error">{error}</p>}
        {loading?<p role="status">기록을 불러오는 중입니다…</p>:!available?<p>근거·검토 저장소가 아직 준비되지 않았습니다.</p>:<>
            {!queue&&page?.document_id&&<section hidden={panel!=='scan'} className="knowledge-scan"><h2>재검토 후보 찾기</h2><p>이 판의 근거 미연결·반대 근거를 찾습니다. 날짜를 정하면 그전에 관측한 근거도 확인 대상으로 남깁니다. 외부 주소에 접속하거나 본문을 바꾸지 않습니다.</p><form onSubmit={e=>{e.preventDefault();const date=String(new FormData(e.currentTarget).get('before')||'');void mutate({op:'scan',document_id:page.document_id,...(date?{checked_before:new Date(date).toISOString()}:{})});}}><label>이 시각 이전 근거 확인 (선택)<input name="before" type="datetime-local"/></label><button disabled={busy}>후보 확인</button></form></section>}
            {panel==='records'&&!items.length&&<p className="empty">표시할 기록이 없습니다. 과거의 작성자·검토 여부는 추정하지 않습니다.</p>}
            <ol hidden={panel!=='records'} className="knowledge-list">{items.map(entry=><li key={entry.id}>
                <div className="knowledge-row"><strong>{kinds[entry.kind]}</strong>{queue&&<Link entry={entry} view="knowledge">{entry.title}</Link>}<span>{entry.historical?'과거 판':'현재 판'}{entry.closed?' · 종결됨':''}</span><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</time></div>
                <p>{categories[entry.payload.category]||results[entry.payload.result]||entry.payload.label||entry.payload.summary||''}</p>
                {entry.payload.url&&<p><a href={entry.payload.url} target="_blank" rel="noopener noreferrer">출처 열기 ↗</a> · {entry.payload.source_version} · {entry.payload.observed_at}</p>}
                {entry.payload.scope&&<p>범위: {entry.payload.scope}</p>}{entry.payload.reason&&<p>{entry.payload.reason}</p>}{entry.payload.note&&<p>{entry.payload.note}</p>}
                <div className="knowledge-links"><Link entry={entry}>대상 판 보기</Link><Link entry={entry} view="history">역사</Link><Link entry={entry} view="discussions">토론</Link>
                    {!entry.closed&&entry.state==='live'&&entry.kind==='proposal'&&<button disabled={busy} onClick={()=>void compare(entry)}>변경 비교</button>}
                    {!queue&&!entry.closed&&['issue','proposal'].includes(entry.kind)&&<button disabled={busy} onClick={()=>{setSelected(entry);setKind('resolution');setPanel('resolution');}}>확인·제외 기록</button>}
                </div>
                <div className="knowledge-record-context"><p>작성 주체: {entry.work_context.actor_name||'미기록'} · 작업 번호: {entry.work_context.session_id||'미기록'}</p><p>앱: {entry.work_context.client||'미기록'} · 모델: {entry.work_context.model||'미기록'} · 프로젝트: {entry.work_context.project||'미기록'}</p><p>저장 경로: {entry.principal.channel==='mcp'?'서버 MCP':'브라우저 요청'}. 주체·모델·작업 정보는 클라이언트가 직접 입력한 정보이며, 백업으로 가져온 과거 기록의 진위는 별도 확인 대상입니다.</p>{entry.work_context.thread_url&&<a href={entry.work_context.thread_url} target="_blank" rel="noopener noreferrer">원본 대화 참조 ↗</a>}<p className="knowledge-record-id">기록 번호: <code title={entry.id}>{entry.id.slice(0,8)}</code></p></div>
            </li>)}</ol>
            {panel==='records'&&(items.length>0||offset>0)&&<div className="knowledge-toolbar"><button disabled={offset===0||loading||busy} onClick={()=>setOffset(v=>Math.max(0,v-30))}>이전</button><span>{items.length?`${offset+1}–${offset+items.length}번째 기록`:'표시할 기록 없음'}</span><button disabled={!more||loading||busy} onClick={()=>setOffset(v=>v+30)}>다음</button></div>}
            {comparison&&<section aria-label="수정안 검토" className="knowledge-proposal"><h2>{comparison.event.payload.summary}</h2><p>{comparison.event.payload.reason}</p><WikiDiff before={comparison.before} after={comparison.event.payload.content} left="제안 기준 판" right="수정안"/>
                {comparison.event.current_version!==comparison.event.revision_id?<p>기준 판이 오래되어 반영할 수 없습니다. 최신 원문과 비교해 새 수정안을 작성해 주세요.</p>:<><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>변경 내용을 확인했습니다.</label><button disabled={!confirmed||busy} onClick={()=>void mutate({op:'apply',proposal_id:comparison.event.id,expected_version:comparison.event.revision_id}).then(ok=>{if(ok){setComparison(null);setConfirmed(false);}})}>수정안 반영</button></>}<button disabled={busy} onClick={()=>setComparison(null)}>비교 닫기</button></section>}
            {!queue&&page?.document_id&&<section hidden={['records','scan'].includes(panel)} className="knowledge-add"><h2>{selected?'항목 확인·제외':kinds[kind]+' 기록 남기기'}</h2><form onSubmit={e=>void submit(e)}>
                <label>기록 종류<select aria-label="기록 종류" disabled={busy||!!selected} value={kind} onChange={e=>setKind(e.target.value)}><option value="evidence">근거 연결</option><option value="observation">새 원본 버전 관측</option><option value="issue">재검토 후보</option><option value="proposal">수정안 작성</option><option value="review">이 판 검토</option>{selected&&<option value="resolution">항목 확인·제외</option>}</select></label>
                <p>대상 판: <code title={version}>{version?.slice(0,8)}</code>{version!==page.version&&' · 과거 판의 기록입니다. 새 판에는 검토를 자동 승계하지 않습니다.'}</p>
                {selected&&<p>대상 항목: {selected.id}<button type="button" onClick={()=>{setSelected(null);setKind('evidence');}}>선택 취소</button></p>}
                <fieldset disabled={busy} key={kind}><legend>{kinds[kind]} 입력</legend>
                    {(kind==='evidence'||kind==='observation')&&<><p>주소와 관측 정보만 연결합니다. 원본 바이트는 자료 보존 기능에서 따로 보관하세요. 해시는 입력값이며 실제 파일 검증 결과가 아닙니다.</p><label>출처 이름<input name="label" required maxLength={300}/></label><label>고정 출처 주소<input name="url" type="url" required maxLength={2000}/></label><label>같은 자료를 묶을 이름<input name="source_key" required maxLength={2000}/></label><label>확인한 버전<input name="source_version" required maxLength={300}/></label><label>확인 시각<input name="observed_at" type="datetime-local" required/></label><label>SHA-256 (선택)<input name="sha256" pattern="[a-f0-9]{64}" maxLength={64}/></label>{kind==='evidence'&&<label>근거 관계<select name="relation"><option value="supports">뒷받침</option><option value="contradicts">다른 판단·반대 근거</option><option value="context">배경 자료</option></select></label>}</>}
                    {kind==='issue'&&<label>재검토 사유<select name="category">{Object.entries(categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
                    {['proposal','issue'].includes(kind)&&<label>이유<textarea name="reason" required maxLength={4000}/></label>}
                    {kind==='proposal'&&<><label>편집 요약<input name="summary" required maxLength={300}/></label><label>변경할 전체 원문<textarea name="content" defaultValue={page.content} maxLength={200000} rows={12}/></label><fieldset><legend>연결할 근거 (선택)</legend>{items.filter(item=>item.kind==='evidence').map(item=><label key={item.id}><input type="checkbox" name="evidence_ids" value={item.id}/>{item.payload.label} · {item.payload.source_version}</label>)}</fieldset><p>제안만 보존하며 현재 본문은 바뀌지 않습니다. 기준 판이 바뀌면 반영을 거부합니다.</p></>}
                    {['review','resolution'].includes(kind)&&<><label>결과<select name="result">{(kind==='review'?['reviewed','changes_requested','adopted']:['resolved','dismissed']).map(result=><option key={result} value={result}>{results[result]}</option>)}</select></label><label>확인 내용·의견<textarea name="note" required maxLength={4000}/></label><p>검토·채택은 사실성·최신성의 보증이나 토론 종료가 아닙니다.</p></>}
                    {kind!=='resolution'&&<label>확인·변경 범위<textarea name="scope" required maxLength={2000}/></label>}
                    <WorkFields/><button disabled={busy||kind==='proposal'&&version!==page.version}>기록 저장</button>
                </fieldset>
            </form></section>}
        </>}
    </section>;
}

/** Read-only, revision-scoped status. A missing record is never a quality verdict. */
export function WikiKnowledgeSummary({documentId,version,title,open}:{documentId:string;version:string;title:string;open:(title:string,view?:string,extra?:Record<string,string>)=>unknown}) {
    const [status,setStatus]=useState<{key:string;items:Entry[];more:boolean;state:string}|null>(null);
    const key=JSON.stringify([documentId,version]);
    useEffect(()=>{
        let current=true;const controller=new AbortController();
        request({document_id:documentId,revision_id:version,limit:100},controller.signal).then(data=>{
            if(!current)return;
            if(typeof data.available!=='boolean'||!Array.isArray(data.items)||data.items.some((e:Entry)=>e.document_id!==documentId||e.revision_id!==version))throw new Error('invalid scope');
            setStatus({key,items:data.items,more:!!data.has_more,state:data.available?'ready':'unavailable'});
        }).catch(()=>{if(current)setStatus({key,items:[],more:false,state:'error'});});
        return()=>{current=false;controller.abort();};
    },[documentId,version,key]);
    const snapshot=status?.key===key?status:null;
    const records=snapshot?.items.filter(e=>e.kind!=='contribution')||[];
    const evidence=records.filter(e=>e.kind==='evidence').length;
    const review=snapshot?.items.find(e=>e.kind==='review');
    const extra={document_id:documentId,rev:version};
    if(!snapshot || (snapshot.state==='ready' && !records.length && !snapshot.more)) return null;
    return <aside className="knowledge-summary" aria-label="이 판의 근거·검토">
        <a href={wikiHref(title,'knowledge',extra)} onClick={e=>{if(modifiedLinkClick(e))return;e.preventDefault();open(title,'knowledge',extra);}}>근거·검토</a>
        {snapshot.state==='error'?<span>기록을 확인하지 못했습니다. 근거·검토에서 다시 조회하세요.</span>:snapshot.state==='unavailable'?<span>기록 저장소 준비 전</span>:<>
            <span>{snapshot.more?'최근 100건 기준 · ':''}{evidence?`연결된 출처 ${evidence}건`:`연결된 기록 ${records.length}건`}</span>
            {review&&<span className="review-outcome">{`${results[review.payload.result]||'검토 기록'} · ${new Date(review.created_at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'})}`}</span>}
        </>}
    </aside>;
}
