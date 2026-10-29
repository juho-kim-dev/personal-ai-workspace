import { snippet } from './wiki-ui-state';
import { splitWikiTarget } from './wiki-navigation';

export type ReadingPreviews = { documents: boolean; notes: boolean };
export const DEFAULT_READING_PREVIEWS: ReadingPreviews = { documents: true, notes: true };
export const READING_PREVIEWS_KEY = 'wiki-reading-previews';
export function readReadingPreviews(value: string | null): ReadingPreviews {
  try {
    const parsed = JSON.parse(value || '{}');
    return { documents: typeof parsed?.documents === 'boolean' ? parsed.documents : true,
      notes: typeof parsed?.notes === 'boolean' ? parsed.notes : true };
  } catch { return { ...DEFAULT_READING_PREVIEWS }; }
}
/** Preview only the already authorized, current document snapshot. No requests,
 * include expansion or HTML/media execution on hover. */
export function documentPreview(target: string, pages: {title:string;content:string}[]) {
  const { title, anchor } = splitWikiTarget(target);
  const page = pages.find(page => page.title.normalize('NFC') === title.normalize('NFC'));
  const excerpt = page ? snippet(page.content, '') : '';
  return { title, body: page ? (excerpt.length > 160 ? excerpt.slice(0,160) + '…' : excerpt) || '본문이 비어 있습니다.' : '아직 작성되지 않았거나 현재 목록에서 확인할 수 없는 문서입니다.',
    detail: page ? `현재 문서의 발췌${anchor ? ' · 특정 절의 발췌는 아닙니다.' : ''}` : '문서 미리보기' };
}
