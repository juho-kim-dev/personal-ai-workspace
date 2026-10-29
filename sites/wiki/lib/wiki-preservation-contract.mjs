// Shared by offline CLI, browser selection and authenticated Worker endpoints. No filesystem APIs.
export const WEB_PRESERVATION_BUDGETS = Object.freeze({maxManifestBytes:1024*1024,maxObjectBytes:96*1024*1024,maxTotalObjectBytes:512*1024*1024,maxObjects:2048,maxEntities:10000,maxDiagnostics:512});
const FORMAT = 'wiki42-preservation-v1';
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const GROUPS = ['documents', 'revisions', 'media', 'threads', 'comments', 'annotations', 'dependencies'];
const DEFAULTS = Object.freeze({
  maxManifestBytes: 16 * 1024 * 1024,
  maxObjectBytes: 8 * 1024 ** 3,
  maxTotalObjectBytes: 64 * 1024 ** 3,
  maxObjects: 100_000,
  maxEntities: 100_000,
  maxStorePackages: 10_000,
  maxJsonDepth: 64,
  maxJsonNodes: 1_000_000,
  maxStringChars: 1_048_576,
  maxDiagnostics: 256,
});

class PreservationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PreservationError';
    this.code = code;
  }
}

function fail(code, message) { throw new PreservationError(code, message); }
function config(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('OPTIONS', 'Options must be an object.');
  if (Object.keys(options).some(key => !['budgets', 'signal'].includes(key))) fail('OPTIONS', 'Unknown option.');
  const budgets = { ...DEFAULTS };
  if (options.budgets !== undefined) {
    if (!options.budgets || typeof options.budgets !== 'object' || Array.isArray(options.budgets)) fail('OPTIONS', 'budgets must be an object.');
    for (const [key, value] of Object.entries(options.budgets)) {
      if (!Object.hasOwn(DEFAULTS, key) || !Number.isSafeInteger(value) || value < 1) fail('OPTIONS', 'Unknown budget or nonpositive/unsafe budget integer.');
      budgets[key] = value;
    }
  }
  if (budgets.maxDiagnostics < 2 || budgets.maxJsonDepth > 256) fail('OPTIONS', 'maxDiagnostics must be >=2; maxJsonDepth must be <=256.');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail('OPTIONS', 'signal must be an AbortSignal.');
  return { budgets, signal: options.signal };
}
// JSON.parse alone accepts duplicate keys. This parser rejects them at every depth,
// including escape-equivalent names, and never assigns into an object prototype.
function parseJson(bytes, budgets) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail('MANIFEST_UTF8', 'Manifest is not valid UTF-8.'); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let offset = 0; let nodes = 0;
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  function whitespace() {
    while (offset < text.length && /[\x20\t\r\n]/.test(text[offset])) offset++;
  }
  function string() {
    const start = offset++;
    while (offset < text.length) {
      const c = text.charCodeAt(offset++);
      if (offset - start > budgets.maxStringChars * 6 + 2) fail('RESOURCE_LIMIT', 'JSON string budget exceeded.');
      if (c === 34) {
        let decoded;
        try { decoded = JSON.parse(text.slice(start, offset)); }
        catch { fail('MANIFEST_JSON', 'Invalid JSON string.'); }
        if (decoded.length > budgets.maxStringChars) fail('RESOURCE_LIMIT', 'JSON string budget exceeded.');
        return decoded;
      }
      if (c < 32) fail('MANIFEST_JSON', 'Unescaped JSON control character.');
      if (c === 92) offset++;
    }
    fail('MANIFEST_JSON', 'Unterminated JSON string.');
  }
  function value(depth) {
    if (++nodes > budgets.maxJsonNodes || depth > budgets.maxJsonDepth) fail('RESOURCE_LIMIT', 'JSON node/depth budget exceeded.');
    whitespace(); const c = text[offset];
    if (c === '"') return string();
    if (c === '{' || c === '[') {
      const object = c === '{'; const result = object ? Object.create(null) : [];
      const end = object ? '}' : ']';
      offset++; whitespace();
      if (text[offset] === end) { offset++; return result; }
      while (true) {
        whitespace();
        if (object) {
          if (text[offset] !== '"') fail('MANIFEST_JSON', 'Expected JSON object key.');
          const key = string(); whitespace();
          if (Object.hasOwn(result, key)) fail('MANIFEST_DUPLICATE_KEY', 'Duplicate JSON object key.');
          if (text[offset++] !== ':') fail('MANIFEST_JSON', 'Expected colon.');
          result[key] = value(depth + 1);
        } else result.push(value(depth + 1));
        whitespace();
        if (text[offset] === end) { offset++; return result; }
        if (text[offset++] !== ',') fail('MANIFEST_JSON', 'Expected comma or closing delimiter.');
      }
    }
    for (const [literal, decoded] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return decoded; }
    }
    number.lastIndex = offset;
    const match = number.exec(text);
    if (!match) fail('MANIFEST_JSON', 'Invalid JSON value.');
    offset = number.lastIndex;
    return Number(match[0]);
  }
  const parsed = value(0); whitespace();
  if (offset !== text.length) fail('MANIFEST_JSON', 'Trailing JSON data.');
  return parsed;
}

