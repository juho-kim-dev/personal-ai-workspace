import type { VaultFile } from './api';

export const MAX_DRAFT_TEXT = 4 * 1024 * 1024;
export const MAX_DRAFT_JSON = 32 * 1024 * 1024;
const MAX_SCAN = 20_000;
export type JournalStorage = Pick<Storage, 'length'|'key'|'getItem'|'setItem'|'removeItem'>;
export type DraftBase = { file: VaultFile; text: string; revision: string };
export type DraftConflict = { local:string; remote:string; revision:string|null; missing:boolean; kind?:'pane'|'recovery'; alternatives?:string[] };
export type DraftSnapshot = {
  file: VaultFile; text: string; saved: string; revision: string;
  origin?: DraftBase;
  preserveSource?: true;
  alternatives?: string[];
  conflict?: DraftConflict;
};
export type DraftRecord = DraftSnapshot & { schema: 1; id: string; run: string; time: number; origin: DraftBase };
export type DraftCandidate = { key: string; raw: string; record: DraftRecord | null; problem?: string };
export type JournalIssue = 'identity'|'unavailable'|'quota'|'invalid'|'scan-limit'|null;
const token=(v:unknown):v is string=>typeof v==='string' && v.length>0 && v.length<=512 && !/[\x00-\x1f\x7f]/.test(v);
export function draftPath(v:unknown):v is string {
  return typeof v==='string' && v.length>0 && v.length<=1024 && !/^[\\/]|^[a-z]:|[\x00-\x1f\x7f\\]/i.test(v) && !v.split('/').some(p=>!p || p==='.' || p==='..');
}
const object=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==='object' && !Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string' && v.length<=MAX_DRAFT_TEXT;
function file(v:unknown):v is VaultFile {
  return object(v) && draftPath(v.path) && token(v.revision) && typeof v.size==='number' && Number.isSafeInteger(v.size) && v.size>=0 && v.size<=MAX_DRAFT_TEXT*4 && typeof v.mime==='string' && v.mime.length<=256 && typeof v.updatedAt==='string' && v.updatedAt.length<=128 && Object.keys(v).every(k=>['path','size','mime','revision','updatedAt'].includes(k));
}
function base(v:unknown):v is DraftBase {return object(v) && file(v.file) && text(v.text) && token(v.revision) && Object.keys(v).every(k=>['file','text','revision'].includes(k));}
function alternatives(v:unknown):boolean {return v===undefined || Array.isArray(v) && v.length<=32 && v.every(text);}
function conflict(v:unknown):boolean {
  return v===undefined || object(v) && Object.keys(v).every(k=>['local','remote','revision','missing','kind','alternatives'].includes(k)) && text(v.local) && text(v.remote) && (v.revision===null || token(v.revision)) && typeof v.missing==='boolean' && (v.kind===undefined || v.kind==='pane' || v.kind==='recovery') && alternatives(v.alternatives);
}
export function parseDraft(raw:string):DraftRecord|null {
  if(raw.length>MAX_DRAFT_JSON)return null;
  try {
    const v:unknown=JSON.parse(raw);
    if(!object(v) || Object.keys(v).some(k=>!['schema','id','run','time','file','text','saved','revision','origin','alternatives','conflict','preserveSource'].includes(k)))return null;
    if(v.schema!==1 || !token(v.id) || !token(v.run) || typeof v.time!=='number' || !Number.isSafeInteger(v.time) || !file(v.file) || !text(v.text) || !text(v.saved) || !token(v.revision) || !base(v.origin))return null;
    if(v.file.revision!==v.revision || v.origin.file.path!==v.file.path || v.origin.file.revision!==v.origin.revision)return null;
    if(v.preserveSource!==undefined && v.preserveSource!==true)return null;
    if(!alternatives(v.alternatives) || !conflict(v.conflict))return null;
    return v as DraftRecord;
  }catch{return null;}
}
/** Immutable, independently keyed snapshots: no shared index, RMW, lease or sessionStorage ID.
 * Reloads and duplicated tabs always get a new run. Old runs never expire automatically. */
