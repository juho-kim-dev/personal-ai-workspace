import {env} from 'cloudflare:workers';
import {db,WikiError,titleInput} from './wiki-store';
import {validateStoredAttachment} from './attachments';
import {identityStatus,identityMode,identityBatch,identityAdoptBatch,documentIdInput} from './wiki-identity';
import {WIKI_NAMESPACES} from './wiki-title';
import {knowledgeReady,knowledgeRows} from './wiki-knowledge-store';
import {KNOWLEDGE_FIELDS,validateKnowledgeRecord,orderKnowledgeRecords} from './wiki-knowledge-contract';

export const MAX_BACKUP_BYTES=24*1024*1024;
export const MAX_BACKUP_REQUEST_BYTES=MAX_BACKUP_BYTES+4096;
const tables=['pages','revisions','notes','bookmarks','threads','comments','trash','files','knowledge'] as const;
const sqlTable=(kind:Kind)=>kind==='files'?'attachments':kind==='knowledge'?'knowledge_events':kind;
type Kind=typeof tables[number];
type Data=Record<Kind,any[]>;
type Identity={dataset_id:string;namespace_json:string;documents:any[];events:any[];imports:any[]};
const fields:Record<Kind,string[]>={pages:['title','content','version','updated_at'],revisions:['id','title','content','summary','created_at','size'],notes:['id','title','body','created_at'],bookmarks:['title'],threads:['id','title','subject','status','version','created_at','updated_at'],comments:['id','thread_id','number','body','created_at'],trash:['title','content','version','updated_at','deleted_at','delete_summary','trash_id'],files:['name','mime','size','created_at','base64','sha256'],knowledge:[...KNOWLEDGE_FIELDS]};
const ownership:Partial<Record<Kind,string[]>>={pages:['document_id'],revisions:['document_id','observed_title'],notes:['document_id','observed_title'],bookmarks:['document_id','observed_title'],threads:['document_id','observed_title'],trash:['document_id']};
const identityFields={documents:['document_id','title','state','observed_title'],events:['id','document_id','kind','old_title','new_title','redirect_document_id','created_at'],imports:['source_fingerprint','mapping_json']} as const;
const key=(kind:Kind,row:any)=>row[kind==='files'?'name':['pages','bookmarks','trash'].includes(kind)?'title':'id'];
const canonical=(x:any):string=>JSON.stringify(x===null||typeof x!=='object'?x:Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])));
const sorted=(rows:any[],field:string)=>[...rows].sort((a,b)=>a[field]<b[field]?-1:a[field]>b[field]?1:0);
const project=(row:any,columns:readonly string[])=>Object.fromEntries(columns.map(f=>[f,row[f]]));
const columns=(kind:Kind,identified:boolean)=>[...fields[kind],...(identified?ownership[kind]||[]:[])];
async function hash(value:string|Uint8Array){const bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('')}
function fail(message='백업 형식이 올바르지 않습니다.'):never{throw new WikiError(message)}
function str(v:any,max:number,empty=false){if(typeof v!=='string'||v.length>max||(!empty&&!v.length)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v))fail();return v}
function identifier(v:any){return str(v,80)}
function date(v:any){str(v,40);if(!/^\d{4}-\d\d-\d\dT/.test(v)||!Number.isFinite(Date.parse(v)))fail()}
function title(v:any){if(titleInput(v)!==v)fail()}
function record(value:any,allowed:readonly string[],strict:boolean){if(!value||typeof value!=='object'||Array.isArray(value)||allowed.some(f=>!(f in value))||(strict&&Object.keys(value).some(f=>!allowed.includes(f))))fail();return project(value,allowed)}
function decode(value:string){if(value.length>14*1024*1024||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('파일 base64 형식이 올바르지 않습니다.');const raw=atob(value);const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(encode(bytes)!==value)fail();return bytes}
function encode(bytes:Uint8Array){let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw)}
function bounded(value:any){if(new TextEncoder().encode(JSON.stringify(value)).length>MAX_BACKUP_BYTES)throw new WikiError('백업 JSON은 24 MiB 이하여야 합니다.',413)}
function validateHeads(data:Data,identified:boolean){
 const revisions=new Map(data.revisions.map(row=>[row.id,row]));
 for(const row of [...data.pages,...data.trash]){
  const head=revisions.get(row.version);
  // Old document-only backups can legitimately have no retained head revision.
  if(head&&((identified?head.document_id!==row.document_id:head.title!==row.title)||head.content!==row.content))
   fail('현재 판의 문서 소유권 또는 본문이 원문과 다릅니다.');
 }
}
function mapping(value:string){str(value,MAX_BACKUP_BYTES);let parsed:any;try{parsed=JSON.parse(value)}catch{fail('이전 백업 문서 연결 정보가 올바르지 않습니다.')}record(parsed,['format','documents'],true);if(parsed.format!=='wiki42-legacy-identity-map-v1'||!Array.isArray(parsed.documents))fail();const titles=new Set(),ids=new Set();for(const d of parsed.documents){record(d,['title','document_id'],true);title(d.title);documentIdInput(d.document_id);if(titles.has(d.title)||ids.has(d.document_id))fail('중복 이전 백업 문서 연결입니다.');titles.add(d.title);ids.add(d.document_id)}return parsed.documents as {title:string;document_id:string}[]}

