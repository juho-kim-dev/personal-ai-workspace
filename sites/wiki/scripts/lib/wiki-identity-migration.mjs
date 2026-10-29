import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { assertPrivatePath } from './wiki-private-path.mjs';
import { createIdentityPlan, DEFAULT_REGISTRY, serializeIdentityPlan } from './wiki-identity-plan.mjs';
import { parseOfflineJSON } from '../wiki-identity-diagnose.mjs';

/**
 * EXPERIMENTAL local shadow materialization, never an application writer.
 * The frozen legacy source remains authoritative. All exported materialized rows
 * are rederived from that source and compared before use. IDs reuse the existing
 * planner; they are not recomputed after an application rename (none is supported).
 * The CLI owns directory/path safety and its process-wide SQLite lock.
 */
export const EXPERIMENTAL_BACKUP_FORMAT = 'wiki42-identity-shadow-EXPERIMENTAL-v1';
const SCHEMA_VERSION = 1;
export const MAX_SOURCE_BYTES = 24 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const KINDS = ['pages', 'trash', 'revisions', 'notes', 'bookmarks', 'threads', 'comments', 'files'];
const canonical = serializeIdentityPlan;
const hash = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const equal = (a, b) => canonical(a) === canonical(b);
export class MigrationError extends Error {
  constructor(code, message) {
    super(`Isolated identity migration: ${message}`);
    this.name = 'IdentityMigrationError';
    this.code = code;
  }
}
function fail(code, message) {
  throw new MigrationError(code, message);
}
function boundedBuffer(value, limit, label) {
  if (!(value instanceof Uint8Array) || value.byteLength > limit) fail('INPUT_LIMIT', `${label} must be bounded bytes.`);
  return Buffer.from(value);
}
function ordinaryObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value, keys, label) {
  if (!ordinaryObject(value) || !equal(Object.keys(value).sort(), [...keys].sort())) {
    fail('BACKUP_INVALID', `${label} has missing or unsupported fields.`);
  }
}
function decodeBase64(value, label) {
  if (typeof value !== 'string' || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    fail('BACKUP_INVALID', `${label} is not canonical base64.`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) fail('BACKUP_INVALID', `${label} is not canonical base64.`);
  return bytes;
}

// These are intentionally real typed tables with independently checked values.
// Unknown source fields live in source_ledger, not an allowlist reconstruction.
const DEFINITIONS = {
  registry: [
    'namespace_id TEXT PRIMARY KEY', 'prefix TEXT NOT NULL UNIQUE', 'aliases_json TEXT NOT NULL',
    'provenance TEXT NOT NULL', 'registry_fingerprint TEXT NOT NULL',
  ],
  source_ledger: [
    'ledger_id TEXT PRIMARY KEY', 'source_kind TEXT NOT NULL', 'source_key TEXT NOT NULL',
    'source_hash TEXT NOT NULL', 'row_json TEXT NOT NULL', 'UNIQUE(source_kind, source_key)',
  ],
  identity_mapping: [
    'ledger_id TEXT PRIMARY KEY REFERENCES source_ledger(ledger_id)', 'source_kind TEXT NOT NULL',
    'source_key TEXT NOT NULL', 'source_hash TEXT NOT NULL', 'document_id TEXT',
  ],
  documents: [
    'document_id TEXT PRIMARY KEY', 'observed_title TEXT NOT NULL UNIQUE',
    "state TEXT NOT NULL CHECK(state IN ('active','trash'))", 'content TEXT NOT NULL',
    'head_version TEXT NOT NULL', 'head_revision_id TEXT',
    "head_status TEXT NOT NULL CHECK(head_status IN ('present','missing'))", 'updated_at TEXT NOT NULL',
    'ledger_id TEXT NOT NULL UNIQUE REFERENCES source_ledger(ledger_id)',
    "CHECK((head_status='present' AND head_revision_id=head_version) OR (head_status='missing' AND head_revision_id IS NULL))",
  ],
  addresses: [
    'exact_title TEXT PRIMARY KEY', 'namespace_id TEXT NOT NULL REFERENCES registry(namespace_id)',
    'local_title TEXT NOT NULL', 'document_id TEXT NOT NULL UNIQUE REFERENCES documents(document_id)',
    "state TEXT NOT NULL CHECK(state IN ('active','reserved_deleted'))", 'UNIQUE(namespace_id, local_title)',
  ],
  reservations: [
    'exact_title TEXT PRIMARY KEY REFERENCES addresses(exact_title)',
    'document_id TEXT NOT NULL UNIQUE REFERENCES documents(document_id)', 'trash_id TEXT NOT NULL UNIQUE',
  ],
  trash: [
    'trash_id TEXT PRIMARY KEY', 'document_id TEXT NOT NULL UNIQUE REFERENCES documents(document_id)',
    'deleted_at TEXT NOT NULL', 'delete_summary TEXT NOT NULL',
    'ledger_id TEXT NOT NULL UNIQUE REFERENCES source_ledger(ledger_id)',
  ],
  revisions: [
    'revision_id TEXT PRIMARY KEY', 'document_id TEXT NOT NULL REFERENCES documents(document_id)',
    'observed_title TEXT NOT NULL', 'title_at_save TEXT CHECK(title_at_save IS NULL)',
    'content TEXT NOT NULL', 'summary TEXT NOT NULL', 'created_at TEXT NOT NULL', 'size INTEGER NOT NULL',
    'ledger_id TEXT NOT NULL UNIQUE REFERENCES source_ledger(ledger_id)',
  ],
  notes: [
    'note_id TEXT PRIMARY KEY', 'document_id TEXT REFERENCES documents(document_id)',
    "target_kind TEXT NOT NULL CHECK(target_kind IN ('document','unresolved_title'))",
    'observed_title TEXT NOT NULL', 'body TEXT NOT NULL', 'created_at TEXT NOT NULL',
    'ledger_id TEXT NOT NULL UNIQUE REFERENCES source_ledger(ledger_id)',
    "CHECK((target_kind='document' AND document_id IS NOT NULL) OR (target_kind='unresolved_title' AND document_id IS NULL))",
  ],
  bookmarks: [
    'observed_title TEXT PRIMARY KEY', 'document_id TEXT REFERENCES documents(document_id)',
    "target_kind TEXT NOT NULL CHECK(target_kind IN ('document','unresolved_title'))",
    'ledger_id TEXT NOT NULL UNIQUE REFERENCES source_ledger(ledger_id)',
    "CHECK((target_kind='document' AND document_id IS NOT NULL) OR (target_kind='unresolved_title' AND document_id IS NULL))",
  ],
  threads: [
    'thread_id TEXT PRIMARY KEY', "kind TEXT NOT NULL CHECK(kind='discussion')",
    "kind_provenance TEXT NOT NULL CHECK(kind_provenance='legacy-v2-discussion-adapter')",
    'document_id TEXT NOT NULL REFERENCES documents(document_id)', 'observed_title TEXT NOT NULL',
    'subject TEXT NOT NULL', "status TEXT NOT NULL CHECK(status IN ('open','paused','closed'))",
    'version TEXT NOT NULL', 'created_at TEXT NOT NULL', 'updated_at TEXT NOT NULL',
    'ledger_id TEXT NOT NULL UNIQUE REFERENCES source_ledger(ledger_id)',
  ],
  entries: [
    'entry_id TEXT PRIMARY KEY', 'thread_id TEXT NOT NULL REFERENCES threads(thread_id)',
    "kind TEXT NOT NULL CHECK(kind='comment')", 'document_id TEXT NOT NULL REFERENCES documents(document_id)',
    'number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 1000)', 'body TEXT NOT NULL', 'created_at TEXT NOT NULL',
    'ledger_id TEXT NOT NULL UNIQUE REFERENCES source_ledger(ledger_id)', 'UNIQUE(thread_id, number)',
  ],
  attachments: [
    'attachment_id TEXT PRIMARY KEY', 'name TEXT NOT NULL UNIQUE', 'mime TEXT NOT NULL',
    'size INTEGER NOT NULL CHECK(size>0)', 'created_at TEXT NOT NULL', 'sha256 TEXT NOT NULL',
    'bytes BLOB NOT NULL', 'document_id TEXT CHECK(document_id IS NULL)',
    'ledger_id TEXT NOT NULL UNIQUE REFERENCES source_ledger(ledger_id)',
  ],
};
const TABLES = Object.keys(DEFINITIONS);
const COLUMNS = Object.fromEntries(TABLES.map(name => [name,
  DEFINITIONS[name].filter(part => !/^(CHECK|UNIQUE)\(/.test(part)).map(part => part.split(' ')[0])]));
const TABLE_SQL = TABLES.map(name => `CREATE TABLE ${name} (${DEFINITIONS[name].join(', ')}) STRICT`);
const META_SQL = [
  'CREATE TABLE frozen_source (id INTEGER PRIMARY KEY CHECK(id=1), source_bytes BLOB NOT NULL, source_digest TEXT NOT NULL, root_extras_json TEXT NOT NULL, config_json TEXT NOT NULL, plan_json TEXT NOT NULL, contract_json TEXT NOT NULL) STRICT',
  "CREATE TABLE checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL CHECK(state IN ('migrating','complete','rolled_back')), next INTEGER NOT NULL CHECK(next>=0), total INTEGER NOT NULL CHECK(total>=0), contract_digest TEXT NOT NULL, CHECK(next<=total), CHECK(state<>'complete' OR next=total)) STRICT",
];
const ALL_SQL = [...META_SQL, ...TABLE_SQL];
const EXPECTED_SCHEMA = ALL_SQL.map(sql => ({ type: 'table', name: sql.match(/^CREATE TABLE (\w+)/)[1], sql }))
  .sort((a, b) => compare(a.name, b.name));
function portableRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    value instanceof Uint8Array ? { base64: Buffer.from(value).toString('base64') } : value]));
}
function portableTables(tables) {
  return Object.fromEntries(TABLES.map(name => [name, tables[name].map(portableRow)
    .sort((a, b) => compare(canonical(a), canonical(b)))]));
}
function emptyTables() { return Object.fromEntries(TABLES.map(name => [name, []])); }

