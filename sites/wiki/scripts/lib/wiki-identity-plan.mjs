import { createHash } from 'node:crypto';

/**
 * Offline diagnostic API (Node >=22.13); no I/O and no production identity assignment.
 *
 * createIdentityPlan(input, { datasetId, migrationId, registry = DEFAULT_REGISTRY })
 * accepts my-wiki-v1/v2 and wiki42-snapshot-v1 JSON records, including unknown
 * row fields (all are fingerprinted). wiki42-inventory-v1 instead requires all
 * eight metadata arrays in INVENTORY_FIELDS and rejects every other row field.
 * It never supplies missing content, compares bodies or checks sizes against content.
 * Registry shape: { namespaces: [{ id, prefix, aliases: [] }] }. The sole main
 * namespace has id "main", prefix "", and no aliases. Other prefixes are exact,
 * case-sensitive proposals, not changes to the running application's resolver.
 *
 * Input budgets: 20,000 total rows, 24 MiB canonical UTF-8 JSON, depth 64,
 * 500,000 JSON values; content 200,000 UTF-16 units, note/comment body 10,000,
 * base64 14 MiB and decoded files 10 MiB. Registry: 64 KiB / 64 namespaces /
 * 256 total nonempty prefixes. Derived report hashing permits up to 256 MiB /
 * 2,000,000 values because one source row can produce several findings.
 * Malformed input throws IdentityPlanInputError
 * (code IDENTITY_PLAN_INPUT_ERROR); relational/semantic defects become issues.
 *
 * Source hashes cover entire supplied rows (metadata only for inventories).
 * source_fingerprint covers the input, including its format (which defines
 * coverage), with top-level row arrays sorted as multisets and only root
 * exported_at omitted.
 * Nested array order and duplicate rows are significant. Object key order is not.
 * plan_fingerprint covers the complete report except itself, including config.
 * Mapping records use source_kind, source_key (the legacy primary key), and
 * source_hash. Duplicate primary keys remain separate records, never overwritten.
 *
 * IDs hash [domain, datasetId, migrationId, exact raw title] ONLY for this
 * input's proposal. They are not a rename algorithm or cross-backup identity
 * proof. Distinct raw titles keep separate proposals even if addresses collide;
 * duplicate exact owners have null IDs. Body/registry changes invalidate the plan
 * while preserving an otherwise unchanged title's proposal within this generation.
 */

const MAX_ROWS = 20_000;
const MAX_JSON_BYTES = 24 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BASE64 = 14 * 1024 * 1024;
const COMMON_KINDS = ['pages', 'revisions', 'notes', 'bookmarks', 'threads', 'comments', 'trash'];
const ALL_KINDS = [...COMMON_KINDS, 'files', 'attachments'];
const TITLE_KINDS = ['pages', 'trash', 'revisions', 'notes', 'bookmarks', 'threads'];
const PLANNER_VERSION = 1;
const FORMAT = 'wiki42-identity-plan-v1';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha256 = value => createHash('sha256').update(value).digest('hex');

export const DEFAULT_REGISTRY = Object.freeze({
  namespaces: Object.freeze(['main', '위키42', '틀', '분류', '파일', '템플릿', '프로젝트'].map(id =>
    Object.freeze({ id, prefix: id === 'main' ? '' : id, aliases: Object.freeze([]) }))),
});

function inputError(message) {
  const error = new TypeError(`Identity plan input: ${message}`);
  error.name = 'IdentityPlanInputError';
  error.code = 'IDENTITY_PLAN_INPUT_ERROR';
  throw error;
}

