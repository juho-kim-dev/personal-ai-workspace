'use client';
import { useEffect, useRef, useState } from 'react';
import { WikiMarkup } from '../wiki-markup';
import { isWikiAuthoringTemplate, type WikiAuthoringTemplate } from '../../lib/wiki-authoring-template';
import { wikiHref } from '../../lib/wiki-navigation';
import { wikiNamespace } from '../../lib/wiki-title';

export function WikiAuthoringTemplatePicker({ pages, disabled, load, apply, applyReport }: {
  pages: { title: string; content: string; version: string; document_id?: string | null; dataset_id?: string | null }[];
  disabled: boolean;
  load: (documentId: string) => Promise<WikiAuthoringTemplate>;
  apply: (source: WikiAuthoringTemplate) => boolean;
  applyReport?: () => boolean;
}) {
  // Selecting freezes the displayed revision even if the background list refreshes.
  const [previewMode,setPreviewMode] = useState('preview');
  const [source, setSource] = useState<WikiAuthoringTemplate | null>(null);
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState(''), [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const templates = pages.filter(page => wikiNamespace(page.title) === '템플릿' && !!page.document_id).sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  return <section className="authoring-template-picker" aria-label="작성 양식으로 시작"><h2>작성 양식으로 시작</h2>
    <p>선택한 판을 빈 초안에 한 번 복사합니다. 이후 양식이 바뀌어도 작성한 내용은 바뀌지 않습니다.</p>
    {applyReport&&<button type="button" disabled={disabled} onClick={()=>setMessage(applyReport()?'기본 자료 검토 양식을 빈 초안에 복사했습니다.':'빈 새 문서에서만 사용할 수 있습니다. 기존 초안은 보존했습니다.')}>기본 자료 검토 양식</button>}
    <label>작성 양식 <select disabled={disabled} value={selection} onChange={async event => {
      const selected = templates.find(item => item.document_id === event.target.value);
      const epoch = ++request.current;
      setSelection(selected?.document_id || ''); setSource(null); setMessage(''); setLoading(!!selected);
      if (!selected?.document_id) return;
      try {
        const resolved = await load(selected.document_id);
        if (epoch !== request.current) return;
        if (!isWikiAuthoringTemplate(resolved) || resolved.document_id !== selected.document_id) throw new Error('양식의 문서와 판을 확인할 수 없습니다.');
        setSource({ ...resolved });
      } catch (error) { if (epoch === request.current) setMessage((error as Error).message); }
      finally { if (epoch === request.current) setLoading(false); }
    }}><option value="">양식 선택</option>{templates.map(item => <option key={item.document_id} value={item.document_id || ''}>{item.title}</option>)}</select></label>
    {!templates.length && <p>등록된 작성 양식이 없습니다. 템플릿: 이름공간에 일반 문서처럼 작성할 수 있습니다.</p>}
    {loading && <p role="status">선택한 양식의 원문과 판을 확인하고 있습니다.</p>}
    {source && <>
      <p><a href={wikiHref(source.title, 'read', { document_id: source.document_id, rev: source.version })} target="_blank" rel="noopener noreferrer">선택한 원천 판 보기 ↗</a></p>
      <div role="group" aria-label="양식 확인">{[['preview','양식 미리보기'],['source','복사할 원문']].map(([id,label])=><button type="button" key={id} aria-pressed={previewMode===id} onClick={()=>setPreviewMode(id)}>{label}</button>)}</div><div hidden={previewMode!=='source'}><pre>{source.content || '(빈 양식)'}</pre></div>
      <div hidden={previewMode!=='preview'}><WikiMarkup content={source.content} sources={Object.fromEntries(pages.map(page => [page.title, page.content]))} documentTitle={source.title} known={pages.map(page => page.title)} open={target => { window.open(wikiHref(target), '_blank', 'noopener,noreferrer'); }} idPrefix="authoring-template-preview"/></div>
      <button type="button" disabled={disabled} onClick={() => {
        setMessage(apply(source) ? '선택한 판을 초안에 복사했습니다. 저장 전까지 새 문서는 생성되지 않습니다.' : '빈 새 문서에서만 사용할 수 있습니다. 기존 초안은 보존했습니다.');
      }}>빈 초안에 양식 복사</button>
    </>}
    {disabled && <p>빈 새 문서의 전체 편집에서 사용할 수 있습니다. 작성 중인 내용과 편집 요약을 덮어쓰지 않습니다.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
