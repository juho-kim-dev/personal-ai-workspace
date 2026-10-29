import {db,WikiError} from './wiki-store';
import {identityMode} from './wiki-identity';
import {KNOWLEDGE_FIELDS,decodedKnowledge,knowledgeText,knowledgeToken,workContextInput,validateKnowledgeRecord,type KnowledgeRecord,type KnowledgePrincipal,type KnowledgeKind} from './wiki-knowledge-contract';

export async function knowledgeReady() {
    return !!await db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_events'").first();
}
export async function requireKnowledge() {
    if(await identityMode()!=='active'||!await knowledgeReady())throw new WikiError('근거·검토 기능에는 문서 ID 활성화와 0004 마이그레이션이 필요합니다.',503);
}
export async function knowledgeRows():Promise<KnowledgeRecord[]> {
    if(!await knowledgeReady())return [];
    return (await db().prepare('SELECT * FROM knowledge_events ORDER BY created_at,id').all()).results as KnowledgeRecord[];
}
export async function knowledgePrincipal(principal:KnowledgePrincipal) {
    if(!principal||!['browser','mcp'].includes(principal.channel))throw new WikiError('로그인이 필요합니다.',401);
    const subject=knowledgeText(principal.subject,1000,'인증 주체');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(subject));
    return JSON.stringify({subject_hash:Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''),channel:principal.channel});
}
export async function makeKnowledgeRecord(input:{id:string;document_id:string;revision_id:string;kind:KnowledgeKind;payload:Record<string,any>;subject_id?:string|null;work_context?:unknown},principal:KnowledgePrincipal):Promise<KnowledgeRecord> {
    return {id:knowledgeToken(input.id),document_id:input.document_id,revision_id:input.revision_id,kind:input.kind,
        subject_id:input.subject_id??null,source_key:['evidence','observation'].includes(input.kind)?input.payload.source_key:null,
        source_version:['evidence','observation'].includes(input.kind)?input.payload.source_version:null,payload:JSON.stringify(input.payload),
        work_context:JSON.stringify(workContextInput(input.work_context)),principal:await knowledgePrincipal(principal),created_at:new Date().toISOString()};
}
export function insertKnowledge(row:KnowledgeRecord,ignore=false) {
    validateKnowledgeRecord(row);
    return db().prepare(`INSERT ${ignore?'OR IGNORE ':''}INTO knowledge_events(${KNOWLEDGE_FIELDS.join(',')}) VALUES(${KNOWLEDGE_FIELDS.map(()=>'?').join(',')})`).bind(...KNOWLEDGE_FIELDS.map(k=>row[k]));
}
export function knowledgeHeadGuard(documentId:string,revisionId:string) {
    const id=crypto.randomUUID();
    return [db().prepare("INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM pages p JOIN documents d ON d.document_id=p.document_id WHERE p.document_id=? AND p.version=? AND d.state='live' AND d.title=p.title) THEN 1 ELSE 0 END").bind(id,documentId,revisionId),db().prepare('DELETE FROM mutation_guards WHERE id=?').bind(id)];
}
export async function contributionStatements(documentId:string,revisionId:string,target:'revision'|'comment',targetId:string,context:unknown,principal?:KnowledgePrincipal) {
    if(context!==undefined&&!principal)throw new WikiError('작업 맥락을 기록할 인증 정보가 없습니다.',401);
    if(!principal)return [];
    if(!await knowledgeReady()){
        if(context!==undefined)throw new WikiError('작업 맥락을 보존하려면 0004 마이그레이션이 필요합니다.',503);
        return [];
    }
    const row=await makeKnowledgeRecord({id:crypto.randomUUID(),document_id:documentId,revision_id:revisionId,kind:'contribution',payload:{target,target_id:targetId},work_context:context},principal);
    return [insertKnowledge(row)];
}
export async function knowledgeEvent(id:unknown) {
    const row=await db().prepare('SELECT * FROM knowledge_events WHERE id=?').bind(knowledgeToken(id)).first<KnowledgeRecord>();
    if(!row)throw new WikiError('근거·검토 기록을 찾을 수 없습니다.',404);
    return row;
}
export async function proposalStatements(proposalId:string,requestId:string,documentId:string,baseVersion:string,newVersion:string,context:unknown,principal:KnowledgePrincipal) {
    const [before,after]=knowledgeHeadGuard(documentId,newVersion);
    // The page save and this terminal event share one atomic identity batch.
    const guard=crypto.randomUUID();
    const open=db().prepare("INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM knowledge_events e WHERE e.id=? AND e.kind='proposal' AND e.document_id=? AND e.revision_id=?) AND NOT EXISTS(SELECT 1 FROM knowledge_events WHERE subject_id=? AND kind IN ('resolution','applied')) THEN 1 ELSE 0 END").bind(guard,proposalId,documentId,baseVersion,proposalId);
    const row=await makeKnowledgeRecord({id:requestId,document_id:documentId,revision_id:newVersion,kind:'applied',subject_id:proposalId,payload:{target:'proposal',target_id:proposalId},work_context:context},principal);
    return [before,open,insertKnowledge(row),db().prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),after];
}
export async function contributionForComment(documentId:string,revisionId:string,commentId:string,context:unknown,principal?:KnowledgePrincipal) {
    return contributionStatements(documentId,revisionId,'comment',commentId,context,principal);
}
export async function withContributions(rows:any[],target:'revision'|'comment') {
    if(!rows.length||!await knowledgeReady())return rows;
    const records=new Map<string,any>();
    for(let offset=0;offset<rows.length;offset+=90){
        const ids=rows.slice(offset,offset+90).map(row=>row.id);
        const found=(await db().prepare(`SELECT * FROM knowledge_events WHERE kind='contribution' AND json_extract(payload,'$.target')=? AND json_extract(payload,'$.target_id') IN (${ids.map(()=>'?').join(',')}) ORDER BY created_at,id`).bind(target,...ids).all()).results as KnowledgeRecord[];
        for(const record of found)records.set(JSON.parse(record.payload).target_id,{work_context:JSON.parse(record.work_context),channel:JSON.parse(record.principal).channel,record_id:record.id});
    }
    return rows.map(row=>records.has(row.id)?{...row,contribution:records.get(row.id)}:row);
}
export {decodedKnowledge};
