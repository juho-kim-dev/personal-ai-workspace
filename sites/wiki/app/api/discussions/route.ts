import {getChatGPTUser} from '../../chatgpt-auth';
import {WikiError} from '../../../lib/wiki';
import {boundedJSON} from '../../../lib/request-body';
import {requireCurrentWikiBrowser} from '../../../lib/wiki-browser-protocol';
import {listThreads,readThread,createThread,changeThread,recentDiscussions} from '../../../lib/discussions';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
function failure(e:unknown){return json({error:e instanceof Error?e.message:'요청을 처리하지 못했습니다.'},e instanceof WikiError?e.status:500)}
export async function GET(req:Request){try{if(!await getChatGPTUser())return json({error:'로그인이 필요합니다.'},401);const u=new URL(req.url);if(u.searchParams.get('op')==='recent')return json(await recentDiscussions(Object.fromEntries(['status','query','offset','limit'].filter(k=>u.searchParams.has(k)).map(k=>[k,u.searchParams.get(k)]))));if(u.searchParams.get('op')==='list')return json(await listThreads(u.searchParams.get('title'),u.searchParams.get('document_id')??undefined));if(u.searchParams.get('op')==='read')return json(await readThread(u.searchParams.get('id')));throw new WikiError('지원하지 않는 작업입니다.')}catch(e){return failure(e)}}
export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return json({error:'로그인이 필요합니다.'},401);
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'허용되지 않은 요청입니다.'},403);
 await requireCurrentWikiBrowser(req);
 const b=await boundedJSON(req);if(!b||typeof b!=='object'||Array.isArray(b))throw new WikiError('요청 형식을 확인해 주세요.');
 const principal={subject:user.userId,channel:'browser' as const};
 if(b.op==='create')return json(await createThread(b,principal));if(b.op==='comment')return json(await changeThread(b,true,principal));if(b.op==='status')return json(await changeThread(b,false,principal));throw new WikiError('지원하지 않는 작업입니다.');
 }catch(e){return failure(e)}}
