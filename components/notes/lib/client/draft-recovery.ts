import type { VaultFile } from './api';
import { draftPath, type DraftCandidate, type DraftRecord } from './draft-journal.ts';
import type { SharedDocuments } from './shared-documents';
export type RecoveryReview = { candidate: DraftCandidate; status: 'safe'|'changed'|'missing'|'unavailable'|'unknown'|'busy'; remote?: string; message: string };
export type RecoveryIO = {
  read:(file:VaultFile)=>Promise<{text:string;revision:string|null}>;
  missing:(error:unknown)=>boolean;
  copy?:(path:string,text:string)=>Promise<VaultFile>;
};
/** Recovery never substitutes a newly fetched revision into the draft. */
export class DraftRecovery {
  readonly store:SharedDocuments;
  private io:RecoveryIO;
  constructor(store:SharedDocuments,io:RecoveryIO) {this.store=store;this.io=io;}
  candidates(){return this.store.journal?.discover().filter(c=>!this.store.journal!.owns(c)) || [];}
  private record(candidate:DraftCandidate):DraftRecord {
    const current=this.store.journal?.discover().find(c=>c.key===candidate.key && c.raw===candidate.raw);
    if(!current?.record)throw Error('복구 자료를 다시 확인하세요. 원본 다운로드는 계속 사용할 수 있습니다.');
    return current.record;
  }
  async review(candidate:DraftCandidate):Promise<RecoveryReview> {
    if(!candidate.record)return {candidate,status:'unknown',message:'손상되었거나 지원하지 않는 자료입니다. 원본 JSON을 내려받아 보관하세요.'};
    const r=this.record(candidate),e=this.store.entries.get(r.file.path);
    if(e?.saving || e?.loading || e?.conflict || e?.document && e.document.text!==e.document.saved)return {candidate,status:'busy',message:'열린 문서에 편집 또는 저장 작업이 있습니다. 복구 자료를 별도 사본으로 보관하세요.'};
    try {
      const remote=await this.io.read(r.file);
      if(remote.revision!==r.revision || remote.text!==r.saved || r.conflict && r.conflict.kind!=='pane')return {candidate,status:'changed',remote:remote.text,message:'서버 내용 또는 파일 revision이 바뀌었습니다. 기존 파일을 덮어쓰지 않고 사본이나 다운로드로 보관하세요.'};
      return {candidate,status:'safe',remote:remote.text,message:r.alternatives?.length?'여러 편집 대안이 있습니다. 복원한 뒤 충돌에서 사용할 내용을 선택하세요.':'서버의 원래 revision과 내용이 같습니다. 복원 후에도 이 revision으로만 저장합니다.'};
    }catch(error){return {candidate,status:this.io.missing(error)?'missing':'unavailable',message:this.io.missing(error)?'원래 경로의 파일이 없거나 이름이 바뀌었습니다. 사본이나 다운로드로 보관하세요.':'서버를 확인할 수 없습니다. 복구 자료는 유지됩니다.'};}
  }
  async restore(candidate:DraftCandidate):Promise<RecoveryReview> {
    // Recheck after review, including after async read; an editor may have changed meanwhile.
    const review=await this.review(candidate);if(review.status!=='safe')return review;
    const r=this.record(candidate),e=this.store.entry(r.file.path);
    if(e.saving || e.loading || e.conflict || e.document && e.document.text!==e.document.saved)return {...review,status:'busy',message:'확인 중 열린 문서의 편집이 바뀌었습니다. 복구 자료를 유지했습니다.'};
    e.document={file:{...r.file},text:r.text,saved:r.saved,revision:r.revision,editable:this.store.io.editable(r.file)};
    e.origin=r.origin;e.preserveSource=r.preserveSource;
    e.conflict=r.conflict?.kind==='pane'?{...r.conflict}:r.alternatives?.length?{kind:'pane',local:r.text,remote:r.alternatives[0],alternatives:r.alternatives,revision:r.revision,missing:false}:null;
    e.recoverySources=[candidate];
    // Retain the source until save acknowledgment; install a fresh run-owned checkpoint.
    e.journal=this.store.journal?.persist({file:r.file,text:r.text,saved:r.saved,revision:r.revision,origin:r.origin,...(r.preserveSource?{preserveSource:true as const}:{}),conflict:r.conflict,alternatives:r.alternatives});
    this.store.editVersion++;this.store.changed();return review;
  }
  discard(candidate:DraftCandidate){this.store.journal?.remove(candidate);this.store.changed();}
  async copy(candidate:DraftCandidate,path:string) {
    const r=this.record(candidate);if(!draftPath(path) || path===r.file.path)throw Error('원본과 다른 올바른 상대 경로를 입력하세요.');
    if(!this.io.copy)throw Error('사본 저장을 사용할 수 없습니다. 다운로드로 보관하세요.');
    // If-None-Match only, even if this path exists. Preserve source and all alternatives.
    const file=await this.io.copy(path,r.text);this.store.io.saved(file);return file;
  }
}
