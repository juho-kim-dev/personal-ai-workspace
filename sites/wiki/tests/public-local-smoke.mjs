import assert from 'node:assert/strict';
const base=process.env.PAW_WIKI_TEST_URL||'http://127.0.0.1:5197';
const url=new URL(base);assert.equal(url.hostname,'127.0.0.1','Only the local preview is permitted');
const sign=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});
const cookie=sign.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
const headers={cookie,'Content-Type':'application/json',Origin:base,'X-Wiki42-Client':'document-identity-v1'};
async function api(route,body,status=200){const res=await fetch(base+route,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;}
assert.equal((await fetch(base+'/api/wiki')).status,401,'Anonymous API must remain protected');
let meta=await api('/api/identity');
if(meta.state==='legacy'){
 await api('/api/identity',{action:'start'});await api('/api/identity',{action:'backup'});
 for(let n=0;n<100;n++){meta=await api('/api/identity');if(meta.phase==='done')break;await api('/api/identity',{action:'step',limit:100,generation:meta.generation});}
 await api('/api/identity',{action:'verify'});await api('/api/identity',{action:'backup'});meta=await api('/api/identity');
 await api('/api/identity',{action:'activate',expected_generation:meta.generation,expected_backup_epoch:meta.backup_epoch,expected_backup_fingerprint:meta.backup_fingerprint,expected_dataset_id:meta.dataset_id});
}
assert.equal((await api('/api/identity')).state,'active');
const title='나의 첫 문서';const page=await api('/api/wiki?op=read&title='+encodeURIComponent(title));assert.ok(page.document_id);
const save={op:'save',title,document_id:page.document_id,expected_version:page.version,content:page.content+'\n\n로컬 공개 준비본 저장 검사.',summary:'합성 로컬 저장 검사'};
await api('/api/wiki',save);await api('/api/wiki',save,409);
const after=await api('/api/wiki?op=read&title='+encodeURIComponent(title));assert.ok(after.content.endsWith('로컬 공개 준비본 저장 검사.'));
await api('/api/wiki',{...save,expected_version:after.version,content:page.content,summary:'합성 검사 후 시작 문서 복귀'});
assert.equal((await api('/api/wiki?op=read&title='+encodeURIComponent(title))).content,page.content);
assert.ok((await api('/api/wiki?op=search&q='+encodeURIComponent('프로젝트'))).length);
assert.ok((await api('/api/wiki?op=history&title='+encodeURIComponent(title))).length>=3);
assert.equal((await api('/api/wiki')).length,6,'Only six authored starter/help pages should exist');
await api('/api/wiki',{...save,expected_version:after.version},409);
console.log('PASS: loopback sign-in, anonymous rejection, identity activation, search, persistent save/read/history, stale rejection, original content restored, six starter pages only.');
