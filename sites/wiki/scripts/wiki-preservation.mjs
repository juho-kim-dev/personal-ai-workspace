#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { inspectPackage, importPackage, exportPackage, createDemoPackage } from './lib/wiki-preservation.mjs';

const HELP = {
  runtime: 'Node.js 22+; offline filesystem bundles only',
  commands: [
    'inspect --package DIR [--report NEWFILE]',
    'import --package DIR --store DIR',
    'export --store DIR --package-id SHA256 --out NEWDIR',
    'demo --out NEWDIR',
    '--help',
  ],
  exit_codes: { success: 0, command_or_io_failure: 1, invalid_inspection: 2 },
  notes: ['JSON stdout; errors are JSON on stderr.', 'No overwrite, merge, delete, rendering or network commands.'],
};
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
const norm = p => process.platform === 'win32' ? p.toLowerCase() : p;
async function maybeStat(p) {
  try { return await fs.lstat(p); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Reports are also untrusted output paths. This is intentionally independent of
// the four-operation module API and never creates missing parent directories.
async function reportSourceBoundary(packageDir) {
  if (typeof packageDir !== 'string' || !packageDir || packageDir.length > 4096 || /[\x00-\x1f]/.test(packageDir)) fail('PATH_INVALID', 'Invalid package path for report output.');
  if (/^(?:\\\\|\/\/|[a-z]+:\/\/)/i.test(packageDir) || /^[A-Za-z]:(?![\\/])/.test(packageDir)) fail('PATH_INVALID', 'Network/device/URL package paths are forbidden.');
  if (process.platform !== 'win32' && packageDir.includes('\\')) fail('PATH_INVALID', 'Backslashes are not supported in POSIX paths.');
  const parts = packageDir.split(/[\\/]/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (process.platform === 'win32' && i === 0 && /^[A-Za-z]:$/.test(parts[i])) continue;
    if (parts[i] === '.' || parts[i] === '..' || /[:*?"<>|]/.test(parts[i]) || /[. ]$/.test(parts[i]) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(parts[i])) fail('PATH_INVALID', 'Invalid package path component for report output.');
  }
  const full = path.resolve(packageDir);
  const root = path.parse(full).root;
  if (full === root) fail('PATH_INVALID', 'Package cannot be a filesystem root.');
  const segments = full.slice(root.length).split(path.sep);
  let cursor = root;
  for (let i = -1; i < segments.length; i++) {
    if (i >= 0) cursor = path.join(cursor, segments[i]);
    const st = await maybeStat(cursor);
    if (!st) fail('PATH_MISSING', 'Package boundary cannot be established for report output.');
    if (st.isSymbolicLink() || norm(await fs.realpath(cursor)) !== norm(cursor)) fail('PATH_LINK', 'Package boundary cannot traverse links or junctions for report output.');
    if (!st.isDirectory()) fail('PATH_TYPE', 'Package boundary must be a regular directory.');
  }
  return full;
}

async function saveReport(file, packageDir, report) {
  // Inspection returns invalid reports for rejected paths. Establish the source
  // identity independently before allowing any report file to be created.
  const source = norm(await reportSourceBoundary(packageDir));
  if (typeof file !== 'string' || !file || file.length > 4096 || /[\x00-\x1f]/.test(file)) fail('PATH_INVALID', 'Invalid report path.');
  if (/^(?:\\\\|\/\/|[a-z]+:\/\/)/i.test(file) || /^[A-Za-z]:(?![\\/])/.test(file)) fail('PATH_INVALID', 'Network/device/URL paths are forbidden.');
  if (process.platform !== 'win32' && file.includes('\\')) fail('PATH_INVALID', 'Backslashes are not supported in POSIX paths.');
  const parts = file.split(/[\\/]/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (process.platform === 'win32' && i === 0 && /^[A-Za-z]:$/.test(parts[i])) continue;
    if (parts[i] === '.' || parts[i] === '..' || /[:*?"<>|]/.test(parts[i]) || /[. ]$/.test(parts[i]) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(parts[i])) fail('PATH_INVALID', 'Invalid report path component.');
  }
  const full = path.resolve(file);
  const target = norm(full);
  if (target === source || target.startsWith(source + path.sep) || source.startsWith(target + path.sep)) fail('PATH_OVERLAP', 'Report must be outside the package.');
  const root = path.parse(full).root;
  if (full === root) fail('PATH_INVALID', 'Report cannot be a filesystem root.');
  const segments = full.slice(root.length).split(path.sep);
  let cursor = root;
  for (let i = -1; i < segments.length; i++) {
    if (i >= 0) cursor = path.join(cursor, segments[i]);
    const st = await maybeStat(cursor);
    if (!st) {
      if (i === segments.length - 1) break;
      fail('PATH_MISSING', 'Report parent directory does not exist.');
    }
    if (st.isSymbolicLink() || norm(await fs.realpath(cursor)) !== norm(cursor)) fail('PATH_LINK', 'Report paths cannot traverse links or junctions.');
    if (i === segments.length - 1) fail('REPORT_EXISTS', 'Report must be a new file.');
    if (!st.isDirectory()) fail('PATH_TYPE', 'Report parent must be a regular directory.');
  }
  const handle = await fs.open(full, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(report, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}

function argumentsFor(argv) {
  const [command, ...args] = argv;
  const definitions = {
    inspect: { required: ['package'], optional: ['report'] },
    import: { required: ['package', 'store'], optional: [] },
    export: { required: ['store', 'package-id', 'out'], optional: [] },
    demo: { required: ['out'], optional: [] },
  };
  if (!Object.hasOwn(definitions, command || '')) fail('ARGUMENTS', 'Unknown or missing command; use --help.');
  const definition = definitions[command]; const values = Object.create(null);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].startsWith('--') ? args[i].slice(2) : '';
    if (![...definition.required, ...definition.optional].includes(key) || Object.hasOwn(values, key)) fail('ARGUMENTS', 'Unknown or duplicate option.');
    const value = args[i + 1];
    if (!value || value.startsWith('--')) fail('ARGUMENTS', 'Each option requires one value.');
    values[key] = value;
  }
  if (definition.required.some(key => !Object.hasOwn(values, key))) fail('ARGUMENTS', 'Required option is missing; use --help.');
  return { command, values };
}
async function main() {
  const argv = process.argv.slice(2);
  if ((argv.length === 1 && argv[0] === '--help') || (argv.length === 2 && argv[1] === '--help' && ['inspect', 'import', 'export', 'demo'].includes(argv[0]))) {
    process.stdout.write(JSON.stringify(HELP, null, 2) + '\n'); return;
  }
  const { command, values: v } = argumentsFor(argv);
  if (command === 'inspect') {
    const report = await inspectPackage(v.package);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (v.report) await saveReport(v.report, v.package, report);
    if (!report.can_import) process.exitCode = 2;
    return;
  }
  const result = command === 'demo' ? await createDemoPackage(v.out)
    : command === 'import' ? await importPackage(v.package, v.store)
      : await exportPackage(v.store, v['package-id'], v.out);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
main().catch(error => {
  const code = /^[A-Z_]+$/.test(error.code || '') ? error.code : 'IO_ERROR';
  const message = code === 'IO_ERROR' ? 'Local filesystem operation failed.' : String(error.message).slice(0, 320);
  const detail = { code, message };
  for (const key of ['report', 'staging_incomplete', 'staging_id', 'staging_path', 'output_incomplete', 'cleanup_error', 'operation_completed', 'committed_result']) {
    if (Object.hasOwn(error, key)) detail[key] = error[key];
  }
  process.stderr.write(JSON.stringify({ error: detail }, null, 2) + '\n');
  process.exitCode = 1;
});
