#!/usr/bin/env node
// Offline only. The SQLite file below is a local diagnostic journal, never the wiki DB.
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { createIdentityPlan, serializeIdentityPlan } from './lib/wiki-identity-plan.mjs';

import { PrivatePathError, assertPathComponents, assertPrivatePath, preparePrivateDirectory, lockWindowsDirectory } from './lib/wiki-private-path.mjs';

const INPUT_LIMIT = 24 * 1024 * 1024;
const REPORT_LIMIT = 128 * 1024 * 1024;
const SECTIONS = ['documents', 'revisions', 'related', 'attachments', 'issues'];
const STATE_FILE = 'checkpoint.sqlite';
const REPORT_FILE = 'plan.json';
const LOCK_FILE = 'lock.sqlite';
const RUN_SCHEMA = 'CREATE TABLE diagnostic_run(id INTEGER PRIMARY KEY CHECK(id=1), contract TEXT NOT NULL, next_record INTEGER NOT NULL CHECK(next_record>=0), complete INTEGER NOT NULL CHECK(complete IN(0,1)))';
const RECORD_SCHEMA = 'CREATE TABLE diagnostic_records(position INTEGER PRIMARY KEY CHECK(position>=0), payload TEXT NOT NULL)';

export class DiagnosticError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new DiagnosticError(code, message); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = serializeIdentityPlan;

async function fileInfo(filename) {
  try { return await fs.lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function readBounded(filename, limit, privateOutput = false) {
  assertPathComponents(filename);
  const info = await fs.lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) fail('UNSAFE_FILE', '심볼릭 링크가 아닌 일반 파일만 읽을 수 있습니다.');
  if (privateOutput) assertPrivatePath(filename, info);
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (before.dev !== info.dev || before.ino !== info.ino || !before.isFile() || before.size > limit || (privateOutput && (before.nlink !== 1 || (process.platform !== 'win32' && (before.mode & 0o077))))) {
      fail('UNSAFE_FILE', '일반 파일·크기·비공개 출력 권한 조건을 확인해 주세요.');
    }
    // A finite buffer also bounds a file that grows after stat().
    const bytes = Buffer.alloc(Math.min(before.size + 1, limit + 1));
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      fail('INPUT_CHANGED', '파일을 읽는 동안 자료가 바뀌었습니다. 고정된 사본으로 다시 실행해 주세요.');
    }
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

function parseJSON(bytes) {
  let text, value;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); value = JSON.parse(text); }
  catch { fail('INVALID_JSON', '입력은 올바른 UTF-8 JSON이어야 합니다. 원문은 오류 메시지에 출력하지 않습니다.'); }
  // JSON.parse silently keeps the last duplicate member. Diagnose the complete
  // source instead of allowing an earlier table/key to disappear before planning.
  let cursor = 0;
  const whitespace = () => { while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++; };
  function stringToken() {
    const start = cursor++;
    while (cursor < text.length) {
      const char = text[cursor++];
      if (char === '\\') cursor++;
      else if (char === '"') break;
    }
    return text.slice(start, cursor);
  }
  function visit(depth) {
    if (depth > 64) fail('INVALID_JSON', '입력 JSON의 중첩 한도를 초과했습니다.');
    whitespace();
    if (text[cursor] === '{') {
      cursor++; whitespace(); const keys = new Set();
      while (text[cursor] !== '}') {
        const key = JSON.parse(stringToken());
        if (keys.has(key)) fail('DUPLICATE_JSON_KEY', '중복 JSON 항목 이름이 있어 진단을 중단했습니다. 원본은 변경하지 않습니다.');
        keys.add(key); whitespace(); cursor++; visit(depth + 1); whitespace();
        if (text[cursor] !== ',') break;
        cursor++; whitespace();
      }
      cursor++;
    } else if (text[cursor] === '[') {
      cursor++; whitespace();
      while (text[cursor] !== ']') {
        visit(depth + 1); whitespace();
        if (text[cursor] !== ',') break;
        cursor++;
      }
      cursor++;
    } else if (text[cursor] === '"') stringToken();
    else {
      const start = cursor;
      while (cursor < text.length && !/[\s,\]}]/.test(text[cursor])) cursor++;
      const token = text.slice(start, cursor);
      if (/^-?\d/.test(token)) {
        const number = Number(token);
        if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))
          || (number === 0 && /[1-9]/.test(token.split(/[eE]/)[0]))) {
          fail('INVALID_JSON_NUMBER', '정확히 처리할 수 없는 JSON 숫자가 있습니다.');
        }
      }
    }
  }
  visit(0);
  return value;
}

