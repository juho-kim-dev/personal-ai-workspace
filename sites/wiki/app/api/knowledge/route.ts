import {getChatGPTUser} from '../../chatgpt-auth';
import {WikiError} from '../../../lib/wiki-store';
import {boundedJSON} from '../../../lib/request-body';
import {requireCurrentWikiBrowser} from '../../../lib/wiki-browser-protocol';
import {readKnowledge,readKnowledgeContext,recordKnowledge,applyKnowledgeProposal,scanKnowledge} from '../../../lib/wiki-knowledge';
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const failure=(error:unknown)=>json({error:error instanceof Error?error.message:'기록을 처리하지 못했습니다.'},error instanceof WikiError?error.status:500);
export async function GET(req:Request) {
    try{
        if(!await getChatGPTUser())return json({error:'로그인이 필요합니다.'},401);
        const input=Object.fromEntries(new URL(req.url).searchParams);
        return json(input.op==='context'?await readKnowledgeContext(input):await readKnowledge(input));
    }catch(error){return failure(error);}
}
export async function POST(req:Request) {
    try{
        const user=await getChatGPTUser();if(!user)return json({error:'로그인이 필요합니다.'},401);
        if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'허용되지 않은 요청입니다.'},403);
        await requireCurrentWikiBrowser(req);
        const input=await boundedJSON(req);
        if(!input||typeof input!=='object'||Array.isArray(input))throw new WikiError('요청 형식을 확인해 주세요.');
        const principal={subject:user.userId,channel:'browser' as const};
        if(input.op==='record')return json(await recordKnowledge(input,principal));
        if(input.op==='apply')return json(await applyKnowledgeProposal(input,principal));
        if(input.op==='scan')return json(await scanKnowledge(input,principal));
        throw new WikiError('지원하지 않는 작업입니다.');
    }catch(error){return failure(error);}
}