function newReport() {
  return {
    package_id: null, format: null,
    counts: {
      datasets: 0, documents: 0, revisions: 0, media: 0, representations: 0,
      threads: 0, comments: 0, annotations: 0, dependencies: 0,
      objects: 0, declared_object_bytes: 0, verified_objects: 0, verified_object_bytes: 0,
    },
    diagnostics: [], diagnostics_omitted: 0,
    archive_integrity: 'invalid', content_completeness: 'unknown',
    rendering_assessed: false, can_import: false,
  };
}
function reporter(report, ctx) {
  let invalid = false; let incomplete = false; let unknown = false; let overflow = false;
  const grouped = new Map();
  return {
    add(code, severity, message, entity_id) {
      if (severity === 'error') invalid = true;
      // Web manifests can have thousands of records with the same missing-provenance warning.
      // Aggregate repeated non-error diagnostics explicitly; never suppress errors or invent provenance.
      const key = code + '\0' + message;
      if (ctx.aggregateDiagnostics && severity !== 'error' && grouped.has(key)) {
        const previous = grouped.get(key); previous.occurrences = (previous.occurrences || 1) + 1; return;
      }
      if (report.diagnostics.length < ctx.budgets.maxDiagnostics - 1) {
        const item = { code, severity, ...(entity_id ? { entity_id } : {}), message };
        report.diagnostics.push(item);
        if (ctx.aggregateDiagnostics && severity !== 'error') grouped.set(key, item);
      } else {
        report.diagnostics_omitted++;
        if (!overflow) {
          overflow = true; invalid = true;
          report.diagnostics.push({ code: 'RESOURCE_LIMIT', severity: 'error', message: 'Diagnostic budget exceeded. Omitted count is explicit; increase maxDiagnostics for a full assessment.' });
        }
      }
    },
    incomplete() { incomplete = true; },
    unknown() { unknown = true; },
    finish() {
      report.archive_integrity = invalid ? 'invalid' : 'valid';
      report.can_import = !invalid;
      report.content_completeness = invalid ? 'unknown' : incomplete ? 'incomplete' : unknown ? 'unknown' : 'complete';
    },
  };
}

