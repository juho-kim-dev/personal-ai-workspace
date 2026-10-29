import type { VaultFile } from './api';
import { DraftJournal, type DraftBase, type DraftCandidate } from './draft-journal.ts';
export type OpenDocument = { file: VaultFile; text: string; saved: string; revision: string; editable: boolean };
export type Conflict = { local: string; remote: string; revision: string | null; missing: boolean; kind?: 'pane'|'recovery'; alternatives?: string[] };
export type DocumentEntry = { document: OpenDocument | null; conflict: Conflict | null; saving: Promise<void> | null; loading: Promise<void> | null; journal?: DraftCandidate | null; origin?: DraftBase; recoverySources?: DraftCandidate[]; preserveSource?: boolean };
export type DocumentTransport = {
  read: (file: VaultFile, signal?: AbortSignal) => Promise<{text:string;revision:string|null}>;
  write: (doc: OpenDocument, text: string, signal?: AbortSignal) => Promise<VaultFile>;
  editable: (file: VaultFile) => boolean;
  prepare: (doc: OpenDocument) => string;
  conflict: (error: unknown) => boolean;
  missing: (error: unknown) => boolean;
  saved: (file: VaultFile) => void;
};
/** One entry and CAS writer per path, shared by every pane. No pane owns a draft. */
export class SharedDocuments {
  editVersion = 0;
  readonly leases = new Map<string,number>();
  lease(path:string) {this.leases.set(path,(this.leases.get(path)||0)+1);let live=true;return ()=>{if(!live)return;live=false;const n=(this.leases.get(path)||1)-1;if(n)this.leases.set(path,n);else this.leases.delete(path);};}
  retain(path:string) {const e=this.entries.get(path);return !!this.leases.get(path)||!!e?.loading||!!e?.saving||!!e?.conflict||!!e?.document && e.document.text!==e.document.saved;}
  readonly entries = new Map<string, DocumentEntry>();
  readonly io: DocumentTransport;
  readonly changed: () => void;
  readonly journal?:DraftJournal;
  constructor(io: DocumentTransport, changed: () => void, journal?: DraftJournal) {this.io=io;this.changed=changed;this.journal=journal;}
  private checkpoint(e:DocumentEntry) {
    const d=e.document;if(!d || !this.journal)return;
    e.origin ||= {file:{...d.file},text:d.saved,revision:d.revision};
    e.journal=this.journal.persist({file:d.file,text:d.text,saved:d.saved,revision:d.revision,origin:e.origin,...(e.preserveSource?{preserveSource:true as const}:{}),conflict:e.conflict || undefined,alternatives:e.conflict?.kind==='pane'?e.conflict.alternatives:undefined});
  }
  entry(path: string) { let entry=this.entries.get(path);if(!entry){entry={document:null,conflict:null,saving:null,loading:null};this.entries.set(path,entry);}return entry; }
  get(path: string | null) { return path ? this.entries.get(path)?.document || null : null; }
  get dirty() { return [...this.entries.values()].some(e=>e.conflict?.kind==='pane' || e.document && e.document.text!==e.document.saved); }
  get saving() { return [...this.entries.values()].some(e=>e.saving); }
  edit(path: string, text: string, base?:string) {
    const e=this.entry(path),doc=e.document;if(!doc?.editable)return;
    if(e.conflict?.kind==='pane'){e.conflict={...e.conflict,remote:text,alternatives:[...new Set([...(e.conflict.alternatives || []),e.conflict.remote,text])]};this.checkpoint(e);this.changed();return;}
    const merged=base===undefined?text:mergePaneEdit(base,doc.text,text);
    if(merged===null){e.conflict={kind:'pane',local:doc.text,remote:text,alternatives:[text],revision:doc.revision,missing:false};this.checkpoint(e);this.changed();return;}
    e.document={...doc,text:merged};this.checkpoint(e);this.editVersion++;this.changed();
  }
  /** Scoped drafts bypass automatic metadata transforms until their exact text is acknowledged. */
  preserveSource(path:string) {this.entry(path).preserveSource=true;}
  /** Retain a full-source incoming event even after detach, lock, retarget or another conflict. */
  preserveAlternative(path:string,text:string,snapshot:OpenDocument) {
    const e=this.entry(path);e.document ||= snapshot;e.preserveSource=true;
    const d=e.document,c=e.conflict;
    // Independently archived input is never pruned by a later checkpoint or save.
    this.journal?.persist({file:snapshot.file,text,saved:snapshot.saved,revision:snapshot.revision,origin:e.origin,preserveSource:true},true);
    e.conflict=c?{...c,alternatives:[...new Set([...(c.alternatives||[]),text])]}:{kind:'pane',local:d.text,remote:text,alternatives:[text],revision:d.revision,missing:false};
    this.checkpoint(e);this.editVersion++;this.changed();
  }
  async load(file: VaultFile, signal?: AbortSignal, force=false, admission?: {read: DocumentTransport['read']; valid:()=>boolean}) {
    const e=this.entry(file.path);
    if(e.loading){await e.loading;signal?.throwIfAborted();}
    if(e.document && !force && (e.saving || e.document.revision===file.revision || e.document.text!==e.document.saved || e.conflict))return;
    if(force)await this.flushPath(file.path,signal);
    signal?.throwIfAborted();
    const before=e.document;
    const task=(async()=>{
      const editable=this.io.editable(file),result=editable?await (admission?.read || this.io.read)(file,signal):{text:'',revision:file.revision};signal?.throwIfAborted();
      if(admission && (!admission.valid() || result.revision!==file.revision))throw Error(`${file.path}: 목록 버전이 바뀌었습니다. 재시도하세요.`);
      if(e.saving || e.conflict || e.document!==before)throw Error(`${file.path}: 읽는 동안 편집이 바뀌어 로컬 내용을 유지했습니다.`);
      e.document={file:{...file,revision:result.revision || file.revision},text:result.text,saved:result.text,revision:result.revision || file.revision,editable};e.conflict=null;
    })();
    e.loading=task;this.changed();
    try{await task;}finally{if(e.loading===task)e.loading=null;this.changed();}
  }
  async save(path: string, signal?: AbortSignal): Promise<void> {
    const e=this.entry(path);
    // Re-check after every wait: several panes may request a flush together.
    while(e.saving){await e.saving;signal?.throwIfAborted();}
    const doc=e.document;if(!doc || !doc.editable || doc.text===doc.saved)return;
    if(e.conflict)throw Error(`${path}: 충돌을 먼저 해결하세요. 로컬 편집은 유지됩니다.`);
    signal?.throwIfAborted();const sourcePolicy=!!e.preserveSource,text=sourcePolicy?doc.text:this.io.prepare(doc),ack=e.journal;
    const sources=e.recoverySources?.slice() || [];
    const task=(async()=>{
      try {
        const file=await this.io.write(doc,text,signal);
        if(!file || file.path!==doc.file.path || typeof file.revision!=='string' || !file.revision || file.revision.length>512 || /[\x00-\x1f\x7f]/.test(file.revision))throw Error('저장 응답을 확인할 수 없습니다. 복구 초안을 유지했습니다.');
        const now=e.document!;
        // A scoped edit can start while an ordinary metadata-transformed write is
        // pending, then undo back to identical text. Its new source policy still
        // owns that text; an older ACK must not substitute the prepared bytes.
        const newerSourcePolicy=e.preserveSource&&!sourcePolicy;
        e.document={...now,file,revision:file.revision,saved:text,text:now.text===doc.text&&!newerSourcePolicy?text:now.text};
        // Write the post-ack base synchronously before pruning an older snapshot. A crash
        // before this checkpoint leaves the original CAS draft, which recovers as a conflict.
        if(e.document.text!==text || e.conflict)this.checkpoint(e);
        else {
          const latest=e.journal;
          if(latest?.record && latest.record.text===doc.text && latest.record.revision===doc.revision && latest.record.saved===doc.saved)this.journal?.remove(latest);
          e.journal=null;e.origin=undefined;e.preserveSource=false;this.journal?.confirmed(path);
        }
        if(ack?.record && ack.record.text===doc.text && ack.record.saved===doc.saved && ack.record.revision===doc.revision)this.journal?.remove(ack);
        // Explicitly reviewed source records remain until the selected text has an exact ack.
        const acknowledged=sources.filter(source=>source.record?.text===doc.text && source.record.saved===doc.saved && source.record.revision===doc.revision && !source.record.alternatives?.length);
        for(const source of acknowledged)this.journal?.remove(source);
        e.recoverySources=[]; // Remaining source alternatives stay archived for explicit discard, independently of this now-confirmed document.
        this.io.saved(file);
      } catch(error) {
        if(this.io.conflict(error)) {
          let remote='',revision:string|null=null,missing=false;
          try {const result=await this.io.read(doc.file);remote=result.text;revision=result.revision;}catch(readError){missing=this.io.missing(readError);}
          if(e.conflict?.kind!=='pane')e.conflict={local:e.document?.text ?? doc.text,remote,revision,missing,...(e.recoverySources?.length?{kind:'recovery' as const}:{})};
          this.checkpoint(e);
        }
        throw error;
      }
    })();
    e.saving=task;this.changed();
    try{await task;}finally{if(e.saving===task)e.saving=null;this.changed();}
  }
  async flushPath(path: string, signal?: AbortSignal) {
    await this.save(path,signal);await this.save(path,signal);
    const e=this.entry(path);if(e.conflict || e.document && e.document.text!==e.document.saved)throw Error(`${path}: 저장을 완료한 뒤 다시 시도하세요. 편집은 유지됩니다.`);
  }
  async flush(signal?: AbortSignal) {
    // Complete independent saves even when one path fails; report every failed path.
    const result=await Promise.allSettled([...this.entries.keys()].map(path=>this.flushPath(path,signal)));
    const errors=result.filter((r):r is PromiseRejectedResult=>r.status==='rejected');if(errors.length)throw new Error(errors.map(r=>String(r.reason instanceof Error?r.reason.message:r.reason)).join('\n'));
    if(this.dirty)throw Error('저장 중 새 편집이 생겼습니다. 다시 시도하세요.');
  }
  async resolve(path: string, strategy: 'local'|'remote') {
    const e=this.entry(path),c=e.conflict,d=e.document;if(!c || !d)return;
    if(c.kind==='pane'){e.document={...d,text:strategy==='remote'?c.remote:d.text};e.conflict=null;this.checkpoint(e);this.editVersion++;this.changed();return;}
    if(c.kind==='recovery' && strategy==='local')throw Error('복구 초안의 서버 버전이 바뀌었습니다. 복구 패널에서 사본이나 다운로드로 보관하세요.');
    if(!c.revision)throw Error('서버 버전을 확인할 수 없습니다. 로컬 사본을 보관하세요.');
    e.document={...d,file:{...d.file,revision:c.revision},revision:c.revision,saved:c.remote,text:strategy==='remote'?c.remote:d.text};e.conflict=null;this.checkpoint(e);this.changed();
    if(strategy==='local')await this.save(path);
  }
  /** Used only after a successful flush; dirty records are never evicted or remapped. */
  remap(moves: {from:string;to:string}[]) {
    for(const move of moves){const e=this.entries.get(move.from);if(!e)continue;if(e.conflict || e.saving || e.loading || e.document && e.document.text!==e.document.saved)throw Error(`${move.from}: 저장되지 않은 편집이 있습니다.`);this.entries.delete(move.from);if(e.document)e.document={...e.document,file:{...e.document.file,path:move.to}};e.origin=undefined;e.journal=null;e.recoverySources=[];this.entries.set(move.to,e);}this.changed();
  }
  forget(paths: string[]) {for(const path of paths){const e=this.entries.get(path);if(e?.conflict || e?.saving || e?.loading || e?.document && e.document.text!==e.document.saved)throw Error(`${path}: 저장되지 않은 편집이 있습니다.`);this.entries.delete(path);}this.changed();}
}

/** Rebase a delayed controlled-editor update over another pane's disjoint change. */
export function mergePaneEdit(base:string,current:string,incoming:string):string|null {
  if(base===current || current===incoming)return incoming;
  if(base===incoming)return current;
  function change(next:string){let start=0;while(start<base.length && start<next.length && base[start]===next[start])start++;let end=base.length,tail=next.length;while(end>start && tail>start && base[end-1]===next[tail-1]){end--;tail--;}return {start,end,text:next.slice(start,tail)};}
  const a=change(current),b=change(incoming);
  if(a.start===b.start && a.end===b.end && a.text===b.text)return current;
  // Two inserts at the same caret have no unambiguous order; retain both for review.
  if(a.start===b.start || !(a.end<=b.start || b.end<=a.start))return null;
  const edits=[a,b].sort((x,y)=>y.start-x.start);let result=base;
  for(const edit of edits)result=result.slice(0,edit.start)+edit.text+result.slice(edit.end);
  return result;
}
