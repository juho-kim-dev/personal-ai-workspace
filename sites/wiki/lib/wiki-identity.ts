import {db, WikiError, titleInput} from './wiki-store';
import {WIKI_NAMESPACES} from './wiki-title';

export const IDENTITY_NAMESPACES = JSON.stringify(['', ...WIKI_NAMESPACES]);
export const IDENTITY_CHUNK_LIMIT = 100;
const phases = ['pages', 'trash', 'revisions', 'threads', 'notes', 'bookmarks', 'done'] as const;
const states = ['frozen', 'migrating', 'verified', 'active', 'maintenance'];
export type IdentityMode = 'legacy'|'active';
export type IdentityMeta = {
  state:string; schema_ready:boolean; id?:number; dataset_id?:string; namespace_json?:string;
  phase?:string; cursor?:string; generation?:number; source_epoch?:number|null;
  source_fingerprint?:string|null; backup_fingerprint?:string|null; backup_epoch?:number|null;
  source_backup_fingerprint?:string|null; verified_epoch?:number|null;
};
const legacyFields:Record<string,string[]> = {
  pages:['title','content','version','updated_at'], trash:['title','content','version','updated_at','deleted_at','delete_summary','trash_id'],
  revisions:['id','title','content','summary','created_at','size'], threads:['id','title','subject','status','version','created_at','updated_at'],
  notes:['id','title','body','created_at'], bookmarks:['title'], comments:['id','thread_id','number','body','created_at'],
  attachments:['name','key','mime','size','created_at'],
};
function unavailable(message='문서 ID 전환 중에는 쓰기가 중지됩니다. 상태를 확인하고 다시 시도해 주세요.'):never {
  throw new WikiError(message,503);
}
function conflict(message='문서 ID 전환 상태가 변경되었습니다. 상태를 다시 확인해 주세요.'):never {
  throw new WikiError(message,409);
}
export function documentIdInput(value:unknown):string {
  if (typeof value!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new WikiError('문서 ID 형식이 올바르지 않습니다.');
  return value;
}
const identityTables=['identity_meta','documents','identity_events','identity_imports','identity_gate'] as const;
const ownershipColumns:Record<string,string[]>={
  pages:['document_id'],trash:['document_id'],restore_stage:['document_id'],
  revisions:['document_id','observed_title'],threads:['document_id','observed_title'],
  notes:['document_id','observed_title'],bookmarks:['document_id','observed_title'],
};
/** Absence is legacy only when the schema and stored rows independently prove it. */
async function assertUninitializedIdentity(schemaReady:boolean) {
  const baselineTables=[...Object.keys(legacyFields),'restore_stage','mutation_guards','wiki_state'];
  const names=[...identityTables,...baselineTables];
  const artifacts=(await db().prepare(`SELECT name,type FROM sqlite_master WHERE name IN (${names.map(()=>'?').join(',')})
    OR (type='trigger' AND name GLOB 'identity_*')`).bind(...names).all()).results;
  if (!schemaReady && artifacts.some(row=>row.type==='trigger'||identityTables.some(table=>table===row.name)))
    unavailable('문서 ID 메타데이터가 없지만 이관 스키마가 남아 있습니다. 쓰기는 차단되어 있습니다.');
  if (baselineTables.some(table=>!artifacts.some(row=>row.name===table&&row.type==='table')))
    unavailable('기존 문서 저장 스키마가 완전하지 않습니다. 쓰기는 차단되어 있습니다.');
  if (schemaReady && identityTables.some(table=>!artifacts.some(row=>row.name===table&&row.type==='table')))
    unavailable('문서 ID 스키마가 완전하지 않습니다. 쓰기는 차단되어 있습니다.');
  for (const [table,columns] of Object.entries(ownershipColumns)) {
    const actual=(await db().prepare(`PRAGMA table_info(${table})`).all()).results;
    if (!actual.length) unavailable('기존 문서 저장 스키마가 완전하지 않습니다. 쓰기는 차단되어 있습니다.');
    const hasIdentity=actual.some(row=>row.name==='document_id'||row.name==='observed_title');
    if (!schemaReady && hasIdentity) unavailable('문서 ID 메타데이터가 없지만 소속 열이 남아 있습니다. 쓰기는 차단되어 있습니다.');
    if (schemaReady && columns.some(column=>!actual.some(row=>row.name===column)))
      unavailable('문서 ID 소속 스키마가 완전하지 않습니다. 쓰기는 차단되어 있습니다.');
  }
  if (!schemaReady) return;
  const evidence=[
    ...identityTables.map(table=>`EXISTS(SELECT 1 FROM ${table})`),
    ...Object.entries(ownershipColumns).map(([table,columns])=>
      `EXISTS(SELECT 1 FROM ${table} WHERE ${columns.map(column=>`${column} IS NOT NULL`).join(' OR ')})`),
  ];
  if (await db().prepare(`SELECT 1 WHERE ${evidence.join(' OR ')}`).first())
    unavailable('문서 ID 메타데이터가 없지만 식별 자료가 남아 있습니다. 쓰기는 차단되어 있습니다.');
}
export async function identityStatus():Promise<IdentityMeta> {
  let row:any;
  try { row = await db().prepare('SELECT * FROM identity_meta WHERE id=1').first(); }
  catch(error) {
    // Compatibility only for the old, unapplied additive schema. Never swallow an outage or corrupt state.
    if (error && typeof error==='object' && 'message' in error && typeof error.message==='string'
      && /no such table:\s*(?:main\.)?identity_meta\b/i.test(error.message)) {
      await assertUninitializedIdentity(false);
      return {state:'legacy',schema_ready:false};
    }
    throw error;
  }
  if (!row) {
    await assertUninitializedIdentity(true);
    return {state:'legacy',schema_ready:true};
  }
  if (!states.includes(row.state) || !phases.includes(row.phase) || !Number.isSafeInteger(row.generation) || row.generation<0)
    unavailable('알 수 없는 ID 전환 상태입니다. 쓰기는 차단되어 있습니다.');
  if (row.namespace_json!==IDENTITY_NAMESPACES) unavailable('지원하지 않는 이름공간 레지스트리입니다.');
  documentIdInput(row.dataset_id);
  return {...row,schema_ready:true};
}
export async function identityMode():Promise<IdentityMode> {
  const meta=await identityStatus();
  if (meta.state!=='legacy' && meta.state!=='active') unavailable();
  return meta.state;
}
export async function identityEpoch() {
  const row:any=await db().prepare('SELECT version FROM wiki_state WHERE id=1').first();
  if (!row || !Number.isSafeInteger(row.version)) unavailable('저장소 세대가 없습니다.');
  return row.version as number;
}
const epoch=identityEpoch;
function checkpoint(meta:IdentityMeta) {
  return db().prepare('INSERT INTO identity_gate(id,mode,generation) VALUES(1,?,?)')
    .bind(meta.state==='active'?'write':'maintenance',meta.generation!);
}
async function maintenanceBatch(meta:IdentityMeta, statements:D1PreparedStatement[]) {
  if (!['frozen','migrating','verified','maintenance'].includes(meta.state)) conflict();
  try {
    const results=await db().batch([checkpoint(meta), ...statements, db().prepare('DELETE FROM identity_gate WHERE id=1')]);
    return results.slice(1,-1);
  } catch(error) {
    if (error instanceof WikiError) throw error;
    conflict('전환 배치가 중단되었습니다. 마지막 완료된 체크포인트에서 다시 실행해 주세요.');
  }
}
/** Every gate lives entirely inside one atomic D1 batch. Never grant active permission to SQL built in legacy mode. */
export async function identityBatch(statements:D1PreparedStatement[], mode:'write'|'maintenance'='write', expectedMode?:IdentityMode) {
  const meta=await identityStatus();
  if (expectedMode!==undefined && meta.state!==expectedMode) conflict();
  if (mode==='maintenance') return maintenanceBatch(meta,statements);
  if (meta.state==='legacy') {
    if (!meta.schema_ready) return db().batch(statements);
    const guard=crypto.randomUUID();
    const result=await db().batch([
      db().prepare('INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM identity_meta) THEN 1 ELSE 0 END').bind(guard),
      ...statements, db().prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),
    ]);
    return result.slice(1,-1);
  }
  if (meta.state!=='active') unavailable();
  const result=await db().batch([checkpoint(meta),...statements,db().prepare('DELETE FROM identity_gate WHERE id=1')]);
  return result.slice(1,-1);
}
export async function identityTarget(value:unknown, documentId?:unknown, options:{deleted?:boolean;allowMissing?:boolean}={}) {
  const meta=await identityStatus();
  if (documentId!==undefined && documentId!==null) {
    const id=documentIdInput(documentId);
    if (meta.state==='legacy') throw new WikiError('영구 문서 ID가 아직 활성화되지 않았습니다.',409);
    const row:any=await db().prepare('SELECT * FROM documents WHERE document_id=?').bind(id).first();
    if (!row) throw new WikiError('문서 ID를 찾을 수 없습니다.',404);
    if (value!==undefined && value!==null && titleInput(value)!==row.title) conflict('문서 ID와 제목이 일치하지 않습니다. 현재 문서를 다시 읽어 주세요.');
    if (row.state==='deleted' && !options.deleted) throw new WikiError('삭제된 문서입니다. 휴지통에서 복원해 주세요.',410);
    return {title:String(row.title),document_id:id,dataset_id:meta.dataset_id!};
  }
  const title=titleInput(value);
  if (meta.state==='legacy') return {title,document_id:null,dataset_id:null};
  const row:any=await db().prepare('SELECT * FROM documents WHERE title=?').bind(title).first();
  if (!row) {
    if (options.allowMissing) return {title,document_id:null,dataset_id:meta.dataset_id!};
    throw new WikiError('아직 작성되지 않은 문서입니다.',404);
  }
  if (row.state==='deleted' && !options.deleted) throw new WikiError('삭제된 문서입니다. 휴지통에서 복원해 주세요.',410);
  return {title,document_id:String(row.document_id),dataset_id:meta.dataset_id!};
}
function canonical(value:any):string {
  return JSON.stringify(value===null||typeof value!=='object'?value:Array.isArray(value)?
    value.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])));
}
async function digest(value:any) {
  const data=new TextEncoder().encode(canonical(value));
  if (data.byteLength>24*1024*1024) throw new WikiError('ID 전환 원본은 24 MiB 이하여야 합니다.',413);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function sourceFingerprint() {
  const before=await epoch(), data:Record<string,unknown>={}; let count=0,bytes=0;
  for (const [table,fields] of Object.entries(legacyFields)) {
    const byteExpression=fields.map(field=>`length(CAST(${field} AS BLOB))`).join('+');
    const n:any=await db().prepare(`SELECT count(*) AS n,coalesce(sum(${byteExpression}),0) AS bytes FROM ${table}`).first();
    count+=Number(n.n);
    if (count>20000) throw new WikiError('ID 전환 원본 레코드는 20,000개 이하여야 합니다.',413);
    bytes+=Number(n.bytes);
    if (bytes>24*1024*1024) throw new WikiError('ID 전환 원본은 24 MiB 이하여야 합니다.',413);
    const order=fields[0];
    data[table]=(await db().prepare(`SELECT ${fields.join(',')} FROM ${table} ORDER BY ${order}`).all()).results;
  }
  const fingerprint=await digest(data);
  if (await epoch()!==before) conflict();
  return {fingerprint,epoch:before,count};
}
async function assertTransientEmpty() {
  for (const table of ['identity_gate','mutation_guards','restore_stage']) {
    if (await db().prepare(`SELECT 1 FROM ${table} LIMIT 1`).first()) conflict(`미완료 임시 상태(${table})가 있어 전환을 중단합니다.`);
  }
}
async function migrationCapacity() {
  let records=0,bytes=0;
  for (const [table,fields] of Object.entries(legacyFields)) {
    const byteExpression=fields.map(field=>`length(CAST(${field} AS BLOB))`).join('+');
    const row:any=await db().prepare(`SELECT count(*) AS n,coalesce(sum(${byteExpression}),0) AS bytes FROM ${table}`).first();
    records+=Number(row.n)*(table==='pages'||table==='trash'?2:1);
    bytes+=Number(row.bytes);
  }
  // Reserve one source-backup mapping row. Metadata singleton itself is not a backup record.
  if (records+1>20000) throw new WikiError('문서 레지스트리를 포함한 ID 이관 예상 레코드가 20,000개를 초과합니다.',413);
  if (bytes>24*1024*1024) throw new WikiError('ID 전환 원본은 24 MiB 이하여야 합니다.',413);
}
export async function startIdentityMigration() {
  let meta=await identityStatus();
  if (!meta.schema_ready) unavailable('추가 스키마를 먼저 적용해야 합니다.');
  if (!['legacy','frozen','migrating','verified'].includes(meta.state)) conflict();
  if (meta.state==='legacy') {
    await assertTransientEmpty();
    await migrationCapacity();
    const generation=0, dataset=crypto.randomUUID();
    // Freezing is the first persistent action. A crash afterwards leaves all legacy writers blocked.
    try {
      await db().prepare(`INSERT INTO identity_meta(id,dataset_id,namespace_json,state,phase,cursor,generation)
        VALUES(1,?,?,'frozen','pages','',?)`).bind(dataset,IDENTITY_NAMESPACES,generation).run();
    } catch { conflict(); }
    meta=await identityStatus();
  }
  if (!meta.source_fingerprint) {
    // Only the initial freeze can retry a failed preparation. After activation,
    // NULL intentionally means observed titles may differ from current titles.
    if (meta.state!=='frozen'||meta.phase!=='pages'||meta.cursor!=='') conflict();
    const source=await sourceFingerprint();
    await maintenanceBatch(meta,[db().prepare('UPDATE identity_meta SET source_epoch=?,source_fingerprint=?,generation=generation+1 WHERE id=1')
      .bind(source.epoch,source.fingerprint)]);
  }
  return identityStatus();
}
export async function stepIdentityMigration(input:{limit?:number;generation?:number}={}) {
  const meta=await identityStatus(), limit=input.limit??50;
  if (!Number.isInteger(limit)||limit<1||limit>IDENTITY_CHUNK_LIMIT) throw new WikiError('이관 청크는 1~100개여야 합니다.');
  if (input.generation!==undefined && input.generation!==meta.generation) conflict();
  if (!['frozen','migrating'].includes(meta.state) || !meta.source_fingerprint) conflict();
  if (!meta.source_backup_fingerprint) conflict('원본 전체 v2 백업을 먼저 내보내고 기록해야 이관을 시작할 수 있습니다.');
  if (meta.phase==='done') return meta;
  const firstStep=meta.state==='frozen';
  if (firstStep && (meta.phase!=='pages'||meta.cursor!==''||meta.source_epoch==null||
    meta.backup_epoch!==meta.source_epoch||meta.backup_fingerprint!==meta.source_backup_fingerprint||await epoch()!==meta.source_epoch))
    conflict('최초 고정 백업 이후 원본 세대가 변경되었습니다. 이관을 시작할 수 없습니다.');
  const table=meta.phase!;
  if (!phases.includes(table as typeof phases[number])) unavailable();
  const key=['pages','trash','bookmarks'].includes(table)?'title':'id';
  const rows=(await db().prepare(`SELECT * FROM ${table} WHERE ${key}>? ORDER BY ${key} LIMIT ?`).bind(meta.cursor!,limit).all()).results as any[];
  const statements:D1PreparedStatement[]=[];
  const sourceGuard=crypto.randomUUID();
  if (firstStep) statements.push(db().prepare(
    'INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN version=? THEN 1 ELSE 0 END FROM wiki_state WHERE id=1')
    .bind(sourceGuard,meta.source_epoch!));
  for (const row of rows) {
    if (titleInput(row.title)!==row.title) conflict('정규화되지 않은 원본 제목이 있습니다. 자료를 보존하고 진단해야 합니다.');
    if (table==='pages'||table==='trash') {
      const id=crypto.randomUUID();
      if (row.document_id) conflict('예상하지 않은 기존 문서 ID가 있습니다.');
      statements.push(db().prepare('INSERT INTO documents(document_id,title,state,observed_title) VALUES(?,?,?,?)')
        .bind(id,row.title,table==='pages'?'live':'deleted',row.title));
      statements.push(db().prepare(`UPDATE ${table} SET document_id=? WHERE title=? AND document_id IS NULL`).bind(id,row.title));
    } else {
      // Exact stored titles are evidence. Never infer a past title from a summary or redirect.
      const document:any=await db().prepare('SELECT document_id FROM documents WHERE title=?').bind(row.title).first();
      if (!document && ['revisions','threads'].includes(table))
        conflict(`소속 문서가 없는 ${table} 기록입니다: ${String(row[key]).slice(0,80)} / ${JSON.stringify(row.title)}. 활성화할 수 없습니다.`);
      statements.push(db().prepare(`UPDATE ${table} SET document_id=?,observed_title=? WHERE ${key}=?`)
        .bind(document?.document_id??null,row.title,row[key]));
    }
  }
  const finished=rows.length<limit;
  const phase=finished?phases[phases.indexOf(table as typeof phases[number])+1]:table;
  const cursor=finished?'':String(rows.at(-1)[key]);
  if (phase==='done' && meta.source_backup_fingerprint) {
    const documents=(await db().prepare('SELECT title,document_id FROM documents ORDER BY title').all()).results;
    statements.push(db().prepare('INSERT INTO identity_imports(source_fingerprint,mapping_json) VALUES(?,?)')
      .bind(meta.source_backup_fingerprint,canonical({format:'wiki42-legacy-identity-map-v1',documents})));
  }
  statements.push(db().prepare("UPDATE identity_meta SET state='migrating',phase=?,cursor=?,generation=generation+1,verified_epoch=NULL WHERE id=1").bind(phase,cursor));
  if (firstStep) statements.push(db().prepare('DELETE FROM mutation_guards WHERE id=?').bind(sourceGuard));
  await maintenanceBatch(meta,statements);
  return identityStatus();
}
/** A full bounded invariant scan, also used when reopening after new ID-aware writes. */
export async function verifyIdentityData() {
  const meta=await identityStatus(), before=await epoch(), problems:string[]=[];
  if (meta.state==='legacy') conflict();
  let count=0;
  for (const table of [...Object.keys(legacyFields),'documents','identity_events','identity_imports']) {
    const n:any=await db().prepare(`SELECT count(*) AS n FROM ${table}`).first();
    count+=Number(n.n);
  }
  if (count>20000) throw new WikiError('ID 자료 레코드는 20,000개 이하여야 합니다.',413);
  const invalid=async(name:string,sql:string)=>{
    if (await db().prepare(sql).first()) problems.push(name);
  };
  await invalid('active/deleted title collision','SELECT 1 FROM pages p JOIN trash t ON p.title=t.title LIMIT 1');
  await invalid('registry ownership',`SELECT 1 FROM documents d WHERE
    (d.state='live' AND NOT EXISTS(SELECT 1 FROM pages p WHERE p.title=d.title AND p.document_id=d.document_id)) OR
    (d.state='deleted' AND NOT EXISTS(SELECT 1 FROM trash t WHERE t.title=d.title AND t.document_id=d.document_id)) LIMIT 1`);
  for (const table of ['pages','trash','revisions','threads','notes','bookmarks']) {
    const optional=['notes','bookmarks'].includes(table);
    await invalid(`${table} ownership`, `SELECT 1 FROM ${table} x WHERE ${
      optional?'':'x.document_id IS NULL OR '} (x.document_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM documents d WHERE d.document_id=x.document_id AND d.title=x.title
      ${table==='pages'?"AND d.state='live'":table==='trash'?"AND d.state='deleted'":''})) ${
      ['revisions','threads','notes','bookmarks'].includes(table)?'OR x.observed_title IS NULL':''} LIMIT 1`);
  }
  // A missing head can be a preserved v1 snapshot. If the named revision exists,
  // its owner and body must agree with the current live or deleted document.
  for (const table of ['pages','trash']) {
    await invalid(`${table} head revision ownership`, `SELECT 1 FROM ${table} p JOIN revisions r ON r.id=p.version
      WHERE r.document_id IS NOT p.document_id LIMIT 1`);
    await invalid(`${table} head revision content`, `SELECT 1 FROM ${table} p JOIN revisions r ON r.id=p.version
      WHERE r.content IS NOT p.content LIMIT 1`);
  }
  if (meta.source_fingerprint) {
    if (!meta.source_backup_fingerprint) problems.push('missing original backup checkpoint');
    else {
      const mapping:any=await db().prepare('SELECT mapping_json FROM identity_imports WHERE source_fingerprint=?')
        .bind(meta.source_backup_fingerprint).first();
      const documents=(await db().prepare('SELECT title,document_id FROM documents ORDER BY title').all()).results;
      if (!mapping || mapping.mapping_json!==canonical({format:'wiki42-legacy-identity-map-v1',documents}))
        problems.push('original backup identity mapping');
    }
    for (const table of ['documents','revisions','threads','notes','bookmarks'])
      await invalid(`${table} original observed title`,`SELECT 1 FROM ${table} WHERE observed_title IS NOT title LIMIT 1`);
  }
  await invalid('orphan comments','SELECT 1 FROM comments c WHERE NOT EXISTS(SELECT 1 FROM threads t WHERE t.id=c.thread_id) LIMIT 1');
  await invalid('comment sequence',`SELECT 1 FROM threads t LEFT JOIN comments c ON c.thread_id=t.id GROUP BY t.id
    HAVING count(c.id)=0 OR min(c.number)<>1 OR max(c.number)<>count(c.id) OR count(c.id)>1000 LIMIT 1`);
  await invalid('event ownership',`SELECT 1 FROM identity_events e WHERE NOT EXISTS(SELECT 1 FROM documents d WHERE d.document_id=e.document_id)
    OR (e.redirect_document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM documents d WHERE d.document_id=e.redirect_document_id)) LIMIT 1`);
  const docs=(await db().prepare('SELECT * FROM documents').all()).results as any[];
  for (const doc of docs) {
    documentIdInput(doc.document_id); titleInput(doc.title); titleInput(doc.observed_title);
  }
  if (await epoch()!==before) conflict();
  return {valid:problems.length===0,problems,epoch:before,records:count};
}
export async function verifyIdentityMigration() {
  const meta=await identityStatus();
  if (!['migrating','verified','maintenance'].includes(meta.state) || meta.phase!=='done') conflict('모든 청크를 완료해야 검증할 수 있습니다.');
  await assertTransientEmpty();
  const check=await verifyIdentityData();
  if (!check.valid) throw new WikiError('ID 소속 검증 실패: '+check.problems.join(', '),409);
  if (meta.source_fingerprint) {
    const source=await sourceFingerprint();
    if (source.fingerprint!==meta.source_fingerprint) conflict('고정된 원본 값이 변경되었습니다. 활성화를 중단합니다.');
  }
  const guard=crypto.randomUUID();
  await maintenanceBatch(meta,[
    db().prepare('INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN version=? THEN 1 ELSE 0 END FROM wiki_state WHERE id=1').bind(guard,check.epoch),
    db().prepare("UPDATE identity_meta SET state='verified',verified_epoch=?,generation=generation+1 WHERE id=1").bind(check.epoch),
    db().prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),
  ]);
  return {...await identityStatus(),validation:check};
}
/** Caller obtains a full validated export, then hashes it using backupFingerprint. No user-supplied checkpoint is accepted by HTTP. */
export async function recordIdentityBackup(backup:any,fingerprint:string,expected?:{generation:number;epoch:number}) {
  const meta=await identityStatus();
  if (!['frozen','migrating','verified','maintenance'].includes(meta.state)) conflict();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new WikiError('백업 지문이 올바르지 않습니다.');
  const before=await epoch();
  if (expected && (expected.generation!==meta.generation||expected.epoch!==before)) conflict('백업을 읽는 동안 이관 세대가 변경되었습니다. 다시 내보내 주세요.');
  const isInitial=backup.format==='my-wiki-v2' && meta.phase!=='done';
  if (!isInitial && !['my-wiki-v3','my-wiki-v4'].includes(backup.format)) conflict('완료된 ID 자료에는 v3/v4 백업이 필요합니다.');
  if (isInitial) {
    if (!meta.source_fingerprint||meta.source_epoch==null) conflict('원본 지문 준비를 먼저 완료해야 합니다.');
    if (meta.source_backup_fingerprint && meta.source_backup_fingerprint!==fingerprint)
      conflict('최초 원본 백업 체크포인트는 다른 백업으로 바꿀 수 없습니다.');
    if (!meta.source_backup_fingerprint && (meta.state!=='frozen'||meta.phase!=='pages'||meta.cursor!==''||before!==meta.source_epoch))
      conflict('원본 전체 v2 백업은 첫 이관 전에 고정된 원본 세대에서 기록해야 합니다.');
  } else if (meta.phase!=='done' || (meta.source_fingerprint && !meta.source_backup_fingerprint)) {
    conflict('원본 백업과 모든 이관 청크를 완료한 뒤 v3 체크포인트를 기록해 주세요.');
  }
  if (['my-wiki-v3','my-wiki-v4'].includes(backup.format) && backup.identity?.dataset_id!==meta.dataset_id) conflict('백업 데이터 집합이 일치하지 않습니다.');
  const guard=crypto.randomUUID();
  await maintenanceBatch(meta,[
    db().prepare('INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN version=? THEN 1 ELSE 0 END FROM wiki_state WHERE id=1').bind(guard,before),
    db().prepare(`UPDATE identity_meta SET backup_fingerprint=?,backup_epoch=?,
    source_backup_fingerprint=CASE WHEN ? THEN coalesce(source_backup_fingerprint,?) ELSE source_backup_fingerprint END,generation=generation+1 WHERE id=1`)
    .bind(fingerprint,before,isInitial?1:0,fingerprint),
    db().prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard)]);
  return identityStatus();
}
export type IdentityActivationExpectation = {
  expected_generation:unknown;
  expected_backup_epoch:unknown;
  expected_backup_fingerprint:unknown;
  expected_dataset_id:unknown;
};
export async function activateIdentityMigration(expected:IdentityActivationExpectation) {
  if (!expected || !Number.isSafeInteger(expected.expected_generation) || Number(expected.expected_generation)<0 ||
    !Number.isSafeInteger(expected.expected_backup_epoch) || Number(expected.expected_backup_epoch)<0 ||
    typeof expected.expected_backup_fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(expected.expected_backup_fingerprint))
    throw new WikiError('검증한 백업의 세대·지문·데이터 집합을 모두 보내 주세요.');
  const datasetId=documentIdInput(expected.expected_dataset_id);
  const meta=await identityStatus();
  if (meta.generation!==expected.expected_generation || meta.backup_epoch!==expected.expected_backup_epoch ||
    meta.backup_fingerprint!==expected.expected_backup_fingerprint || meta.dataset_id!==datasetId)
    conflict('검증한 백업 체크포인트가 변경되었습니다. 최신 고정 백업을 다시 확인해 주세요.');
  if (meta.state!=='verified'||meta.phase!=='done'||!meta.backup_fingerprint||meta.verified_epoch==null) conflict('검증과 전체 백업을 먼저 완료해야 합니다.');
  const check=await verifyIdentityData();
  if (!check.valid||check.epoch!==meta.verified_epoch||meta.backup_epoch!==check.epoch) conflict('검증 이후 변경되었거나 현재 세대의 전체 백업이 없습니다.');
  await maintenanceBatch(meta,[db().prepare(`INSERT INTO mutation_guards(id,valid) VALUES(?,CASE WHEN EXISTS(
    SELECT 1 FROM identity_meta m JOIN wiki_state w ON w.id=1
    WHERE m.id=1 AND m.state='verified' AND m.phase='done' AND m.generation=?
      AND m.backup_epoch=? AND m.backup_fingerprint=? AND m.dataset_id=?
      AND m.verified_epoch=? AND w.version=?) THEN 1 ELSE 0 END)`)
      .bind('identity-activation',expected.expected_generation as number,expected.expected_backup_epoch as number,
        expected.expected_backup_fingerprint,datasetId,check.epoch,check.epoch),
    db().prepare("DELETE FROM mutation_guards WHERE id='identity-activation'"),
    db().prepare("UPDATE identity_meta SET state='active',generation=generation+1,source_fingerprint=NULL WHERE id=1")]);
  return identityStatus();
}
export async function reopenIdentityMaintenance() {
  const meta=await identityStatus();
  if (meta.state==='maintenance') return meta;
  if (meta.state!=='active') conflict();
  await identityBatch([db().prepare(`UPDATE identity_meta SET state='maintenance',phase='done',cursor='',
    generation=generation+1,source_fingerprint=NULL,backup_fingerprint=NULL,backup_epoch=NULL,verified_epoch=NULL WHERE id=1`)],'write','active');
  return identityStatus();
}
export async function identityAdoptBatch(statements:D1PreparedStatement[], namespace:{dataset_id:string;namespace_json:string}, expectedEpoch:number) {
  documentIdInput(namespace.dataset_id);
  if (namespace.namespace_json!==IDENTITY_NAMESPACES) throw new WikiError('지원하지 않는 이름공간 레지스트리입니다.');
  const meta=await identityStatus();
  if (meta.state!=='legacy'||!meta.schema_ready) conflict('v3 새 복원은 비어 있는 추가 스키마 저장소에서 시작해야 합니다.');
  const empty=[...Object.keys(legacyFields),'documents','identity_events','identity_imports','identity_gate','restore_stage','mutation_guards']
    .map(table=>`NOT EXISTS(SELECT 1 FROM ${table})`).join(' AND ');
  const guard=crypto.randomUUID();
  const result=await db().batch([
    db().prepare(`INSERT INTO mutation_guards(id,valid) SELECT ?,CASE WHEN version=? AND ${empty}
      AND NOT EXISTS(SELECT 1 FROM identity_meta) THEN 1 ELSE 0 END FROM wiki_state WHERE id=1`).bind(guard,expectedEpoch),
    db().prepare(`INSERT INTO identity_meta(id,dataset_id,namespace_json,state,phase,cursor,generation)
      VALUES(1,?,?,'active','done','',0)`).bind(namespace.dataset_id,namespace.namespace_json),
    db().prepare("INSERT INTO identity_gate(id,mode,generation) VALUES(1,'write',0)"),
    ...statements,
    db().prepare('DELETE FROM mutation_guards WHERE id=?').bind(guard),
    db().prepare('DELETE FROM identity_gate WHERE id=1'),
  ]);
  return result.slice(3,-2);
}
