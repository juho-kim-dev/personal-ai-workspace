import {WikiError} from './error';

export const KNOWLEDGE_KINDS = ['evidence','observation','issue','proposal','review','resolution','contribution','applied'] as const;
export type KnowledgeKind = typeof KNOWLEDGE_KINDS[number];
export type WorkContext = {session_id?:string;actor_name?:string;actor_kind?:'person'|'ai'|'unknown';client?:string;model?:string;thread_url?:string;project?:string};
export type KnowledgePrincipal = {subject:string;channel:'browser'|'mcp'};
export type KnowledgeRecord = {id:string;document_id:string;revision_id:string;kind:KnowledgeKind;subject_id:string|null;source_key:string|null;source_version:string|null;payload:string;work_context:string;principal:string;created_at:string};
export const KNOWLEDGE_FIELDS = ['id','document_id','revision_id','kind','subject_id','source_key','source_version','payload','work_context','principal','created_at'] as const;
export function knowledgeText(value:unknown,max:number,label:string,empty=false):string {
    if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new WikiError(`${label} 형식을 확인해 주세요.`);
    return value;
}
export function knowledgeToken(value:unknown):string {
    const token=knowledgeText(value,80,'기록 번호');
    if(!/^[a-z0-9-]+$/i.test(token))throw new WikiError('기록 번호 형식이 올바르지 않습니다.');
    return token;
}
export function knowledgeDate(value:unknown):string {
    const date=knowledgeText(value,40,'관측 시각');
    if(!/^\d{4}-\d\d-\d\dT/.test(date)||!Number.isFinite(Date.parse(date)))throw new WikiError('관측 시각은 시간대가 있는 ISO 날짜여야 합니다.');
    if(!/(?:Z|[+-]\d\d:\d\d)$/.test(date))throw new WikiError('관측 시각의 시간대가 필요합니다.');
    return new Date(date).toISOString();
}
export function knowledgeURL(value:unknown):string {
    const text=knowledgeText(value,2000,'출처 주소');let url:URL;
    try{url=new URL(text);}catch{throw new WikiError('출처의 전체 웹 주소를 입력해 주세요.');}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new WikiError('출처에는 인증 정보 없는 HTTP(S) 주소만 사용할 수 있습니다.');
    return url.href;
}
function object(value:unknown,keys:readonly string[]) {
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new WikiError('지원하지 않는 기록 필드입니다.');
    return value as Record<string,unknown>;
}
export function workContextInput(value:unknown):WorkContext {
    if(value===undefined)return {};
    const raw=object(value,['session_id','actor_name','actor_kind','client','model','thread_url','project']),out:Record<string,string>={};
    for(const [key,item] of Object.entries(raw).sort(([a],[b])=>a.localeCompare(b))){
        out[key]=key==='thread_url'?knowledgeURL(item):knowledgeText(item,key==='project'?300:200,'작업 맥락');
        if(key==='actor_kind'&&!['person','ai','unknown'].includes(out[key]))throw new WikiError('작성 주체 구분이 올바르지 않습니다.');
    }
    return out as WorkContext;
}
export function knowledgePayload(kind:KnowledgeKind,value:unknown):Record<string,any> {
    let raw:Record<string,unknown>;
    if(kind==='evidence'||kind==='observation'){
        raw=object(value,['url','label','source_key','source_version','observed_at','scope','sha256','relation']);
        const out:Record<string,any>={url:knowledgeURL(raw.url),label:knowledgeText(raw.label,300,'출처 이름'),source_key:knowledgeText(raw.source_key,2000,'자료 식별자'),source_version:knowledgeText(raw.source_version,300,'자료 버전'),observed_at:knowledgeDate(raw.observed_at),scope:knowledgeText(raw.scope,2000,'확인 범위')};
        if(raw.sha256!==undefined){if(typeof raw.sha256!=='string'||!/^[a-f0-9]{64}$/.test(raw.sha256))throw new WikiError('SHA-256 형식이 올바르지 않습니다.');out.sha256=raw.sha256;}
        if(kind==='evidence'){out.relation=raw.relation??'supports';if(!['supports','contradicts','context'].includes(out.relation))throw new WikiError('근거 관계가 올바르지 않습니다.');}
        else if(raw.relation!==undefined)throw new WikiError('원본 관측에는 주장 판정을 넣지 않습니다.');
        // A fixed archive reference must retain the exact observed revision.
        const url=new URL(out.url);
        if(url.pathname.endsWith('/archive')||url.hash.startsWith('#/thread/')){
            const match=url.hash.match(/^#\/thread\/([^/?]+)(?:\/message\/([^/?]+))?\?revision=([a-f0-9]{64})$/);
            if(!match||match[3]!==out.source_version)throw new WikiError('대화 출처에는 고정 thread/revision 주소와 같은 revision이 필요합니다.');
        }
        if(url.hostname==='github.com'&&/\/blob\//.test(url.pathname)){
            const match=url.pathname.match(/^\/[^/]+\/[^/]+\/blob\/([a-f0-9]{40})\//i);
            if(!match||match[1]!==out.source_version)throw new WikiError('GitHub 소스 근거에는 고정 commit의 파일 주소와 같은 commit 버전이 필요합니다.');
        }
        return out;
    }
    if(kind==='issue'){
        raw=object(value,['category','reason','scope']);
        if(!['source_changed','stale','conflict','missing_evidence','broken_reference','other'].includes(String(raw.category)))throw new WikiError('재검토 사유가 올바르지 않습니다.');
        return {category:raw.category,reason:knowledgeText(raw.reason,4000,'재검토 이유'),scope:knowledgeText(raw.scope,2000,'검토 범위')};
    }
    if(kind==='proposal'){
        raw=object(value,['content','summary','reason','scope','evidence_ids']);
        if(!Array.isArray(raw.evidence_ids)||raw.evidence_ids.length>50)throw new WikiError('근거 기록은 최대 50개입니다.');
        const ids=raw.evidence_ids.map(knowledgeToken);if(new Set(ids).size!==ids.length)throw new WikiError('근거 기록 번호가 중복되었습니다.');
        return {content:knowledgeText(raw.content,200000,'수정안 본문',true),summary:knowledgeText(raw.summary,300,'편집 요약'),reason:knowledgeText(raw.reason,4000,'변경 이유'),scope:knowledgeText(raw.scope,2000,'변경 범위'),evidence_ids:ids};
    }
    if(kind==='review'||kind==='resolution'){
        raw=object(value,kind==='review'?['result','scope','note']:['result','note']);
        if(!(kind==='review'?['reviewed','changes_requested','adopted']:['resolved','dismissed']).includes(String(raw.result)))throw new WikiError('검토 결과가 올바르지 않습니다.');
        return {result:raw.result,...(kind==='review'?{scope:knowledgeText(raw.scope,2000,'검토 범위')} :{}),note:knowledgeText(raw.note,4000,'검토 의견')};
    }
    raw=object(value,['target','target_id']);
    if(!(kind==='applied'?['proposal']:['revision','comment']).includes(String(raw.target)))throw new WikiError('기여 대상이 올바르지 않습니다.');
    return {target:raw.target,target_id:knowledgeToken(raw.target_id)};
}
export function knowledgeInteger(value:unknown,fallback:number,max:number,min=0) {
    if(value===undefined||value===null)return fallback;
    if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+$/.test(value)))throw new WikiError('조회 범위가 올바르지 않습니다.');
    const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new WikiError('조회 범위가 올바르지 않습니다.');return n;
}
export function decodedKnowledge(row:KnowledgeRecord,full=false) {
    const payload=JSON.parse(row.payload);
    if(row.kind==='proposal'&&!full){payload.content_preview=payload.content.slice(0,400);payload.content_length=payload.content.length;delete payload.content;}
    return {...row,payload,work_context:JSON.parse(row.work_context),principal:JSON.parse(row.principal)};
}
export function validateKnowledgeRecord(value:unknown):KnowledgeRecord {
    const raw=object(value,KNOWLEDGE_FIELDS);
    if(KNOWLEDGE_FIELDS.some(k=>!Object.hasOwn(raw,k)))throw new WikiError('근거·검토 백업 필드가 누락되었습니다.');
    for(const key of ['id','document_id','revision_id'])knowledgeToken(raw[key]);
    if(!KNOWLEDGE_KINDS.includes(raw.kind as KnowledgeKind))throw new WikiError('지원하지 않는 근거·검토 기록입니다.');
    if(raw.subject_id!==null)knowledgeToken(raw.subject_id);
    let payload:any,context:any,principal:any;
    // JSON can expand each accepted source character to six characters (for example, a tab).
    try{payload=JSON.parse(knowledgeText(raw.payload,1300000,'기록 본문'));context=JSON.parse(knowledgeText(raw.work_context,12000,'작업 맥락'));principal=JSON.parse(knowledgeText(raw.principal,300,'저장 경로'));}catch{throw new WikiError('근거·검토 JSON 형식이 올바르지 않습니다.');}
    knowledgePayload(raw.kind as KnowledgeKind,payload);workContextInput(context);
    object(principal,['subject_hash','channel']);
    if(typeof principal.subject_hash!=='string'||!/^[a-f0-9]{64}$/.test(principal.subject_hash)||!['browser','mcp'].includes(principal.channel))throw new WikiError('저장 경로 형식이 올바르지 않습니다.');
    if(knowledgeDate(raw.created_at)!==raw.created_at)throw new WikiError('기록 시각은 정규 UTC 형식이어야 합니다.');
    if(payload.observed_at&&knowledgeDate(payload.observed_at)!==payload.observed_at)throw new WikiError('관측 시각은 정규 UTC 형식이어야 합니다.');
    if(['evidence','observation'].includes(String(raw.kind))){if(raw.source_key!==payload.source_key||raw.source_version!==payload.source_version)throw new WikiError('원본 관측 연결이 다릅니다.');}
    else if(raw.kind==='issue'&&raw.source_key!==null){knowledgeText(raw.source_key,2000,'자료 식별자');knowledgeText(raw.source_version,300,'자료 버전');}
    else if(raw.source_key!==null||raw.source_version!==null)throw new WikiError('지원하지 않는 자료 연결입니다.');
    if(['resolution','applied'].includes(String(raw.kind))&&raw.subject_id===null)throw new WikiError('종결 대상이 없습니다.');
    return raw as KnowledgeRecord;
}
export function orderKnowledgeRecords(rows:KnowledgeRecord[]) {
    const byId=new Map(rows.map(r=>[r.id,r])),ordered:KnowledgeRecord[]=[],done=new Set<string>(),visiting=new Set<string>();
    // Backups can contain 20,000 linked records; an explicit stack avoids exhausting the call stack.
    for(const root of rows){
        const stack:{row:KnowledgeRecord;exit:boolean}[]=[{row:root,exit:false}];
        while(stack.length){
            const {row,exit}=stack.pop()!;
            if(exit){visiting.delete(row.id);done.add(row.id);ordered.push(row);continue;}
            if(done.has(row.id))continue;
            if(visiting.has(row.id))throw new WikiError('근거·검토 기록의 순환 연결입니다.');
            visiting.add(row.id);stack.push({row,exit:true});
            const dependencies=[row.subject_id,...(JSON.parse(row.payload).evidence_ids??[])];
            for(const id of dependencies.reverse())if(byId.has(id))stack.push({row:byId.get(id)!,exit:false});
        }
    }
    return ordered;
}
