import {db,WikiError,titleInput,summaryInput} from './wiki';
import {identityMode,identityTarget,identityBatch} from './wiki-identity';
export async function listTrash(){await identityMode();return (await db().prepare('SELECT * FROM trash ORDER BY deleted_at DESC,title').all()).results}
export async function readTrash(value:unknown,documentId?:unknown){
 const mode=await identityMode(),target=mode==='active'?await identityTarget(documentId?undefined:value,documentId,{deleted:true,allowMissing:true}):null;
 if(mode==='legacy'&&documentId)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
 const byId=Boolean(documentId&&target?.document_id);
 const row=await db().prepare('SELECT * FROM trash WHERE '+(byId?'document_id=?':'title=?'+(target?.document_id?' AND document_id=?':''))).bind(...(byId?[target!.document_id]:[target?.title??titleInput(value),...(target?.document_id?[target.document_id]:[])])).first();
 if(!row)throw new WikiError('휴지통 문서를 찾을 수 없습니다.',404);return target?{...row,dataset_id:target.dataset_id}:row;
}
export async function trashPage(input:any){
 const mode=await identityMode(),target=mode==='active'?await identityTarget(input.title,input.document_id):null;
 if(mode==='legacy'&&input.document_id)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
 const title=target?.title??titleInput(input.title),summary=summaryInput(input.summary);if(typeof input.expected_version!=='string'||!input.expected_version)throw new WikiError('현재 판 번호가 필요합니다.');
 const id=crypto.randomUUID(),now=new Date().toISOString(),d=db();
 const source=await d.prepare('SELECT * FROM pages WHERE title=? AND version=?'+(target?.document_id?' AND document_id=?':'')).bind(title,input.expected_version,...(target?.document_id?[target.document_id]:[])).first();
 if(!source)throw new WikiError('문서가 먼저 수정되었거나 삭제되었습니다.',409);
 if(mode==='active'){
  const documentId=target!.document_id!,guard=crypto.randomUUID(),revisionId=crypto.randomUUID();
  await identityBatch([
   d.prepare("INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM pages p JOIN documents d ON d.document_id=p.document_id WHERE p.title=? AND p.document_id=? AND p.version=? AND d.title=p.title AND d.state='live') AND NOT EXISTS(SELECT 1 FROM trash WHERE title=?) THEN 1 ELSE 0 END").bind(guard,title,documentId,input.expected_version,title),
   d.prepare('INSERT INTO trash(title,content,version,updated_at,deleted_at,delete_summary,trash_id,document_id) SELECT title,content,version,updated_at,?,?,?,document_id FROM pages WHERE title=? AND document_id=? AND version=?').bind(now,summary,id,title,documentId,input.expected_version),
   d.prepare('INSERT INTO revisions(id,title,content,summary,created_at,size,document_id,observed_title) SELECT ?,title,content,?,deleted_at,length(content),document_id,title FROM trash WHERE trash_id=? AND document_id=?').bind(revisionId,'삭제: '+summary,id,documentId),
   d.prepare('DELETE FROM pages WHERE title=? AND document_id=? AND version=?').bind(title,documentId,input.expected_version),
   d.prepare("UPDATE documents SET state='deleted' WHERE document_id=? AND title=?").bind(documentId,title),
   d.prepare("INSERT INTO identity_events(id,document_id,kind,old_title,new_title,redirect_document_id,created_at) VALUES(?,?,'delete',?,?,NULL,?)").bind(crypto.randomUUID(),documentId,title,title,now),
   d.prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),
  ],'write',mode).catch(error=>{if(error?.status)throw error;throw new WikiError('문서가 먼저 수정되었거나 삭제되었습니다.',409)});
  return {...source,deleted_at:now,delete_summary:summary,trash_id:id,document_id:documentId,dataset_id:target!.dataset_id};
 }
 const out=await identityBatch([
 d.prepare('INSERT INTO trash(title,content,version,updated_at,deleted_at,delete_summary,trash_id) SELECT title,content,version,updated_at,?,?,? FROM pages WHERE title=? AND version=?').bind(now,summary,id,title,input.expected_version),
 d.prepare('INSERT INTO revisions(id,title,content,summary,created_at,size) SELECT trash_id,title,content,?,deleted_at,length(content) FROM trash WHERE trash_id=?').bind('삭제: '+summary,id),
 d.prepare('DELETE FROM pages WHERE title=? AND version=? AND EXISTS(SELECT 1 FROM trash WHERE trash_id=?)').bind(title,input.expected_version,id)],'write',mode);
 if(!out[0].meta.changes)throw new WikiError('문서가 먼저 수정되었거나 삭제되었습니다.',409);return {...source,deleted_at:now,delete_summary:summary,trash_id:id};
}
export async function restorePage(input:any){
 const mode=await identityMode(),target=mode==='active'?await identityTarget(input.title,input.document_id,{deleted:true}):null;
 if(mode==='legacy'&&input.document_id)throw new WikiError('문서 ID 전환이 아직 완료되지 않았습니다.',409);
 const title=target?.title??titleInput(input.title),summary=summaryInput(input.summary);if(typeof input.trash_id!=='string'||typeof input.expected_version!=='string')throw new WikiError('휴지통 번호와 현재 판 번호가 필요합니다.');
 const id=crypto.randomUUID(),now=new Date().toISOString(),d=db();
 const source=await d.prepare('SELECT content FROM trash WHERE title=? AND trash_id=? AND version=?'+(target?.document_id?' AND document_id=?':'')).bind(title,input.trash_id,input.expected_version,...(target?.document_id?[target.document_id]:[])).first();
 if(!source)throw new WikiError('휴지통 문서가 변경되었습니다. 다시 확인해 주세요.',409);
 if(mode==='active'){
  const documentId=target!.document_id!,guard=crypto.randomUUID();
  await identityBatch([
   d.prepare("INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM trash t JOIN documents d ON d.document_id=t.document_id WHERE t.title=? AND t.document_id=? AND t.trash_id=? AND t.version=? AND d.title=t.title AND d.state='deleted') AND NOT EXISTS(SELECT 1 FROM pages WHERE title=?) AND NOT EXISTS(SELECT 1 FROM restore_stage WHERE title=?) THEN 1 ELSE 0 END").bind(guard,title,documentId,input.trash_id,input.expected_version,title,title),
   d.prepare('INSERT INTO restore_stage(title,content,version,updated_at,deleted_at,delete_summary,trash_id,document_id) SELECT title,content,version,updated_at,deleted_at,delete_summary,trash_id,document_id FROM trash WHERE title=? AND document_id=? AND trash_id=?').bind(title,documentId,input.trash_id),
   // Imported legacy trash can lack its deletion audit. Preserve its stored
   // facts before removing the reservation, without reusing trash_id as a revision.
   d.prepare("INSERT INTO revisions(id,title,content,summary,created_at,size,document_id,observed_title) SELECT ?,s.title,s.content,'삭제: '||s.delete_summary,s.deleted_at,length(s.content),s.document_id,s.title FROM restore_stage s WHERE s.title=? AND s.document_id=? AND NOT EXISTS(SELECT 1 FROM revisions r WHERE r.document_id=s.document_id AND r.created_at=s.deleted_at AND r.summary='삭제: '||s.delete_summary AND r.content=s.content)").bind(crypto.randomUUID(),title,documentId),
   d.prepare('DELETE FROM trash WHERE title=? AND document_id=? AND trash_id=?').bind(title,documentId,input.trash_id),
   d.prepare('INSERT INTO pages(title,content,version,updated_at,document_id) SELECT title,content,?,?,document_id FROM restore_stage WHERE title=? AND document_id=?').bind(id,now,title,documentId),
   d.prepare("UPDATE documents SET state='live' WHERE document_id=? AND title=?").bind(documentId,title),
   d.prepare('INSERT INTO revisions(id,title,content,summary,created_at,size,document_id,observed_title) SELECT version,title,content,?,?,length(content),document_id,title FROM pages WHERE title=? AND document_id=?').bind('복원: '+summary,now,title,documentId),
   d.prepare("INSERT INTO identity_events(id,document_id,kind,old_title,new_title,redirect_document_id,created_at) VALUES(?,?,'restore',?,?,NULL,?)").bind(crypto.randomUUID(),documentId,title,title,now),
   d.prepare('DELETE FROM restore_stage WHERE title=? AND document_id=?').bind(title,documentId),
   d.prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),
  ],'write',mode).catch(error=>{if(error?.status)throw error;throw new WikiError('휴지통 문서가 변경되었습니다. 다시 확인해 주세요.',409)});
  return {title,content:source.content,version:id,updated_at:now,document_id:documentId,dataset_id:target!.dataset_id};
 }
 // Remove reservation and insert from a transaction-local staging row. The guard aborts the entire batch on stale CAS.
 const guard=crypto.randomUUID();const out=await identityBatch([
 d.prepare('INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM trash WHERE title=? AND trash_id=? AND version=?) AND NOT EXISTS(SELECT 1 FROM pages WHERE title=?) THEN 1 ELSE 0 END').bind(guard,title,input.trash_id,input.expected_version,title),
 d.prepare('INSERT INTO restore_stage SELECT * FROM trash WHERE title=?').bind(title),
 d.prepare("INSERT INTO revisions(id,title,content,summary,created_at,size) SELECT trash_id,title,content,'삭제: '||delete_summary,deleted_at,length(content) FROM restore_stage WHERE title=? AND NOT EXISTS(SELECT 1 FROM revisions WHERE id=restore_stage.trash_id)").bind(title),
 d.prepare('DELETE FROM trash WHERE title=?').bind(title),
 d.prepare('INSERT INTO pages(title,content,version,updated_at) SELECT title,content,?,? FROM restore_stage WHERE title=?').bind(id,now,title),
 d.prepare('INSERT INTO revisions(id,title,content,summary,created_at,size) SELECT version,title,content,?,?,length(content) FROM pages WHERE title=?').bind('복원: '+summary,now,title),
 d.prepare('DELETE FROM restore_stage WHERE title=?').bind(title),d.prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard)
 ],'write',mode).catch(error=>{if(error?.status)throw error;throw new WikiError('휴지통 문서가 변경되었습니다. 다시 확인해 주세요.',409)});void out;return {title,content:source.content,version:id,updated_at:now};
}
