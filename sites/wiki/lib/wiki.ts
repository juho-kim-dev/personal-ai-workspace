import { seeds } from './seed';
import { wikiLinks, wikiCategories, redirectTarget } from './wiki-text';
import { splitWikiTarget } from './wiki-navigation';
import { WIKI_NAMESPACES, isWikiNamespace, normalizeWikiTitle } from './wiki-title';
import { wikiTitleReference } from './wiki-reference';
import {db,WikiError,titleInput} from './wiki-store';
import {identityMode,identityTarget,identityBatch} from './wiki-identity';
import {contributionStatements,proposalStatements,withContributions} from './wiki-knowledge-store';
import type {KnowledgePrincipal} from './wiki-knowledge-contract';
export {db,WikiError,titleInput};

export const links=wikiLinks;
export const categories=wikiCategories;
function pagination(offset:unknown,limit:unknown,defaultLimit=50,maxLimit=100){
  const parsedOffset=offset===undefined||offset===null?0:Number(offset);
  const parsedLimit=limit===undefined||limit===null?defaultLimit:Number(limit);
  if(!Number.isInteger(parsedOffset)||parsedOffset<0||parsedOffset>1000000||!Number.isInteger(parsedLimit)||parsedLimit<1||parsedLimit>maxLimit)throw new WikiError('목록 범위가 올바르지 않습니다.');
  return {offset:parsedOffset,limit:parsedLimit};
}
export async function searchPages(query:string,options:{target?:string;namespace?:string;offset?:unknown;limit?:unknown}={}){
  await identityMode();
  const range=pagination(options.offset,options.limit,200,201);
  if(typeof query!=='string')throw new WikiError('검색어를 입력해 주세요.');
  const q=query.trim().normalize('NFC').slice(0,200);
  const target=options.target||'title_content';
  if(!['title','content','title_content'].includes(target))throw new WikiError('검색 범위가 올바르지 않습니다.');
  const clause=target==='title'?'instr(lower(title),lower(?))>0':target==='content'?'instr(lower(content),lower(?))>0':'(instr(lower(title),lower(?))>0 OR instr(lower(content),lower(?))>0)';
  const values:unknown[]=target==='title_content'?[q,q]:[q];
  if(options.namespace!==undefined&&typeof options.namespace!=='string')throw new WikiError('이름공간이 올바르지 않습니다.');
  const ns=normalizeWikiTitle(options.namespace||'');
  let namespaceClause='';
  if(ns==='문서'){
    namespaceClause=` AND substr(title,1,instr(title,':')-1) NOT IN (${WIKI_NAMESPACES.map(()=>'?').join(',')})`;
    values.push(...WIKI_NAMESPACES);
  }
  else if(ns){
    // Reject unknown filters explicitly; they are ordinary title prefixes, not namespaces.
    if(!isWikiNamespace(ns))throw new WikiError('등록되지 않은 이름공간입니다.');
    namespaceClause=' AND substr(title,1,length(?))=?';values.push(ns+':',ns+':');
  }
  if(!q)return [];
  values.push(q,q);
  return (await db().prepare('SELECT * FROM pages WHERE '+clause+namespaceClause+' ORDER BY CASE WHEN lower(title)=lower(?) THEN 0 WHEN instr(lower(title),lower(?))>0 THEN 1 ELSE 2 END,updated_at DESC,title LIMIT ? OFFSET ?').bind(...values,range.limit,range.offset).all()).results;
}
export async function searchPageWindow(query:string,options:{target?:string;namespace?:string;offset?:unknown;limit?:unknown}={}){
  const range=pagination(options.offset,options.limit,20);
  const rows=await searchPages(query,{...options,offset:range.offset,limit:range.limit+1});
  return {items:rows.slice(0,range.limit),has_more:rows.length>range.limit,...range};
}
export async function listPages(query=''){
  await identityMode();
  return query.trim()?searchPages(query):(await db().prepare('SELECT * FROM pages ORDER BY updated_at DESC,title').all()).results;
}
export async function readPage(value:unknown,documentId?:unknown){
  const mode=await identityMode(),target=mode==='active'?await identityTarget(documentId?undefined:value,documentId,{deleted:true,allowMissing:true}):null;
  if(mode==='legacy'&&documentId)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
  const title=target?.title??titleInput(value),byId=Boolean(documentId&&target?.document_id);
  const page=await db().prepare('SELECT * FROM pages WHERE '+(byId?'document_id=?':'title=?'+(target?.document_id?' AND document_id=?':''))).bind(...(byId?[target!.document_id]:[title,...(target?.document_id?[target.document_id]:[])])).first();
  if(!page){if(await db().prepare('SELECT title FROM trash WHERE '+(byId?'document_id=?':'title=?')).bind(byId?target!.document_id:title).first())throw new WikiError('삭제된 문서입니다. 휴지통에서 복원해 주세요.',410);throw new WikiError('아직 작성되지 않은 문서입니다.',404);}
  return target?{...page,dataset_id:target.dataset_id}:page;
}
export async function history(value:unknown,offset?:unknown,limit?:unknown,documentId?:unknown){
  const range=pagination(offset,limit,100);
  if(await identityMode()==='active'){
    const target=await identityTarget(documentId?undefined:value,documentId,{deleted:true,allowMissing:true});
    if(!target.document_id)return [];
    return withContributions((await db().prepare('SELECT * FROM revisions WHERE document_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(target.document_id,range.limit,range.offset).all()).results,'revision');
  }
  if(documentId)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
  return (await db().prepare('SELECT * FROM revisions WHERE title=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(titleInput(value),range.limit,range.offset).all()).results;
}
export async function readRevision(value:unknown,id:unknown,documentId?:unknown){
  if(typeof id!=='string'||!/^[a-z0-9-]{1,80}$/i.test(id))throw new WikiError('판 번호가 올바르지 않습니다.');
  if(await identityMode()==='active'){
    // Revision IDs are globally unique. Old title URLs may refer to a revision
    // moved away from that title; an explicit document ID must match ownership.
    if(documentId){
      const target=await identityTarget(undefined,documentId,{deleted:true});
      const row=await db().prepare('SELECT * FROM revisions WHERE id=? AND document_id=?').bind(id,target.document_id).first();
      if(row)return row;
    }else{
      titleInput(value);
      const row=await db().prepare('SELECT * FROM revisions WHERE id=?').bind(id).first();
      if(row)return row;
    }
    throw new WikiError('이 문서의 해당 판을 찾을 수 없습니다.',404);
  }
  if(documentId)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
  let title=titleInput(value);
  const visited=new Set<string>();
  for(let depth=0;depth<10&&!visited.has(title);depth++){
    visited.add(title);
    const revision=await db().prepare('SELECT * FROM revisions WHERE title=? AND id=?').bind(title,id).first();
    if(revision)return revision;
    const page:any=await db().prepare('SELECT content FROM pages WHERE title=? UNION ALL SELECT content FROM trash WHERE title=? LIMIT 1').bind(title,title).first();
    const target=page&&redirectTarget(page.content);
    if(!target)break;
    title=titleInput(splitWikiTarget(target).title);
  }
  throw new WikiError('이 문서의 해당 판을 찾을 수 없습니다.',404);
}
export async function recentChanges(offset?:unknown,limit?:unknown){
  const range=pagination(offset,limit);
  const mode=await identityMode();
  return withContributions((await db().prepare('SELECT id,title,summary,created_at,size'+(mode==='active'?',document_id,observed_title':'')+' FROM revisions ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(range.limit,range.offset).all()).results,'revision');
}
export type ActivityItem = {id:string;title:string;created_at:string;document_id?:string|null;observed_title?:string|null} & (
  {type:'edit';summary:string;size:number} |
  {type:'discussion';thread_id:string;subject:string;number:number;excerpt:string}
);
export type ActivityResult = {title:string;document_id?:string|null;type:'all'|'edits'|'discussions';offset:number;limit:number;items:ActivityItem[];has_more:boolean;from?:string;before?:string};

// Stored titles only: do not resolve redirects or require a currently live page.
export async function activity(value:unknown,input:{type?:unknown;offset?:unknown;limit?:unknown;document_id?:unknown;from?:unknown;before?:unknown}={}):Promise<ActivityResult>{
  const mode=await identityMode(),target=mode==='active'?await identityTarget(input.document_id?undefined:value,input.document_id,{deleted:true,allowMissing:true}):null;
  if(mode==='legacy'&&input.document_id)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
  const title=target?.title??titleInput(value),type=input.type===undefined?'all':input.type;
  if(type!=='all'&&type!=='edits'&&type!=='discussions')throw new WikiError('활동 종류가 올바르지 않습니다.');
  const integer=(value:unknown,fallback:number,min:number,max:number)=>{
    if(value===undefined)return fallback;
    if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+$/.test(value)))throw new WikiError('목록 범위가 올바르지 않습니다.');
    const n=Number(value);
    if(!Number.isSafeInteger(n)||n<min||n>max)throw new WikiError('목록 범위가 올바르지 않습니다.');
    return n;
  };
  const offset=integer(input.offset,0,0,1000000),limit=integer(input.limit,30,1,100);
  const timestamp=(v:unknown)=>{if(v===undefined)return null;if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))throw new WikiError('기간은 시간대가 있는 ISO 날짜로 입력해 주세요.');return new Date(v).toISOString();};
  const from=timestamp(input.from),before=timestamp(input.before);if(from&&before&&from>=before)throw new WikiError('기간의 끝은 시작보다 뒤여야 합니다.');
  const rows=(await db().prepare(`
    SELECT type,sort_rank,id,title,created_at,summary,size,document_id,observed_title,thread_id,subject,number,excerpt FROM (
    SELECT 'edit' AS type,0 AS sort_rank,id,title,created_at,substr(summary,1,300) AS summary,size,
      ${mode==='active'?'document_id,observed_title':'NULL AS document_id,NULL AS observed_title'},
      NULL AS thread_id,NULL AS subject,NULL AS number,NULL AS excerpt
    FROM revisions WHERE ${mode==='active'?'document_id':'title'}=? AND ? IN ('all','edits')
    UNION ALL
    SELECT 'discussion',1,c.id,t.title,c.created_at,NULL,NULL,
      ${mode==='active'?'t.document_id,t.observed_title':'NULL,NULL'},
      t.id,substr(t.subject,1,200),c.number,substr(c.body,1,240)
    FROM comments c JOIN threads t ON t.id=c.thread_id
    WHERE t.${mode==='active'?'document_id':'title'}=? AND ? IN ('all','discussions')
    ) WHERE (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<?)
    ORDER BY created_at DESC,sort_rank ASC,id DESC LIMIT ? OFFSET ?
  `).bind(mode==='active'?target!.document_id:title,type,mode==='active'?target!.document_id:title,type,from,from,before,before,limit+1,offset).all()).results;
  // SQLite substr counts code points; also bound UTF-16 payloads without splitting emoji.
  const bounded=(text:unknown,max:number)=>String(text??'').slice(0,max).replace(/[\uD800-\uDBFF]$/,'');
  const items:ActivityItem[]=rows.slice(0,limit).map(row=>{
    const common={id:String(row.id),title:String(row.title),created_at:String(row.created_at),...(mode==='active'?{document_id:row.document_id as string|null,observed_title:row.observed_title as string|null}:{})};
    return row.type==='edit'
      ?{...common,type:'edit',summary:bounded(row.summary,300),size:Number(row.size)}
      :{...common,type:'discussion',thread_id:String(row.thread_id),subject:bounded(row.subject,200),number:Number(row.number),excerpt:bounded(row.excerpt,240)};
  });
  return {title,...(target?{document_id:target.document_id}:{}),type,offset,limit,items,has_more:rows.length>limit,...(from?{from}:{}),...(before?{before}:{})};
}
export function summaryInput(value:unknown){
  if(typeof value!=='string'||!value.trim()||value.length>300)throw new WikiError('편집 요약을 1~300자로 입력해 주세요.');
  return value.trim();
}
export async function savePage(input:any,principal?:KnowledgePrincipal,proposal?:{proposal_id:string;request_id:string}){
  const mode=await identityMode(),summary=summaryInput(input.summary);
  if(mode==='legacy'&&input.work_context!==undefined)throw new WikiError('작업 맥락을 보존하려면 문서 ID 활성화가 필요합니다.',503);
  if(typeof input.content!=='string'||input.content.length>200000)throw new WikiError('문서 본문은 200,000자 이내로 입력해 주세요.');
  if(input.expected_version!==null&&typeof input.expected_version!=='string')throw new WikiError('expected_version은 현재 판 또는 새 문서의 경우 null이어야 합니다.');
  const target=mode==='active'?await identityTarget(input.title,input.document_id,{allowMissing:input.expected_version===null}):null;
  if(mode==='legacy'&&input.document_id)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
  const title=target?.title??titleInput(input.title);
  const id=crypto.randomUUID(),now=new Date().toISOString(),d=db();
  if(mode==='active'){
    const documentId=target!.document_id??crypto.randomUUID(),guard=crypto.randomUUID();
    const statements=input.expected_version===null?[
      d.prepare('INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM documents WHERE title=?) AND NOT EXISTS(SELECT 1 FROM pages WHERE title=?) AND NOT EXISTS(SELECT 1 FROM trash WHERE title=?) THEN 1 ELSE 0 END').bind(guard,title,title,title),
      d.prepare("INSERT INTO documents(document_id,title,state,observed_title) VALUES(?,?,'live',?)").bind(documentId,title,title),
      d.prepare('INSERT INTO pages(title,content,version,updated_at,document_id) VALUES(?,?,?,?,?)').bind(title,input.content,id,now,documentId),
    ]:[
      d.prepare("INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM pages p JOIN documents d ON d.document_id=p.document_id WHERE p.title=? AND p.document_id=? AND p.version=? AND d.title=p.title AND d.state='live') THEN 1 ELSE 0 END").bind(guard,title,documentId,input.expected_version),
      d.prepare('UPDATE pages SET content=?,version=?,updated_at=? WHERE title=? AND document_id=? AND version=?').bind(input.content,id,now,title,documentId,input.expected_version),
    ];
    statements.push(
      d.prepare('INSERT INTO revisions(id,title,content,summary,created_at,size,document_id,observed_title) SELECT version,title,content,?,?,length(content),document_id,title FROM pages WHERE title=? AND document_id=? AND version=?').bind(summary,now,title,documentId,id),
    );
    statements.push(...await contributionStatements(documentId,id,'revision',id,input.work_context,principal));
    if(proposal){if(!principal)throw new WikiError('로그인이 필요합니다.',401);statements.push(...await proposalStatements(proposal.proposal_id,proposal.request_id,documentId,input.expected_version,id,input.work_context,principal));}
    statements.push(d.prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard));
    await identityBatch(statements,'write',mode).catch(error=>{if(error?.status)throw error;throw new WikiError('다른 창이나 AI가 문서를 먼저 수정했습니다. 작성 중인 내용과 최신 판을 비교해 주세요.',409)});
    return {title,content:input.content,version:id,updated_at:now,document_id:documentId,dataset_id:target!.dataset_id};
  }
  const mutation=input.expected_version===null
    ?d.prepare('INSERT OR IGNORE INTO pages(title,content,version,updated_at) VALUES(?,?,?,?)').bind(title,input.content,id,now)
    :d.prepare('UPDATE pages SET content=?,version=?,updated_at=? WHERE title=? AND version=?').bind(input.content,id,now,title,input.expected_version);
  const result=await identityBatch([mutation,d.prepare('INSERT INTO revisions(id,title,content,summary,created_at,size) SELECT ?,title,content,?,?,length(content) FROM pages WHERE title=? AND version=?').bind(id,summary,now,title,id)],'write',mode);
  if(!result[0].meta.changes)throw new WikiError('다른 창이나 AI가 문서를 먼저 수정했습니다. 작성 중인 내용과 최신 판을 비교해 주세요.',409);
  return {title,content:input.content,version:id,updated_at:now};
}
export async function movePage(input:any){
  const mode=await identityMode(),target=mode==='active'?await identityTarget(input.title,input.document_id):null;
  if(mode==='legacy'&&input.document_id)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
  const title=target?.title??titleInput(input.title),newTitle=titleInput(input.new_title),summary=summaryInput(input.summary);
  if(title===newTitle)throw new WikiError('현재 제목과 다른 새 제목을 입력해 주세요.');
  if(typeof input.expected_version!=='string'||!input.expected_version)throw new WikiError('현재 판 번호가 필요합니다.');
  const redirectSource='#redirect '+(newTitle.startsWith('[[')?wikiTitleReference(newTitle):newTitle);
  if(redirectTarget(redirectSource)!==newTitle)throw new WikiError('이 제목은 안전한 넘겨주기로 연결할 수 없습니다. 다른 새 제목을 선택해 주세요.');
  const d=db(),id=crypto.randomUUID(),redirectId=crypto.randomUUID(),now=new Date().toISOString();
  const source=await d.prepare('SELECT content FROM pages WHERE title=? AND version=?'+(target?.document_id?' AND document_id=?':'')).bind(title,input.expected_version,...(target?.document_id?[target.document_id]:[])).first();
  if(!source)throw new WikiError('문서가 먼저 수정됐습니다. 최신 판을 확인한 뒤 이동해 주세요.',409);
  if(mode==='active'){
    const documentId=target!.document_id!,redirectDocumentId=crypto.randomUUID(),guard=crypto.randomUUID();
    await identityBatch([
      d.prepare("INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM pages p JOIN documents d ON d.document_id=p.document_id WHERE p.title=? AND p.document_id=? AND p.version=? AND d.title=p.title AND d.state='live') AND NOT EXISTS(SELECT 1 FROM documents WHERE title=?) AND NOT EXISTS(SELECT 1 FROM pages WHERE title=?) AND NOT EXISTS(SELECT 1 FROM trash WHERE title=?) AND NOT (EXISTS(SELECT 1 FROM bookmarks WHERE document_id=?) AND EXISTS(SELECT 1 FROM bookmarks WHERE title=?)) THEN 1 ELSE 0 END").bind(guard,title,documentId,input.expected_version,newTitle,newTitle,newTitle,documentId,newTitle),
      d.prepare("UPDATE documents SET title=? WHERE document_id=? AND title=? AND state='live'").bind(newTitle,documentId,title),
      d.prepare('UPDATE pages SET title=?,version=?,updated_at=? WHERE title=? AND document_id=? AND version=?').bind(newTitle,id,now,title,documentId,input.expected_version),
      d.prepare('UPDATE revisions SET title=? WHERE document_id=?').bind(newTitle,documentId),
      d.prepare('UPDATE notes SET title=? WHERE document_id=?').bind(newTitle,documentId),
      d.prepare('UPDATE bookmarks SET title=? WHERE document_id=?').bind(newTitle,documentId),
      d.prepare('UPDATE threads SET title=? WHERE document_id=?').bind(newTitle,documentId),
      d.prepare('INSERT INTO revisions(id,title,content,summary,created_at,size,document_id,observed_title) SELECT version,title,content,?,?,length(content),document_id,title FROM pages WHERE document_id=?').bind('문서 이동: '+title+' → '+newTitle+' · '+summary,now,documentId),
      d.prepare("INSERT INTO documents(document_id,title,state,observed_title) VALUES(?,?,'live',?)").bind(redirectDocumentId,title,title),
      d.prepare('INSERT INTO pages(title,content,version,updated_at,document_id) VALUES(?,?,?,?,?)').bind(title,redirectSource,redirectId,now,redirectDocumentId),
      d.prepare('INSERT INTO revisions(id,title,content,summary,created_at,size,document_id,observed_title) SELECT version,title,content,?,?,length(content),document_id,title FROM pages WHERE document_id=?').bind('문서 이동 후 넘겨주기: '+newTitle,now,redirectDocumentId),
      d.prepare("INSERT INTO identity_events(id,document_id,kind,old_title,new_title,redirect_document_id,created_at) VALUES(?,?,'move',?,?,?,?)").bind(crypto.randomUUID(),documentId,title,newTitle,redirectDocumentId,now),
      d.prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),
    ],'write',mode).catch(error=>{if(error?.status)throw error;throw new WikiError('문서가 변경되었거나 새 제목의 문서·즐겨찾기가 이미 있습니다. 최신 상태를 확인해 주세요.',409)});
    return {
      page:{title:newTitle,content:source.content,version:id,updated_at:now,document_id:documentId,dataset_id:target!.dataset_id},
      redirect:{title,content:redirectSource,version:redirectId,updated_at:now,document_id:redirectDocumentId,dataset_id:target!.dataset_id},
    };
  }
  const copied="EXISTS(SELECT 1 FROM pages WHERE title=? AND version=?)";
  const result=await identityBatch([
    d.prepare('INSERT OR IGNORE INTO pages(title,content,version,updated_at) SELECT ?,content,?,? FROM pages WHERE title=? AND version=?').bind(newTitle,id,now,title,input.expected_version),
    d.prepare('UPDATE revisions SET title=? WHERE title=? AND '+copied).bind(newTitle,title,newTitle,id),
    d.prepare('INSERT INTO revisions(id,title,content,summary,created_at,size) SELECT version,title,content,?,?,length(content) FROM pages WHERE title=? AND version=?').bind('문서 이동: '+title+' → '+newTitle+' · '+summary,now,newTitle,id),
    d.prepare('UPDATE pages SET content=?,version=?,updated_at=? WHERE title=? AND version=? AND '+copied).bind(redirectSource,redirectId,now,title,input.expected_version,newTitle,id),
    d.prepare('INSERT INTO revisions(id,title,content,summary,created_at,size) SELECT version,title,content,?,?,length(content) FROM pages WHERE title=? AND version=?').bind('문서 이동 후 넘겨주기: '+newTitle,now,title,redirectId),
    d.prepare('INSERT OR IGNORE INTO bookmarks(title) SELECT ? FROM bookmarks WHERE title=? AND '+copied).bind(newTitle,title,newTitle,id),
    d.prepare('DELETE FROM bookmarks WHERE title=? AND '+copied).bind(title,newTitle,id),
    d.prepare('UPDATE notes SET title=? WHERE title=? AND '+copied).bind(newTitle,title,newTitle,id),
    d.prepare('UPDATE threads SET title=? WHERE title=? AND '+copied).bind(newTitle,title,newTitle,id),
  ],'write',mode);
  if(!result[0].meta.changes){
    const destination=await d.prepare('SELECT title FROM pages WHERE title=?').bind(newTitle).first();
    throw new WikiError(destination?'같은 제목의 문서가 이미 있습니다. 다른 제목을 선택해 주세요.':'문서가 먼저 수정됐습니다. 최신 판을 확인한 뒤 이동해 주세요.',409);
  }
  return {page:{title:newTitle,content:source.content,version:id,updated_at:now},redirect:{title,content:redirectSource,version:redirectId,updated_at:now}};
}
export async function backlinks(value:unknown){
  const title=titleInput(value);
  return (await listPages()).filter((p:any)=>wikiLinks(p.content).includes(title)).map((p:any)=>({title:p.title,updated_at:p.updated_at,...(p.document_id?{document_id:p.document_id}:{})}));
}
export async function initialize(){
  const d=db(),mode=await identityMode();
  for(const page of seeds){
    const id=crypto.randomUUID(),now=new Date().toISOString();
    if(mode==='active'){
      const documentId=crypto.randomUUID();
      await identityBatch([
        d.prepare("INSERT OR IGNORE INTO documents(document_id,title,state,observed_title) SELECT ?,?,'live',? WHERE NOT EXISTS(SELECT 1 FROM pages WHERE title=?) AND NOT EXISTS(SELECT 1 FROM trash WHERE title=?)").bind(documentId,page.title,page.title,page.title,page.title),
        d.prepare('INSERT INTO pages(title,content,version,updated_at,document_id) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM documents WHERE document_id=?)').bind(page.title,page.content,id,now,documentId,documentId),
        d.prepare('INSERT INTO revisions(id,title,content,summary,created_at,size,document_id,observed_title) SELECT version,title,content,?,?,length(content),document_id,title FROM pages WHERE document_id=? AND version=?').bind('시작 문서',now,documentId,id),
      ],'write',mode);
    }else await identityBatch([d.prepare('INSERT OR IGNORE INTO pages(title,content,version,updated_at) VALUES(?,?,?,?)').bind(page.title,page.content,id,now),d.prepare('INSERT OR IGNORE INTO revisions(id,title,content,summary,created_at,size) SELECT version,title,content,?,?,length(content) FROM pages WHERE title=? AND version=?').bind('시작 문서',now,page.title,id)],'write',mode);
  }
  return {ok:true};
}
export async function getBookmarks(){
  const mode=await identityMode();
  return (await db().prepare('SELECT title FROM bookmarks WHERE NOT EXISTS(SELECT 1 FROM trash WHERE '+(mode==='active'?'trash.document_id=bookmarks.document_id OR (bookmarks.document_id IS NULL AND trash.title=bookmarks.title)':'trash.title=bookmarks.title')+') ORDER BY title').all()).results.map((r:any)=>r.title);
}
export async function setBookmark(value:unknown,on:unknown,documentId?:unknown){
  const mode=await identityMode(),target=mode==='active'?await identityTarget(value,documentId,{deleted:true,allowMissing:true}):null;
  if(mode==='legacy'&&documentId)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
  const title=target?.title??titleInput(value),d=db();
  if(typeof on!=='boolean')throw new WikiError('즐겨찾기 값이 올바르지 않습니다.');
  if(target){
    const guard=crypto.randomUUID();
    await identityBatch([
      d.prepare('INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN '+(target.document_id?'EXISTS(SELECT 1 FROM documents WHERE document_id=? AND title=?)':'NOT EXISTS(SELECT 1 FROM documents WHERE title=?)')+' THEN 1 ELSE 0 END').bind(guard,...(target.document_id?[target.document_id,title]:[title])),
      on?d.prepare('INSERT INTO bookmarks(title,document_id,observed_title) VALUES(?,?,?) ON CONFLICT(title) DO UPDATE SET document_id=excluded.document_id').bind(title,target.document_id,title):d.prepare('DELETE FROM bookmarks WHERE title=? AND (document_id IS ? OR document_id IS NULL)').bind(title,target.document_id),
      d.prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),
    ],'write',mode).catch(error=>{if(error?.status)throw error;throw new WikiError('문서 제목이 변경되었습니다. 다시 확인해 주세요.',409)});
  }else await identityBatch([(on?d.prepare('INSERT OR IGNORE INTO bookmarks(title) VALUES(?)'):d.prepare('DELETE FROM bookmarks WHERE title=?')).bind(title)],'write',mode);
  return getBookmarks();
}
export async function getNotes(value:unknown,documentId?:unknown){
  const mode=await identityMode();
  if(mode==='active'){
    const target=await identityTarget(documentId?undefined:value,documentId,{deleted:true,allowMissing:true});
    return (await db().prepare('SELECT * FROM notes WHERE document_id=? OR (document_id IS NULL AND title=?) ORDER BY created_at DESC,id DESC LIMIT 100').bind(target.document_id,target.title).all()).results;
  }
  if(documentId)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
  return (await db().prepare('SELECT * FROM notes WHERE title=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(titleInput(value)).all()).results;
}
export async function addNote(value:unknown,body:unknown,documentId?:unknown){
  const mode=await identityMode(),target=mode==='active'?await identityTarget(value,documentId,{deleted:true,allowMissing:true}):null;
  if(mode==='legacy'&&documentId)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
  const title=target?.title??titleInput(value),d=db();
  if(typeof body!=='string'||!body.trim()||body.length>10000)throw new WikiError('메모를 1~10,000자로 작성해 주세요.');
  if(target){
    const guard=crypto.randomUUID();
    await identityBatch([
      d.prepare('INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN '+(target.document_id?'EXISTS(SELECT 1 FROM documents WHERE document_id=? AND title=?)':'NOT EXISTS(SELECT 1 FROM documents WHERE title=?)')+' THEN 1 ELSE 0 END').bind(guard,...(target.document_id?[target.document_id,title]:[title])),
      d.prepare('INSERT INTO notes(id,title,body,created_at,document_id,observed_title) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),title,body.trim(),new Date().toISOString(),target.document_id,title),
      d.prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),
    ],'write',mode).catch(error=>{if(error?.status)throw error;throw new WikiError('문서 제목이 변경되었습니다. 다시 확인해 주세요.',409)});
  }else await identityBatch([d.prepare('INSERT INTO notes(id,title,body,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),title,body.trim(),new Date().toISOString())],'write',mode);
  return getNotes(title,target?.document_id??undefined);
}
