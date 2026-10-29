import type { VaultFile } from './api.ts';
import {noteName} from './notes.ts';
import {createLinkResolver, extractNoteMetadata, safeNotePath, type NoteMetadata} from './note-metadata.ts';
import {compileSearchQuery} from './search-query.ts';

export const GRAPH_LIMITS = {nodes:360, links:1800, positions:360, groups:12, query:512, scaleMin:1/128, scaleMax:8} as const;
export type Point = {x:number;y:number};
export type GraphNode = {id:string; label:string; kind:'file'|'attachment'|'missing'|'tag'; path?:string; degree:number; x:number;y:number};
export type GraphLink = {from:string;to:string;forward:boolean;backward:boolean};
export type GraphData = {nodes:GraphNode[];links:GraphLink[];partial:string[];error?:string};
export type GraphGroup = {id:string;query:string;color:string};
export type GraphOptions = {tags:boolean;attachments:boolean;existingOnly:boolean;orphans:boolean;arrows:boolean;labelThreshold:number;nodeSize:number;linkWidth:number;centerForce:number;repulsion:number;linkForce:number;linkDistance:number};
export type GraphViewState = {query:string;options:GraphOptions;groups:GraphGroup[];positions:Record<string,Point>;viewport:{center:Point;scale:number};panelOpen:boolean};
export const defaultGraphOptions:GraphOptions = {tags:false,attachments:false,existingOnly:false,orphans:true,arrows:false,labelThreshold:0,nodeSize:1,linkWidth:1,centerForce:.518713248970312,repulsion:10,linkForce:1,linkDistance:250};
export function defaultGraphState():GraphViewState {return {query:'',options:{...defaultGraphOptions},groups:[],positions:{},viewport:{center:{x:0,y:0},scale:1},panelOpen:true};}
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const point=(v:unknown):v is Point=>!!v&&typeof v==='object'&&Object.keys(v).length===2&&finite((v as Point).x,-1e6,1e6)&&finite((v as Point).y,-1e6,1e6);
const bounds:Record<keyof GraphOptions,[number,number]|'boolean'>={tags:'boolean',attachments:'boolean',existingOnly:'boolean',orphans:'boolean',arrows:'boolean',labelThreshold:[-3,3],nodeSize:[.1,5],linkWidth:[.1,5],centerForce:[0,1],repulsion:[0,20],linkForce:[0,1],linkDistance:[30,500]};
export function validGraphState(v:unknown):v is GraphViewState {
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const s=v as GraphViewState;
  if(Object.keys(s).some(k=>!['query','options','groups','positions','viewport','panelOpen'].includes(k))||typeof s.query!=='string'||s.query.length>GRAPH_LIMITS.query||typeof s.panelOpen!=='boolean'||!s.options||typeof s.options!=='object'||Object.keys(s.options).length!==Object.keys(bounds).length)return false;
  for(const [k,b] of Object.entries(bounds)){const value=s.options[k as keyof GraphOptions];if(b==='boolean'?typeof value!=='boolean':!finite(value,b[0],b[1]))return false;}
  if(!Array.isArray(s.groups)||s.groups.length>GRAPH_LIMITS.groups||!s.groups.every(g=>g&&Object.keys(g).sort().join()=='color,id,query'&&typeof g.id==='string'&&/^[\w-]{1,40}$/.test(g.id)&&typeof g.query==='string'&&g.query.length<=GRAPH_LIMITS.query&&typeof g.color==='string'&&/^#[0-9a-fA-F]{6}$/.test(g.color))||new Set(s.groups.map(g=>g.id)).size!==s.groups.length)return false;
  if(!s.positions||typeof s.positions!=='object'||Array.isArray(s.positions)||Object.keys(s.positions).length>GRAPH_LIMITS.positions||!Object.entries(s.positions).every(([id,p])=>id.length<=1024&&point(p)))return false;
  return !!s.viewport&&Object.keys(s.viewport).sort().join()==='center,scale'&&point(s.viewport.center)&&finite(s.viewport.scale,GRAPH_LIMITS.scaleMin,GRAPH_LIMITS.scaleMax);
}
export function graphSeed(id:string):Point {let h=2166136261;for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619);const a=(h>>>0)/4294967296*Math.PI*2;const r=35+((h>>>8)%190);return {x:Math.cos(a)*r,y:Math.sin(a)*r};}
export function screenPoint(p:Point,view:GraphViewState['viewport'],width:number,height:number):Point{return {x:(p.x-view.center.x)*view.scale+width/2,y:(p.y-view.center.y)*view.scale+height/2};}
export function worldPoint(p:Point,view:GraphViewState['viewport'],width:number,height:number):Point{return {x:(p.x-width/2)/view.scale+view.center.x,y:(p.y-height/2)/view.scale+view.center.y};}
export function wheelDelta(delta:number,mode:number):number {return Number.isFinite(delta)?Math.max(-1e6,Math.min(1e6,delta*(mode===1?40:mode===2?800:1))):0;}
export function wheelFactor(delta:number):number {return Math.pow(1.5,Math.max(-2400,Math.min(2400,-delta))/120);}
const validView=(v:GraphViewState['viewport'])=>!!v&&point(v.center)&&finite(v.scale,GRAPH_LIMITS.scaleMin,GRAPH_LIMITS.scaleMax);
const clampPoint=(p:Point):Point=>({x:Math.max(-1e6,Math.min(1e6,p.x)),y:Math.max(-1e6,Math.min(1e6,p.y))});
export function zoomViewport(view:GraphViewState['viewport'],factor:number,anchor:Point,width:number,height:number):GraphViewState['viewport'] {
  if(!validView(view)||!point(anchor)||!Number.isFinite(factor)||factor<=0||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return view;
  const before=worldPoint(anchor,view,width,height),scale=Math.max(GRAPH_LIMITS.scaleMin,Math.min(GRAPH_LIMITS.scaleMax,view.scale*factor));
  const center=clampPoint({x:before.x-(anchor.x-width/2)/scale,y:before.y-(anchor.y-height/2)/scale});
  return Number.isFinite(center.x)&&Number.isFinite(center.y)?{scale,center}:view;
}
export function panViewport(view:GraphViewState['viewport'],dx:number,dy:number):GraphViewState['viewport'] {if(!validView(view)||!Number.isFinite(dx)||!Number.isFinite(dy))return view;return {scale:view.scale,center:clampPoint({x:view.center.x-dx/view.scale,y:view.center.y-dy/view.scale})};}
export function buildGraph(index:Record<string,string>,files:VaultFile[],state:GraphViewState,metadata?:Record<string,NoteMetadata>):GraphData {
  const partial:string[]=[],nodes:GraphNode[]=[],links:GraphLink[]=[],seen=new Set<string>();
  const safeFiles=files.filter(f=>safeNotePath(f.path));
  const byPath=new Map(safeFiles.map(f=>[f.path,f])),resolve=createLinkResolver(safeFiles);
  let query;try{query=compileSearchQuery(state.query);}catch(e){return {nodes:[],links:[],partial,error:String(e)}}
  const add=(id:string,kind:GraphNode['kind'],path?:string)=>{if(id.length>1024){if(!partial.includes('긴 노드 ID 제외'))partial.push('긴 노드 ID 제외');return false;}if(seen.has(id))return true;if(nodes.length>=GRAPH_LIMITS.nodes){if(!partial.includes('노드 360개 상한'))partial.push('노드 360개 상한');return false;}seen.add(id);nodes.push({id,label:kind==='file'||kind==='attachment'?noteName(path!):id.split(':').slice(1).join(':'),kind,path,degree:0,...state.positions[id]||graphSeed(id)});return true;};
  const addLink=(a:string,b:string)=>{if(a===b)return;const [from,to]=[a,b].sort(),key=from+'\0'+to;const existing=edgeSeen.get(key);if(existing){if(a===from)existing.forward=true;else existing.backward=true;return;}if(links.length>=GRAPH_LIMITS.links){if(!partial.includes('연결 1800개 상한'))partial.push('연결 1800개 상한');return;}const link={from,to,forward:a===from,backward:a!==from};edgeSeen.set(key,link);links.push(link);};const edgeSeen=new Map<string,GraphLink>();
  const paths=Object.keys(index).filter(p=>/\.md$/i.test(p)&&safeNotePath(p)&&byPath.has(p));
  for(const path of paths){try{if(query.test({path},index[path]))add(path,'file',path);}catch(e){return {nodes:[],links:[],partial,error:String(e)}}}
  // Canvas files are native file nodes, including when attachment display is off.
  for(const file of safeFiles)if(/\.canvas$/i.test(file.path)){try{if(query.test({path:file.path},undefined))add(file.path,'file',file.path);}catch(e){return {nodes:[],links:[],partial,error:String(e)}}}
  const selected=new Set(nodes.map(n=>n.id));
  for(const path of paths){if(!selected.has(path))continue;const meta=metadata?.[path] || extractNoteMetadata(index[path]);
    for(const link of meta.links){const resolved=resolve(link.target,path);if(resolved.path){const target=resolved.path;if(selected.has(target))addLink(path,target);else if(state.options.attachments&&!/\.md$/i.test(target)&&add(target,'attachment',target))addLink(path,target);}
      else if(resolved.missing&&!state.options.existingOnly){const id='missing:'+resolved.missing;if(add(id,'missing'))addLink(path,id);}}
    if(state.options.tags){const tags=meta.tags;if(tags.length>64&&!partial.includes('노트당 태그 64개 상한'))partial.push('노트당 태그 64개 상한');for(const tag of tags.slice(0,64)){const id='tag:'+tag;if(add(id,'tag'))addLink(path,id);}}
  }
  const degrees=new Map<string,number>();for(const link of links){degrees.set(link.from,(degrees.get(link.from)||0)+1);degrees.set(link.to,(degrees.get(link.to)||0)+1);}
  for(const n of nodes)n.degree=degrees.get(n.id)||0;
  const visible=nodes.filter(n=>state.options.orphans||n.degree>0),ids=new Set(visible.map(n=>n.id));
  return {nodes:visible,links:links.filter(l=>ids.has(l.from)&&ids.has(l.to)),partial};
}
export function forceStep(nodes:GraphNode[],links:GraphLink[],options:GraphOptions,alpha:number,pinned:ReadonlySet<string>=new Set()):number {
  if(alpha<.005||!nodes.length)return 0;const delta=new Map(nodes.map(n=>[n.id,{x:0,y:0}]));const byId=new Map(nodes.map(n=>[n.id,n]));
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],dx=a.x-b.x,dy=a.y-b.y,d2=Math.max(64,dx*dx+dy*dy),force=Math.min(20,options.repulsion*alpha*100/d2);const x=dx*force,y=dy*force;delta.get(a.id)!.x+=x;delta.get(a.id)!.y+=y;delta.get(b.id)!.x-=x;delta.get(b.id)!.y-=y;}
  for(const l of links){const a=byId.get(l.from),b=byId.get(l.to);if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),f=(d-options.linkDistance)*options.linkForce*alpha*.008;const x=dx/d*f,y=dy/d*f;delta.get(a.id)!.x+=x;delta.get(a.id)!.y+=y;delta.get(b.id)!.x-=x;delta.get(b.id)!.y-=y;}
  for(const n of nodes){if(pinned.has(n.id))continue;const d=delta.get(n.id)!;n.x=Math.max(-1e6,Math.min(1e6,n.x+Math.max(-8,Math.min(8,d.x-n.x*options.centerForce*alpha*.002))));n.y=Math.max(-1e6,Math.min(1e6,n.y+Math.max(-8,Math.min(8,d.y-n.y*options.centerForce*alpha*.002))));}
  return alpha*.94;
}
