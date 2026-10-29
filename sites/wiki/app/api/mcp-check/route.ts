import {getChatGPTUser} from '../../chatgpt-auth';
import {POST as dispatchMcp} from '../../mcp/route';
import {boundedJSON} from '../../../lib/request-body';
import {requireCurrentWikiBrowser} from '../../../lib/wiki-browser-protocol';
import {WikiError} from '../../../lib/wiki';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
// Sites' public /mcp gateway requires connector OAuth. Browser diagnostics use
// the existing signed-in Site boundary and the same server tool dispatcher.
export async function POST(req:Request){
 try{
  if(!await getChatGPTUser())return json({error:'로그인이 필요합니다.'},401);
  if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'허용되지 않은 요청입니다.'},403);
  await requireCurrentWikiBrowser(req);
  const body=await boundedJSON(req);
  if(!body||body.jsonrpc!=='2.0'||!['server/discover','initialize','tools/list','tools/call'].includes(body.method))throw new WikiError('지원하지 않는 연결 진단 요청입니다.');
  return dispatchMcp(new Request(new URL('/mcp',req.url),{method:'POST',headers:req.headers,body:JSON.stringify(body)}));
 }catch(e){return json({error:e instanceof Error?e.message:'연결을 확인할 수 없습니다.'},e instanceof WikiError?e.status:500);}
}
