'use client';

import { useState } from 'react';
import { editWikiSource, wikiSearchSummary, WIKI_EDITOR_LIMIT, type WikiEditorAction, type WikiSourceChange } from '../../lib/wiki-editor-tools';

export type WikiEditorToolsProps = {
  /** Current controlled value, used only for live counts. */
  value: string;
  disabled?: boolean;
  busy?: boolean;
  /** Read the latest draft AND textarea selection together, at invocation time. */
  getSelection: () => WikiSourceChange;
  /** Synchronously update the draft/ref; restore selection after React commits. */
  apply: (change: WikiSourceChange) => void;
};

/** Import app/wiki-editor-tools.css from the parent stylesheet entry point.
 * Remount with a title/section/request key. Parent guards IME and save/upload locks. */
export function WikiEditorTools({ value, disabled = false, busy = false, getSelection, apply }: WikiEditorToolsProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ value: string; query: string; text: string } | null>(null);
  const blocked = disabled || busy;
  const counts = wikiSearchSummary(value, query);
  const invalidQuery = !query.length || query.length > WIKI_EDITOR_LIMIT;
  const invalidReplacement = replacement.length > WIKI_EDITOR_LIMIT;

  function run(action: WikiEditorAction) {
    if (blocked) return;
    const latest = getSelection();
    const result = editWikiSource(latest.value, action, latest);
    if (!result.ok) { setError(result.error); setNotice(null); return; }
    setError('');
    apply(result.change);
    const count = result.search;
    const text = result.message + (count && action.type !== 'find'
      ? ` 남은 일치 ${count.total}개${count.current ? `, 현재 ${count.current}번째` : ', 현재 선택한 일치 없음'}.` : '');
    setNotice({ value: result.change.value, query, text });
  }

  return <section className="wiki-editor-tools" aria-label="편집 도구 · 찾기 및 바꾸기" aria-busy={busy}>
    <fieldset disabled={blocked}>
      <legend>원문 찾기 및 바꾸기</legend>
      <div className="wiki-editor-tools-row">
        <label>찾을 내용<textarea rows={1} aria-label="찾을 내용" value={query} disabled={blocked} onChange={event => {
          setQuery(event.target.value); setError(''); setNotice(null);
        }}/></label>
        <button type="button" disabled={blocked || invalidQuery} onClick={() => run({ type: 'find', query, direction: 'previous' })}>이전 찾기</button>
        <button type="button" disabled={blocked || invalidQuery} onClick={() => run({ type: 'find', query, direction: 'next' })}>다음 찾기</button>
      </div>
      <div className="wiki-editor-tools-row">
        <label>바꿀 내용<textarea rows={1} aria-label="바꿀 내용" value={replacement} disabled={blocked} onChange={event => {
          setReplacement(event.target.value); setError(''); setNotice(null);
        }}/></label>
        <button type="button" disabled={blocked || invalidQuery || invalidReplacement} onClick={() => run({ type: 'replace-current', query, replacement })}>현재 일치 바꾸기</button>
        <button type="button" disabled={blocked || invalidQuery || invalidReplacement} onClick={() => run({ type: 'replace-all', query, replacement })}>모두 바꾸기</button>
      </div>
      <p className="wiki-editor-tools-hint">대소문자를 구분하는 글자 그대로 찾기 · 겹침 포함 {counts.total}개 · 모두 바꾸기 대상 {counts.replaceable}개 (왼쪽부터 겹침 제외). 빈 바꿀 내용은 삭제합니다.</p>
    </fieldset>
    <fieldset disabled={blocked}>
      <legend>선택한 원문 서식</legend>
      <div className="wiki-editor-tools-row">
        {([
          ['indent', '들여쓰기'], ['outdent', '내어쓰기'], ['list', '목록 넣기'],
          ['table', '표 넣기'], ['footnote', '각주 넣기'], ['folding', '접기 넣기'],
        ] as const).map(([type, label]) => <button type="button" key={type} disabled={blocked} onClick={() => run({ type })}>{label}</button>)}
      </div>
    </fieldset>
    <p role="status" aria-live="polite" aria-atomic="true">{busy ? '편집 작업을 기다리는 중입니다.'
      : notice?.value === value && notice.query === query ? notice.text
      : query && !invalidQuery ? `일치 ${counts.total}개. 다음 찾기 또는 이전 찾기로 선택하세요.` : '찾을 내용을 입력하거나 원문에서 서식을 넣을 범위를 선택하세요.'}</p>
    {(error || value.length > WIKI_EDITOR_LIMIT || query.length > WIKI_EDITOR_LIMIT || invalidReplacement) && <p role="alert">
      {error || '원문과 입력은 각각 200,000자 이하여야 합니다. 변경하지 않았습니다.'}
    </p>}
  </section>;
}
