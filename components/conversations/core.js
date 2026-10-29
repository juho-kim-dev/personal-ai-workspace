export const PAGE_SIZE=40;
export const SEARCH_SIZE=16;
export const escapeHTML=(v)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const messageId=(threadId,seq)=>`${threadId}-m${String(seq).padStart(4,'0')}`;
export const messageLink=(threadId,id,options={})=>{const params=new URLSearchParams();if(options.mode==='all')params.set('mode','all');if(options.revision)params.set('revision',options.revision);if(options.viewer)params.set('viewer',options.viewer);if(options.viewer==='pages'&&options.turn!==undefined)params.set('turn',String(options.turn));return `#/thread/${encodeURIComponent(threadId)}/message/${encodeURIComponent(id)}`+(params.size?'?'+params:'');};
export function targetSequence(thread,id,locations){return locations.find(m=>m.id===id&&m.threadId===thread.id)?.seq??null;}
export function parseRoute(hash){
 try{
  const [path,query='']=hash.replace(/^#/, '').split('?'),p=path.split('/').filter(Boolean),params=new URLSearchParams(query);
  if(!p.length)return {view:'home'};
  if(p[0]==='search')return {view:'search',mode:params.get('mode')==='all'?'all':'read',q:params.get('q')||'',scope:params.get('scope')||'all',...(['messages','threads'].includes(params.get('resultType'))?{resultType:params.get('resultType')}:{}),...(['phrase','all_terms'].includes(params.get('match'))?{match:params.get('match')}:{}),...(['body','title','all'].includes(params.get('field'))?{field:params.get('field')}:{}),...(params.get('revision')?{revision:params.get('revision')}:{}),page:Math.max(0,Math.min(9999,Number(params.get('page'))||0))};
  if(p[0]!=='thread'||!p[1])return {view:'missing'};
  for(const key of ['viewer','turn','chunk'])if(params.getAll(key).length>1)return {view:'missing'};
  const viewer=params.get('viewer');if(viewer!==null&&!['pages','scroll'].includes(viewer))return {view:'missing'};
  for(const key of ['turn','chunk']){
   const value=params.get(key);
   if(value!==null&&!(key==='turn'&&value==='leading')&&(!/^(0|[1-9]\d{0,7})$/.test(value)||Number(value)>10000000))return {view:'missing'};
  }
  return {view:'thread',thread:decodeURIComponent(p[1]),message:p[2]==='message'?decodeURIComponent(p[3]||''):null,mode:params.get('mode')==='all'?'all':'read',page:Math.max(0,Math.floor(Number(params.get('page'))||0)),revision:params.get('revision')||undefined,...(viewer?{viewer}:{}),...(params.has('turn')?{turn:params.get('turn')==='leading'?'leading':Number(params.get('turn'))}:{}),...(params.has('chunk')?{chunk:Number(params.get('chunk'))}:{})};
 }catch{return {view:'missing'};}
}

const fold=text=>text.normalize('NFC').toLowerCase();
const graphemes=new Intl.Segmenter('und',{granularity:'grapheme'});
export function searchMessages(index,query,scope='all') {const q=fold(query.trim());if(!q)return [];return index.filter(m=>(scope==='all'||m.threadId===scope)&&fold(m.text).includes(q));}
export function searchContext(index,message){const ordered=index.filter(m=>m.threadId===message.threadId).sort((a,b)=>a.seq-b.seq);const i=ordered.findIndex(m=>m.id===message.id);return {before:i>0?ordered[i-1]:null,after:i>=0?ordered[i+1]??null:null};}
// Map normalized UTF-16 offsets back to complete original graphemes; never rewrite source text.
export function matchRanges(text,query){
 const needle=fold(query.trim());if(!needle)return [];
 const offsets=[];for(const {segment,index} of graphemes.segment(text))for(let i=0;i<fold(segment).length;i++)offsets.push([index,index+segment.length]);
 const normalized=fold(text),ranges=[];let pos=0,i;
 while((i=normalized.indexOf(needle,pos))!==-1){const range=[offsets[i][0],offsets[i+needle.length-1][1]],last=ranges.at(-1);if(last&&range[0]<last[1])last[1]=range[1];else ranges.push(range);pos=i+needle.length;}
 return ranges;
}
export function snippet(text,query,max=180){
 const match=matchRanges(text,query)[0];let start=Math.max(0,(match?.[0]??0)-50),end=Math.min(text.length,Math.max(start+max,match?.[1]??0));
 for(const {segment,index} of graphemes.segment(text)){if(index<=start&&index+segment.length>start)start=index;if(index<end&&index+segment.length>end)end=index+segment.length;}
 return (start?'…':'')+text.slice(start,end)+(end<text.length?'…':'');
}
export function highlight(text,query,match='phrase'){const ranges=(match==='all_terms'?query.trim().split(/\s+/u):[query]).flatMap(term=>matchRanges(text,term)).sort((a,b)=>a[0]-b[0]),merged=[];for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}let result='',pos=0;for(const [start,end] of merged){result+=escapeHTML(text.slice(pos,start))+'<mark>'+escapeHTML(text.slice(start,end))+'</mark>';pos=end;}return result+escapeHTML(text.slice(pos));}
export class ArchiveRepository {
 constructor(fetcher=globalThis.fetch){
  // Browser fetch requires its Window receiver, not this repository instance.
  this.fetcher=(...args)=>Reflect.apply(fetcher,globalThis,args);
  this.cache=new Map();this.indexPromise=null;this.locationPromises=new Map();
 }
 async json(path){const r=await this.fetcher(path);if(!r.ok)throw new Error('데이터를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');return r.json();}
 threads(){return this.json('./data/threads.json');}
 async chunk(thread,page){const key=`${thread}/${page}`;if(this.cache.has(key)){const data=this.cache.get(key);this.cache.delete(key);this.cache.set(key,data);return data;}const data=await this.json(`./data/originals/${encodeURIComponent(thread)}/${page}.json`);this.cache.set(key,data);while(this.cache.size>8)this.cache.delete(this.cache.keys().next().value);return data;}
 async page(thread,page=0,mode='read'){page=Math.min(Math.max(0,page),Math.max(0,Math.ceil(thread.count/PAGE_SIZE)-1));const messages=await this.chunk(thread.id,page);return {page,mode,preserved:thread.count,shown:thread.count,start:thread.count?page*PAGE_SIZE+1:0,end:Math.min((page+1)*PAGE_SIZE,thread.count),messages};}
 async window(thread,seq){const page=Math.floor((seq-1)/PAGE_SIZE);return {page,messages:await this.chunk(thread.id,page)};}
 locations(thread){
  if(!this.locationPromises.has(thread.id))this.locationPromises.set(thread.id,this.json(`./data/locations/${encodeURIComponent(thread.id)}.json`).then(d=>d.messages).catch(e=>{this.locationPromises.delete(thread.id);throw e;}));
  return this.locationPromises.get(thread.id);
 }
 async resolveMessage(thread,id){
  const location=(await this.locations(thread)).find(m=>m.id===id&&m.threadId===thread.id);
  if(!location)return null;
  const messages=await this.chunk(thread.id,location.page);
  const message=messages.find(m=>m.id===id&&m.threadId===thread.id&&m.seq===location.seq);
  if(!message)throw new Error('메시지 위치 정보가 원문과 일치하지 않아요. 새로고침 후 다시 시도해 주세요.');
  return {page:location.page,messages,message};
 }
 async messageAt(thread,seq){if(!Number.isInteger(seq)||seq<1||seq>thread.count)return null;return (await this.window(thread,seq)).messages.find(m=>m.threadId===thread.id&&m.seq===seq)??null;}
 searchIndex(){if(!this.indexPromise)this.indexPromise=this.json('./data/search/index-v2.json').then(d=>d.messages).catch(e=>{this.indexPromise=null;throw e;});return this.indexPromise;}
}