async function validate(input:any){
 bounded(input);if(!input||typeof input!=='object'||Array.isArray(input)||!['my-wiki-v1','my-wiki-v2','my-wiki-v3','my-wiki-v4'].includes(input.format))fail();
 const legacy=input.format==='my-wiki-v1',knowledge=input.format==='my-wiki-v4',identified=knowledge||input.format==='my-wiki-v3',data={} as Data,warnings=legacy?['v1 백업에는 문서만 있습니다. 이력·메모·즐겨찾기·휴지통·토론·첨부파일은 복원되지 않습니다.']:[];
 let total=0;const count=(rows:any)=>{if(!Array.isArray(rows)||(total+=rows.length)>20000)fail('백업 레코드는 총 20,000개 이하여야 합니다.');return rows as any[]};
 if(identified){record(input,['format','exported_at',...tables.filter(k=>k!=='knowledge'||knowledge),'identity'],true);date(input.exported_at)}
 for(const kind of tables){const rows=count((legacy&&kind!=='pages')||(kind==='knowledge'&&!knowledge)?[]:input[kind]);data[kind]=[];const seen=new Set();
  for(const original of rows){const row=record(original,columns(kind,identified),identified);
   if(kind==='knowledge')validateKnowledgeRecord(row);
   if('title' in row)title(row.title);if('name' in row)title(row.name);for(const f of ['id','thread_id','version','trash_id'])if(f in row)identifier(row[f]);for(const f of ['created_at','updated_at','deleted_at'])if(f in row)date(row[f]);
   if('content' in row)str(row.content,200000,true);if('body' in row)str(row.body,10000);if('summary' in row)str(row.summary,1000,true);if('delete_summary' in row)str(row.delete_summary,300);if('subject' in row)str(row.subject,200);if('status' in row&&!['open','paused','closed'].includes(row.status))fail();
   if('document_id' in row){if(row.document_id===null){if(kind!=='notes'&&kind!=='bookmarks')fail('문서 ID 연결이 없습니다.')}else documentIdInput(row.document_id)}if('observed_title' in row)title(row.observed_title);
   if(kind==='revisions'&&(!Number.isInteger(row.size)||row.size!==Array.from(row.content.split('\0')[0]).length))fail('판 크기가 본문과 다릅니다.');
   if(kind==='comments'&&(!Number.isInteger(row.number)||row.number<1||row.number>1000))fail();
   if(kind==='files'){str(row.base64,14*1024*1024);if(typeof row.sha256!=='string'||! /^[a-f0-9]{64}$/.test(row.sha256))fail();const bytes=decode(row.base64),meta=validateStoredAttachment(row.name,bytes);if(meta.name!==row.name||meta.mime!==row.mime||meta.size!==row.size||await hash(bytes)!==row.sha256)fail('첨부파일 크기·형식 또는 SHA-256 검증에 실패했습니다.')}
   const k=key(kind,row);if(seen.has(k))fail('중복 백업 레코드입니다.');seen.add(k);data[kind].push(row);
  }
 }
 const titles=new Set([...data.pages,...data.trash].map(x=>x.title));if(titles.size!==data.pages.length+data.trash.length)fail('활성 문서와 휴지통 제목이 충돌합니다.');
 if(new Set(data.trash.map(x=>x.trash_id)).size!==data.trash.length)fail('중복 휴지통 번호입니다.');
 if(!legacy)for(const r of data.revisions)if(!titles.has(r.title))fail('판 이력의 문서가 없습니다.');
 if([...data.notes,...data.bookmarks].some(x=>!titles.has(x.title)))warnings.push('문서가 없는 메모·즐겨찾기도 원본대로 보존됩니다.');
 const threads=new Map(data.threads.map(x=>[x.id,x]));for(const thread of data.threads)if(!titles.has(thread.title))fail('토론의 문서가 없습니다.');
 const numbers=new Map<string,number[]>();for(const c of data.comments){if(!threads.has(c.thread_id))fail('답글의 토론이 없습니다.');const ns=numbers.get(c.thread_id)||[];ns.push(c.number);numbers.set(c.thread_id,ns)}for(const thread of data.threads){const ns=(numbers.get(thread.id)||[]).sort((a,b)=>a-b);if(!ns.length||ns.some((n,i)=>n!==i+1))fail('답글 번호가 연속적이지 않습니다.')}
 let identity:Identity|null=null;
 if(identified){
  const raw=record(input.identity,['dataset_id','namespace_json','documents','events','imports'],true);documentIdInput(raw.dataset_id);str(raw.namespace_json,10000);
  // This release supports this exact namespace registry. A later registry requires an explicit adapter.
  if(raw.namespace_json!==canonical(['',...WIKI_NAMESPACES]))fail('지원하지 않는 이름공간 레지스트리입니다.');
  identity={dataset_id:raw.dataset_id,namespace_json:raw.namespace_json,documents:[],events:[],imports:[]};
  for(const kind of ['documents','events','imports'] as const){const seen=new Set();for(const original of count(raw[kind])){const row=record(original,identityFields[kind],true);const k=row[kind==='documents'?'document_id':kind==='events'?'id':'source_fingerprint'];if(seen.has(k))fail('중복 식별 레코드입니다.');seen.add(k);identity[kind].push(row)}}
  const docs=new Map<string,any>(),docTitles=new Set();for(const d of identity.documents){documentIdInput(d.document_id);title(d.title);title(d.observed_title);if(!['live','deleted'].includes(d.state)||docTitles.has(d.title))fail('문서 식별 레지스트리가 충돌합니다.');docTitles.add(d.title);docs.set(d.document_id,d)}
  if(docs.size!==data.pages.length+data.trash.length)fail('문서 식별 레지스트리와 원문 수가 다릅니다.');
  const owned=new Set();for(const kind of ['pages','trash'] as const)for(const row of data[kind]){const doc=docs.get(row.document_id);if(!doc||doc.title!==row.title||doc.state!==(kind==='pages'?'live':'deleted')||owned.has(row.document_id))fail('문서 식별 레지스트리와 원문 연결이 다릅니다.');owned.add(row.document_id)}
  for(const kind of ['revisions','notes','bookmarks','threads'] as const)for(const row of data[kind]){if(row.document_id===null)continue;const doc=docs.get(row.document_id);if(!doc||doc.title!==row.title)fail('문서 ID 관계가 올바르지 않습니다.')}
  for(const e of identity.events){identifier(e.id);documentIdInput(e.document_id);if(!docs.has(e.document_id)||!['move','delete','restore'].includes(e.kind))fail('문서 사건 연결이 올바르지 않습니다.');title(e.old_title);title(e.new_title);date(e.created_at);if(e.redirect_document_id!==null){documentIdInput(e.redirect_document_id);if(!docs.has(e.redirect_document_id)||e.redirect_document_id===e.document_id)fail('넘겨주기 문서 연결이 올바르지 않습니다.')}}
  for(const entry of identity.imports){if(typeof entry.source_fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(entry.source_fingerprint))fail();for(const d of mapping(entry.mapping_json))if(!docs.has(d.document_id))fail('이전 백업 문서 연결 대상이 없습니다.')}
 }
 if(data.knowledge.length){
  const revisions=new Map(data.revisions.map(r=>[r.id,r])),events=new Map(data.knowledge.map(r=>[r.id,r])),terminal=new Set(),sourceCandidates=new Set();
  for(const row of data.knowledge){
   if(revisions.get(row.revision_id)?.document_id!==row.document_id)fail('근거·검토 판의 문서 연결이 올바르지 않습니다.');
   const parent=row.subject_id&&events.get(row.subject_id);
   if(row.subject_id&&(!parent||parent.document_id!==row.document_id))fail('근거·검토 대상 연결이 올바르지 않습니다.');
   if(parent&&!['resolution','issue','applied'].includes(row.kind)&&parent.revision_id!==row.revision_id)fail('검토 대상과 기록의 판이 다릅니다.');
   if(parent&&!['review','resolution','issue','applied'].includes(row.kind))fail('지원하지 않는 대상 기록 연결입니다.');
   if(['resolution','applied'].includes(row.kind)){
    if(!parent||!(row.kind==='applied'?['proposal']:['issue','proposal']).includes(parent.kind)||terminal.has(row.subject_id))fail('중복 또는 잘못된 종결 기록입니다.');terminal.add(row.subject_id);
   }
   const payload=JSON.parse(row.payload);
   if(row.kind==='applied'&&(payload.target_id!==row.subject_id||revisions.get(row.revision_id)?.content!==JSON.parse(parent.payload).content))fail('반영된 판과 수정안의 원문이 다릅니다.');
   if(row.kind==='contribution'&&payload.target==='revision'&&payload.target_id!==row.revision_id)fail('판 기여의 대상이 다릅니다.');
   for(const id of payload.evidence_ids??[])if(events.get(id)?.kind!=='evidence'||events.get(id)?.document_id!==row.document_id)fail('수정안의 근거 연결이 올바르지 않습니다.');
   if(row.kind==='contribution'&&payload.target==='comment'){
    const comment=data.comments.find(c=>c.id===payload.target_id),thread=comment&&data.threads.find(t=>t.id===comment.thread_id);
    if(thread?.document_id!==row.document_id)fail('댓글 기여의 문서 연결이 올바르지 않습니다.');
   }
   if(row.kind==='issue'&&row.source_key!==null){if(!parent||parent.kind!=='evidence'||parent.source_key!==row.source_key||parent.source_version===row.source_version||payload.category!=='source_changed')fail('원본 변경 후보의 근거가 다릅니다.');const key=canonical([row.subject_id,row.source_version]);if(sourceCandidates.has(key))fail('중복 원본 변경 후보입니다.');sourceCandidates.add(key);}
  }
  data.knowledge=orderKnowledgeRecords(data.knowledge);
 }
 validateHeads(data,identified);
 return {data,identity,warnings,format:input.format as string};
}

