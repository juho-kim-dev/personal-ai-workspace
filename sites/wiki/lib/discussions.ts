import {db,WikiError,titleInput,summaryInput,readPage} from './wiki';
import {identityMode,identityTarget,identityBatch} from './wiki-identity';
import {contributionForComment,withContributions} from './wiki-knowledge-store';
import type {KnowledgePrincipal} from './wiki-knowledge-contract';
export function textInput(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max)throw new WikiError(`내용을 1~${max}자로 입력해 주세요.`);return value.trim()}
export async function listThreads(value:unknown,documentId?:unknown){
 const mode=await identityMode();
 if(mode==='active'){
  const target=await identityTarget(documentId?undefined:value,documentId,{deleted:true,allowMissing:true});
  return (await db().prepare('SELECT * FROM threads WHERE document_id=? ORDER BY updated_at DESC,id').bind(target.document_id).all()).results;
 }
 if(documentId)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
 return (await db().prepare('SELECT * FROM threads WHERE title=? ORDER BY updated_at DESC,id').bind(titleInput(value)).all()).results;
}
export async function readThread(id:unknown){await identityMode();if(typeof id!=='string'||!id||id.length>80)throw new WikiError('토론 번호가 올바르지 않습니다.');const thread=await db().prepare('SELECT * FROM threads WHERE id=?').bind(id).first();if(!thread)throw new WikiError('토론을 찾을 수 없습니다.',404);return {thread,comments:await withContributions((await db().prepare('SELECT * FROM comments WHERE thread_id=? ORDER BY number').bind(id).all()).results,'comment')}}
export async function createThread(input:any,principal?:KnowledgePrincipal){
 const mode=await identityMode(),target=mode==='active'?await identityTarget(input.title,input.document_id):null;
 if(mode==='legacy'&&input.document_id)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
 const title=target?.title??titleInput(input.title),subject=textInput(input.subject,200),body=textInput(input.body,10000),page=await readPage(title,target?.document_id??undefined);
 if(mode==='legacy'&&input.work_context!==undefined)throw new WikiError('작업 맥락을 보존하려면 문서 ID 활성화가 필요합니다.',503);
 const id=crypto.randomUUID(),commentId=crypto.randomUUID(),now=new Date().toISOString(),d=db();
 if(target){
  const guard=crypto.randomUUID();
  await identityBatch([
   d.prepare("INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM pages p JOIN documents d ON d.document_id=p.document_id WHERE p.title=? AND p.document_id=? AND d.title=p.title AND d.state='live') THEN 1 ELSE 0 END").bind(guard,title,target.document_id),
   d.prepare("INSERT INTO threads(id,title,subject,status,version,created_at,updated_at,document_id,observed_title) VALUES(?,?,?,'open',?,?,?,?,?)").bind(id,title,subject,crypto.randomUUID(),now,now,target.document_id,title),
   d.prepare('INSERT INTO comments(id,thread_id,number,body,created_at) VALUES(?,?,1,?,?)').bind(commentId,id,body,now),
   ...await contributionForComment(String(target.document_id),String(page.version),commentId,input.work_context,principal),
   d.prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),
  ],'write',mode).catch(error=>{if(error?.status)throw error;throw new WikiError('문서가 이동되었거나 삭제되었습니다. 최신 문서를 확인해 주세요.',409)});
  return readThread(id);
 }
 const r=await identityBatch([
 db().prepare("INSERT INTO threads(id,title,subject,status,version,created_at,updated_at) SELECT ?,?,?,'open',?,?,? WHERE EXISTS(SELECT 1 FROM pages WHERE title=?)").bind(id,title,subject,crypto.randomUUID(),now,now,title),
 db().prepare('INSERT INTO comments(id,thread_id,number,body,created_at) SELECT ?,id,1,?,? FROM threads WHERE id=?').bind(crypto.randomUUID(),body,now,id)],'write',mode);if(!r[0].meta.changes)throw new WikiError('문서가 삭제되었습니다.',409);return readThread(id)}
