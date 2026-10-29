import {getChatGPTUser} from '../../chatgpt-auth';
import {WikiError} from '../../../lib/wiki-store';
import {boundedJSON} from '../../../lib/request-body';
import {requireCurrentWikiBrowser} from '../../../lib/wiki-browser-protocol';
import * as identity from '../../../lib/wiki-identity';
import {exportBackup,backupFingerprint} from '../../../lib/wiki-backup';
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
function failure(error:unknown) {
  return json({error:error instanceof Error?error.message:'ID 전환 요청을 처리하지 못했습니다.'},error instanceof WikiError?error.status:500);
}
export async function GET() {
  try {
    if (!await getChatGPTUser()) return json({error:'로그인이 필요합니다.'},401);
    return json(await identity.identityStatus());
  } catch(error) { return failure(error); }
}
export async function POST(req:Request) {
  try {
    if (!await getChatGPTUser()) return json({error:'로그인이 필요합니다.'},401);
    if (req.headers.get('origin') && req.headers.get('origin')!==new URL(req.url).origin)
      return json({error:'허용되지 않은 요청입니다.'},403);
    await requireCurrentWikiBrowser(req);
    const body=await boundedJSON(req);
    if (!body||typeof body!=='object'||Array.isArray(body)) throw new WikiError('요청 형식을 확인해 주세요.');
    switch (body.action) {
      case 'start':return json(await identity.startIdentityMigration());
      case 'step':return json(await identity.stepIdentityMigration({limit:body.limit,generation:body.generation}));
      case 'verify':return json(await identity.verifyIdentityMigration());
      case 'activate':return json(await identity.activateIdentityMigration({
        expected_generation:body.expected_generation,
        expected_backup_epoch:body.expected_backup_epoch,
        expected_backup_fingerprint:body.expected_backup_fingerprint,
        expected_dataset_id:body.expected_dataset_id,
      }));
      case 'reopen':return json(await identity.reopenIdentityMaintenance());
      case 'backup': {
        const meta=await identity.identityStatus(),epoch=await identity.identityEpoch();
        if (!['frozen','migrating','verified','maintenance'].includes(meta.state)) throw new WikiError('고정된 유지보수 상태에서 전체 백업을 실행해 주세요.',409);
        const backup=await exportBackup(),fingerprint=await backupFingerprint(backup);
        if (backup.format==='my-wiki-v3' && meta.source_fingerprint && meta.source_backup_fingerprint
          && await backupFingerprint({...backup,format:'my-wiki-v2'})!==meta.source_backup_fingerprint)
          throw new WikiError('최초 고정 백업과 원본 내용·첨부 바이트가 다릅니다. 활성화를 중단합니다.',409);
        await identity.recordIdentityBackup(backup,fingerprint,{generation:meta.generation!,epoch});
        // The response itself is the complete portable file; GET status exposes its checkpoint.
        return json(backup);
      }
      default:throw new WikiError('지원하지 않는 ID 전환 작업입니다.');
    }
  } catch(error) { return failure(error); }
}
