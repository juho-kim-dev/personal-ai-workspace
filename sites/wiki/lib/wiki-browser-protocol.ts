import { WIKI_CLIENT_HEADER, WIKI_CLIENT_PROTOCOL } from './wiki-client-protocol';
import { identityStatus } from './wiki-identity';
import { WikiError } from './wiki-store';

/** Old browser tabs must not rebase a moved document's draft onto its redirect. */
export async function requireCurrentWikiBrowser(request: Request) {
  if (request.headers.get(WIKI_CLIENT_HEADER) === WIKI_CLIENT_PROTOCOL) return;
  const state = await identityStatus();
  if (state.state !== 'legacy') {
    throw new WikiError('위키가 업데이트되었습니다. 작성 중인 내용을 보관한 뒤 화면을 새로 열어 주세요.', 409);
  }
}