function schema(m, report, diag, ctx) {
  const entities = new Map(); const objects = new Map(); let extensions = false;
  function record(v, allowed) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail('SCHEMA', 'Expected a manifest object.');
    if (Object.keys(v).some(key => !allowed.includes(key))) extensions = true;
  }
  function str(v) { if (typeof v !== 'string' || !v.length) fail('SCHEMA', 'Expected a nonempty string.'); }
  function nullable(v) { if (v !== null) str(v); }
  function id(v) { if (typeof v !== 'string' || !ID.test(v)) fail('ID_INVALID', 'Invalid stable entity ID.'); }
  function reference(v) { if (v !== null) id(v); }
  function choice(v, values) { if (!values.includes(v)) fail('SCHEMA', 'Invalid enum value.'); }
  function add(v, type) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail('SCHEMA', 'Entity must be an object.');
    id(v.id);
    if (entities.has(v.id)) fail('ID_DUPLICATE', 'Stable entity IDs must be globally unique.');
    if (entities.size >= ctx.budgets.maxEntities) fail('RESOURCE_LIMIT', 'Entity budget exceeded.');
    entities.set(v.id, { value: v, type });
  }
  function content(hash) {
    if (typeof hash !== 'string' || !HEX.test(hash)) fail('OBJECT_REFERENCE', 'Content reference must be lowercase SHA-256.');
    if (!objects.has(hash)) fail('OBJECT_UNDECLARED', 'Referenced content object is not declared.');
  }
  function provenance(v, owner) {
    record(v, ['source', 'source_url', 'source_revision', 'attribution', 'observed_at', 'evidence_sha256']);
    str(v.source); nullable(v.source_url); nullable(v.source_revision); nullable(v.observed_at);
    if (v.observed_at !== null) {
      const parsed = Date.parse(v.observed_at);
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v.observed_at) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== v.observed_at.slice(0, 19)) fail('SCHEMA', 'observed_at must be a valid UTC ISO time or null.');
    }
    record(v.attribution, ['status', 'text']);
    choice(v.attribution.status, ['known', 'unknown']); nullable(v.attribution.text);
    if (v.attribution.status === 'known' && !v.attribution.text) fail('SCHEMA', 'Known attribution requires text.');
    if (v.evidence_sha256 !== undefined && v.evidence_sha256 !== null) content(v.evidence_sha256);
    if (v.attribution.status === 'unknown' || v.source_revision === null || v.source_url === null || v.observed_at === null) {
      diag.unknown();
      diag.add('PROVENANCE_UNKNOWN', 'warning', 'Source revision, attribution, URL or observation is unknown; supplied provenance is retained as claimed.', owner);
    }
  }
  record(m, ['format', 'dataset', 'objects', ...GROUPS]);
  if (m.format !== FORMAT) fail('FORMAT', 'Unsupported manifest format.');
  report.format = FORMAT;
  if (!Array.isArray(m.objects)) fail('SCHEMA', 'objects must be an array.');
  if (m.objects.length > ctx.budgets.maxObjects) fail('RESOURCE_LIMIT', 'Object count budget exceeded.');
  for (const o of m.objects) {
    record(o, ['sha256', 'bytes']);
    if (typeof o.sha256 !== 'string' || !HEX.test(o.sha256)) fail('OBJECT_NAME', 'Object names must be exactly 64 lowercase hexadecimal characters.');
    if (objects.has(o.sha256)) fail('OBJECT_DUPLICATE', 'Duplicate object declaration.');
    if (!Number.isSafeInteger(o.bytes) || o.bytes < 0) fail('SCHEMA', 'Object byte length must be a nonnegative safe integer.');
    if (o.bytes > ctx.budgets.maxObjectBytes || o.bytes > ctx.budgets.maxTotalObjectBytes - report.counts.declared_object_bytes) fail('RESOURCE_LIMIT', 'Declared object byte budget exceeded.');
    report.counts.declared_object_bytes += o.bytes; objects.set(o.sha256, o);
  }
  report.counts.objects = objects.size;
  record(m.dataset, ['id', 'provenance']); add(m.dataset, 'dataset');
  report.counts.datasets = 1; provenance(m.dataset.provenance, m.dataset.id);
  for (const group of GROUPS) {
    if (!Array.isArray(m[group])) fail('SCHEMA', 'Every entity collection must be an array.');
    if (m[group].length > ctx.budgets.maxEntities - entities.size) fail('RESOURCE_LIMIT', 'Entity budget exceeded.');
    for (const v of m[group]) add(v, group);
    report.counts[group] = m[group].length;
  }
  for (const media of m.media) {
    if (!Array.isArray(media.representations)) fail('SCHEMA', 'Media representations must be an array.');
    for (const r of media.representations) { add(r, 'representations'); report.counts.representations++; }
  }
  function target(v, type, owner) {
    id(v); const found = entities.get(v);
    if (!found || (type && found.type !== type)) {
      diag.add('REFERENCE_DANGLING', 'error', 'Owned reference is missing or has the wrong entity type.', owner);
      return null;
    }
    return found.value;
  }
  for (const v of m.documents) {
    record(v, ['id', 'dataset_id', 'title', 'aliases', 'current_revision_id', 'history', 'provenance']);
    target(v.dataset_id, 'dataset', v.id); str(v.title);
    if (!Array.isArray(v.aliases)) fail('SCHEMA', 'Document aliases must be an array.');
    v.aliases.forEach(str); reference(v.current_revision_id);
    choice(v.history, ['complete', 'partial', 'unknown']); provenance(v.provenance, v.id);
    if (v.current_revision_id !== null) {
      const rev = target(v.current_revision_id, 'revisions', v.id);
      if (rev && rev.document_id !== v.id) diag.add('REVISION_OWNER', 'error', 'Current revision belongs to another document.', v.id);
    } else {
      diag.incomplete(); diag.add('REVISION_MISSING', 'warning', 'Document has no retained current revision.', v.id);
    }
    if (v.history !== 'complete') {
      if (v.history === 'partial') diag.incomplete(); else diag.unknown();
      diag.add('HISTORY_NOT_COMPLETE', 'warning', 'Revision/source history is partial or unknown.', v.id);
    }
  }
  for (const v of m.revisions) {
    record(v, ['id', 'document_id', 'parent_revision_id', 'content', 'syntax', 'provenance']);
    target(v.document_id, 'documents', v.id); reference(v.parent_revision_id);
    content(v.content); str(v.syntax); provenance(v.provenance, v.id);
    if (v.parent_revision_id !== null) {
      const parent = target(v.parent_revision_id, 'revisions', v.id);
      if (parent && parent.document_id !== v.document_id) diag.add('REVISION_OWNER', 'error', 'Parent revision belongs to another document.', v.id);
    }
  }
  for (const v of m.media) {
    record(v, ['id', 'dataset_id', 'original_status', 'representations', 'provenance']);
    target(v.dataset_id, 'dataset', v.id); choice(v.original_status, ['present', 'missing', 'unknown']);
    provenance(v.provenance, v.id); let originals = 0;
    for (const r of v.representations) {
      record(r, ['id', 'role', 'content', 'media_type', 'source_filename', 'provenance']);
      choice(r.role, ['original', 'source-variant', 'unknown']); content(r.content); str(r.media_type);
      if (r.source_filename !== undefined) nullable(r.source_filename);
      provenance(r.provenance, r.id);
      if (r.role === 'original') originals++;
      if (r.role === 'unknown') {
        diag.unknown(); diag.add('MEDIA_VARIANT_UNKNOWN', 'warning', 'Representation role is unknown.', r.id);
      }
    }
    if ((v.original_status === 'present') !== (originals > 0)) fail('MEDIA_ORIGINAL', 'original_status conflicts with retained original representations.');
    if (v.original_status !== 'present') {
      if (v.original_status === 'missing') diag.incomplete(); else diag.unknown();
      diag.add('MEDIA_ORIGINAL_NOT_PRESENT', 'warning', 'A source variant does not establish retention of the original media.', v.id);
    }
  }
  for (const v of m.threads) {
    record(v, ['id', 'document_id', 'provenance']);
    target(v.document_id, 'documents', v.id); provenance(v.provenance, v.id);
  }
  for (const v of m.comments) {
    record(v, ['id', 'thread_id', 'parent_comment_id', 'content', 'provenance']);
    target(v.thread_id, 'threads', v.id); reference(v.parent_comment_id);
    content(v.content); provenance(v.provenance, v.id);
    if (v.parent_comment_id !== null) {
      const parent = target(v.parent_comment_id, 'comments', v.id);
      if (parent && parent.thread_id !== v.thread_id) diag.add('COMMENT_OWNER', 'error', 'Parent comment belongs to another thread.', v.id);
    }
  }
  for (const v of m.annotations) {
    record(v, ['id', 'kind', 'source_revision_id', 'source_content_sha256', 'content', 'processor', 'provenance']);
    str(v.kind); content(v.content); content(v.source_content_sha256);
    const rev = target(v.source_revision_id, 'revisions', v.id);
    if (rev && rev.content !== v.source_content_sha256) diag.add('AI_SOURCE_HASH', 'error', 'Annotation hash differs from the exact referenced revision content.', v.id);
    provenance(v.provenance, v.id);
    if (v.kind === 'ai') {
      record(v.processor, ['name', 'version', 'model', 'prompt_version']);
      for (const key of ['name', 'version', 'model', 'prompt_version']) str(v.processor[key]);
    } else if (v.kind === 'note') {
      if (v.processor !== null) fail('SCHEMA', 'A note processor must be null.');
    } else extensions = true;
  }
  for (const v of m.dependencies) {
    record(v, ['id', 'owner_id', 'kind', 'status', 'target_id', 'source_url', 'provenance']);
    const owner = target(v.owner_id, null, v.id);
    if (owner && entities.get(v.owner_id).type === 'dependencies') fail('SCHEMA', 'A dependency cannot own another dependency.');
    str(v.kind); choice(v.status, ['resolved', 'missing', 'unknown']);
    reference(v.target_id); nullable(v.source_url); provenance(v.provenance, v.id);
    if (v.status === 'resolved') {
      if (v.target_id === null) fail('SCHEMA', 'Resolved dependency requires a local target ID.');
      const type = v.kind === 'media' ? 'media' : ['template', 'document'].includes(v.kind) ? 'documents' : null;
      const found = target(v.target_id, type, v.id);
      if (found && entities.get(v.target_id).type === 'dependencies') fail('SCHEMA', 'Dependency targets must be content entities.');
    } else {
      if (v.target_id !== null) fail('SCHEMA', 'Missing/unknown external dependency requires null target_id.');
      if (v.status === 'missing') diag.incomplete(); else diag.unknown();
      diag.add('DEPENDENCY_' + v.status.toUpperCase(), 'warning', 'External dependency is explicitly missing or unknown; no lookup is attempted.', v.id);
    }
    if (!['media', 'template', 'document'].includes(v.kind)) extensions = true;
  }
  function parentCycles(rows, key) {
    const done = new Set();
    for (const row of rows) {
      let current = row.id; const active = new Set();
      while (current !== null && entities.has(current) && !done.has(current)) {
        if (active.has(current)) {
          diag.add('REFERENCE_CYCLE', 'error', 'Revision/comment parent cycle.', row.id); break;
        }
        active.add(current); current = entities.get(current).value[key] ?? null;
      }
      for (const item of active) done.add(item);
    }
  }
  parentCycles(m.revisions, 'parent_revision_id'); parentCycles(m.comments, 'parent_comment_id');
  if (m.dependencies.some(v => v.status === 'resolved')) diag.add('DEPENDENCY_GRAPH_NOT_EVALUATED', 'info', 'Local dependency links/types are checked; transclusion cycles and runtime behavior are not evaluated.');
  if (m.revisions.length) {
    diag.add('SYNTAX_NOT_EVALUATED', 'warning', 'No source parser, NamuMark execution, HTML rendering or functional equivalence assessment is performed.');
    if (m.revisions.some(v => v.syntax !== 'text/plain')) {
      diag.unknown(); diag.add('SYNTAX_COVERAGE_UNKNOWN', 'warning', 'Non-plain syntax coverage is unknown; raw bytes remain unchanged.');
    }
  }
  if (extensions) {
    diag.unknown(); diag.add('EXTENSIONS_NOT_EVALUATED', 'warning', 'Unknown fields/features are retained recursively in exact manifest bytes; their semantics and references are not evaluated.');
  }
  diag.add('PRESERVATION_SCOPE', 'info', 'Integrity covers this declared bundle. Source authenticity, inventory/history claims and rendering equivalence are not independently proven.');
  return objects;
}


export { PreservationError, FORMAT, HEX, GROUPS, config, fail, parseJson, newReport, reporter, schema };
export async function sha256(bytes) {
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
export async function inspectManifest(bytes, options = {}) {
  const ctx = {...config(options), aggregateDiagnostics:true}, report = newReport(), diag = reporter(report, ctx);
  let manifest = null, objects = new Map();
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > ctx.budgets.maxManifestBytes) fail('RESOURCE_LIMIT', 'Manifest byte budget exceeded.');
    report.package_id = await sha256(bytes);
    manifest = parseJson(bytes, ctx.budgets);
    objects = schema(manifest, report, diag, ctx);
  } catch (error) { diag.add(error.code || 'MANIFEST_INVALID', 'error', error instanceof PreservationError ? error.message : 'Manifest validation failed.'); }
  diag.finish();
  // This checks declared references only. Storage adapters must verify EVERY object before import.
  return {manifest, report, objects: [...objects.values()]};
}