export async function changeThread(input:any,comment=false,principal?:KnowledgePrincipal){
 const mode=await identityMode();
 if(mode==='legacy'&&input.work_context!==undefined)throw new WikiError('작업 맥락을 보존하려면 문서 ID 활성화가 필요합니다.',503);
 const id=textInput(input.thread_id,80),expected=textInput(input.expected_version,80),now=new Date().toISOString(),version=crypto.randomUUID();let body='';
 if(comment)body=textInput(input.body,10000);else {if(!['open','paused','closed'].includes(input.status))throw new WikiError('토론 상태가 올바르지 않습니다.');body=summaryInput(input.summary)}
 const hasDocumentId=input.document_id!==undefined&&input.document_id!==null;
 if(mode==='legacy'&&hasDocumentId)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
 const target=hasDocumentId&&mode==='active'?await identityTarget(input.title,input.document_id):null;
 const d=db();const statements=[d.prepare('UPDATE threads SET status=CASE WHEN ? THEN status ELSE ? END,version=?,updated_at=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM pages WHERE pages.title=threads.title'+(mode==='active'?' AND pages.document_id=threads.document_id':'')+')'+(target?' AND document_id=? AND title=?':'')+" AND (SELECT count(*) FROM comments WHERE thread_id=threads.id)<1000"+(comment?" AND status='open'":' AND status<>?')).bind(comment?1:0,comment?'open':input.status,version,now,id,expected,...(target?[target.document_id,target.title]:[]),...(comment?[]:[input.status]))];
 statements.unshift(d.prepare('INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM threads WHERE id=? AND version=?'+(comment?'':' AND status<>?')+') THEN 1 ELSE 0 END').bind(version,id,expected,...(comment?[]:[input.status])));
 const previous=comment?null:await d.prepare('SELECT status FROM threads WHERE id=?').bind(id).first();
 if(!comment)body='상태 변경: '+previous?.status+' → '+input.status+' — '+body;
 const commentId=crypto.randomUUID();
 statements.push(d.prepare('INSERT INTO comments(id,thread_id,number,body,created_at) SELECT ?,id,(SELECT coalesce(max(number),0)+1 FROM comments WHERE thread_id=?),?,? FROM threads WHERE id=? AND version=?').bind(commentId,id,body,now,id,version));
 if(principal&&mode==='active'){
  const page:any=await d.prepare('SELECT p.* FROM pages p JOIN threads t ON t.document_id=p.document_id WHERE t.id=?').bind(id).first();
  if(page)statements.push(...await contributionForComment(page.document_id,page.version,commentId,input.work_context,principal));
 }
 statements.push(d.prepare('DELETE FROM mutation_guards WHERE id=?').bind(version));
 const out=await identityBatch(statements,'write',mode).catch(error=>{if(error?.status)throw error;throw new WikiError('토론이 변경되었거나 같은 상태로 변경할 수 없습니다.',409)});if(!out[1].meta.changes)throw new WikiError('토론이 변경되었거나 답글을 작성할 수 없는 상태입니다.',409);return readThread(id);
}

// One bounded query shared by HTTP and MCP. instr treats %, _ and backslashes literally.
export async function recentDiscussions(input:{status?:unknown;query?:unknown;offset?:unknown;limit?:unknown}={}){
 const mode=await identityMode();
 const status=input.status===undefined?'all':input.status,query=input.query===undefined?'':input.query;
 if(typeof status!=='string'||!['all','open','paused','closed'].includes(status))throw new WikiError('토론 상태가 올바르지 않습니다.');
 if(typeof query!=='string'||query.length>200)throw new WikiError('검색어는 200자 이하로 입력해 주세요.');
 const integer=(value:unknown,fallback:number,max:number,min=0)=>{
  if(value===undefined)return fallback;
  if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+$/.test(value)))throw new WikiError('목록 범위가 올바르지 않습니다.');
  const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new WikiError('목록 범위가 올바르지 않습니다.');return n;
 };
 const offset=integer(input.offset,0,100000),limit=integer(input.limit,30,100,1),q=query.trim().normalize('NFC');
 const rows=(await db().prepare(`SELECT t.*,
 (SELECT count(*) FROM comments c WHERE c.thread_id=t.id) AS comment_count,
 coalesce((SELECT max(c.number) FROM comments c WHERE c.thread_id=t.id),0) AS last_number,
 coalesce((SELECT substr(c.body,1,240) FROM comments c WHERE c.thread_id=t.id ORDER BY c.number DESC LIMIT 1),'') AS last_body
 FROM threads t JOIN pages p ON p.title=t.title${mode==='active'?' AND p.document_id=t.document_id':''}
 WHERE (?='all' OR t.status=?) AND (instr(lower(t.title),lower(?))>0 OR instr(lower(t.subject),lower(?))>0)
 ORDER BY t.updated_at DESC,t.id LIMIT ? OFFSET ?`).bind(status,status,q,q,limit+1,offset).all()).results;
 // Also cap UTF-16 length for API consumers (SQLite substr counts Unicode code points).
 return {items:rows.slice(0,limit).map(row=>({...row,last_body:String(row.last_body).slice(0,240).replace(/[\uD800-\uDBFF]$/,'')})),has_more:rows.length>limit};
}