// Stable across export timestamps and row order; no raw private content is returned.
export async function backupFingerprint(input:any){const checked=await validate(input);return semanticFingerprint(checked)}
async function semanticFingerprint(input:{data:Data;identity:Identity|null;format:string}){
 const data=Object.fromEntries(tables.filter(k=>k!=='knowledge'||input.format==='my-wiki-v4').map(k=>[k,sorted(input.data[k],k==='files'?'name':['pages','bookmarks','trash'].includes(k)?'title':'id')]));
 const identity=input.identity&&{...input.identity,documents:sorted(input.identity.documents,'document_id'),events:sorted(input.identity.events,'id'),imports:sorted(input.identity.imports,'source_fingerprint')};
 return hash(canonical({format:input.format,data,identity}));
}
async function epoch(){const row:any=await db().prepare('SELECT version FROM wiki_state WHERE id=1').first();return row.version as number}
async function state(){
 const before=await epoch(),status=await identityStatus(),data={} as Data;
 for(const kind of tables)data[kind]=kind==='knowledge'?await knowledgeRows():(await db().prepare('SELECT * FROM '+sqlTable(kind)).all()).results;
 let identity:Identity|null=null;
 if(status.state!=='legacy'){
  const current:Identity={dataset_id:status.dataset_id!,namespace_json:status.namespace_json!,documents:[],events:[],imports:[]};
  for(const [kind,table] of [['documents','documents'],['events','identity_events'],['imports','identity_imports']] as const)current[kind]=(await db().prepare('SELECT * FROM '+table).all()).results;
  identity=current;
 }
 const after=await epoch(),afterStatus=await identityStatus();if(before!==after||canonical(status)!==canonical(afterStatus))throw new WikiError('저장소가 변경되었습니다. 다시 시도해 주세요.',409);
 return {data,identity,status,epoch:after};
}
async function backupFileRows(files:any[]){
 let estimated=0;const result=[];
 for(const row of files){
  estimated+=Math.ceil(row.size/3)*4;if(estimated>MAX_BACKUP_BYTES)throw new WikiError('첨부파일을 포함한 백업이 24 MiB를 초과합니다.',413);
  if('base64' in row){result.push(row);continue}
  if(!env.BUCKET)throw new WikiError('파일 저장소 연결이 필요합니다.',503);
  const object=await env.BUCKET.get(row.key);if(!object||object.size!==row.size)throw new WikiError('첨부파일 원본을 찾을 수 없습니다.',503);
  const bytes=new Uint8Array(await new Response(object.body).arrayBuffer());
  result.push({...row,base64:encode(bytes),sha256:await hash(bytes)});
 }
 return result;
}
function backupEnvelope(data:Data,identity:Identity|null,identified:boolean){
 return {format:data.knowledge.length?'my-wiki-v4':identified?'my-wiki-v3':'my-wiki-v2',exported_at:new Date().toISOString(),...Object.fromEntries(tables.filter(k=>k!=='knowledge'||data.knowledge.length).map(k=>[k,data[k].map(row=>project(row,columns(k,identified)))])),...(identified?{identity}:{})};
}
export async function exportBackup(){
 let budget=0;const status=await identityStatus();
 for(const table of ['pages','revisions','notes','bookmarks','threads','comments','trash','attachments',...(status.state!=='legacy'?['documents','identity_events','identity_imports']:[]),...(await knowledgeReady()?['knowledge_events']:[])]){const row:any=await db().prepare('SELECT count(*) AS n FROM '+table).first();budget+=row.n;if(budget>20000)throw new WikiError('백업 레코드는 총 20,000개 이하여야 합니다.',413)}
 let contentBytes=0;
 for(const [table,column] of [['pages','content'],['revisions','content'],['notes','body'],['comments','body'],['trash','content']]){const row:any=await db().prepare('SELECT coalesce(sum(length(CAST('+column+' AS BLOB))),0) AS bytes FROM '+table).first();contentBytes+=row.bytes;if(contentBytes>MAX_BACKUP_BYTES)throw new WikiError('백업 JSON은 24 MiB 이하여야 합니다.',413)}
 if(await knowledgeReady()){const row:any=await db().prepare('SELECT coalesce(sum(length(CAST(payload AS BLOB))+length(CAST(work_context AS BLOB))+length(CAST(principal AS BLOB))),0) AS bytes FROM knowledge_events').first();if(contentBytes+row.bytes>MAX_BACKUP_BYTES)throw new WikiError('근거·검토를 포함한 백업 JSON은 24 MiB 이하여야 합니다.',413);}
 const snapshot=await state();snapshot.data.files=await backupFileRows(snapshot.data.files);
 if(await epoch()!==snapshot.epoch||canonical(await identityStatus())!==canonical(snapshot.status))throw new WikiError('저장소가 변경되었습니다. 다시 내보내 주세요.',409);
 const identified=snapshot.status.phase==='done'&&['migrating','verified','active','maintenance'].includes(snapshot.status.state);
 const result=backupEnvelope(snapshot.data,snapshot.identity,identified);
 bounded(result);await validate(result);return result;
}