// Validate while serializing: do not invoke toJSON/getters or silently coerce/drop
// undefined, NaN, sparse elements, symbols, cycles, or non-JSON objects.
function canonicalJson(value, maxBytes = MAX_JSON_BYTES, maxNodes = 500_000) {
  let bytes = 0, nodes = 0;
  const ancestors = new Set();
  function token(text) {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) inputError(`canonical JSON exceeds ${maxBytes} bytes`);
    return text;
  }
  function visit(item, depth) {
    if (++nodes > maxNodes || depth > 64) inputError('JSON value/depth budget exceeded');
    if (item === null) return token('null');
    if (typeof item === 'string') {
      if (item.length > maxBytes) inputError(`string exceeds ${maxBytes} units`);
      return token(JSON.stringify(item));
    }
    if (typeof item === 'boolean') return token(String(item));
    if (typeof item === 'number' && Number.isFinite(item)) return token(Object.is(item, -0) ? '-0' : String(item));
    if (typeof item !== 'object') inputError('only finite JSON values are accepted');
    if (ancestors.has(item)) inputError('cyclic JSON is not accepted');
    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      inputError('records must be plain JSON objects');
    }
    const keys = Reflect.ownKeys(item);
    if (keys.some(key => typeof key !== 'string')) inputError('symbol properties are not accepted');
    if (array && (item.length > 500_000 || keys.length !== item.length + 1)) inputError('sparse or extended arrays are not accepted');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!Object.hasOwn(descriptor, 'value') || (!descriptor.enumerable && !(array && key === 'length'))) {
        inputError('accessors and hidden JSON properties are not accepted');
      }
    }
    ancestors.add(item);
    let result;
    if (array) {
      const parts = [token('[')];
      for (let i = 0; i < item.length; i++) {
        if (!Object.hasOwn(item, i)) inputError('sparse arrays are not accepted');
        if (i) parts.push(token(','));
        parts.push(visit(item[i], depth + 1));
      }
      parts.push(token(']'));
      result = parts.join('');
    } else {
      const parts = [token('{')];
      keys.sort(compare).forEach((key, index) => {
        if (index) parts.push(token(','));
        parts.push(token(JSON.stringify(key)), token(':'), visit(item[key], depth + 1));
      });
      parts.push(token('}'));
      result = parts.join('');
    }
    ancestors.delete(item);
    return result;
  }
  return visit(value, 0);
}