export function prepareMigration(sourceBytes, options) {
  const bytes = boundedBuffer(sourceBytes, MAX_SOURCE_BYTES, 'source');
  const source = parseOfflineJSON(bytes);
  if (!ordinaryObject(source) || !['my-wiki-v1', 'my-wiki-v2'].includes(source.format)) {
    fail('UNSUPPORTED_SOURCE', 'only complete my-wiki-v1/v2 sources with their required arrays and verified file bytes are supported.');
  }
  if (!ordinaryObject(options)) fail('CONFIG_INVALID', 'datasetId and migrationId are required.');
  if (Object.keys(options).some(key => !['datasetId', 'migrationId', 'registry'].includes(key))) {
    fail('CONFIG_INVALID', 'unsupported migration configuration.');
  }
  // Full-root canonicalization also validates and budgets opaque root extensions.
  if (Buffer.byteLength(canonical(source)) > MAX_SOURCE_BYTES) fail('INPUT_LIMIT', 'source canonical JSON exceeds its limit.');
  const kinds = source.format === 'my-wiki-v1' ? ['pages'] : KINDS;
  const knownRoot = ['format', 'exported_at', ...kinds];
  // Reserved record arrays cannot hide as opaque extensions of another format.
  // In particular a v2 "attachments" metadata array must never bypass file-byte
  // verification, and v1 must not silently smuggle revisions/files alongside pages.
  const diagnosticRoot = ['format', 'exported_at', ...KINDS, 'attachments'];
  const diagnosticInput = Object.fromEntries(Object.entries(source).filter(([key]) => diagnosticRoot.includes(key)));
  const rootExtras = Object.fromEntries(Object.entries(source).filter(([key]) => !knownRoot.includes(key)));
  const registryExplicit = Object.hasOwn(options, 'registry');
  const registry = parseOfflineJSON(Buffer.from(canonical(registryExplicit ? options.registry : DEFAULT_REGISTRY)));
  const config = { datasetId: options.datasetId, migrationId: options.migrationId, registry,
    registryProvenance: registryExplicit ? 'explicit-offline-registry' : 'offline-default-registry-v1' };
  const plan = createIdentityPlan(diagnosticInput, { datasetId: options.datasetId, migrationId: options.migrationId, registry });
  if (plan.counts.blockers) fail('DIAGNOSTIC_BLOCKERS', `${plan.counts.blockers} diagnostic blockers prevent any migration writes.`);
  if (plan.counts.attachment_bytes_unverified || plan.counts.attachment_bytes_failed) {
    fail('ATTACHMENT_UNVERIFIED', 'all attachment bytes must be verified.');
  }
  const tables = emptyTables();
  for (const ns of registry.namespaces) tables.registry.push({
    namespace_id: ns.id, prefix: ns.prefix, aliases_json: canonical(ns.aliases),
    provenance: config.registryProvenance, registry_fingerprint: plan.registry_fingerprint,
  });
  const mappings = new Map([...plan.documents, ...plan.revisions, ...plan.related, ...plan.attachments]
    .map(row => [canonical([row.source_kind, row.source_key, row.source_hash]), row]));
  const tasks = [];
  for (const kind of kinds) {
    const rows = source[kind].map(row => ({ row, json: canonical(row) })).sort((a, b) => compare(a.json, b.json));
    for (const { row, json } of rows) {
      const sourceKey = ['pages', 'trash', 'bookmarks'].includes(kind) ? row.title : kind === 'files' ? row.name : row.id;
      const sourceHash = hash(json), ledgerId = `${kind}:${sourceHash}`;
      const mapping = mappings.get(canonical([kind, sourceKey, sourceHash]));
      if (!mapping) fail('MAPPING_INVALID', 'every source row must have a diagnostic mapping.');
      const documentId = mapping.document_id;
      const writes = [];
      const put = (table, record) => {
        // SQLite INTEGER cannot distinguish -0; the exact JSON number remains
        // in row_json and frozen bytes, and this conversion is explicit.
        const recordForSQLite = Object.fromEntries(Object.entries(record)
          .map(([key, value]) => [key, Object.is(value, -0) ? 0 : value]));
        if (Object.values(recordForSQLite).some(value => typeof value === 'string' && !value.isWellFormed())) {
          fail('UNSUPPORTED_TEXT', 'typed SQLite text contains an unpaired UTF-16 surrogate; source was not changed.');
        }
        tables[table].push(recordForSQLite);
        writes.push({ table, row: recordForSQLite });
      };
      put('source_ledger', { ledger_id: ledgerId, source_kind: kind, source_key: sourceKey, source_hash: sourceHash, row_json: json });
      put('identity_mapping', { ledger_id: ledgerId, source_kind: kind, source_key: sourceKey, source_hash: sourceHash, document_id: documentId });
      if (kind === 'pages' || kind === 'trash') {
        put('documents', { document_id: documentId, observed_title: row.title, state: mapping.state,
          content: row.content, head_version: row.version,
          head_revision_id: mapping.head_revision_status === 'present' ? row.version : null,
          head_status: mapping.head_revision_status, updated_at: row.updated_at, ledger_id: ledgerId });
        put('addresses', { exact_title: row.title, namespace_id: mapping.proposed_address.namespace_id,
          local_title: mapping.proposed_address.local_title, document_id: documentId,
          state: kind === 'trash' ? 'reserved_deleted' : 'active' });
        if (kind === 'trash') {
          put('reservations', { exact_title: row.title, document_id: documentId, trash_id: row.trash_id });
          put('trash', { trash_id: row.trash_id, document_id: documentId,
            deleted_at: row.deleted_at, delete_summary: row.delete_summary, ledger_id: ledgerId });
        }
      } else if (kind === 'revisions') {
        put('revisions', { revision_id: row.id, document_id: documentId, observed_title: row.title,
          title_at_save: null, content: row.content, summary: row.summary, created_at: row.created_at,
          size: row.size, ledger_id: ledgerId });
      } else if (kind === 'notes') {
        put('notes', { note_id: row.id, document_id: documentId, target_kind: mapping.target_kind,
          observed_title: row.title, body: row.body, created_at: row.created_at, ledger_id: ledgerId });
      } else if (kind === 'bookmarks') {
        put('bookmarks', { observed_title: row.title, document_id: documentId, target_kind: mapping.target_kind, ledger_id: ledgerId });
      } else if (kind === 'threads') {
        put('threads', { thread_id: row.id, kind: 'discussion', kind_provenance: 'legacy-v2-discussion-adapter',
          document_id: documentId, observed_title: row.title, subject: row.subject, status: row.status,
          version: row.version, created_at: row.created_at, updated_at: row.updated_at, ledger_id: ledgerId });
      } else if (kind === 'comments') {
        put('entries', { entry_id: row.id, thread_id: row.thread_id, kind: 'comment', document_id: documentId,
          number: row.number, body: row.body, created_at: row.created_at, ledger_id: ledgerId });
      } else if (kind === 'files') {
        put('attachments', { attachment_id: `a-${hash(canonical(['wiki42-shadow-attachment-v1', options.datasetId, options.migrationId, row.name]))}`,
          name: row.name, mime: row.mime, size: row.size, created_at: row.created_at,
          sha256: row.sha256, bytes: Buffer.from(row.base64, 'base64'), document_id: null, ledger_id: ledgerId });
      }
      tasks.push(writes);
    }
  }
  const sourceDigest = hash(bytes);
  const contract = { experiment: EXPERIMENTAL_BACKUP_FORMAT, schema_version: SCHEMA_VERSION,
    source_digest: sourceDigest, config_digest: hash(canonical(config)), plan_fingerprint: plan.plan_fingerprint,
    materialized_digest: hash(canonical(portableTables(tables))), total: tasks.length };
  return { sourceBytes: bytes, sourceDigest, rootExtras, config, plan, total: tasks.length, tables, tasks, contract };
}