async function plan(input:any){
 const mode=await identityMode(),checked=await validate(input),snapshot=await state(),sourceFingerprint=await semanticFingerprint(checked),conflicts:{kind:string;key:string;reason:string}[]=[],pending={} as Data;
 if(checked.data.knowledge.length&&!await knowledgeReady())throw new WikiError('v4 백업을 복원하려면 0004 마이그레이션이 필요합니다.',503);
 let skipped=0,adopt=false,identity=checked.identity;
 const newIdentity:Pick<Identity,'documents'|'events'|'imports'>={documents:[],events:[],imports:[]};
 if(identity){
  if(mode==='legacy'){
   adopt=true;if(tables.some(k=>snapshot.data[k].length))conflicts.push({kind:'identity',key:identity.dataset_id,reason:'ID 백업은 비어 있는 저장소에만 새 데이터셋으로 복원할 수 있습니다.'});
  }else if(snapshot.identity!.dataset_id!==identity.dataset_id||snapshot.identity!.namespace_json!==identity.namespace_json)conflicts.push({kind:'identity',key:identity.dataset_id,reason:'서로 다른 식별 데이터셋은 병합할 수 없습니다.'});
 }else if(mode==='active'){
  const previous=snapshot.identity!.imports.find(x=>x.source_fingerprint===sourceFingerprint);
  const documents=previous?mapping(previous.mapping_json):sorted([...checked.data.pages,...checked.data.trash],'title').map(row=>({title:row.title,document_id:crypto.randomUUID()}));
  const ids=new Map(documents.map(d=>[d.title,d.document_id]));
  if(ids.size!==checked.data.pages.length+checked.data.trash.length||[...checked.data.pages,...checked.data.trash].some(row=>!ids.has(row.title)))fail('이전 백업 연결 정보와 원문이 다릅니다.');
  for(const kind of tables)if(ownership[kind])checked.data[kind]=checked.data[kind].map(row=>({...row,document_id:ids.get(row.title)??null,...(ownership[kind]!.includes('observed_title')?{observed_title:row.title}:{})}));
  identity={dataset_id:snapshot.identity!.dataset_id,namespace_json:snapshot.identity!.namespace_json,documents:[...checked.data.pages.map(row=>({document_id:row.document_id,title:row.title,state:'live',observed_title:row.title})),...checked.data.trash.map(row=>({document_id:row.document_id,title:row.title,state:'deleted',observed_title:row.title}))],events:[],imports:[{source_fingerprint:sourceFingerprint,mapping_json:previous?.mapping_json??canonical({format:'wiki42-legacy-identity-map-v1',documents:sorted(documents,'title')})}]};
  checked.warnings.push('이전 형식의 알려진 필드만 가져옵니다. 문서 ID는 이 백업에 대한 영속 연결로 보존되며 알 수 없는 확장 필드는 복원되지 않습니다.');
 }
 if(identity){
  for(const kind of ['documents','events','imports'] as const){const field=kind==='documents'?'document_id':kind==='events'?'id':'source_fingerprint',existing=snapshot.identity?.[kind]||[],current=new Map(existing.map(row=>[row[field],row]));
   for(const row of identity[kind]){const old=current.get(row[field]);if(old){if(canonical(project(old,identityFields[kind]))===canonical(row)){skipped++;continue}conflicts.push({kind,key:row[field],reason:'기존 식별 레코드와 내용이 다릅니다.'});continue}
    if(kind==='documents'&&existing.some(d=>d.title===row.title)){conflicts.push({kind,key:row.title,reason:'같은 제목이 다른 문서 ID에 속합니다.'});continue}newIdentity[kind].push(row);
   }
  }
 }
 const reserved=new Set([...snapshot.data.pages,...snapshot.data.trash].map(x=>x.title));
 for(const kind of tables){const current=new Map(snapshot.data[kind].map(x=>[key(kind,x),x]));pending[kind]=[];
  for(const row of checked.data[kind]){const old=current.get(key(kind,row));if(old){let equal=false;if(kind==='files'){if(old.mime===row.mime&&old.size===row.size&&old.created_at===row.created_at){const obj=await env.BUCKET?.get(old.key);if(obj&&obj.size===row.size)equal=await hash(new Uint8Array(await new Response(obj.body).arrayBuffer()))===row.sha256}}else equal=canonical(project(old,columns(kind,!!identity)))===canonical(row);if(equal){skipped++;continue}conflicts.push({kind,key:key(kind,row),reason:'기존 레코드와 내용 또는 문서 ID가 다릅니다.'});continue}
   if(kind==='trash'&&snapshot.data.trash.some(x=>x.trash_id===row.trash_id)){conflicts.push({kind,key:row.title,reason:'휴지통 번호 충돌'});continue}
   if((kind==='pages'||kind==='trash')&&reserved.has(row.title)){conflicts.push({kind,key:row.title,reason:'활성 문서 또는 휴지통에서 예약한 제목입니다.'});continue}
   if(kind==='comments'&&snapshot.data.comments.some(c=>c.thread_id===row.thread_id&&c.number===row.number)){conflicts.push({kind,key:row.id,reason:'답글 번호 충돌'});continue}pending[kind].push(row);
  }
 }
 if(!conflicts.length){
  const merged=Object.fromEntries(tables.map(kind=>[kind,[...snapshot.data[kind],...pending[kind]]])) as Data;
  const mergedIdentity:Identity|null=identity?{dataset_id:identity.dataset_id,namespace_json:identity.namespace_json,
   documents:[...(snapshot.identity?.documents||[]),...newIdentity.documents],
   events:[...(snapshot.identity?.events||[]),...newIdentity.events],
   imports:[...(snapshot.identity?.imports||[]),...newIdentity.imports]}:null;
  const total=tables.reduce((count,kind)=>count+merged[kind].length,0)+(mergedIdentity?mergedIdentity.documents.length+mergedIdentity.events.length+mergedIdentity.imports.length:0);
  if(total>20000)throw new WikiError('백업 레코드는 총 20,000개 이하여야 합니다.',413);
  // Validate the actual union, including heads that exist only on the other
  // side and the bytes of retained attachments, before any R2 staging.
  validateHeads(merged,!!mergedIdentity);
  merged.files=await backupFileRows(merged.files);
  await validate(backupEnvelope(merged,mergedIdentity,!!mergedIdentity));
  if(await epoch()!==snapshot.epoch||canonical(await identityStatus())!==canonical(snapshot.status))throw new WikiError('저장소가 변경되었습니다. 미리보기를 다시 실행해 주세요.',409);
 }
 const fingerprint=await hash(canonical({sourceFingerprint,epoch:snapshot.epoch,status:snapshot.status}));
 const visibleTables=tables.filter(k=>k!=='knowledge'||input.format==='my-wiki-v4');
 return {fingerprint,counts:{...Object.fromEntries(visibleTables.map(k=>[k,pending[k].length])),...(identity?Object.fromEntries(Object.entries(newIdentity).map(([k,v])=>[k,v.length])):{})},total_counts:{...Object.fromEntries(visibleTables.map(k=>[k,checked.data[k].length])),...(identity?Object.fromEntries(['documents','events','imports'].map(k=>[k,identity![k as keyof typeof newIdentity].length])):{})},conflicts,warnings:checked.warnings,can_apply:!conflicts.length,pending,identity,newIdentity,adopt,mode,epoch:snapshot.epoch,skipped};
}
export async function previewBackup(input:any){const {pending,identity,newIdentity,adopt,mode,epoch,...preview}=await plan(input);void pending;void identity;void newIdentity;void adopt;void mode;void epoch;return preview}
export async function importBackup(input:any,fingerprint:unknown){
 const p=await plan(input);if(typeof fingerprint!=='string'||fingerprint!==p.fingerprint)throw new WikiError('백업 또는 저장소가 변경되었습니다. 미리보기를 다시 실행해 주세요.',409);if(!p.can_apply)throw new WikiError('충돌하는 백업은 가져올 수 없습니다. 기존 데이터는 변경되지 않았습니다.',409);
 const staged:string[]=[],statements=[],guard=crypto.randomUUID();
 try{
  statements.push(db().prepare('INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN version=? THEN 1 ELSE 0 END FROM wiki_state WHERE id=1').bind(guard,p.epoch));
  for(const kind of ['documents','events','imports'] as const)for(const row of p.newIdentity[kind]){const cols=identityFields[kind];statements.push(db().prepare('INSERT INTO '+(kind==='documents'?'documents':'identity_'+kind)+'('+cols.join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').bind(...cols.map(f=>row[f])))}
  for(const kind of tables)for(const row of p.pending[kind]){
   let cols=columns(kind,!!p.identity),values=cols.map(f=>row[f]);if(kind==='files'){if(!env.BUCKET)throw new WikiError('파일 저장소 연결이 필요합니다.',503);const objectKey='wiki/'+crypto.randomUUID();staged.push(objectKey);await env.BUCKET.put(objectKey,new Uint8Array(decode(row.base64)).buffer,{httpMetadata:{contentType:row.mime},customMetadata:{name:row.name}});cols=['name','key','mime','size','created_at'];values=[row.name,objectKey,row.mime,row.size,row.created_at]}
   statements.push(db().prepare('INSERT INTO '+sqlTable(kind)+'('+cols.join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').bind(...values));
  }
  statements.push(db().prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard));
  if(p.adopt)await identityAdoptBatch(statements,{dataset_id:p.identity!.dataset_id,namespace_json:p.identity!.namespace_json},p.epoch);else await identityBatch(statements,'write',p.mode);
 }catch(error){const cleanup=await Promise.allSettled(staged.map(async k=>{const referenced=await db().prepare('SELECT name FROM attachments WHERE key=?').bind(k).first();if(!referenced)await env.BUCKET!.delete(k)}));if(cleanup.some(x=>x.status==='rejected'))throw new WikiError('가져오기가 취소되었습니다. 임시 첨부파일 정리가 필요합니다.',503);if(error instanceof WikiError)throw error;throw new WikiError('가져오기 결과를 확인해 주세요. 저장소가 변경되었거나 저장에 실패했습니다. 미리보기를 다시 실행해 주세요.',409)}
 return {imported:p.counts,skipped:p.skipped};
}
