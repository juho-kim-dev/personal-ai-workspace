import {env} from 'cloudflare:workers';
import {WikiError,titleInput} from './wiki-store';
import {identityMode,identityBatch} from './wiki-identity';
export const MAX_FILE_BYTES=10*1024*1024;
function storage(){if(!env.DB||!env.BUCKET)throw new WikiError('파일 저장소가 아직 연결되지 않았습니다.',503);return {db:env.DB,bucket:env.BUCKET}}
export function detectFileType(bytes:Uint8Array):string|null{
  const start=String.fromCharCode(...bytes.slice(0,12));
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(start.startsWith('GIF87a')||start.startsWith('GIF89a'))return 'image/gif';
  if(start.slice(0,4)==='RIFF'&&start.slice(8,12)==='WEBP')return 'image/webp';
  if(start.startsWith('%PDF-'))return 'application/pdf';
  return null;
}
export function validateAttachment(name:string,bytes:Uint8Array){
  const clean=titleInput(name.replace(/^파일:/,''));
  return validateStoredAttachment(clean,bytes);
}
// Stored names are identities, not upload input: never strip a literal 파일: prefix.
export function validateStoredAttachment(name:string,bytes:Uint8Array){
  const clean=titleInput(name);
  if(clean!==name)throw new WikiError('저장된 파일 이름은 앞뒤 공백 없이 NFC 형식이어야 합니다.');
  if(!bytes.byteLength||bytes.byteLength>MAX_FILE_BYTES)throw new WikiError('파일은 0바이트보다 크고 10MB 이하여야 합니다.');
  const mime=detectFileType(bytes),ext=clean.split('.').at(-1)?.toLowerCase();
  const allowed:Record<string,string[]>={'image/png':['png'],'image/jpeg':['jpg','jpeg'],'image/gif':['gif'],'image/webp':['webp'],'application/pdf':['pdf']};
  if(!mime||!ext||!allowed[mime].includes(ext))throw new WikiError('내용과 확장자가 일치하는 PNG, JPG, GIF, WebP 또는 PDF 파일을 선택해 주세요.');
  return {name:clean,mime,size:bytes.byteLength};
}
function metadata(row:any){return {name:row.name,mime:row.mime,size:row.size,created_at:row.created_at,url:'/api/files?name='+encodeURIComponent(row.name)}}
export async function listAttachments(){return (await storage().db.prepare('SELECT name,mime,size,created_at FROM attachments ORDER BY created_at DESC,name').all()).results.map(metadata)}
export async function uploadAttachment(name:string,bytes:Uint8Array){
  const mode=await identityMode();
  const entry=validateAttachment(name,bytes),{db,bucket}=storage();
  if(await db.prepare('SELECT name FROM attachments WHERE name=?').bind(entry.name).first())throw new WikiError('같은 이름의 파일이 있습니다. 파일 이름을 바꿔 다시 올려 주세요.',409);
  const key='wiki/'+crypto.randomUUID(),now=new Date().toISOString();
  await bucket.put(key,new Uint8Array(bytes).buffer,{httpMetadata:{contentType:entry.mime},customMetadata:{name:entry.name}});
  try{await identityBatch([db.prepare('INSERT INTO attachments(name,key,mime,size,created_at) VALUES(?,?,?,?,?)').bind(entry.name,key,entry.mime,entry.size,now)],'write',mode)}
  catch{const referenced=await db.prepare('SELECT name FROM attachments WHERE key=?').bind(key).first();if(!referenced)await bucket.delete(key);throw new WikiError('파일 이름이 충돌했거나 저장되지 않았습니다. 다시 확인해 주세요.',409)}
  return metadata({...entry,created_at:now});
}
export async function downloadAttachment(value:unknown){
  const name=titleInput(value),{db,bucket}=storage();
  const row:any=await db.prepare('SELECT * FROM attachments WHERE name=?').bind(name).first();
  if(!row)throw new WikiError('파일을 찾을 수 없습니다.',404);
  const object=await bucket.get(row.key);
  if(!object)throw new WikiError('파일 내용을 찾을 수 없습니다.',404);
  const encoded=encodeURIComponent(row.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return new Response(object.body,{headers:{'Content-Type':row.mime,'Content-Length':String(object.size),'Content-Disposition':`${row.mime.startsWith('image/')?'inline':'attachment'}; filename="download"; filename*=UTF-8''${encoded}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
