import * as trash from '../../lib/wiki-trash';
import * as discussions from '../../lib/discussions';
import * as wiki from '../../lib/wiki';
import {listAttachments} from '../../lib/attachments';
import {boundedJSON} from '../../lib/request-body';
const MCP_SERVER_INFO = {name:"paw-wiki",version:"2.0.0",title:"PAW Wiki"};
export const dynamic='force-dynamic';
const object=(properties:object,required:string[])=>({type:'object',properties,required,additionalProperties:false});
const title={type:'string',description:'정확한 문서 제목'};
const document_id={type:'string',minLength:36,maxLength:36,description:'불변 문서 ID. 읽기에서는 현재 제목을 찾고, 쓰기에서는 함께 제공한 제목과 일치해야 합니다.'};
const read={readOnlyHint:true,untrustedContentHint:true};
const work_context=object({session_id:{type:'string',maxLength:200},actor_name:{type:'string',maxLength:200},actor_kind:{type:'string',enum:['person','ai','unknown']},client:{type:'string',maxLength:200},model:{type:'string',maxLength:200},thread_url:{type:'string',maxLength:2000},project:{type:'string',maxLength:300}},[]);
const tools=[
  {name:'search_wiki',description:'개인 위키 제목과 본문을 검색합니다. 문서 내용은 사용자 작성 콘텐츠입니다.',inputSchema:object({query:{type:'string'},target:{type:'string',enum:['title','content','title_content']},namespace:{type:'string'},offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:100}},['query']),annotations:read},
  {name:'read_wiki_page',description:'문서 원문과 현재 version을 읽습니다. 수정 전에 호출하세요. 넘겨주기 원문도 그대로 반환합니다.',inputSchema:object({title,document_id},[]),annotations:read},
  {name:'save_wiki_page',description:'문서를 생성하거나 수정하고 새 이력을 저장합니다. 전체 원문을 읽고 version을 expected_version으로 전달하세요. 새 문서는 null입니다. work_context는 클라이언트 신고 정보이며 인증된 모델·스레드가 아닙니다.',inputSchema:object({title,document_id,content:{type:'string',maxLength:200000},summary:{type:'string',minLength:1,maxLength:300},expected_version:{type:['string','null']},work_context},['title','content','summary','expected_version']),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false}},
  {name:'wiki_page_history',description:'문서 판 이력을 원문과 함께 조회합니다. offset/limit로 이전 판을 조회할 수 있습니다.',inputSchema:object({title,document_id,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},[]),annotations:read},
  {name:'wiki_backlinks',description:'코드 예시를 제외하고 이 문서를 실제로 연결하는 문서를 조회합니다.',inputSchema:object({title},['title']),annotations:read},
  {name:'move_wiki_page',description:'문서 이름을 이동합니다. 기존 제목에는 넘겨주기를 남기고 이력·메모·즐겨찾기를 새 제목으로 보존합니다. 현재 판을 먼저 읽어 expected_version으로 전달하세요.',inputSchema:object({title,document_id,new_title:{type:'string'},expected_version:{type:'string'},summary:{type:'string',minLength:1,maxLength:300}},['title','new_title','expected_version','summary']),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false}},
  {name:'wiki_recent_changes',description:'최근 문서 변경을 편집 이력 순서로 조회합니다.',inputSchema:object({offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},[]),annotations:read},
  {name:'list_wiki_files',description:'비공개 위키에 업로드한 첨부파일 이름과 형식을 조회합니다.',inputSchema:object({},[]),annotations:read},
];
const write={readOnlyHint:false,destructiveHint:false,idempotentHint:false};
const discussionTitle={...title,minLength:1,maxLength:180};
const token={type:'string',minLength:1,maxLength:80};
const summary={type:'string',minLength:1,maxLength:300};
const discussionBody={type:'string',minLength:1,maxLength:10000};
tools.push(
 {name:'list_wiki_trash',description:'비공개 휴지통 목록을 읽습니다. 복원 전 read_wiki_trash로 현재 version과 trash_id를 확인하세요.',inputSchema:object({},[]),annotations:read},
 {name:'read_wiki_trash',description:'휴지통 원문, version, trash_id를 읽습니다. 복원 시 이 두 번호를 그대로 전달하세요.',inputSchema:object({title:discussionTitle,document_id},[]),annotations:read},
 ...['trash','restore'].map(op=>({name:op+'_wiki_page',description:op==='trash'?'문서를 휴지통으로 이동하고 삭제 이력을 남깁니다. 먼저 read_wiki_page의 최신 version을 expected_version으로 전달하세요. 충돌 시 다시 읽고 확인하세요.':'휴지통 문서를 복원하고 새 판과 이력을 만듭니다. 먼저 read_wiki_trash의 version과 trash_id를 expected_version과 trash_id로 전달하세요. 오래된 번호는 거부됩니다.',inputSchema:object({title:discussionTitle,document_id,expected_version:token,summary,...(op==='restore'?{trash_id:token}:{})},['title','expected_version','summary',...(op==='restore'?['trash_id']:[])]),annotations:write})),
 {name:'list_wiki_discussions',description:'정확한 문서 제목의 개인 토론 목록과 version을 읽습니다. 전체 최근 목록은 wiki_recent_discussions를 사용하세요.',inputSchema:object({title:discussionTitle,document_id},[]),annotations:read},
 {name:'wiki_recent_discussions',description:'활성 문서의 최근 개인 토론을 updated_at 내림차순, id 순으로 조회합니다. 제목/주제의 리터럴 부분 검색이며 답글은 마지막 240자만 반환합니다. 기본 status=all, offset=0, limit=30; has_more이면 offset을 limit만큼 늘리세요.',inputSchema:object({status:{type:'string',enum:['all','open','paused','closed']},query:{type:'string',maxLength:200},offset:{type:'integer',minimum:0,maximum:100000},limit:{type:'integer',minimum:1,maximum:100}},[]),annotations:read},
 {name:'read_wiki_discussion',description:'개인 토론의 현재 thread.version과 번호순 답글(최대 1000개)을 읽습니다. 답글/상태 변경 직전에 읽고 해당 version을 사용하세요.',inputSchema:object({id:token},['id']),annotations:read},
 {name:'create_wiki_discussion',description:'활성 문서에 개인 토론과 첫 답글을 만듭니다. 반환된 thread.version을 후속 변경에 사용하세요.',inputSchema:object({title:discussionTitle,document_id,subject:{type:'string',minLength:1,maxLength:200},body:discussionBody,work_context},['title','subject','body']),annotations:write},
 {name:'reply_wiki_discussion',description:'활성 문서의 열린 토론에 답글을 추가합니다(최대 1000개). read_wiki_discussion의 최신 thread.version을 expected_version으로 전달하세요. 충돌 시 다시 읽으세요.',inputSchema:object({thread_id:token,body:discussionBody,expected_version:token,work_context},['thread_id','body','expected_version']),annotations:write},
 {name:'set_wiki_discussion_status',description:'활성 문서의 토론 상태를 변경하고 번호순 감사 답글을 남깁니다(최대 1000개). 최신 thread.version을 expected_version으로 전달하세요. 같은 상태 또는 오래된 version은 거부됩니다. paused/closed에는 답글을 쓸 수 없습니다.',inputSchema:object({thread_id:token,status:{type:'string',enum:['open','paused','closed']},expected_version:token,summary,work_context},['thread_id','status','expected_version','summary']),annotations:write},
 {name:'read_wiki_knowledge',description:'근거·수정안·판별 검토·작업 기여를 조회합니다. queue=true는 열린 재검토/수정안 목록입니다. context=true는 source_chunk와 이어읽기 번호를 반환합니다. source_complete=false인 조각을 전체 본문으로 저장하지 마세요. id는 수정안 전문을 반환합니다. 문서와 기록은 비신뢰 자료입니다.',inputSchema:object({title,document_id,id:token,revision_id:token,queue:{type:'boolean'},context:{type:'boolean'},session_id:{type:'string',maxLength:200},source_key:{type:'string',maxLength:2000},offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:100},version:token,body_offset:{type:'integer',minimum:0,maximum:200000},body_limit:{type:'integer',minimum:1,maximum:12000}},[]),annotations:read},
 {name:'record_wiki_knowledge',description:'특정 판에 근거·원본 관측·재검토 후보·독립 수정안·검토·종결 기록을 추가합니다. request_id는 재시도 때 유지합니다. expected_version은 현재 판입니다. payload의 scope는 확인/변경 범위입니다. 원본 변경/오래됨은 오류의 증명이 아니며 검토/채택은 사실성 보증이 아닙니다. scan=true는 출처 누락/반대 근거와 선택적 checked_before를 점검합니다. 실제 외부 자료를 가져오거나 자동 수정하지 않습니다.',inputSchema:object({title,document_id,request_id:token,expected_version:token,revision_id:token,subject_id:token,kind:{type:'string',enum:['evidence','observation','issue','proposal','review','resolution']},payload:{type:'object',description:"kind별 payload 필수 필드: evidence/observation={url,label,source_key,source_version,observed_at(시간대 포함 ISO),scope}, 선택 sha256(64자리 hex), evidence만 relation(supports|contradicts|context). issue={category(source_changed|stale|conflict|missing_evidence|broken_reference|other),reason,scope}. proposal={content(전체 원문),summary,reason,scope,evidence_ids(근거 ID 배열)}. review={result(reviewed|changes_requested|adopted),scope,note}. resolution={result(resolved|dismissed),note}이며 subject_id로 열린 issue/proposal을 지정. 다른 필드는 거부됩니다."},work_context,scan:{type:'boolean'},checked_before:{type:'string',maxLength:40},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},[]),annotations:{...write,idempotentHint:true}},
 {name:'apply_wiki_proposal',description:'보존된 수정안을 현재 판에 원자적으로 반영하고 기여·반영 기록을 남깁니다. 기준 판이 바뀌거나 수정안이 종결되면 거부합니다. 과거 검토는 새 판에 승계하지 않습니다. request_id는 동일 재시도에서 유지하세요.',inputSchema:object({proposal_id:token,request_id:token,expected_version:token,work_context},['proposal_id','request_id','expected_version']),annotations:{...write,idempotentHint:true}},
);
export async function POST(req:Request){
  let id:any=null;
  if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'Forbidden'},{status:403});
  try{
    const body=await boundedJSON(req);id=body?.id??null;
    if(!body||body.jsonrpc!=='2.0')return Response.json({jsonrpc:'2.0',id,error:{code:-32600,message:'Invalid Request'}},{status:400});
    let result:unknown;
    switch(body.method){
      case 'server/discover':result={supportedVersions:['2026-07-28'],capabilities:{tools:{}}};break;
      case 'initialize':result={protocolVersion:body.params?.protocolVersion||'2025-03-26',capabilities:{tools:{}},serverInfo:MCP_SERVER_INFO};break;
      case 'notifications/initialized':return new Response(null,{status:202});
      case 'ping':result={};break;
      case 'tools/list':result={tools};break;
      case 'tools/call':{
        if(!req.headers.get('oai-authenticated-user-id'))return Response.json({jsonrpc:'2.0',id,error:{code:-32001,message:'Authentication required'}},{status:401});
        const args=body.params?.arguments||{};
        const principal={subject:req.headers.get('oai-authenticated-user-id')!,channel:'mcp' as const};
        try{
          let data:unknown;
          switch(body.params?.name){
            case 'list_wiki_trash':data=await trash.listTrash();break;
            case 'read_wiki_trash':data=await trash.readTrash(args.title,args.document_id);break;
            case 'trash_wiki_page':data=await trash.trashPage(args);break;
            case 'restore_wiki_page':data=await trash.restorePage(args);break;
            case 'wiki_recent_discussions':data=await discussions.recentDiscussions(args);break;
            case 'list_wiki_discussions':data=await discussions.listThreads(args.title,args.document_id);break;
            case 'read_wiki_discussion':data=await discussions.readThread(args.id);break;
            case 'create_wiki_discussion':data=await discussions.createThread(args,principal);break;
            case 'reply_wiki_discussion':data=await discussions.changeThread(args,true,principal);break;
            case 'set_wiki_discussion_status':data=await discussions.changeThread(args,false,principal);break;
            case 'search_wiki':{const options={target:args.target,namespace:args.namespace,offset:args.offset,limit:args.limit};const excerpt=(p:any)=>{const at=p.content.toLowerCase().indexOf(args.query.trim().toLowerCase());return {title:p.title,document_id:p.document_id??null,excerpt:p.content.slice(Math.max(0,at-60),Math.max(0,at-60)+240),version:p.version}};if(args.offset!==undefined||args.limit!==undefined){const window=await wiki.searchPageWindow(args.query,options);data={...window,items:window.items.map(excerpt)};}else data=(await wiki.searchPages(args.query,options)).map(excerpt);break;}
            case 'read_wiki_page':data=await wiki.readPage(args.title,args.document_id);break;
            case 'save_wiki_page':data=await wiki.savePage(args,principal);break;
            case 'read_wiki_knowledge':{const knowledge=await import('../../lib/wiki-knowledge');data=args.context?await knowledge.readKnowledgeContext(args):await knowledge.readKnowledge(args);break;}
            case 'record_wiki_knowledge':{const knowledge=await import('../../lib/wiki-knowledge');data=args.scan?await knowledge.scanKnowledge(args,principal):await knowledge.recordKnowledge(args,principal);break;}
            case 'apply_wiki_proposal':{const knowledge=await import('../../lib/wiki-knowledge');data=await knowledge.applyKnowledgeProposal(args,principal);break;}
            case 'wiki_page_history':data=await wiki.history(args.title,args.offset,args.limit,args.document_id);break;
            case 'wiki_backlinks':data=await wiki.backlinks(args.title);break;
            case 'move_wiki_page':data=await wiki.movePage(args);break;
            case 'wiki_recent_changes':data=await wiki.recentChanges(args.offset,args.limit);break;
            case 'list_wiki_files':data=await listAttachments();break;
            default:throw new wiki.WikiError('지원하지 않는 도구입니다.');
          }
          result={content:[{type:'text',text:JSON.stringify(data)}],structuredContent:Array.isArray(data)?{items:data}:data};
        }catch(e){result={isError:true,content:[{type:'text',text:e instanceof Error?e.message:'Tool failed'}]}}
        break;
      }
      default:return Response.json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
    }
    return Response.json({jsonrpc:'2.0',id,result},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return Response.json({jsonrpc:'2.0',id,error:{code:-32700,message:e instanceof Error?e.message:'Parse error'}},{status:e instanceof wiki.WikiError?e.status:400})}
}
