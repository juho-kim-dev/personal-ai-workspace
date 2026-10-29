import {inspectManifest, sha256, WEB_PRESERVATION_BUDGETS, parseJson, config} from './wiki-preservation-contract.mjs';

export {WEB_PRESERVATION_BUDGETS};
const encoder = new TextEncoder();
const nameAllowed = name => name === 'manifest.json' || /^objects\/[a-f0-9]{64}$/.test(name);
const error = message => {throw new Error(message);};

// Parse only regular ustar entries with fixed package names. Never extract to a filesystem.
export async function readPackageTar(file) {
  if(file.size > WEB_PRESERVATION_BUDGETS.maxTotalObjectBytes + 4*1024*1024) error('보존 파일 전체 크기는 512 MiB 이하여야 합니다.');
  const entries = new Map(); let offset=0, ended=false, total=0;
  while(offset+512<=file.size) {
    const header=new Uint8Array(await file.slice(offset,offset+512).arrayBuffer()); offset+=512;
    if(header.every(v=>v===0)) {
      if(offset+512>file.size) error('보존 파일의 끝부분이 잘렸습니다.');
      for(let p=offset;p<file.size;p+=65536) if(new Uint8Array(await file.slice(p,p+65536).arrayBuffer()).some(v=>v!==0)) error('보존 파일 끝에 알 수 없는 내용이 있습니다.');
      ended=true;break;
    }
    const field=(start,length)=>new TextDecoder('utf-8',{fatal:true}).decode(header.slice(start,start+length)).split('\0')[0];
    const octal=(start,length)=>{const s=field(start,length).trim();if(!/^[0-7]+$/.test(s))error('지원하지 않는 보존 파일 숫자 형식입니다.');return parseInt(s,8);};
    const expected=octal(148,8);let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:header[i];
    if(sum!==expected)error('보존 파일의 머리글이 손상됐습니다.');
    const name=field(0,100),size=octal(124,12);
    if(!nameAllowed(name)||entries.has(name)||field(345,155)||field(157,100)||![0,48].includes(header[156])||!field(257,6).startsWith('ustar'))error('중복 경로·링크 또는 지원하지 않는 보존 파일 형식입니다.');
    if(entries.size>=2049||!Number.isSafeInteger(size)||size>(name==='manifest.json'?WEB_PRESERVATION_BUDGETS.maxManifestBytes:WEB_PRESERVATION_BUDGETS.maxObjectBytes)||(total+=size)>WEB_PRESERVATION_BUDGETS.maxTotalObjectBytes+WEB_PRESERVATION_BUDGETS.maxManifestBytes||offset+Math.ceil(size/512)*512>file.size)error('보존 파일의 크기 제한을 넘었거나 파일이 잘렸습니다.');
    entries.set(name,file.slice(offset,offset+size));offset+=Math.ceil(size/512)*512;
  }
  if(!ended)error('보존 파일의 끝부분을 확인할 수 없습니다.');
  return entries;
}

export async function readPackageFiles(files) {
  if(files.length===1 && /\.tar$/i.test(files[0].name))return readPackageTar(files[0]);
  if(!files.length||files.length>2049)error('manifest.json과 objects 폴더가 있는 보존 폴더를 선택해 주세요.');
  const entries=new Map();let root=null;
  for(const file of files){
    let name=file.webkitRelativePath||file.name;
    if(file.webkitRelativePath){const parts=name.split('/');const first=parts.shift();if(root===null)root=first;else if(root!==first)error('한 보존 폴더만 선택해 주세요.');name=parts.join('/');}
    if(!nameAllowed(name)||entries.has(name))error('보존 폴더에 중복되거나 알 수 없는 파일이 있습니다.');
    entries.set(name,file);
  }
  return entries;
}

