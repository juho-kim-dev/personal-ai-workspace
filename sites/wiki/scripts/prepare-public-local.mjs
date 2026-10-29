import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './sites-env.mjs';
import path from 'node:path';
const manifest=path.join(projectRoot,'.openai/hosting.json');
let existing;try{existing=JSON.parse(await readFile(manifest,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(existing?.project_id)throw new Error('This setup is local-only; a deployed Site identity must not be reused.');
await mkdir(path.dirname(manifest),{recursive:true});
await writeFile(manifest,await readFile(path.join(projectRoot,'hosting.template.json')));
const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config','wrangler.local.json','--persist-to','.wrangler/state'],{cwd:projectRoot,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
