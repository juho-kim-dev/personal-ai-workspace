import { PreservationError, FORMAT, HEX, GROUPS, config, fail, parseJson, newReport, reporter, schema } from '../../lib/wiki-preservation-contract.mjs';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const MARKER = '.wiki42-preservation-store-v1';
const MARKER_BYTES = Buffer.from('wiki42-preservation-store-v1\n');
function publicError(error) {
  if (error instanceof PreservationError) return error;
  const errno = /^E[A-Z0-9]+$/.test(error?.code || '') ? ` (${error.code})` : '';
  return new PreservationError('IO_ERROR', `Local filesystem operation failed${errno}.`);
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const normalized = p => process.platform === 'win32' ? p.toLowerCase() : p;

function abort(ctx) { if (ctx.signal?.aborted) fail('ABORTED', 'Operation aborted.'); }
function overlaps(a, b) {
  a = normalized(a); b = normalized(b);
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}
async function statMaybe(p) {
  try { return await fs.lstat(p); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Check lexical components before resolve() can erase link/../ tricks.
// Existing ancestors are inspected individually without recursively reading them.
async function safePath(input, { missing = false, kind = 'directory' } = {}) {
  if (typeof input !== 'string' || !input || input.length > 4096 || /[\x00-\x1f]/.test(input)) fail('PATH_INVALID', 'Invalid path.');
  if (/^(?:\\\\|\/\/|[a-z]+:\/\/)/i.test(input) || /^[A-Za-z]:(?![\\/])/.test(input)) fail('PATH_INVALID', 'Network, device, URL and drive-relative paths are forbidden.');
  if (process.platform !== 'win32' && input.includes('\\')) fail('PATH_INVALID', 'Backslashes are not supported in POSIX paths.');
  const parts = input.split(/[\\/]/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (process.platform === 'win32' && i === 0 && /^[A-Za-z]:$/.test(part)) continue;
    if (part === '.' || part === '..' || /[:*?"<>|]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) {
      fail('PATH_INVALID', 'Traversal, ambiguous or nonportable path component.');
    }
  }
  const full = path.resolve(input);
  const root = path.parse(full).root;
  if (full === root) fail('PATH_INVALID', 'Filesystem roots cannot be package/store/output paths.');
  const segments = full.slice(root.length).split(path.sep);
  let cursor = root;
  for (let i = -1; i < segments.length; i++) {
    if (i >= 0) cursor = path.join(cursor, segments[i]);
    const st = await statMaybe(cursor);
    if (!st) {
      if (missing && i === segments.length - 1) return full;
      fail('PATH_MISSING', 'Path or parent directory does not exist.');
    }
    if (st.isSymbolicLink()) fail('PATH_LINK', 'Symlinks and junctions are forbidden.');
    if (normalized(await fs.realpath(cursor)) !== normalized(cursor)) fail('PATH_LINK', 'An ancestor resolves to another path.');
    if (i < segments.length - 1 || kind === 'directory') {
      if (!st.isDirectory()) fail('PATH_TYPE', 'Expected a regular directory.');
    } else if (!st.isFile() || st.nlink !== 1) fail('PATH_TYPE', 'Expected a regular file with exactly one hard link.');
  }
  return full;
}

async function regularHandle(p) {
  await safePath(p, { kind: 'file' });
  const before = await fs.lstat(p);
  const handle = await fs.open(p, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink !== 1 || st.dev !== before.dev || st.ino !== before.ino) fail('PATH_CHANGED', 'File changed while opening.');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

async function readBounded(p, limit, ctx) {
  const handle = await regularHandle(p);
  try {
    if ((await handle.stat()).size > limit) fail('RESOURCE_LIMIT', 'File exceeds the configured byte budget.');
    const chunks = []; let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) {
      abort(ctx); size += chunk.length;
      if (size > limit) fail('RESOURCE_LIMIT', 'File exceeds the configured byte budget.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}

async function entries(dir, limit, ctx) {
  await safePath(dir);
  const result = [];
  for await (const entry of await fs.opendir(dir)) {
    abort(ctx);
    if (result.length >= limit) fail('RESOURCE_LIMIT', 'Directory entry budget exceeded.');
    result.push(entry.name);
  }
  return result;
}

// All binary object validation and copying is streamed, including unreferenced objects.
async function streamObject(source, declaration, ctx, destination) {
  abort(ctx); const input = await regularHandle(source); let output;
  try {
    if ((await input.stat()).size !== declaration.bytes) fail('OBJECT_LENGTH', 'Object byte length differs from its declaration.');
    if (destination) {
      await safePath(destination, { missing: true, kind: 'file' });
      output = await fs.open(destination, 'wx', 0o600);
    }
    const digest = createHash('sha256'); let size = 0;
    for await (const chunk of input.createReadStream({ autoClose: false, highWaterMark: 256 * 1024 })) {
      abort(ctx); size += chunk.length;
      if (size > declaration.bytes || size > ctx.budgets.maxObjectBytes) fail('OBJECT_LENGTH', 'Object grew during streaming.');
      digest.update(chunk);
      if (output) {
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset);
          if (!bytesWritten) fail('WRITE_FAILED', 'No progress while writing an object.');
          offset += bytesWritten;
        }
      }
    }
    if (size !== declaration.bytes) fail('OBJECT_LENGTH', 'Object was interrupted or truncated.');
    if (digest.digest('hex') !== declaration.sha256) fail('OBJECT_HASH', 'Object SHA-256 differs from its declaration.');
    const after = await fs.lstat(source); const held = await input.stat();
    if (after.isSymbolicLink() || after.dev !== held.dev || after.ino !== held.ino || after.size !== size || after.nlink !== 1) fail('PATH_CHANGED', 'Object path changed during streaming.');
    if (output) await output.sync();
    return size;
  } finally {
    try { if (output) await output.close(); } finally { await input.close(); }
  }
}

async function inspectInternal(packageDir, ctx) {
  const report = newReport(); const diag = reporter(report, ctx);
  let manifestBytes; let objects; let root;
  try {
    abort(ctx); root = await safePath(packageDir);
    const top = await entries(root, 2, ctx);
    if (top.length !== 2 || !top.includes('manifest.json') || !top.includes('objects')) fail('PACKAGE_LAYOUT', 'Package must contain only manifest.json and objects/.');
    manifestBytes = await readBounded(path.join(root, 'manifest.json'), ctx.budgets.maxManifestBytes, ctx);
    report.package_id = sha(manifestBytes);
    objects = schema(parseJson(manifestBytes, ctx.budgets), report, diag, ctx);
    const objectDir = path.join(root, 'objects');
    const names = new Set(await entries(objectDir, ctx.budgets.maxObjects, ctx));
    for (const name of names) if (!HEX.test(name) || !objects.has(name)) fail('OBJECT_UNDECLARED', 'Object directory contains an invalid or undeclared entry.');
    for (const declaration of objects.values()) {
      abort(ctx);
      try {
        if (!names.has(declaration.sha256)) fail('OBJECT_MISSING', 'Declared object is missing.');
        const bytes = await streamObject(path.join(objectDir, declaration.sha256), declaration, ctx);
        report.counts.verified_objects++; report.counts.verified_object_bytes += bytes;
      } catch (error) {
        const safe = publicError(error); diag.add(safe.code, 'error', safe.message);
        if (safe.code === 'ABORTED') break;
      }
    }
  } catch (error) {
    const safe = publicError(error); diag.add(safe.code, 'error', safe.message);
  }
  diag.finish();
  return { report, manifestBytes, objects, root };
}

/** Read-only bounded diagnosis. Invalid packages return a report rather than throwing. */
export async function inspectPackage(packageDir, options = {}) {
  return (await inspectInternal(packageDir, config(options))).report;
}
function requireValid(state) {
  if (!state.report.can_import) {
    const error = new PreservationError('PACKAGE_INVALID', 'Package validation failed; inspect the attached report.');
    error.report = state.report; throw error;
  }
}
async function writeExclusive(file, bytes) {
  await safePath(file, { missing: true, kind: 'file' });
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function copyBundle(state, destination, ctx) {
  abort(ctx); await safePath(destination);
  await fs.mkdir(path.join(destination, 'objects'), { mode: 0o700 });
  await writeExclusive(path.join(destination, 'manifest.json'), state.manifestBytes);
  for (const declaration of state.objects.values()) {
    await streamObject(path.join(state.root, 'objects', declaration.sha256), declaration, ctx, path.join(destination, 'objects', declaration.sha256));
  }
  const copied = await inspectInternal(destination, ctx); requireValid(copied);
  if (copied.report.package_id !== state.report.package_id || !copied.manifestBytes.equals(state.manifestBytes)) fail('PACKAGE_CHANGED', 'Copied manifest differs from the validated manifest.');
}

async function storeLock(store, ctx, create, callback) {
  abort(ctx); await safePath(store, { missing: create });
  if (!(await statMaybe(store))) {
    try { await fs.mkdir(store, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  await safePath(store);
  const lockPath = path.join(store, '.import.lock');
  let names = await entries(store, 4, ctx);
  if (names.includes('.import.lock')) {
    await safePath(lockPath, { kind: 'file' });
    fail('STORE_LOCKED', 'Store lock exists: active or interrupted operation. Check staging manually; no automatic removal.');
  }
  if (!names.includes(MARKER) && names.length) fail('STORE_UNMARKED', 'Refusing a nonempty, unmarked store.');
  if (!create && !names.includes(MARKER)) fail('STORE_UNMARKED', 'Export requires an initialized v1 store.');
  if (names.some(name => ![MARKER, 'packages', 'staging'].includes(name))) fail('STORE_LAYOUT', 'Unexpected store entry.');
  let handle;
  try { handle = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') fail('STORE_LOCKED', 'Another operation acquired the exclusive store lock.');
    throw error;
  }
  let lockStat; let result; let primaryError; let completed = false;
  try {
    lockStat = await handle.stat();
    await handle.writeFile(JSON.stringify({ format: FORMAT, token: randomUUID(), pid: process.pid, created_at: new Date().toISOString() }) + '\n');
    await handle.sync();
    names = await entries(store, 4, ctx);
    if (!names.includes(MARKER)) {
      if (!create || names.some(name => name !== '.import.lock')) fail('STORE_UNMARKED', 'Refusing an unmarked store that changed during initialization.');
      await writeExclusive(path.join(store, MARKER), MARKER_BYTES);
      await fs.mkdir(path.join(store, 'packages'), { mode: 0o700 });
      await fs.mkdir(path.join(store, 'staging'), { mode: 0o700 });
    }
    if (names.some(name => ![MARKER, 'packages', 'staging', '.import.lock'].includes(name))) fail('STORE_LAYOUT', 'Unexpected store entry.');
    const marker = await readBounded(path.join(store, MARKER), 128, ctx);
    if (!marker.equals(MARKER_BYTES)) fail('STORE_MARKER', 'Store marker does not match v1.');
    const packages = path.join(store, 'packages'); const staging = path.join(store, 'staging');
    await safePath(packages); await safePath(staging);
    if ((await entries(staging, ctx.budgets.maxObjects, ctx)).length) fail('INCOMPLETE_STAGING', 'Incomplete staging exists. Preserve and review it manually; no automatic removal.');
    for (const name of await entries(packages, ctx.budgets.maxStorePackages, ctx)) {
      if (!HEX.test(name)) fail('STORE_LAYOUT', 'Invalid committed package directory name.');
      await safePath(path.join(packages, name));
    }
    result = await callback();
    completed = true;
  } catch (error) {
    primaryError = publicError(error);
  }
  let cleanupError;
  try {
    await handle.close();
    if (!lockStat) fail('LOCK_CHANGED', 'Lock identity could not be established; lock was left untouched.');
    await safePath(lockPath, { kind: 'file' });
    const current = await fs.lstat(lockPath);
    if (current.dev !== lockStat.dev || current.ino !== lockStat.ino || current.nlink !== 1) fail('LOCK_CHANGED', 'Lock changed and was left untouched.');
    await fs.unlink(lockPath);
  } catch (error) {
    cleanupError = publicError(error);
  }
  const cleanupDetail = cleanupError && { code: cleanupError.code, message: cleanupError.message };
  if (primaryError) {
    if (cleanupDetail) primaryError.cleanup_error = cleanupDetail;
    throw primaryError;
  }
  if (cleanupError) {
    cleanupError.cleanup_error = cleanupDetail;
    if (completed) {
      cleanupError.operation_completed = true;
      cleanupError.committed_result = result;
    }
    throw cleanupError;
  }
  return result;
}

/** Copy into an explicitly isolated immutable filesystem store. */
export async function importPackage(packageDir, storeDir, options = {}) {
  const ctx = config(options);
  try {
    const source = await safePath(packageDir);
    const store = await safePath(storeDir, { missing: true });
    if (overlaps(source, store)) fail('PATH_OVERLAP', 'Source and store must be disjoint directories.');
    const state = await inspectInternal(source, ctx); requireValid(state);
    return await storeLock(store, ctx, true, async () => {
      const destination = path.join(store, 'packages', state.report.package_id);
      if (await statMaybe(destination)) {
        const existing = await inspectInternal(destination, ctx); requireValid(existing);
        if (existing.report.package_id !== state.report.package_id || !existing.manifestBytes.equals(state.manifestBytes)) fail('STORE_CONFLICT', 'Stored manifest differs from the exact package manifest.');
        return { package_id: state.report.package_id, disposition: 'already-present' };
      }
      if ((await entries(path.join(store, 'packages'), ctx.budgets.maxStorePackages, ctx)).length >= ctx.budgets.maxStorePackages) fail('RESOURCE_LIMIT', 'Store package count budget exceeded.');
      const stageName = 'stage-' + randomUUID();
      const stage = path.join(store, 'staging', stageName);
      await fs.mkdir(stage, { mode: 0o700 });
      try {
        await copyBundle(state, stage, ctx); abort(ctx);
        await safePath(path.join(store, 'packages')); await safePath(stage);
        if (await statMaybe(destination)) fail('STORE_CONFLICT', 'Package destination appeared before publication.');
        await fs.rename(stage, destination);
        return { package_id: state.report.package_id, disposition: 'imported' };
      } catch (error) {
        const safe = publicError(error);
        safe.staging_incomplete = true; safe.staging_id = stageName; throw safe;
      }
    });
  } catch (error) { throw publicError(error); }
}

/** Verify in an output-filesystem sibling before publishing a brand-new export. */
export async function exportPackage(storeDir, packageId, outDir, options = {}) {
  const ctx = config(options);
  try {
    if (typeof packageId !== 'string' || !HEX.test(packageId)) fail('PACKAGE_ID', 'packageId must be lowercase SHA-256.');
    const store = await safePath(storeDir); const out = await safePath(outDir, { missing: true });
    if (overlaps(store, out)) fail('PATH_OVERLAP', 'Store and output must be disjoint directories.');
    if (await statMaybe(out)) fail('OUTPUT_EXISTS', 'Output must be a brand-new directory.');
    return await storeLock(store, ctx, false, async () => {
      const state = await inspectInternal(path.join(store, 'packages', packageId), ctx); requireValid(state);
      if (state.report.package_id !== packageId) fail('STORE_CONFLICT', 'Stored manifest differs from the requested package ID.');
      // A deterministic sibling is both staging and an exclusive reservation
      // shared by exports from different stores targeting this same output.
      // Renaming it publishes only the fully verified bundle. An interrupted
      // reservation is deliberately retained and never recovered automatically.
      const stageName = '.wiki42-export-stage-' + sha(Buffer.from(normalized(out)));
      const stage = path.join(path.dirname(out), stageName);
      const incomplete = error => {
        const safe = publicError(error);
        safe.output_incomplete = true;
        safe.staging_incomplete = true;
        safe.staging_id = stageName;
        safe.staging_path = stage;
        return safe;
      };
      await safePath(out, { missing: true });
      if (await statMaybe(out)) fail('OUTPUT_EXISTS', 'Output must be a brand-new directory.');
      await safePath(stage, { missing: true });
      try {
        await fs.mkdir(stage, { mode: 0o700 });
      } catch (error) {
        if (error.code === 'EEXIST') {
          throw incomplete(new PreservationError('EXPORT_STAGING_EXISTS', 'Output staging reservation exists: active or interrupted export. Preserve and review it manually; no automatic removal.'));
        }
        throw error;
      }
      try {
        await safePath(out, { missing: true });
        if (await statMaybe(out)) fail('OUTPUT_EXISTS', 'Output appeared before copying.');
        await copyBundle(state, stage, ctx); abort(ctx);
        await safePath(stage); await safePath(out, { missing: true });
        if (await statMaybe(out)) fail('OUTPUT_EXISTS', 'Output appeared before publication.');
        try {
          await fs.rename(stage, out);
        } catch (error) {
          // POSIX and Windows report competing nonempty destinations using
          // different errno values. Neither platform may replace that bundle.
          if (await statMaybe(out)) fail('OUTPUT_EXISTS', 'Output appeared during publication.');
          throw error;
        }
        return { package_id: packageId };
      } catch (error) {
        throw incomplete(error);
      }
    });
  } catch (error) { throw publicError(error); }
}

/** Deterministic synthetic example; no real source material or external access. */
export async function createDemoPackage(outDir) {
  try {
    const out = await safePath(outDir, { missing: true });
    if (await statMaybe(out)) fail('OUTPUT_EXISTS', 'Demo output must be a brand-new directory.');
    const provenance = {
      source: 'SWU (synthetic fixture)',
      source_url: 'https://synthetic.invalid/wiki/example',
      source_revision: 'synthetic-r1',
      attribution: { status: 'known', text: 'Synthetic example author; not source evidence.' },
      observed_at: '2026-10-23T00:00:00Z',
    };
    const raw = Buffer.from('\ufeff== 합성 SWU 문서 ==\r\n[include(틀:합성)]\r\n\0', 'utf8');
    const media = Buffer.from([0, 255, 254, 128, 13, 10, 239, 187, 191, 0]);
    const comment = Buffer.from('합성 댓글\r\n'); const ai = Buffer.from('Synthetic AI output; never raw source.\n');
    const blobs = [raw, media, comment, ai];
    const m = {
      format: FORMAT, dataset: { id: 'dataset:synthetic-swu', provenance },
      objects: blobs.map(bytes => ({ sha256: sha(bytes), bytes: bytes.length })),
      documents: [{ id: 'doc:one', dataset_id: 'dataset:synthetic-swu', title: '합성 문서', aliases: ['합성 별칭'], current_revision_id: 'rev:one:1', history: 'partial', provenance }],
      revisions: [{ id: 'rev:one:1', document_id: 'doc:one', parent_revision_id: null, content: sha(raw), syntax: 'namumark', provenance }],
      media: [{
        id: 'media:one', dataset_id: 'dataset:synthetic-swu', original_status: 'unknown', provenance,
        representations: [{ id: 'variant:one', role: 'source-variant', content: sha(media), media_type: 'application/octet-stream', source_filename: 'synthetic.bin', provenance }],
      }],
      threads: [{ id: 'thread:one', document_id: 'doc:one', provenance }],
      comments: [{ id: 'comment:one', thread_id: 'thread:one', parent_comment_id: null, content: sha(comment), provenance }],
      annotations: [{
        id: 'ai:one', kind: 'ai', source_revision_id: 'rev:one:1', source_content_sha256: sha(raw), content: sha(ai),
        processor: { name: 'synthetic-processor', version: '1', model: 'synthetic-model', prompt_version: 'synthetic-prompt-v1' }, provenance,
      }],
      dependencies: [{ id: 'dep:one', owner_id: 'rev:one:1', kind: 'template', status: 'missing', target_id: null, source_url: 'https://synthetic.invalid/template/example', provenance }],
      synthetic_extension: { nested: { preserved: ['é', 'e\u0301', '__proto__'] } },
    };
    await fs.mkdir(out, { mode: 0o700 });
    try {
      await fs.mkdir(path.join(out, 'objects'), { mode: 0o700 });
      await writeExclusive(path.join(out, 'manifest.json'), Buffer.from('\ufeff' + JSON.stringify(m, null, 2).replaceAll('\n', '\r\n') + '\r\n'));
      for (const bytes of blobs) await writeExclusive(path.join(out, 'objects', sha(bytes)), bytes);
      const state = await inspectInternal(out, config({})); requireValid(state);
      return { package_id: state.report.package_id };
    } catch (error) {
      const safe = publicError(error); safe.output_incomplete = true; throw safe;
    }
  } catch (error) { throw publicError(error); }
}
