import {env} from 'cloudflare:workers';
import {normalizeWikiTitle, validWikiTitle} from './wiki-title';

export class WikiError extends Error {
  constructor(message:string, public status=400) { super(message); }
}
export function db() {
  if (!env.DB) throw new WikiError('저장소 연결을 확인해 주세요.', 503);
  return env.DB;
}
export function titleInput(value:unknown) {
  if (typeof value !== 'string') throw new WikiError('문서 제목을 입력해 주세요.');
  const title = normalizeWikiTitle(value);
  if (!validWikiTitle(title)) throw new WikiError('제목은 1~180자이며 제어 문자, #, 꺾쇠괄호는 사용할 수 없습니다.');
  return title;
}