export class DraftJournal {
  readonly prefix:string;
  private globalIssue:JournalIssue=null;
  private failures=new Map<string,JournalIssue>();
  get issue():JournalIssue {return this.globalIssue || [...this.failures.values()][0] || null;}
  readonly run:string;
  private current=new Map<string,DraftCandidate>();
  private volatile=new Map<string,DraftCandidate>();
  private storage:JournalStorage|null;
  private id:()=>string;
  constructor(storage:JournalStorage|null,owner:string|undefined,vault:string,id:()=>string=()=>crypto.randomUUID()) {
    this.storage=storage;this.id=id;this.run=this.id();
    let prefix='';
    try {if(token(owner) && token(vault))prefix=`paw-public:drafts:${encodeURIComponent(owner)}:${encodeURIComponent(vault)}:`;}catch{/* Invalid Unicode identity is not a usable namespace. */}
    this.prefix=prefix;
    if(!this.prefix)this.globalIssue='identity';else if(!storage)this.globalIssue='unavailable';
  }
  persist(snapshot:DraftSnapshot, archive=false):DraftCandidate|null {
    if(!this.prefix)return null; // Never fall back to vault-only/display-name isolation.
    const valid=file(snapshot.file) && text(snapshot.text) && text(snapshot.saved) && token(snapshot.revision) && (!snapshot.origin || base(snapshot.origin)) && alternatives(snapshot.alternatives) && conflict(snapshot.conflict) && Object.keys(snapshot).every(k=>['file','text','saved','revision','origin','alternatives','conflict','preserveSource'].includes(k));
    if(!valid){this.failures.set(snapshot.file?.path || '', 'invalid');return null;}
    // Reject oversized input before stringify as well as bounding the encoded JSON below.
    const fields=[snapshot.text,snapshot.saved,snapshot.origin?.text || snapshot.saved,...(snapshot.alternatives || []),snapshot.conflict?.local || '',snapshot.conflict?.remote || '',...(snapshot.conflict?.alternatives || [])];
    if(fields.reduce((size,value)=>size+value.length,0)>MAX_DRAFT_JSON){this.failures.set(snapshot.file.path,'invalid');return null;}
    const record:DraftRecord={...snapshot,schema:1,id:this.id(),run:this.run,time:Date.now(),origin:snapshot.origin || {file:snapshot.file,text:snapshot.saved,revision:snapshot.revision}};
    const raw=JSON.stringify(record),key=this.prefix+record.id;
    const candidate={key,raw,record};
    if(!parseDraft(raw)){this.failures.set(snapshot.file.path,'invalid');return null;}
    const previous=archive?undefined:this.current.get(snapshot.file.path);
    // Volatile fallback is exportable if durable storage fails. Never erase the last durable edit first.
    this.volatile.set(key,candidate);if(!archive)this.current.set(snapshot.file.path,candidate);
    try {
      if(!this.storage)throw Error('unavailable');
      this.storage.setItem(key,raw);
      this.volatile.delete(key);
      this.failures.delete(snapshot.file.path);this.globalIssue=null;
      if(previous)this.remove(previous);
    }catch(error){if(previous)this.volatile.delete(previous.key);this.failures.set(snapshot.file.path,error instanceof Error && error.name==='QuotaExceededError'?'quota':'unavailable');}
    return candidate;
  }
  /** Removes only the immutable record actually acknowledged/reviewed, never a path's latest edit. */
  remove(candidate:DraftCandidate):boolean {
    if(!this.prefix || !candidate.key.startsWith(this.prefix))return false;
    try {
      if(this.storage?.getItem(candidate.key)===candidate.raw)this.storage.removeItem(candidate.key);
      this.volatile.delete(candidate.key);
      if(this.current.get(candidate.record?.file.path || '')?.key===candidate.key){this.current.delete(candidate.record!.file.path);this.failures.delete(candidate.record!.file.path);}
      return true;
    }catch{this.globalIssue='unavailable';return false;}
  }
  discover():DraftCandidate[] {
    const found=new Map(this.volatile);
    if(!this.prefix)return [];
    try {
      if(!this.storage)throw Error('unavailable');
      this.globalIssue=this.storage.length>MAX_SCAN?'scan-limit':null;
      for(let i=0;i<Math.min(this.storage.length,MAX_SCAN);i++) {
        const key=this.storage.key(i);if(!key?.startsWith(this.prefix))continue;
        const raw=this.storage.getItem(key);if(raw===null)continue;
        const record=parseDraft(raw);
        found.set(key,{key,raw,record,problem:record?undefined:'알 수 없거나 손상된 복구 자료입니다. 원본을 내려받을 수 있습니다.'});
      }
    }catch{this.globalIssue='unavailable';}
    return [...found.values()].sort((a,b)=>(b.record?.time || 0)-(a.record?.time || 0));
  }
  confirmed(path:string){this.failures.delete(path);}
  owns(candidate:DraftCandidate){return candidate.record?.run===this.run;}
}
export const journalIssueMessage=(issue:JournalIssue)=>({
  identity:'계정 식별자가 없어 초안 복구 보관을 사용할 수 없습니다.',
  unavailable:'브라우저 복구 저장소를 사용할 수 없습니다. 편집 내용을 내려받아 보관하세요.',
  quota:'브라우저 복구 저장 공간이 부족합니다. 편집 내용을 내려받아 보관하세요.',
  invalid:'초안이 복구 자료의 크기 또는 형식 한도를 넘었습니다. 편집 내용을 내려받아 보관하세요.',
  'scan-limit':'복구 저장소 항목이 너무 많아 일부 자료만 표시합니다. 브라우저 저장소를 지우지 마세요.',
}[issue || 'identity']);
