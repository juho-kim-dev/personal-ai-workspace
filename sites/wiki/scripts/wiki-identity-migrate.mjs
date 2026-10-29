#!/usr/bin/env node
// Isolated, frozen-source experiment. No hosted storage, network, or writer API.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { DiagnosticError, offlineFileInfo, readOfflineFile, parseOfflineJSON,
  lockOfflineDirectory } from './wiki-identity-diagnose.mjs';
import { serializeIdentityPlan } from './lib/wiki-identity-plan.mjs';
import { prepareMigration, openMigration, prepareBackupImport, importBackup,
  MigrationError, MAX_SOURCE_BYTES as SOURCE_LIMIT, MAX_BACKUP_BYTES as BACKUP_LIMIT } from './lib/wiki-identity-migration.mjs';

import { PrivatePathError, assertPathComponents, assertPrivatePath, preparePrivateDirectory } from './lib/wiki-private-path.mjs';

const STATE = 'shadow.sqlite';
const INITIAL = '.shadow-new.sqlite';
const TEMP_EXPORT = '.export-new.tmp';
const EXPORTS = ['experimental-backup.json', 'original-backup.json'];
const ALLOWED = new Set([STATE, STATE + '-journal', 'lock.sqlite', 'lock.sqlite-journal', ...EXPORTS]);
const COMMANDS = new Set(['migrate', 'export', 'export-original', 'import', 'rollback']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { throw new DiagnosticError(code, message); };

async function noSymlinkComponents(filename) {
  assertPathComponents(filename);
  let current = path.resolve(filename);
  while (true) {
    const info = await offlineFileInfo(current);
    if (info?.isSymbolicLink()) {
      // macOS system aliases occur in os.tmpdir(); all user-created aliases fail.
      const systemAlias = process.platform === 'darwin'
        && ((current === '/var' && await fs.realpath(current) === '/private/var')
          || (current === '/tmp' && await fs.realpath(current) === '/private/tmp'));
      if (!systemAlias) fail('UNSAFE_PATH', 'Symbolic links are not accepted.');
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function readInput(filename, limit) {
  await noSymlinkComponents(filename);
  const info = await fs.lstat(filename);
  if (!info.isFile() || info.nlink !== 1 || !(info.mode & 0o400)) {
    fail('UNSAFE_FILE', 'Input must be a readable regular file with one link.');
  }
  const bytes = await readOfflineFile(filename, limit);
  const after = await fs.lstat(filename);
  if (after.dev !== info.dev || after.ino !== info.ino || after.nlink !== 1) {
    fail('INPUT_CHANGED', 'Input identity changed while reading.');
  }
  return bytes;
}

function validateOptions(options) {
  const command = options.command ?? 'migrate';
  if (!COMMANDS.has(command) || !options.input || !options.workDir || !options.datasetId || !options.migrationId) {
    fail('INVALID_OPTIONS', 'Explicit input, dataset ID, migration ID and work directory are required.');
  }
  const chunk = options.chunkSize ?? 100, stop = options.stopAfterChunks;
  if (!Number.isSafeInteger(chunk) || chunk < 1 || chunk > 1000
    || (stop !== undefined && (!Number.isSafeInteger(stop) || stop < 1))) {
    fail('INVALID_OPTIONS', 'Chunk size must be 1..1000; stop-after-chunks must be positive.');
  }
  if (command !== 'migrate' && (options.chunkSize !== undefined || stop !== undefined)
    || command === 'import' && (options.resume || options.registry)) {
    fail('INVALID_OPTIONS', 'Chunk controls apply only to migrate; import requires a new target and embedded registry.');
  }
  return { ...options, command, chunkSize: chunk };
}

async function load(options) {
  const inputBytes = await readInput(options.input, options.command === 'import' ? BACKUP_LIMIT : SOURCE_LIMIT);
  const registryBytes = options.registry ? await readInput(options.registry, 64 * 1024) : null;
  const prepared = options.command === 'import'
    ? prepareBackupImport(inputBytes)
    : prepareMigration(inputBytes, {
      datasetId: options.datasetId, migrationId: options.migrationId,
      ...(registryBytes ? { registry: parseOfflineJSON(registryBytes) } : {}),
    });
  if (prepared.plan.dataset_id !== options.datasetId || prepared.plan.migration_id !== options.migrationId) {
    fail('CONFIG_CHANGED', 'Explicit dataset/migration IDs do not match the experimental backup.');
  }
  return { prepared, inputHash: digest(inputBytes), registryHash: registryBytes && digest(registryBytes) };
}

async function unchanged(options, loaded) {
  const input = await readInput(options.input, options.command === 'import' ? BACKUP_LIMIT : SOURCE_LIMIT);
  const registry = options.registry ? await readInput(options.registry, 64 * 1024) : null;
  if (digest(input) !== loaded.inputHash || (registry && digest(registry)) !== loaded.registryHash) {
    fail('INPUT_CHANGED', 'Source/config bytes changed; no completion or export was published.');
  }
}

async function prepareDirectory(options) {
  const directory = path.resolve(options.workDir);
  await noSymlinkComponents(directory);
  const initial = await offlineFileInfo(directory);
  if (initial && (!initial.isDirectory() || initial.isSymbolicLink())) {
    fail('UNSAFE_DIRECTORY', 'Work directory must be a real directory.');
  }
  let ancestor = directory;
  const suffix = [];
  while (!(await offlineFileInfo(ancestor))) {
    suffix.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor);
  }
  const canonical = path.join(await fs.realpath(ancestor), ...suffix);
  for (const source of [options.input, options.registry].filter(Boolean)) {
    const relative = path.relative(canonical, await fs.realpath(source));
    if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
      fail('INPUT_IN_OUTPUT', 'Source/config must be outside the work directory.');
    }
  }
  if (!initial && (options.resume || !['migrate', 'import'].includes(options.command))) {
    fail('MISSING_CHECKPOINT', 'An existing shadow checkpoint is required.');
  }
  if (options.command === 'import' && initial) {
    fail('NEW_TARGET_REQUIRED', 'Import requires a new, nonexistent isolated directory.');
  }
  preparePrivateDirectory(directory);
  // Inspect before lock creation; never modify an unrelated directory.
  if ((await fs.readdir(directory)).some(name => !ALLOWED.has(name))) {
    fail('UNSAFE_DIRECTORY', 'Unexpected output file; preserve it and use a new directory.');
  }
  const release = await lockOfflineDirectory(directory);
  try {
    await inspectDirectory(directory);
    const statePath = path.join(directory, STATE);
    const exists = await offlineFileInfo(statePath);
    if (exists && options.command === 'migrate' && !options.resume) {
      fail('RESUME_REQUIRED', 'Existing shadow state requires --resume.');
    }
    if (!exists && (options.resume || !['migrate', 'import'].includes(options.command))) {
      fail('MISSING_CHECKPOINT', 'No shadow checkpoint exists.');
    }
    if (!exists && (await fs.readdir(directory)).some(name => !['lock.sqlite', 'lock.sqlite-journal'].includes(name))) {
      fail('UNSAFE_DIRECTORY', 'Output artifacts without a checkpoint cannot be reused.');
    }
    return { directory, statePath, exists: !!exists, release };
  } catch (error) { await release(); throw error; }
}

async function inspectDirectory(directory) {
  for (const name of await fs.readdir(directory)) {
    const info = await fs.lstat(path.join(directory, name));
    assertPrivatePath(path.join(directory, name), info, 'UNSAFE_DIRECTORY');
    if (!ALLOWED.has(name) || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1
      || (process.platform !== 'win32' && (info.mode & 0o077)) || !(info.mode & 0o400) || !(info.mode & 0o200)) {
      fail('UNSAFE_DIRECTORY', 'Unexpected, linked, unreadable, or nonprivate output file; preserve it and use a new directory.');
    }
  }
}

async function createState(statePath, prepared, importing, hooks, beforePublish) {
  const temporary = path.join(path.dirname(statePath), INITIAL);
  let store;
  try {
    if (importing) {
      await importBackup(temporary, prepared);
    } else {
      store = openMigration(temporary, prepared, { create: true });
    }
    store?.close();
    store = null;
    await beforePublish();
    if (await offlineFileInfo(statePath)) fail('OUTPUT_CONFLICT', 'Shadow state appeared during initialization.');
    // Atomic publication under the cross-process directory lock.
    await fs.rename(temporary, statePath);
    await hooks.afterInitialized?.();
  } finally {
    store?.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.unlink(temporary + '-journal').catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function publish(filename, bytes) {
  if (bytes.length > BACKUP_LIMIT) fail('OUTPUT_TOO_LARGE', 'Experimental output exceeds its finite size limit.');
  if (await offlineFileInfo(filename)) {
    const existing = await readOfflineFile(filename, BACKUP_LIMIT, true);
    if (!existing.equals(bytes)) fail('OUTPUT_CONFLICT', 'Existing export differs; it will not be overwritten.');
    return;
  }
  const temporary = path.join(path.dirname(filename), TEMP_EXPORT);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes); await handle.sync();
  } finally { await handle.close(); }
  try {
    if (await offlineFileInfo(filename)) fail('OUTPUT_CONFLICT', 'Export appeared during publication.');
    await fs.rename(temporary, filename);
  } finally {
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Local experiment only. Hooks allow controlled process/crash tests without env backdoors. */
export async function runMigration(rawOptions, hooks = {}) {
  const options = validateOptions(rawOptions);
  const loaded = await load(options); // All semantic/backup validation precedes output writes.
  const workspace = await prepareDirectory(options);
  const { directory, statePath, release } = workspace;
  const emit = hooks.emit ?? (() => {});
  let store;
  try {
    if (!workspace.exists) {
      await unchanged(options, loaded);
      await createState(statePath, loaded.prepared, options.command === 'import', hooks, () => unchanged(options, loaded));
    }
    store = openMigration(statePath, loaded.prepared);
    let status = store.verify();
    // Recognized outputs are evidence too: do not silently retain tampered exports.
    for (const name of EXPORTS) {
      const filename = path.join(directory, name);
      if (await offlineFileInfo(filename)) {
        const bytes = await readOfflineFile(filename, BACKUP_LIMIT, true);
        const valid = name === EXPORTS[0]
          ? status.next === status.total && serializeIdentityPlan(prepareBackupImport(bytes).contract) === serializeIdentityPlan(loaded.prepared.contract)
          : bytes.equals(loaded.prepared.sourceBytes);
        if (!valid) {
          fail('OUTPUT_CONFLICT', 'An existing export disagrees with verified shadow state.');
        }
      }
    }
    emit({ event: 'started', ...status, resumed: !!options.resume });
    if (options.command === 'rollback') {
      await unchanged(options, loaded);
      status = store.rollback();
      emit({ event: 'rolled_back', ...status, source_authoritative: true });
    } else if (options.command === 'export' || options.command === 'export-original') {
      const name = options.command === 'export' ? EXPORTS[0] : EXPORTS[1];
      const bytes = options.command === 'export' ? store.exportBackup() : store.exportOriginal();
      await unchanged(options, loaded);
      await publish(path.join(directory, name), bytes);
      emit({ event: 'exported', file: name, experimental: options.command === 'export' });
    } else if (options.command === 'migrate') {
      if (status.state === 'rolled_back') fail('ROLLED_BACK', 'Rollback is terminal. Use the preserved source and mapping in a new isolated directory.');
      let chunks = 0;
      while (status.state !== 'complete') {
        await unchanged(options, loaded);
        status = await store.migrateChunk(options.chunkSize, {
          beforeChunkCommit: async event => {
            await hooks.beforeChunkCommit?.(event);
            if (event.next === event.total) await hooks.beforeCompletionCommit?.();
            await unchanged(options, loaded);
          },
        });
        chunks++;
        emit({ event: 'checkpoint', ...status });
        await hooks.afterCheckpoint?.(status);
        if (options.stopAfterChunks !== undefined && chunks >= options.stopAfterChunks && status.state !== 'complete') {
          emit({ event: 'interrupted', ...status });
          return { exitCode: 75, directory, ...status };
        }
        await yieldTurn();
      }
      await unchanged(options, loaded);
      status = store.verify();
      emit({ event: 'complete', ...status, production_cutover: false, source_authoritative: true });
    } else {
      await unchanged(options, loaded);
      emit({ event: 'imported', ...status, experimental: true, source_authoritative: true });
    }
    return { exitCode: 0, directory, ...status };
  } finally {
    try { store?.close(); } finally { await release(); }
  }
}

function argumentsFrom(argv) {
  const options = {};
  if (argv[0] && !argv[0].startsWith('--')) options.command = argv.shift();
  const names = new Map([['--input', 'input'], ['--dataset-id', 'datasetId'], ['--migration-id', 'migrationId'],
    ['--work-dir', 'workDir'], ['--registry', 'registry'], ['--chunk-size', 'chunkSize'], ['--stop-after-chunks', 'stopAfterChunks']]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '--resume') {
      const key = flag.slice(2);
      if (key in options) fail('INVALID_OPTIONS', 'Duplicate option.');
      options[key] = true; continue;
    }
    const key = names.get(flag), value = argv[++i];
    if (!key || key in options || !value || value.startsWith('--')) fail('INVALID_OPTIONS', 'Unknown, duplicate or missing option.');
    options[key] = ['chunkSize', 'stopAfterChunks'].includes(key) ? (/^[1-9]\d*$/.test(value) ? Number(value) : NaN) : value;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try {
    const options = argumentsFrom(process.argv.slice(2));
    if (options.help) {
      process.stdout.write('EXPERIMENTAL isolated Wiki42 shadow SQLite; source remains authoritative. No production cutover.\n'
        + 'node scripts/wiki-identity-migrate.mjs migrate|export|export-original|import|rollback --input FILE --dataset-id LABEL --migration-id LABEL --work-dir DIR\n'
        + 'migrate: [--registry FILE] [--resume] [--chunk-size 1..1000] [--stop-after-chunks N]\n'
        + 'import: experimental backup into a NEW directory. Other commands read the original full v1/v2 source.\n'
        + 'Exit: 0 success, 75 intentional interruption, 1 fail closed. Rollback is terminal; no accepted writes exist.\n');
    } else {
      const result = await runMigration(options, { emit: event => process.stdout.write(JSON.stringify(event) + '\n') });
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    process.stderr.write(JSON.stringify({
      error: error instanceof DiagnosticError || error instanceof MigrationError || error instanceof PrivatePathError ? error.code : 'MIGRATION_FAILED',
      message: 'Isolated migration failed closed. Preserve source and local evidence; no production operation was performed.',
    }) + '\n');
    process.exitCode = 1;
  }
}