async function loadInputs(options) {
  const inputBytes = await readBounded(options.input, INPUT_LIMIT);
  const registryBytes = options.registry ? await readBounded(options.registry, INPUT_LIMIT) : null;
  let plan;
  try {
    plan = createIdentityPlan(parseJSON(inputBytes), {
      datasetId: options.datasetId, migrationId: options.migrationId,
      ...(registryBytes ? { registry: parseJSON(registryBytes) } : {}),
    });
  } catch (error) {
    if (error instanceof DiagnosticError) throw error;
    fail('INVALID_INPUT', '입력 형식·필수 배열·필드·자료 한도 또는 이름공간 설정을 확인해 주세요.');
  }
  if (!plan || plan.format !== 'wiki42-identity-plan-v1' || plan.ready_for_id_transition !== false
    || SECTIONS.some(section => !Array.isArray(plan[section]))) {
    fail('INVALID_PLAN', '진단기 결과 계약이 올바르지 않습니다.');
  }
  return { plan, inputHash: digest(inputBytes), registryHash: registryBytes ? digest(registryBytes) : null };
}

async function directoryLock(directory) {
  if (process.platform === 'win32') return lockWindowsDirectory(directory);
  const filename = path.join(directory, LOCK_FILE), existing = await fileInfo(filename);
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 || (process.platform !== 'win32' && (existing.mode & 0o077)))) {
    fail('UNSAFE_DIRECTORY', '안전하지 않은 진단 잠금 파일입니다.');
  }
  if (existing) assertPrivatePath(filename, existing, 'UNSAFE_DIRECTORY');
  if (!existing) {
    try { const handle = await fs.open(filename, 'wx', 0o600); await handle.close(); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  assertPrivatePath(filename, await fs.lstat(filename), 'UNSAFE_DIRECTORY');
  const db = new DatabaseSync(filename, { enableLoadExtension: false });
  try {
    db.exec('PRAGMA busy_timeout=0');
    // A RESERVED writer lock is sufficient: this coordination DB is never
    // written. Unlike EXCLUSIVE it does not race a second opener's read lock.
    db.exec('BEGIN IMMEDIATE');
    return () => { try { db.exec('ROLLBACK'); } finally { db.close(); } };
  } catch (error) {
    db.close();
    if (error.errcode === 5 || error.errcode === 6) fail('BUSY', '같은 폴더에서 진단이 실행 중입니다. 종료 후 다시 재개해 주세요.');
    throw error;
  }
}

async function prepareDirectory(options) {
  const directory = path.resolve(options.workDir);
  assertPathComponents(directory);
  const initial = await fileInfo(directory);
  if (initial && (!initial.isDirectory() || initial.isSymbolicLink())) fail('UNSAFE_DIRECTORY', '진단 폴더는 심볼릭 링크가 아닌 디렉터리여야 합니다.');
  // Resolve existing parents before creation so input files cannot become journal/output files.
  let ancestor = directory;
  const suffix = [];
  while (!(await fileInfo(ancestor))) { suffix.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  const canonicalDirectory = path.join(await fs.realpath(ancestor), ...suffix);
  for (const input of [options.input, options.registry].filter(Boolean)) {
    const relative = path.relative(canonicalDirectory, await fs.realpath(input));
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      fail('INPUT_IN_OUTPUT', '입력 자료와 진단 폴더는 서로 분리해 주세요.');
    }
  }
  preparePrivateDirectory(directory);
  const release = await directoryLock(directory);
  try {
  const allowed = name => [STATE_FILE, STATE_FILE + '-journal', REPORT_FILE, LOCK_FILE, LOCK_FILE + '-journal'].includes(name)
    || /^\.(?:plan|checkpoint)-[0-9a-f-]+\.tmp$/.test(name) || /^\.checkpoint-[0-9a-f-]+\.tmp-journal$/.test(name);
  const entries = [];
  for (const name of await fs.readdir(directory)) {
    const stat = await fs.lstat(path.join(directory, name));
    if (!allowed(name) || !stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077))) {
      fail('UNSAFE_DIRECTORY', '진단 폴더에 예상하지 못한 파일이나 안전하지 않은 출력 경로가 있습니다.');
    }
    assertPrivatePath(path.join(directory, name), stat, 'UNSAFE_DIRECTORY');
    entries.push({ name, stat });
  }
  const linkedTemps = [];
  for (const entry of entries.filter(entry => entry.stat.nlink !== 1)) {
    const peers = entries.filter(other => other.stat.ino === entry.stat.ino && other.stat.dev === entry.stat.dev);
    const artifact = peers.find(other => [REPORT_FILE, STATE_FILE].includes(other.name));
    const prefix = artifact?.name === REPORT_FILE ? 'plan' : 'checkpoint';
    const temporary = peers.find(other => new RegExp('^\\.' + prefix + '-[0-9a-f-]+\\.tmp$').test(other.name));
    if (entry.stat.nlink !== 2 || peers.length !== 2 || !artifact || !temporary) {
      fail('UNSAFE_DIRECTORY', '진단 폴더 밖의 파일과 연결된 출력은 사용하지 않습니다.');
    }
    if (!linkedTemps.some(item => item.temporary === temporary.name)) linkedTemps.push({ artifact: artifact.name, temporary: temporary.name });
  }
  const statePath = path.join(directory, STATE_FILE), existing = await fileInfo(statePath);
  if (existing && !options.resume) fail('RESUME_REQUIRED', '기존 진단 기록이 있습니다. 같은 입력으로 --resume 하거나 새 폴더를 사용해 주세요.');
  if (!existing && options.resume) fail('MISSING_CHECKPOINT', '재개할 진단 기록이 없습니다.');
  return { directory, statePath, reportPath: path.join(directory, REPORT_FILE), linkedTemps, release };
  } catch (error) { await release(); throw error; }
}