function expectedPrefix(prepared, next) {
  const expected = emptyTables();
  expected.registry = prepared.tables.registry;
  for (const task of prepared.tasks.slice(0, next)) for (const write of task) expected[write.table].push(write.row);
  return expected;
}
function insertRow(db, table, row) {
  const columns = COLUMNS[table];
  db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
    .run(...columns.map(column => row[column]));
}
function frozenRow(prepared) {
  return { id: 1, source_bytes: prepared.sourceBytes, source_digest: prepared.sourceDigest,
    root_extras_json: canonical(prepared.rootExtras), config_json: canonical(prepared.config),
    plan_json: canonical(prepared.plan), contract_json: canonical(prepared.contract) };
}
function readStatus(db, prepared) {
  const rows = db.prepare('SELECT * FROM checkpoint').all();
  if (rows.length !== 1) fail('CHECKPOINT_CORRUPT', 'checkpoint must contain exactly one row.');
  const row = rows[0];
  if (row.id !== 1 || row.total !== prepared.total || row.contract_digest !== hash(canonical(prepared.contract))
    || !Number.isSafeInteger(row.next) || row.next < 0 || row.next > row.total
    || !['migrating', 'complete', 'rolled_back'].includes(row.state)
    || (row.state === 'complete' && row.next !== row.total)
    || (row.state === 'migrating' && row.next === row.total)) {
    fail('CHECKPOINT_CORRUPT', 'checkpoint source/configuration, range or state does not match.');
  }
  return { state: row.state, next: row.next, total: row.total };
}
function readTables(db) {
  return Object.fromEntries(TABLES.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
}
function verifyDatabase(db, prepared) {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') fail('DATABASE_CORRUPT', 'SQLite integrity check failed.');
  const schema = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  if (!equal(schema, EXPECTED_SCHEMA)) fail('SCHEMA_MISMATCH', 'shadow schema has changed or contains unexpected objects.');
  const frozen = db.prepare('SELECT * FROM frozen_source').all();
  if (frozen.length !== 1 || !equal(portableRow(frozen[0]), portableRow(frozenRow(prepared)))) {
    fail('SOURCE_MISMATCH', 'frozen source/configuration/evidence does not exactly match.');
  }
  const status = readStatus(db, prepared);
  if (!equal(portableTables(readTables(db)), portableTables(expectedPrefix(prepared, status.next)))) {
    fail('MATERIALIZED_MISMATCH', 'materialized rows or persisted mapping differ from the verified source prefix.');
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length) fail('OWNERSHIP_MISMATCH', 'shadow ownership constraints failed.');
  return status;
}
function initialize(db, prepared) {
  for (const sql of ALL_SQL) db.exec(sql);
  const row = frozenRow(prepared);
  db.prepare(`INSERT INTO frozen_source (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`)
    .run(...Object.values(row));
  db.prepare('INSERT INTO checkpoint VALUES (1,?,?,?,?)').run(prepared.total ? 'migrating' : 'complete',
    0, prepared.total, hash(canonical(prepared.contract)));
  for (const row of prepared.tables.registry) insertRow(db, 'registry', row);
}
function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = operation(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function inspectPath(dbPath, create) {
  if (dbPath === ':memory:') return;
  let info;
  try { info = lstatSync(dbPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (create && info) fail('TARGET_EXISTS', 'new isolated target already exists.');
  if (!create && !info) fail('TARGET_MISSING', 'existing shadow database is required.');
  if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) {
    fail('UNSAFE_DATABASE', 'shadow database must be a private regular file with one link.');
  }
  if (process.platform === 'win32') {
    const parent = path.dirname(path.resolve(dbPath)), parentInfo = lstatSync(parent);
    if (!parentInfo.isDirectory()) fail('UNSAFE_DATABASE', 'shadow database parent must be a private directory.');
    assertPrivatePath(parent, parentInfo, 'UNSAFE_DATABASE');
  }
  if (info) assertPrivatePath(dbPath, info, 'UNSAFE_DATABASE');
  if (create) {
    closeSync(openSync(dbPath, 'wx', 0o600));
    assertPrivatePath(dbPath, lstatSync(dbPath), 'UNSAFE_DATABASE');
  }
}

export function openMigration(dbPath, prepared, { create = false } = {}) {
  inspectPath(dbPath, create);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; PRAGMA synchronous=FULL');
    if (create) {
      db.exec('PRAGMA journal_mode=DELETE');
      transaction(db, () => initialize(db, prepared));
    }
    verifyDatabase(db, prepared);
  } catch (error) { db.close(); throw error; }
  let busy = false, closed = false;
  const assertAvailable = () => {
    if (closed) fail('DATABASE_CLOSED', 'shadow database is closed.');
    if (busy) fail('BUSY', 'a chunk is already executing on this handle.');
  };
  const store = {
    db,
    status() { assertAvailable(); return readStatus(db, prepared); },
    verify() { assertAvailable(); return verifyDatabase(db, prepared); },
    async migrateChunk(size, hooks = {}) {
      assertAvailable();
      if (!Number.isSafeInteger(size) || size < 1 || size > 1000) fail('CHUNK_SIZE', 'chunk size must be 1..1000.');
      busy = true;
      let result;
      try {
        db.exec('BEGIN IMMEDIATE');
        try {
          const before = verifyDatabase(db, prepared);
          if (before.state === 'rolled_back') fail('ROLLED_BACK', 'rollback is terminal; create a new isolated target to rematerialize.');
          if (before.state === 'complete') { db.exec('COMMIT'); return before; }
          const next = Math.min(before.next + size, prepared.total);
          for (const task of prepared.tasks.slice(before.next, next)) for (const write of task) insertRow(db, write.table, write.row);
          db.prepare('UPDATE checkpoint SET next=?, state=? WHERE id=1').run(next, next === prepared.total ? 'complete' : 'migrating');
          // Verify actual SQL data before committing it with the checkpoint.
          result = verifyDatabase(db, prepared);
          if (hooks.beforeChunkCommit) await hooks.beforeChunkCommit(result);
          if (result.state === 'complete' && hooks.beforeCompletionCommit) await hooks.beforeCompletionCommit(result);
          // A test hook may inject corruption or an exception, never bypass checks.
          verifyDatabase(db, prepared);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        if (hooks.afterChunkCommit) await hooks.afterChunkCommit(result);
        return result;
      } finally { busy = false; }
    },
    rollback() {
      assertAvailable();
      return transaction(db, () => {
        verifyDatabase(db, prepared);
        db.prepare("UPDATE checkpoint SET state='rolled_back' WHERE id=1").run();
        return verifyDatabase(db, prepared);
      });
    },
    exportBackup() {
      assertAvailable();
      return transaction(db, () => {
        const status = verifyDatabase(db, prepared);
        if (status.state !== 'complete') fail('INCOMPLETE', 'only a complete active shadow can export.');
        return encodeBackup(prepared, readTables(db));
      });
    },
    exportOriginal() {
      assertAvailable();
      return transaction(db, () => {
        if (verifyDatabase(db, prepared).state !== 'complete') fail('INCOMPLETE', 'only a complete active shadow can export.');
        return Buffer.from(db.prepare('SELECT source_bytes FROM frozen_source WHERE id=1').get().source_bytes);
      });
    },
    close() { assertAvailable(); db.close(); closed = true; },
  };
  return store;
}

function encodeBackup(prepared, tables) {
  const payload = { format: EXPERIMENTAL_BACKUP_FORMAT, schema_version: SCHEMA_VERSION,
    state: 'complete', source_authority: 'frozen-legacy-source', production_ready: false,
    source: { base64: prepared.sourceBytes.toString('base64'), sha256: prepared.sourceDigest },
    config: prepared.config, contract: prepared.contract, plan: prepared.plan, tables: portableTables(tables) };
  const encoded = Buffer.from(canonical(payload));
  if (encoded.length > MAX_BACKUP_BYTES) fail('BACKUP_LIMIT', 'experimental backup exceeds its finite size limit.');
  return encoded;
}

export function prepareBackupImport(backupBytes) {
  const bytes = boundedBuffer(backupBytes, MAX_BACKUP_BYTES, 'experimental backup');
  const backup = parseOfflineJSON(bytes);
  exactKeys(backup, ['format', 'schema_version', 'state', 'source_authority', 'production_ready',
    'source', 'config', 'contract', 'plan', 'tables'], 'experimental backup');
  if (backup.format !== EXPERIMENTAL_BACKUP_FORMAT || backup.schema_version !== SCHEMA_VERSION
    || backup.state !== 'complete' || backup.source_authority !== 'frozen-legacy-source' || backup.production_ready !== false) {
    fail('BACKUP_INVALID', 'backup is not a complete supported EXPERIMENTAL shadow.');
  }
  exactKeys(backup.source, ['base64', 'sha256'], 'frozen source');
  exactKeys(backup.config, ['datasetId', 'migrationId', 'registry', 'registryProvenance'], 'configuration');
  const source = decodeBase64(backup.source.base64, 'frozen source');
  if (hash(source) !== backup.source.sha256) fail('SOURCE_MISMATCH', 'backup source byte digest differs.');
  if (!['offline-default-registry-v1', 'explicit-offline-registry'].includes(backup.config.registryProvenance)) {
    fail('BACKUP_INVALID', 'registry provenance is unsupported.');
  }
  const explicit = backup.config.registryProvenance === 'explicit-offline-registry';
  const prepared = prepareMigration(source, { datasetId: backup.config.datasetId, migrationId: backup.config.migrationId,
    ...(explicit ? { registry: backup.config.registry } : {}) });
  // Rebuild every typed row and ID from the full original, then require exact
  // equality, detecting ownership changes, duplicate IDs, unknown table fields,
  // modified attachment bytes, dropped opaque values and incomplete mappings.
  const expected = parseOfflineJSON(encodeBackup(prepared, prepared.tables));
  if (!equal(backup, expected)) fail('BACKUP_MISMATCH', 'backup IDs, registry, mapping, typed rows or source evidence do not agree.');
  return prepared;
}

export function importBackup(dbPath, prepared) {
  // Caller first uses prepareBackupImport, then publishes this NEW temporary DB.
  // All schema, source evidence and typed rows share one SQLite transaction.
  inspectPath(dbPath, true);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL');
    transaction(db, () => {
      initialize(db, prepared);
      for (const task of prepared.tasks) for (const write of task) insertRow(db, write.table, write.row);
      db.prepare("UPDATE checkpoint SET next=total, state='complete' WHERE id=1").run();
      verifyDatabase(db, prepared);
    });
  } finally { db.close(); }
  return { state: 'complete', next: prepared.total, total: prepared.total };
}
