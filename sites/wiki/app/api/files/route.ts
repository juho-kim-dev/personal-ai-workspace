import {getChatGPTUser} from '../../chatgpt-auth';
import {WikiError} from '../../../lib/wiki';
import {boundedBody} from '../../../lib/request-body';
import {requireCurrentWikiBrowser} from '../../../lib/wiki-browser-protocol';
import {downloadAttachment,listAttachments,MAX_FILE_BYTES,uploadAttachment} from '../../../lib/attachments';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const failure=(e:unknown)=>json({error:e instanceof Error?e.message:'파일 요청을 처리하지 못했습니다.'},e instanceof WikiError?e.status:500);
export async function GET(req:Request){try{if(!await getChatGPTUser())return json({error:'로그인이 필요합니다.'},401);const name=new URL(req.url).searchParams.get('name');return name?await downloadAttachment(name):json(await listAttachments())}catch(e){return failure(e)}}
export async function POST(req:Request){
  try{
    if(!await getChatGPTUser())return json({error:'로그인이 필요합니다.'},401);
    if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)throw new WikiError('허용되지 않은 요청입니다.',403);
    await requireCurrentWikiBrowser(req);
    const bytes=await boundedBody(req,MAX_FILE_BYTES+65536);
    const replay=new Request(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('content-type')||''},body:bytes});
    let form:FormData;try{form=await replay.formData()}catch{throw new WikiError('파일 업로드 형식을 확인해 주세요.')}
    const file=form.get('file');if(!(file instanceof File))throw new WikiError('업로드할 파일을 선택해 주세요.');
    const name=form.get('name');return json(await uploadAttachment(typeof name==='string'&&name.trim()?name:file.name,new Uint8Array(await file.arrayBuffer())),201);
  }catch(e){return failure(e)}
}
