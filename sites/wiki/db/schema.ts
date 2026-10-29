import {sql} from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex, check, foreignKey } from 'drizzle-orm/sqlite-core';
export const pages = sqliteTable('pages', { title: text('title').primaryKey(), content: text('content').notNull(), version: text('version').notNull(), updatedAt: text('updated_at').notNull(), documentId:text('document_id') },t=>[uniqueIndex('pages_document_id').on(t.documentId)]);
export const revisions = sqliteTable('revisions', { id: text('id').primaryKey(), title: text('title').notNull(), content: text('content').notNull(), summary: text('summary').notNull(), createdAt: text('created_at').notNull(), size: integer('size').notNull(), documentId:text('document_id'), observedTitle:text('observed_title') },t=>[index('revisions_document_id').on(t.documentId,t.createdAt)]);
export const bookmarks = sqliteTable('bookmarks', { title: text('title').primaryKey(), documentId:text('document_id'), observedTitle:text('observed_title') });
export const notes = sqliteTable('notes', { id: text('id').primaryKey(), title: text('title').notNull(), body: text('body').notNull(), createdAt: text('created_at').notNull(), documentId:text('document_id'), observedTitle:text('observed_title') },t=>[index('notes_document_id').on(t.documentId)]);
export const attachments = sqliteTable('attachments', { name: text('name').primaryKey(), key: text('key').notNull().unique(), mime: text('mime').notNull(), size: integer('size').notNull(), createdAt: text('created_at').notNull() });
export const trash = sqliteTable('trash', {title:text('title').primaryKey(),content:text('content').notNull(),version:text('version').notNull(),updatedAt:text('updated_at').notNull(),deletedAt:text('deleted_at').notNull(),deleteSummary:text('delete_summary').notNull(),trashId:text('trash_id').notNull().unique(),documentId:text('document_id')},t=>[uniqueIndex('trash_document_id').on(t.documentId)]);
export const threads = sqliteTable('threads', {id:text('id').primaryKey(),title:text('title').notNull(),subject:text('subject').notNull(),status:text('status').notNull(),version:text('version').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),documentId:text('document_id'),observedTitle:text('observed_title')},t=>[index('threads_title').on(t.title,t.updatedAt),index('threads_document_id').on(t.documentId),check('thread_status',sql`${t.status} IN ('open','paused','closed')`)]);
export const comments = sqliteTable('comments', {id:text('id').primaryKey(),threadId:text('thread_id').notNull().references(()=>threads.id),number:integer('number').notNull(),body:text('body').notNull(),createdAt:text('created_at').notNull()},t=>[uniqueIndex('comment_thread_number').on(t.threadId,t.number),check('comment_number',sql`${t.number} BETWEEN 1 AND 1000`)]);
export const wikiState = sqliteTable('wiki_state', {id:integer('id').primaryKey(),version:integer('version').notNull()},t=>[check('state_singleton',sql`${t.id}=1`)]);
export const mutationGuards = sqliteTable('mutation_guards', {id:text('id').primaryKey(),valid:integer('valid').notNull()},t=>[check('guard_valid',sql`${t.valid}=1`)]);
export const restoreStage = sqliteTable('restore_stage', {title:text('title').primaryKey(),content:text('content').notNull(),version:text('version').notNull(),updatedAt:text('updated_at').notNull(),deletedAt:text('deleted_at').notNull(),deleteSummary:text('delete_summary').notNull(),trashId:text('trash_id').notNull(),documentId:text('document_id')});

export const documents = sqliteTable('documents', {
  documentId:text('document_id').primaryKey(), title:text('title').notNull().unique(),
  state:text('state').notNull(), observedTitle:text('observed_title').notNull(),
},t=>[check('document_state',sql`${t.state} IN ('live','deleted')`)]);
export const identityMeta = sqliteTable('identity_meta', {
  id:integer('id').primaryKey(), datasetId:text('dataset_id').notNull(), namespaceJson:text('namespace_json').notNull(),
  state:text('state').notNull(), phase:text('phase').notNull(), cursor:text('cursor').notNull(),
  generation:integer('generation').notNull(), sourceEpoch:integer('source_epoch'),
  sourceFingerprint:text('source_fingerprint'), backupFingerprint:text('backup_fingerprint'),
  backupEpoch:integer('backup_epoch'), sourceBackupFingerprint:text('source_backup_fingerprint'),
  verifiedEpoch:integer('verified_epoch'),
},t=>[check('identity_singleton',sql`${t.id}=1`)]);
export const identityGate = sqliteTable('identity_gate', {
  id:integer('id').primaryKey(), mode:text('mode').notNull(), generation:integer('generation').notNull(),
},t=>[check('identity_gate_singleton',sql`${t.id}=1`)]);
export const identityEvents = sqliteTable('identity_events', {
  id:text('id').primaryKey(), documentId:text('document_id').notNull(), kind:text('kind').notNull(),
  oldTitle:text('old_title').notNull(), newTitle:text('new_title').notNull(),
  redirectDocumentId:text('redirect_document_id'), createdAt:text('created_at').notNull(),
},t=>[index('identity_events_document_id').on(t.documentId),check('identity_event_kind',sql`${t.kind} IN ('move','delete','restore')`)]);
export const identityImports = sqliteTable('identity_imports', {
  sourceFingerprint:text('source_fingerprint').primaryKey(), mappingJson:text('mapping_json').notNull(),
});

export const knowledgeEvents = sqliteTable('knowledge_events', {
  id:text('id').primaryKey(), documentId:text('document_id').notNull().references(()=>documents.documentId),
  revisionId:text('revision_id').notNull().references(()=>revisions.id), kind:text('kind').notNull(),
  subjectId:text('subject_id'), sourceKey:text('source_key'), sourceVersion:text('source_version'),
  payload:text('payload').notNull(), workContext:text('work_context').notNull(), principal:text('principal').notNull(),
  createdAt:text('created_at').notNull(),
},t=>[index('knowledge_document_revision').on(t.documentId,t.revisionId,t.createdAt,t.id),index('knowledge_source').on(t.sourceKey,t.sourceVersion),
  uniqueIndex('knowledge_closed_subject').on(t.subjectId).where(sql`${t.kind} IN ('resolution','applied')`),
  uniqueIndex('knowledge_source_candidate').on(t.subjectId,t.sourceVersion).where(sql`${t.kind}='issue' AND ${t.sourceKey} IS NOT NULL`),
  foreignKey({columns:[t.subjectId],foreignColumns:[t.id]}),
  check('knowledge_kind',sql`${t.kind} IN ('evidence','observation','issue','proposal','review','resolution','contribution','applied')`),
  check('knowledge_payload_json',sql`json_valid(${t.payload})`),check('knowledge_context_json',sql`json_valid(${t.workContext})`),check('knowledge_principal_json',sql`json_valid(${t.principal})`)]);
