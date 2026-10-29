import {getChatGPTUser} from '../../chatgpt-auth';
import {WikiError} from '../../../lib/wiki';
import {boundedJSON} from '../../../lib/request-body';
import {requireCurrentWikiBrowser} from '../../../lib/wiki-browser-protocol';
import {exportBackup,previewBackup,importBackup,MAX_BACKUP_REQUEST_BYTES} from '../../../lib/wiki-backup';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
function failure(e:unknown){return json({error:e instanceof Error?e.message:'요청을 처리하지 못했습니다.'},e instanceof WikiError?e.status:500)}
export async function GET(){try{if(!await getChatGPTUser())return json({error:'로그인이 필요합니다.'},401);return json(await exportBackup())}catch(e){return failure(e)}}
export async function POST(req:Request){try{
 if(!await getChatGPTUser())return json({error:'로그인이 필요합니다.'},401);
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'허용되지 않은 요청입니다.'},403);
 await requireCurrentWikiBrowser(req);
 const b=await boundedJSON(req,MAX_BACKUP_REQUEST_BYTES);if(!b||typeof b!=='object'||Array.isArray(b))throw new WikiError('요청 형식을 확인해 주세요.');
 if(b.op==='preview')return json(await previewBackup(b.backup));if(b.op==='apply')return json(await importBackup(b.backup,b.fingerprint));throw new WikiError('지원하지 않는 작업입니다.');
 }catch(e){return failure(e)}}