export async function inspectBrowserPackage(entries,onProgress=()=>{}) {
  const manifestFile=entries.get('manifest.json');
  if(!manifestFile||manifestFile.size>WEB_PRESERVATION_BUDGETS.maxManifestBytes)error('manifest.json이 없거나 1 MiB를 넘습니다.');
  const manifestBytes=new Uint8Array(await manifestFile.arrayBuffer());
  const state=await inspectManifest(manifestBytes,{budgets:WEB_PRESERVATION_BUDGETS});
  const {report,objects}=state;
  const declared=new Set(objects.map(o=>'objects/'+o.sha256));
  const add=(code,message)=>{report.can_import=false;report.archive_integrity='invalid';report.content_completeness='unknown';if(report.diagnostics.length<512)report.diagnostics.push({code,severity:'error',message});else report.diagnostics_omitted++;};
  for(const name of entries.keys())if(name!=='manifest.json'&&!declared.has(name))add('OBJECT_UNDECLARED','목록에 없는 파일이 있습니다.');
  let index=0;
  for(const object of objects){
    onProgress(`${++index}/${objects.length}개 파일 검사 중…`);
    const blob=entries.get('objects/'+object.sha256);
    if(!blob){add('OBJECT_MISSING','목록에 적힌 파일이 없습니다.');continue;}
    if(blob.size!==object.bytes){add('OBJECT_LENGTH','파일 크기가 목록과 다릅니다.');continue;}
    if(await sha256(new Uint8Array(await blob.arrayBuffer()))!==object.sha256){add('OBJECT_HASH','파일 내용이 원래 기록과 다릅니다.');continue;}
    report.counts.verified_objects++;report.counts.verified_object_bytes+=blob.size;
  }
  if(report.can_import && state.manifest?.wiki42_backup){
    try{
      const ext=state.manifest.wiki42_backup;
      if(!ext||typeof ext!=='object'||Object.keys(ext).length!==1||!declared.has('objects/'+ext.content))throw new Error();
      const blob=entries.get('objects/'+ext.content);if(!blob||blob.size>24*1024*1024)throw new Error();
      const native=parseJson(new Uint8Array(await blob.arrayBuffer()),config({budgets:{maxStringChars:14*1024*1024}}).budgets);
      const groups=['pages','revisions','notes','bookmarks','trash','threads','comments','files',...(native.format==='my-wiki-v4'?['knowledge']:[])];
      if(!['my-wiki-v2','my-wiki-v3','my-wiki-v4'].includes(native.format)||groups.some(k=>!Array.isArray(native[k])))throw new Error();
      report.native_counts=Object.fromEntries(groups.map(k=>[k,native[k].length]));
    }catch{add('NATIVE_BACKUP_INVALID','위키42 전체 백업 객체가 잘못됐거나 지원 한도를 넘었습니다.');}
  }
  return {...state,manifestBytes,entries};
}

function tarHeader(name,size){
  const b=new Uint8Array(512),write=(offset,value)=>b.set(encoder.encode(value),offset),oct=(offset,length,n)=>write(offset,n.toString(8).padStart(length-1,'0')+'\0');
  write(0,name);oct(100,8,384);oct(108,8,0);oct(116,8,0);oct(124,12,size);oct(136,12,0);write(148,'        ');write(156,'0');write(257,'ustar\0');write(263,'00');
  const sum=b.reduce((a,v)=>a+v,0);write(148,sum.toString(8).padStart(6,'0')+'\0 ');return b;
}
export function packageTar(entries){
  const parts=[];
  for(const [name,blob]of entries){if(!nameAllowed(name))error('허용되지 않는 보존 경로입니다.');parts.push(tarHeader(name,blob.size),blob,new Uint8Array((512-blob.size%512)%512));}
  parts.push(new Uint8Array(1024));return new Blob(parts,{type:'application/x-tar'});
}
export function bytesToBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
export function base64ToBytes(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}

export async function demoPackage(){
  const bytes=encoder.encode('== 자료 가져오기 시험 ==\r\n이 문서는 보존 기능을 시험하는 예제입니다.\r\n'),hash=await sha256(bytes),tag=globalThis.crypto.randomUUID();
  const provenance={source:'Wiki42 기능 시험 예제',source_url:null,source_revision:null,attribution:{status:'known',text:'Wiki42 합성 예제'},observed_at:new Date().toISOString()};
  const manifest={format:'wiki42-preservation-v1',dataset:{id:'demo:'+tag,provenance},objects:[{sha256:hash,bytes:bytes.byteLength}],documents:[{id:'document:one',dataset_id:'demo:'+tag,title:'보존 기능 시험 '+tag.slice(0,8),aliases:[],current_revision_id:'revision:one',history:'complete',provenance}],revisions:[{id:'revision:one',document_id:'document:one',parent_revision_id:null,content:hash,syntax:'text/plain',provenance}],media:[],threads:[],comments:[],annotations:[],dependencies:[]};
  return new Map([['manifest.json',new Blob([encoder.encode(JSON.stringify(manifest,null,2))])],['objects/'+hash,new Blob([bytes])]]);
}