function transaction(db, run) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = run(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

async function openJournal(statePath, contract, hooks) {
  const existing = await fileInfo(statePath);
  if (!existing) {
    const temporary = path.join(path.dirname(statePath), '.checkpoint-' + randomUUID() + '.tmp');
    try {
      const handle = await fs.open(temporary, 'wx', 0o600); await handle.close();
      const initial = new DatabaseSync(temporary, { enableLoadExtension: false });
      try {
        initial.exec('PRAGMA synchronous=FULL');
        transaction(initial, () => {
          initial.exec(RUN_SCHEMA); initial.exec(RECORD_SCHEMA);
          initial.prepare('INSERT INTO diagnostic_run VALUES(1,?,0,0)').run(contract);
        });
      } finally { initial.close(); }
      await fs.link(temporary, statePath);
      await hooks.afterJournalPublished?.();
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  } else if (existing.size === 0) {
    fail('INVALID_CHECKPOINT', '기존 진단 기록이 비어 있습니다. 손상된 기록을 자동 초기화하지 않습니다.');
  }
  const db = new DatabaseSync(statePath, { enableLoadExtension: false });
  try {
    db.exec('PRAGMA busy_timeout=1000');
    db.exec('PRAGMA journal_mode=DELETE');
    db.exec('PRAGMA synchronous=FULL');
    transaction(db, () => {
      const schema = db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
      if (schema.length !== 2 || schema.some(row => row.type !== 'table')
        || schema.find(row => row.name === 'diagnostic_run')?.sql !== RUN_SCHEMA
        || schema.find(row => row.name === 'diagnostic_records')?.sql !== RECORD_SCHEMA) {
        fail('INVALID_CHECKPOINT', '진단 기록의 스키마가 다릅니다. 기존 기록을 보존하고 새 폴더를 사용해 주세요.');
      }
    });
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') fail('INVALID_CHECKPOINT', '진단 기록의 무결성 검사에 실패했습니다.');
    return db;
  } catch (error) { db.close(); throw error; }
}

function currentRun(db, contract, total) {
  const rows = db.prepare('SELECT * FROM diagnostic_run').all(), run = rows[0];
  if (rows.length !== 1 || run.id !== 1 || run.contract !== contract) {
    fail('PLAN_CHANGED', '입력 자료·설정·진단기 버전이 이전 기록과 다릅니다. 기존 기록을 보존하고 새 폴더에서 실행해 주세요.');
  }
  if (!Number.isSafeInteger(run.next_record) || run.next_record < 0 || run.next_record > total
    || ![0, 1].includes(run.complete) || (run.complete && run.next_record !== total)) {
    fail('INVALID_CHECKPOINT', '재개 위치가 올바르지 않습니다.');
  }
  return run;
}

function validatePrefix(db, contract, records) {
  const run = currentRun(db, contract, records.length);
  const rows = db.prepare('SELECT position,payload FROM diagnostic_records ORDER BY position').all();
  if (rows.length !== run.next_record || rows.some((row, index) => row.position !== index || row.payload !== records[index])) {
    fail('INVALID_CHECKPOINT', '완료된 진단 기록이 입력에서 다시 계산한 결과와 다릅니다. 덮어쓰지 않습니다.');
  }
  return run;
}

async function publishReport(reportPath, reportBytes, hooks) {
  if (await fileInfo(reportPath)) {
    const existing = await readBounded(reportPath, REPORT_LIMIT, true);
    if (!existing.equals(reportBytes)) fail('OUTPUT_CONFLICT', '기존 보고서가 계산 결과와 다릅니다. 덮어쓰지 않습니다.');
    return;
  }
  const temporary = path.join(path.dirname(reportPath), '.plan-' + randomUUID() + '.tmp');
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(reportBytes); await handle.sync(); }
    finally { await handle.close(); }
    // link() publishes exclusively: an unrelated report is never replaced.
    try { await fs.link(temporary, reportPath); await hooks.afterReportLinked?.(); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await publishReport(reportPath, reportBytes, hooks); }
  } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** Resumes diagnostic output only; never migrates a wiki database. Hooks are for failure injection. */
export async function runDiagnostic(options, hooks = {}) {
  const chunkSize = options.chunkSize ?? 100;
  const stopAfterChunks = options.stopAfterChunks ?? null;
  if (!options.input || !options.workDir || !options.datasetId || !options.migrationId
    || !Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 1000
    || (stopAfterChunks !== null && (!Number.isSafeInteger(stopAfterChunks) || stopAfterChunks < 1))) {
    fail('INVALID_OPTIONS', '입력·데이터 집합·이관 세대·진단 폴더와 올바른 청크 범위가 필요합니다.');
  }
  const loaded = await loadInputs(options), { plan } = loaded;
  const reportBytes = Buffer.from(serializeIdentityPlan(plan) + '\n');
  if (reportBytes.length > REPORT_LIMIT) fail('REPORT_TOO_LARGE', '진단 보고서가 지원 크기를 초과합니다.');
  const records = SECTIONS.flatMap(section => plan[section].map((value, index) => stable({ section, index, value })));
  const contract = stable({ format: 'wiki42-diagnostic-journal-v1', planner_version: plan.planner_version,
    dataset_id: plan.dataset_id, migration_id: plan.migration_id, source_fingerprint: plan.source_fingerprint,
    registry_fingerprint: plan.registry_fingerprint, plan_fingerprint: plan.plan_fingerprint,
    report_sha256: digest(reportBytes), total_records: records.length });
  const { directory, statePath, reportPath, linkedTemps, release } = await prepareDirectory(options);
  let db;
  const emit = hooks.emit ?? (() => {});
  try {
    db = await openJournal(statePath, contract, hooks);
    const initial = transaction(db, () => validatePrefix(db, contract, records));
    // A crash after exclusive link publication may leave its temporary hard link.
    // Only the exact, recomputed report and its in-directory peer can be recovered.
    if (linkedTemps.some(item => item.artifact === REPORT_FILE)) {
      const bytes = await readBounded(reportPath, REPORT_LIMIT);
      if (!bytes.equals(reportBytes)) fail('OUTPUT_CONFLICT', '중단된 보고서가 계산 결과와 다릅니다. 보존하고 새 폴더를 사용해 주세요.');
    }
    for (const item of linkedTemps) await fs.unlink(path.join(directory, item.temporary));
    // A final report can survive a crash before the completion flag. Validate, never replace it.
    if (await fileInfo(reportPath)) {
      const existing = await readBounded(reportPath, REPORT_LIMIT, true);
      if (!existing.equals(reportBytes)) fail('OUTPUT_CONFLICT', '기존 보고서가 계산 결과와 다릅니다. 덮어쓰지 않습니다.');
    }
    emit({ event: 'started', resumed: !!options.resume, completed_records: initial.next_record, total_records: records.length });
    let chunks = 0;
    while (true) {
      const progress = transaction(db, () => {
        const run = currentRun(db, contract, records.length);
        if (run.next_record === records.length) return null;
        const end = Math.min(records.length, run.next_record + chunkSize);
        const insert = db.prepare('INSERT INTO diagnostic_records(position,payload) VALUES(?,?)');
        for (let i = run.next_record; i < end; i++) insert.run(i, records[i]);
        db.prepare('UPDATE diagnostic_run SET next_record=? WHERE id=1').run(end);
        hooks.beforeChunkCommit?.({ completed_records: end });
        return end;
      });
      if (progress === null) break;
      chunks++;
      emit({ event: 'checkpoint', completed_records: progress, total_records: records.length });
      await hooks.afterCheckpoint?.({ completed_records: progress });
      if (stopAfterChunks !== null && chunks >= stopAfterChunks) {
        emit({ event: 'interrupted', completed_records: progress, total_records: records.length });
        return { exitCode: 75, directory, completed_records: progress, total_records: records.length };
      }
      await yieldTurn();
    }
    // Do not publish a report if input/registry bytes changed during this invocation.
    const currentInput = await readBounded(options.input, INPUT_LIMIT);
    const currentRegistry = options.registry ? await readBounded(options.registry, INPUT_LIMIT) : null;
    if (digest(currentInput) !== loaded.inputHash || (currentRegistry ? digest(currentRegistry) : null) !== loaded.registryHash) {
      fail('INPUT_CHANGED', '진단 중 입력 또는 설정이 바뀌었습니다. 보고서를 발행하지 않았습니다.');
    }
    transaction(db, () => validatePrefix(db, contract, records));
    await publishReport(reportPath, reportBytes, hooks);
    transaction(db, () => {
      validatePrefix(db, contract, records);
      db.prepare('UPDATE diagnostic_run SET complete=1 WHERE id=1').run();
      hooks.beforeCompletionCommit?.();
    });
    const blockers = plan.issues.filter(issue => issue.severity === 'blocker').length;
    const warnings = plan.issues.filter(issue => issue.severity === 'warning').length;
    emit({ event: 'complete', blockers, warnings, total_records: records.length,
      plan_fingerprint: plan.plan_fingerprint, ready_for_id_transition: false, report: REPORT_FILE });
    return { exitCode: blockers ? 2 : 0, directory, blockers, warnings, completed_records: records.length, total_records: records.length };
  } finally { try { db?.close(); } finally { await release(); } }
}

function argumentsFrom(argv) {
  const values = {}, names = new Map([
    ['--input', 'input'], ['--work-dir', 'workDir'], ['--dataset-id', 'datasetId'],
    ['--migration-id', 'migrationId'], ['--registry', 'registry'],
    ['--chunk-size', 'chunkSize'], ['--stop-after-chunks', 'stopAfterChunks'],
  ]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help') { values.help = true; continue; }
    if (flag === '--resume') { if (values.resume) fail('INVALID_OPTIONS', '중복 인수입니다.'); values.resume = true; continue; }
    const key = names.get(flag), value = argv[++i];
    if (!key || key in values || !value || value.startsWith('--')) fail('INVALID_OPTIONS', '알 수 없거나 중복되거나 값이 없는 인수입니다.');
    values[key] = ['chunkSize', 'stopAfterChunks'].includes(key) ? (/^[1-9]\d*$/.test(value) ? Number(value) : NaN) : value;
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try {
    const options = argumentsFrom(process.argv.slice(2));
    if (options.help) {
      process.stdout.write('Offline Wiki42 diagnostic. No hosted DB/R2/network access.\n'
        + 'node scripts/wiki-identity-diagnose.mjs --input backup.json --dataset-id LABEL --migration-id LABEL --work-dir work/identity [--registry registry.json] [--chunk-size 100] [--resume] [--stop-after-chunks N]\n'
        + 'Exit: 0 completed, 2 completed with blockers, 75 interrupted, 1 input/checkpoint error. plan.json is a diagnostic proposal, never an executable migration.\n');
    } else {
      const result = await runDiagnostic(options, { emit: event => process.stdout.write(JSON.stringify(event) + '\n') });
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error instanceof DiagnosticError || error instanceof PrivatePathError ? error.code : 'DIAGNOSTIC_FAILED',
      message: error instanceof DiagnosticError || error instanceof PrivatePathError ? error.message : '진단에 실패했습니다. 입력과 로컬 진단 기록을 보존하고 확인해 주세요.' }) + '\n');
    process.exitCode = 1;
  }
}

// Narrow shared I/O for the isolated migration CLI; diagnostic behavior is unchanged.
export { fileInfo as offlineFileInfo, readBounded as readOfflineFile,
  parseJSON as parseOfflineJSON, directoryLock as lockOfflineDirectory };
