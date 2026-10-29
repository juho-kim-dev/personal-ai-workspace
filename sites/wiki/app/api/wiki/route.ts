import { getChatGPTUser } from '../../chatgpt-auth';
import {listTrash,readTrash,trashPage,restorePage} from '../../../lib/wiki-trash';
import * as wiki from '../../../lib/wiki';
import {boundedJSON} from '../../../lib/request-body';
import {requireCurrentWikiBrowser} from '../../../lib/wiki-browser-protocol';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
function failure(e:unknown){return json({error:e instanceof Error?e.message:'요청을 처리하지 못했습니다.'},e instanceof wiki.WikiError?e.status:500)}
export async function GET(req:Request){
  try{
    if(!await getChatGPTUser())return json({error:'로그인이 필요합니다.'},401);
    const u=new URL(req.url),op=u.searchParams.get('op'),title=u.searchParams.get('title'),documentId=u.searchParams.get('document_id')??undefined;
    switch(op){
      case 'trash':return json(await listTrash());
      case 'trash_read':return json(await readTrash(title,documentId));
      case 'read':return json(await wiki.readPage(title,documentId));
      case 'history':return json(await wiki.history(title,u.searchParams.get('offset'),u.searchParams.get('limit'),documentId));
      case 'activity':return json(await wiki.activity(title,{type:u.searchParams.get('type')??undefined,offset:u.searchParams.get('offset')??undefined,limit:u.searchParams.get('limit')??undefined,document_id:documentId,from:u.searchParams.get('from')??undefined,before:u.searchParams.get('before')??undefined}));
      case 'revision':return json(await wiki.readRevision(title,u.searchParams.get('id'),documentId));
      case 'changes':return json(await wiki.recentChanges(u.searchParams.get('offset'),u.searchParams.get('limit')));
      case 'search':{const options={target:u.searchParams.get('target')||undefined,namespace:u.searchParams.get('namespace')||undefined,offset:u.searchParams.get('offset')??undefined,limit:u.searchParams.get('limit')??undefined};return json(u.searchParams.get('paged')==='true'?await wiki.searchPageWindow(u.searchParams.get('q')||'',options):await wiki.searchPages(u.searchParams.get('q')||'',options));}
      case 'backlinks':return json(await wiki.backlinks(title));
      case 'bookmarks':return json(await wiki.getBookmarks());
      case 'notes':return json(await wiki.getNotes(title,documentId));
      case 'export':return json({format:'my-wiki-v1',exported_at:new Date().toISOString(),pages:await wiki.listPages()});
      default:return json(await wiki.listPages(u.searchParams.get('q')||''));
    }
  }catch(e){return failure(e)}
}
export async function POST(req:Request){
  try{
    const user=await getChatGPTUser();if(!user)return json({error:'로그인이 필요합니다.'},401);
    if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'허용되지 않은 요청입니다.'},403);
    await requireCurrentWikiBrowser(req);
    const b=await boundedJSON(req);
    if(!b||typeof b!=='object'||Array.isArray(b))throw new wiki.WikiError('요청 형식을 확인해 주세요.');
    switch(b.op){
      case 'trash':return json(await trashPage(b));
      case 'restore':return json(await restorePage(b));
      case 'initialize':return json(await wiki.initialize());
      case 'save':return json(await wiki.savePage(b,{subject:user.userId,channel:'browser'}));
      case 'move':return json(await wiki.movePage(b));
      case 'bookmark':return json(await wiki.setBookmark(b.title,b.on,b.document_id));
      case 'note':return json(await wiki.addNote(b.title,b.body,b.document_id));
      default:throw new wiki.WikiError('지원하지 않는 작업입니다.');
    }
  }catch(e){return failure(e)}
}