const digestJson = value => sha256(canonicalJson(value));
// Persist with the same number/string representation used by plan_fingerprint.
// JSON.stringify would silently turn a supported JSON value of -0 into 0.
export function serializeIdentityPlan(report) {
  return canonicalJson(report, 256 * 1024 * 1024, 2_000_000);
}
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) inputError(`${path} must be an object`);
}
function string(value, path, max, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.length)) {
    inputError(`${path} must be ${allowEmpty ? 'a' : 'a nonempty'} string of at most ${max} units`);
  }
}
function exactKeys(value, allowed, path) {
  if (Object.keys(value).some(key => !allowed.includes(key))) inputError(`${path} has unsupported fields`);
}
function canonicalLabel(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 && value.isWellFormed()
    && value === value.trim().normalize('NFC') && !/[\x00-\x1f\x7f#<>:]/.test(value);
}

function readRegistry(registry) {
  canonicalJson(registry, 64 * 1024);
  object(registry, 'registry');
  exactKeys(registry, ['namespaces'], 'registry');
  if (!Array.isArray(registry.namespaces) || !registry.namespaces.length || registry.namespaces.length > 64) {
    inputError('registry.namespaces must contain 1..64 entries');
  }
  const ids = new Set(), prefixes = new Map(), namespaces = [];
  for (const ns of registry.namespaces) {
    object(ns, 'namespace');
    exactKeys(ns, ['id', 'prefix', 'aliases'], 'namespace');
    if (!canonicalLabel(ns.id) || ids.has(ns.id)) inputError('namespace IDs must be canonical and unique');
    if (!Array.isArray(ns.aliases) || ns.aliases.length > 256) inputError('namespace.aliases must be an array of at most 256 prefixes');
    ids.add(ns.id);
    if (ns.id === 'main') {
      if (ns.prefix !== '' || ns.aliases.length) inputError('main must have an omitted prefix and no aliases');
    } else {
      for (const prefix of [ns.prefix, ...ns.aliases]) {
        if (!canonicalLabel(prefix) || prefixes.has(prefix)) inputError('namespace prefixes/aliases must be canonical, nonempty and unique');
        prefixes.set(prefix, ns.id);
      }
    }
    namespaces.push({ id: ns.id, prefix: ns.prefix, aliases: [...ns.aliases].sort(compare) });
  }
  if (!ids.has('main') || prefixes.size > 256) inputError('registry requires main and at most 256 nonempty prefixes');
  namespaces.sort((a, b) => compare(a.id, b.id));
  return { prefixes, fingerprint: digestJson({ namespaces }) };
}

const FIELDS = {
  pages: { title: 4096, content: 200_000, version: 80, updated_at: 40 },
  revisions: { id: 80, title: 4096, content: 200_000, summary: 1000, created_at: 40, size: 'integer' },
  notes: { id: 80, title: 4096, body: 10_000, created_at: 40 },
  bookmarks: { title: 4096 },
  threads: { id: 80, title: 4096, subject: 200, status: 80, version: 80, created_at: 40, updated_at: 40 },
  comments: { id: 80, thread_id: 80, number: 'integer', body: 10_000, created_at: 40 },
  trash: { title: 4096, content: 200_000, version: 80, updated_at: 40, deleted_at: 40, delete_summary: 300, trash_id: 80 },
  files: { name: 4096, mime: 100, size: 'integer', created_at: 40, base64: MAX_BASE64, sha256: 128 },
  attachments: { name: 4096, key: 4096, mime: 100, size: 'integer', created_at: 40 },
};
const INVENTORY_FIELDS = {
  pages: ['title', 'version', 'updated_at'],
  revisions: ['id', 'title', 'created_at', 'size'],
  notes: ['id', 'title', 'created_at'],
  bookmarks: ['title'],
  threads: ['id', 'title', 'status', 'version', 'created_at', 'updated_at'],
  comments: ['id', 'thread_id', 'number', 'created_at'],
  trash: ['title', 'version', 'updated_at', 'deleted_at', 'trash_id'],
  attachments: ['name', 'key', 'mime', 'size', 'created_at'],
};

function readSource(input) {
  canonicalJson(input);
  object(input, 'input');
  if (!['my-wiki-v1', 'my-wiki-v2', 'wiki42-snapshot-v1', 'wiki42-inventory-v1'].includes(input.format)) inputError('unsupported format');
  const inventory = input.format === 'wiki42-inventory-v1';
  const metadataAttachments = inventory || input.format === 'wiki42-snapshot-v1';
  const kinds = input.format === 'my-wiki-v1' ? ['pages'] : [...COMMON_KINDS, metadataAttachments ? 'attachments' : 'files'];
  exactKeys(input, ['format', 'exported_at', ...(metadataAttachments ? ['source_epoch'] : []), ...kinds], 'input');
  if (Object.hasOwn(input, 'exported_at')) string(input.exported_at, 'exported_at', 80);
  if (Object.hasOwn(input, 'source_epoch') && (!Number.isSafeInteger(input.source_epoch) || input.source_epoch < 0)) {
    inputError('source_epoch must be a nonnegative safe integer');
  }
  let total = 0;
  for (const kind of kinds) {
    if (!Object.hasOwn(input, kind) || !Array.isArray(input[kind])) inputError(`${kind} must be an explicit array`);
    total += input[kind].length;
  }
  if (total > MAX_ROWS) inputError(`total records exceed ${MAX_ROWS}`);
  const entries = Object.fromEntries(ALL_KINDS.map(kind => [kind, []]));
  const normalizedInput = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'exported_at'));
  for (const kind of kinds) {
    const fields = inventory ? INVENTORY_FIELDS[kind] : Object.keys(FIELDS[kind]);
    const rows = input[kind].map((row, index) => {
      const path = `${kind}[${index}]`;
      object(row, path);
      if (inventory) exactKeys(row, fields, path);
      for (const field of fields) {
        const limit = FIELDS[kind][field];
        if (!Object.hasOwn(row, field)) inputError(`${path}.${field} is required`);
        if (limit === 'integer') {
          if (!Number.isSafeInteger(row[field])) inputError(`${path}.${field} must be a safe integer`);
          if (inventory && kind === 'revisions' && field === 'size' && row[field] < 0) {
            inputError(`${path}.${field} must be a nonnegative safe integer`);
          }
        } else string(row[field], `${path}.${field}`, limit, !['id', 'thread_id', 'version', 'trash_id', 'key'].includes(field));
      }
      const json = canonicalJson(row);
      const key = ['pages', 'trash', 'bookmarks'].includes(kind) ? row.title
        : ['files', 'attachments'].includes(kind) ? row.name : row.id;
      return { kind, key, row, json, hash: sha256(json) };
    }).sort((a, b) => compare(a.json, b.json));
    entries[kind] = rows;
    normalizedInput[kind] = rows.map(entry => entry.row);
  }
  return { entries, fingerprint: digestJson(normalizedInput), inventory };
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = key(item);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
  }
  return groups;
}
function mapping(entry, documentId = null) {
  return { source_kind: entry.kind, source_key: entry.key, source_hash: entry.hash, document_id: documentId };
}
function conflictSources(entries) {
  return entries.map(entry => ({ source_kind: entry.kind, source_key: entry.key,
    source_hash: entry.hash, observed_title: entry.row.title }))
    .map(source => ({ source, key: canonicalJson(source) }))
    .sort((a, b) => compare(a.key, b.key)).map(item => item.source);
}
function proposedAddress(title, prefixes) {
  const normalized = title.trim().normalize('NFC');
  const colon = normalized.indexOf(':');
  const prefix = colon < 0 ? '' : normalized.slice(0, colon);
  return {
    normalized_title: normalized,
    namespace_id: prefixes.get(prefix) ?? 'main',
    local_title: prefixes.has(prefix) ? normalized.slice(colon + 1) : normalized,
  };
}
function invalidTitle(title) {
  return !title.length || title.length > 180 || !title.isWellFormed() || /[\x00-\x1f\x7f#<>]/.test(title);
}

// Signature and extension behavior deliberately matches lib/attachments.ts.
// This is a signature check, not an image/PDF decoder or malware inspection.
const EXTENSIONS = {
  'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/gif': ['gif'],
  'image/webp': ['webp'], 'application/pdf': ['pdf'],
};
function detectFileType(bytes) {
  const start = String.fromCharCode(...bytes.subarray(0, 12));
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (start.startsWith('GIF87a') || start.startsWith('GIF89a')) return 'image/gif';
  if (start.slice(0, 4) === 'RIFF' && start.slice(8, 12) === 'WEBP') return 'image/webp';
  if (start.startsWith('%PDF-')) return 'application/pdf';
  return null;
}

function inspectAttachment(entry, issue, inventory) {
  const { row } = entry;
  let failed = false;
  function fail(code, detail) {
    failed = true;
    issue(code, 'blocker', entry, detail);
  }
  if (invalidTitle(row.name) || row.name !== row.name.trim().normalize('NFC')) {
    fail('INVALID_ATTACHMENT_NAME', 'Stored name must be nonempty, well-formed, at most 180 units, trim/NFC canonical, and contain no forbidden title characters. No prefix is removed.');
  }
  const extension = row.name.split('.').at(-1).toLowerCase();
  if (!Object.hasOwn(EXTENSIONS, row.mime) || !EXTENSIONS[row.mime].includes(extension)) {
    fail('ATTACHMENT_MIME_EXTENSION_MISMATCH', 'Declared MIME and filename extension must agree with the supported PNG/JPEG/GIF/WebP/PDF types.');
  }
  if (row.size <= 0 || row.size > MAX_FILE_BYTES) fail('ATTACHMENT_SIZE_INVALID', 'Declared size must be 1..10485760 bytes.');
  const result = { ...mapping(entry), name: row.name, mime: row.mime, size: row.size, created_at: row.created_at };
  if (entry.kind === 'attachments') {
    issue('ATTACHMENT_BYTES_UNVERIFIED', 'warning', entry, `${inventory ? 'Inventory' : 'Raw snapshot'} metadata has no verified R2 bytes; object existence, SHA-256, size and signature were not checked against storage.`);
    return { ...result, storage_key_hash: digestJson(row.key), byte_verification: 'unverified' };
  }
  let bytes = null;
  // Re-encoding also detects nonzero padding bits accepted by permissive decoders.
  if (row.base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(row.base64)) {
    const decoded = Buffer.from(row.base64, 'base64');
    if (decoded.toString('base64') === row.base64) bytes = decoded;
  }
  if (!bytes) fail('ATTACHMENT_BASE64_INVALID', 'Bytes must use canonical padded base64 without whitespace.');
  if (!/^[a-f0-9]{64}$/.test(row.sha256)) fail('ATTACHMENT_SHA256_INVALID', 'SHA-256 must be 64 lowercase hexadecimal digits.');
  if (bytes) {
    if (bytes.length !== row.size || !bytes.length || bytes.length > MAX_FILE_BYTES) {
      fail('ATTACHMENT_BYTE_SIZE_MISMATCH', 'Decoded length must equal declared size and be within 1..10485760 bytes.');
    }
    if (sha256(bytes) !== row.sha256) fail('ATTACHMENT_SHA256_MISMATCH', 'Decoded bytes do not match the declared SHA-256.');
    const detected = detectFileType(bytes);
    if (!detected || detected !== row.mime || !EXTENSIONS[detected].includes(extension)) {
      fail('ATTACHMENT_HEADER_MISMATCH', 'Byte signature, declared MIME and filename extension do not agree.');
    }
  }
  return { ...result, byte_verification: failed ? 'failed' : 'verified' };
}

export function createIdentityPlan(input, options) {
  canonicalJson(options, 128 * 1024);
  object(options, 'options');
  exactKeys(options, ['datasetId', 'migrationId', 'registry'], 'options');
  const { datasetId, migrationId } = options;
  for (const [name, value] of [['datasetId', datasetId], ['migrationId', migrationId]]) {
    string(value, name, 128, false);
    if (!value.isWellFormed() || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) inputError(`${name} must be a well-formed, trimmed identifier`);
  }
  const registry = readRegistry(Object.hasOwn(options, 'registry') ? options.registry : DEFAULT_REGISTRY);
  const { entries, fingerprint, inventory } = readSource(input);
  const issues = [];
  const issue = (code, severity, entry, detail, evidence = {}) => issues.push({ code, severity, kind: entry.kind, source_key: entry.key, detail, ...evidence });
  const duplicateKeys = new Map();
  for (const kind of ALL_KINDS) {
    const groups = groupBy(entries[kind], entry => entry.key);
    duplicateKeys.set(kind, groups);
    if (kind === 'pages' || kind === 'trash') continue;
    for (const group of groups.values()) if (group.length > 1) {
      const code = { revisions: 'DUPLICATE_REVISION_ID', threads: 'DUPLICATE_THREAD_ID', comments: 'DUPLICATE_COMMENT_ID',
        notes: 'DUPLICATE_NOTE_ID', bookmarks: 'DUPLICATE_BOOKMARK_TITLE', files: 'DUPLICATE_ATTACHMENT_NAME', attachments: 'DUPLICATE_ATTACHMENT_NAME' }[kind];
      issue(code, 'blocker', group[0], `${group.length} records share this source key; all source rows are retained.`);
    }
  }
  const documentEntries = [...entries.pages, ...entries.trash];
  const owners = groupBy(documentEntries, entry => entry.row.title);
  for (const group of owners.values()) if (group.length > 1) {
    const evidence = { shared_title: group[0].row.title, conflict_sources: conflictSources(group) };
    issue('DUPLICATE_EXACT_TITLE', 'blocker', group[0], `${group.length} document rows have this exact title; ownership is ambiguous.`, evidence);
    if (new Set(group.map(entry => entry.kind)).size > 1) {
      issue('ACTIVE_TRASH_COLLISION', 'blocker', group[0], 'Active and trash records occupy the same exact title; neither is selected as owner.', evidence);
    }
  }
  for (const group of groupBy(entries.trash, entry => entry.row.trash_id).values()) if (group.length > 1) {
    issue('DUPLICATE_TRASH_ID', 'blocker', group[0], `${group.length} trash records share a deletion ID.`);
  }
  const titleEntries = TITLE_KINDS.flatMap(kind => entries[kind]);
  for (const entry of titleEntries) {
    const { title } = entry.row;
    if (invalidTitle(title)) issue('INVALID_STORED_TITLE', 'blocker', entry, 'Stored title must be nonempty, well-formed, at most 180 UTF-16 units and contain no control characters, #, < or >.');
    if (title !== title.trim().normalize('NFC')) issue('NONCANONICAL_STORED_TITLE', 'blocker', entry, 'Whole-title trim/NFC would change the stored title; no automatic rename is proposed.');
    const address = proposedAddress(title, registry.prefixes);
    if (address.namespace_id !== 'main' && !address.local_title.length) {
      issue('EMPTY_NAMESPACE_LOCAL_TITLE', 'blocker', entry, 'Registered prefix has an empty local title; the stored title is preserved.');
    }
  }
  // Include unresolved title targets in collision analysis without inventing owners.
  const titleGroups = groupBy(titleEntries, entry => entry.row.title);
  const distinctTitles = [...titleGroups.values()].map(group => group[0]);
  for (const group of groupBy(distinctTitles, entry => entry.row.title.trim().normalize('NFC')).values()) if (group.length > 1) {
    issue('TITLE_NORMALIZATION_COLLISION', 'blocker', group[0], `${group.length} distinct raw titles share a whole-title trim/NFC result. They are not merged.`, {
      normalized_title: group[0].row.title.trim().normalize('NFC'),
      conflict_sources: conflictSources(group.flatMap(entry => titleGroups.get(entry.row.title))),
    });
  }
  for (const group of groupBy(distinctTitles, entry => {
    const address = proposedAddress(entry.row.title, registry.prefixes);
    return JSON.stringify([address.namespace_id, address.local_title]);
  }).values()) {
    if (new Set(group.map(entry => entry.row.title.trim().normalize('NFC'))).size > 1) {
      const address = proposedAddress(group[0].row.title, registry.prefixes);
      issue('SEMANTIC_ADDRESS_COLLISION', 'blocker', group[0], `${group.length} distinct titles share a proposed namespace/local address under this registry. They are not merged.`, {
        shared_address: { namespace_id: address.namespace_id, local_title: address.local_title },
        conflict_sources: conflictSources(group.flatMap(entry => titleGroups.get(entry.row.title))),
      });
    }
  }
  const ids = new Map();
  const idTitles = new Map();
  for (const [title, group] of owners) if (group.length === 1) {
    const id = `d-${digestJson(['wiki42-document-migration-v1', datasetId, migrationId, title])}`;
    ids.set(title, id);
    if (!idTitles.has(id)) idTitles.set(id, []);
    idTitles.get(id).push(title);
  }
  for (const titles of idTitles.values()) if (titles.length > 1) {
    for (const title of titles) ids.delete(title);
    issue('DOCUMENT_ID_COLLISION', 'blocker', owners.get(titles[0])[0], 'Different exact titles produced the same proposal ID; no suffix or owner was selected.');
  }
  function ownership(entry, missingCode, missingSeverity = 'blocker') {
    if (!owners.has(entry.row.title)) {
      issue(missingCode, missingSeverity, entry, 'No active or trash document has this exact stored title; no document is fabricated.');
      return null;
    }
    if (!ids.has(entry.row.title)) {
      issue('AMBIGUOUS_DOCUMENT_OWNER', 'blocker', entry, 'This exact title has no unique document proposal.');
      return null;
    }
    return ids.get(entry.row.title);
  }
  const uniqueSource = entry => duplicateKeys.get(entry.kind).get(entry.key).length === 1;
  const revisionGroups = duplicateKeys.get('revisions');
  const documents = documentEntries.map(entry => {
    const row = entry.row;
    const head = revisionGroups.get(row.version) ?? [];
    let status;
    if (!head.length) {
      status = 'missing';
      issue('HEAD_REVISION_MISSING', 'warning', entry, 'No revision row has this head version. This is normal for v1/pages-only history; no historical row is fabricated.');
    } else if (head.length > 1) {
      status = 'ambiguous';
      issue('HEAD_REVISION_AMBIGUOUS', 'blocker', entry, 'Multiple revision rows use this head version.');
    } else if (head[0].row.title !== row.title) {
      status = 'other_document';
      issue('HEAD_REVISION_OTHER_DOCUMENT', 'blocker', entry, 'The head version belongs to a different exact observed title.');
    } else if (!ids.has(row.title)) {
      status = 'ambiguous';
    } else if (inventory) {
      status = 'ownership_verified_content_unverified';
    } else if (head[0].row.content !== row.content) {
      status = 'content_mismatch';
      issue('HEAD_CONTENT_MISMATCH', 'blocker', entry, 'Stored document content differs from the revision named by its head version.');
    } else status = 'present';
    return {
      ...mapping(entry, ids.get(row.title) ?? null), state: entry.kind === 'pages' ? 'active' : 'trash',
      observed_title: row.title, proposed_address: proposedAddress(row.title, registry.prefixes),
      head_version: row.version, head_revision_status: status,
      ...(entry.kind === 'trash' ? { trash_id: row.trash_id } : {}),
    };
  });
  const revisions = entries.revisions.map(entry => {
    const owner = ownership(entry, 'ORPHAN_REVISION');
    // SQLite length(TEXT) counts Unicode code points and stops at the first NUL.
    if (!inventory && entry.row.size !== Array.from(entry.row.content.split('\0')[0]).length) {
      issue('REVISION_SIZE_MISMATCH', 'blocker', entry, 'Stored revision size differs from SQLite text-length semantics for its content.');
    }
    return { ...mapping(entry, uniqueSource(entry) ? owner : null), revision_id: entry.row.id,
      observed_title: entry.row.title, title_at_save: null };
  });
  const related = [];
  const threadOwners = new Map();
  for (const kind of ['threads', 'notes', 'bookmarks']) for (const entry of entries[kind]) {
    const owner = ownership(entry, kind === 'threads' ? 'ORPHAN_THREAD' : 'UNRESOLVED_TITLE_TARGET', kind === 'threads' ? 'blocker' : 'warning');
    const documentId = uniqueSource(entry) ? owner : null;
    related.push({ ...mapping(entry, documentId), observed_title: entry.row.title,
      target_kind: documentId ? 'document' : 'unresolved_title' });
    if (kind === 'threads' && uniqueSource(entry)) threadOwners.set(entry.key, documentId);
    if (kind === 'threads' && !['open', 'paused', 'closed'].includes(entry.row.status)) {
      issue('INVALID_THREAD_STATUS', 'blocker', entry, 'Thread status is not open, paused or closed.');
    }
  }
  const threadGroups = duplicateKeys.get('threads');
  const commentsByThread = groupBy(entries.comments, entry => entry.row.thread_id);
  for (const entry of entries.comments) {
    const group = threadGroups.get(entry.row.thread_id) ?? [];
    if (!group.length) issue('COMMENT_THREAD_MISSING', 'blocker', entry, 'No thread has this exact thread_id.');
    else if (group.length > 1) issue('COMMENT_THREAD_AMBIGUOUS', 'blocker', entry, 'Multiple threads have this thread_id.');
    else if (!threadOwners.get(entry.row.thread_id)) issue('COMMENT_DOCUMENT_UNRESOLVED', 'blocker', entry, 'The thread has no unique document owner.');
    if (entry.row.number < 1 || entry.row.number > 1000) issue('COMMENT_NUMBER_INVALID', 'blocker', entry, 'Comment number must be within 1..1000.');
    related.push({ ...mapping(entry, uniqueSource(entry) ? threadOwners.get(entry.row.thread_id) ?? null : null),
      thread_id: entry.row.thread_id, number: entry.row.number });
  }
  for (const comments of commentsByThread.values()) {
    for (const group of groupBy(comments, entry => entry.row.number).values()) if (group.length > 1) {
      issue('COMMENT_NUMBER_DUPLICATE', 'blocker', group[0], `${group.length} comments share a number within one thread.`);
    }
  }
  for (const [threadId, group] of threadGroups) {
    const numbers = (commentsByThread.get(threadId) ?? []).map(entry => entry.row.number).sort((a, b) => a - b);
    if (!numbers.length || numbers.some((number, index) => number !== index + 1)) {
      issue('COMMENT_NUMBER_SEQUENCE', 'blocker', group[0], 'Thread comments must have a nonempty contiguous numbering sequence starting at 1.');
    }
  }
  const attachments = [...entries.files, ...entries.attachments].map(entry => inspectAttachment(entry, issue, inventory));
  for (const group of groupBy(entries.attachments, entry => entry.row.key).values()) if (group.length > 1) {
    issue('DUPLICATE_ATTACHMENT_STORAGE_KEY', 'blocker', group[0], `${group.length} attachment records reference the same storage key (key value withheld).`);
  }
  // Dates are diagnostic data, never used as a clock or an identity seed.
  for (const kind of ALL_KINDS) for (const entry of entries[kind]) {
    for (const field of ['created_at', 'updated_at', 'deleted_at']) if (Object.hasOwn(FIELDS[kind], field)) {
      if (!/^\d{4}-\d\d-\d\dT/.test(entry.row[field]) || !Number.isFinite(Date.parse(entry.row[field]))) {
        issue('INVALID_TIMESTAMP', 'blocker', entry, `Stored ${field} is not a recognized ISO timestamp.`);
      }
    }
  }
  // Sort completed records, not source indices: ties retain multiplicity and their
  // identical serialization cannot depend on the input row order or locale.
  const sorted = records => records.map(record => ({ record, key: canonicalJson(record) }))
    .sort((a, b) => compare(a.key, b.key)).map(item => item.record);
  const limitations = [
    'Offline proposals only; no DB/R2 reads or writes, production ID assignment, migration, or rollback is implemented or validated.',
    'No UI, API, MCP, WebMCP, authentication, concurrency, or production validation is performed.',
    `IDs apply only to this dataset/migration ${inventory ? 'inventory' : 'frozen-snapshot'} proposal. Renames and identity across backups require a persisted mapping; current title hashes cannot establish continuity.`,
    'Legacy revision titles are observations only. title_at_save is always null; summaries are never interpreted as move evidence.',
    'No general link/include/category/redirect parser, reference rewriting, dependency validation, or historical rendering is provided. Redirect documents retain independent exact-title proposals.',
    'Attachment names do not prove ownership by file-description documents; attachment document_id is always null.',
    'File byte verification covers canonical base64, SHA-256, size, supported signature/MIME/extension agreement only; it is not full image/PDF decoding or malware inspection.',
  ];
  if (input.format === 'my-wiki-v1') limitations.push('v1 contains only current pages; revisions, trash, discussions, notes, bookmarks and attachments are not available for diagnosis.');
  if (input.format === 'wiki42-snapshot-v1') limitations.push('Raw snapshot attachment bytes and R2 object existence are unverified, even when metadata has no blockers.');
  if (inventory) limitations.push(
    'Metadata-only inventory: source_hash hashes only each supplied metadata row; source_fingerprint hashes only the metadata inventory, including its format. Neither hashes or verifies source bodies.',
    'Current body equality, historical body/size consistency, and content reference parsing are unverified because content is not provided.',
    'Inventory attachment metadata and storage_key_hash do not verify R2 object existence or bytes, including byte hashes, size and signatures.',
    'Live DB completeness and atomic capture are unverified. source_epoch is an observation, not proof of atomic acquisition.',
  );
  const sourceCounts = Object.fromEntries(ALL_KINDS.map(kind => [kind, entries[kind].length]));
  sourceCounts.total = Object.values(sourceCounts).reduce((sum, count) => sum + count, 0);
  const report = {
    format: FORMAT, planner_version: PLANNER_VERSION, dataset_id: datasetId, migration_id: migrationId,
    source_format: input.format, source_epoch: input.source_epoch ?? null,
    registry_fingerprint: registry.fingerprint, source_fingerprint: fingerprint,
    ...(inventory ? { coverage: {
      content_verification: 'not_provided', source_hash_scope: 'metadata_row_only',
      source_fingerprint_scope: 'metadata_inventory_only',
    } } : {}),
    counts: {
      source: sourceCounts, documents: documents.length, document_ids_proposed: documents.filter(row => row.document_id !== null).length,
      revisions: revisions.length, related: related.length, attachments: attachments.length,
      attachment_bytes_verified: attachments.filter(row => row.byte_verification === 'verified').length,
      attachment_bytes_failed: attachments.filter(row => row.byte_verification === 'failed').length,
      attachment_bytes_unverified: attachments.filter(row => row.byte_verification === 'unverified').length,
      blockers: issues.filter(row => row.severity === 'blocker').length,
      warnings: issues.filter(row => row.severity === 'warning').length,
      info: issues.filter(row => row.severity === 'info').length,
    },
    issues: sorted(issues), documents: sorted(documents), revisions: sorted(revisions), related: sorted(related),
    attachments: sorted(attachments), limitations, ready_for_id_transition: false,
  };
  return { ...report, plan_fingerprint: sha256(serializeIdentityPlan(report)) };
}
