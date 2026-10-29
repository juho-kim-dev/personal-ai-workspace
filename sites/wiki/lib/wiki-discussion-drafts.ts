export type DiscussionDraft={subject:string;body:string;summary:string};
export const emptyDiscussionDraft=():DiscussionDraft=>({subject:'',body:'',summary:''});
// An object scope cannot collide with the legacy [title, threadId] tuple.
// A new discussion can still belong to an identified document. Both IDs are
// required so independent datasets cannot share drafts. Reply scopes retain
// their existing exact thread-ID behavior.
export const discussionDraftScope=(title:string,threadId:string,datasetId?:string|null,documentId?:string|null)=>threadId?JSON.stringify({thread:threadId}):datasetId&&documentId?JSON.stringify({dataset:datasetId,document:documentId}):JSON.stringify([title,'']);
export const discussionDraftKey=(scope:string)=>'wiki:discussion-draft:v5:'+scope;
export function parseDiscussionDraft(raw:string|null):DiscussionDraft|null{
 if(raw===null)return null;
 const d=JSON.parse(raw);if(!d||['subject','body','summary'].some(k=>typeof d[k]!=='string'))throw new Error('저장된 토론 초안을 확인할 수 없습니다.');
 return {subject:d.subject,body:d.body,summary:d.summary};
}
export function readDiscussionDraft(scope:string):DiscussionDraft|null{
 return parseDiscussionDraft(sessionStorage.getItem(discussionDraftKey(scope)));
}
export function saveDiscussionDraft(scope:string,d:DiscussionDraft){
 // An empty ID draft is a tombstone: discard/submission must not resurrect
 // preserved legacy drafts on the next visit. The token detects intervening
 // edits, including discard followed by retyping exactly the submitted text.
 if(d.subject||d.body||d.summary||scope.startsWith('{'))sessionStorage.setItem(discussionDraftKey(scope),JSON.stringify({...d,writeId:crypto.randomUUID()}));
 else sessionStorage.removeItem(discussionDraftKey(scope));
}
export type LegacyDiscussionDraft={scope:string;title:string;draft:DiscussionDraft};
export function readLegacyDiscussionDrafts(threadId:string,titles:string[]){
 const scopes=new Set(titles.map(title=>JSON.stringify([title,threadId])));
 let failed=false;
 // Discover older titles as well, including when the current address is opened
 // directly after a move. Only exact thread IDs in legacy tuples are eligible.
 try{
  for(let i=0;i<sessionStorage.length;i++){
   const key=sessionStorage.key(i);
   if(!key?.startsWith(discussionDraftKey('')))continue;
   const scope=key.slice(discussionDraftKey('').length);
   let value;try{value=JSON.parse(scope);}catch{continue;}
   if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&value[1]===threadId)scopes.add(scope);
  }
 }catch{failed=true;}
 const drafts:LegacyDiscussionDraft[]=[];
 for(const scope of scopes){
  try{const draft=readDiscussionDraft(scope);if(draft&&(draft.subject||draft.body||draft.summary))drafts.push({scope,title:JSON.parse(scope)[0],draft});}catch{failed=true;}
 }
 return {drafts,failed};
}
export const sameDiscussionDraft=(a:DiscussionDraft,b:DiscussionDraft)=>a.subject===b.subject&&a.body===b.body&&a.summary===b.summary;
export function clearSubmittedDraft(current:DiscussionDraft,submitted:DiscussionDraft,fields:(keyof DiscussionDraft)[]){
 const next={...current};for(const field of fields)if(next[field]===submitted[field])next[field]='';return next;
}
