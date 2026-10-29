import { wikiNamespace } from './wiki-title';
import { WIKI_REPORT_TEMPLATE } from './wiki-report-template';

/** A selected immutable source snapshot, not a continuing include relationship. */
export type WikiAuthoringTemplate = {
  title: string;
  content: string;
  version: string;
  document_id: string;
  dataset_id: string;
};

export function isWikiAuthoringTemplate(value: unknown): value is WikiAuthoringTemplate {
  if (!value || typeof value !== 'object') return false;
  const source = value as WikiAuthoringTemplate;
  return typeof source.title === 'string' && source.title.length <= 200 && wikiNamespace(source.title) === '템플릿'
    && typeof source.content === 'string' && source.content.length <= 200000
    && ['version', 'document_id', 'dataset_id'].every(key => {
      const field = source[key as keyof WikiAuthoringTemplate];
      return typeof field === 'string' && field.length > 0 && field.length <= 64;
    });
}

export type WikiAuthoringTarget = {
  ready: boolean;
  existing: boolean;
  version: string | null;
  section: number | null;
  content: string;
  summary: string;
};

/** Copy only into an empty, confirmed missing document. Never replace a draft. */
export function copyWikiAuthoringTemplate(source: WikiAuthoringTemplate, target: WikiAuthoringTarget) {
  if (!isWikiAuthoringTemplate(source)) return null;
  return copyTemplate(source.content,
    // Editable ordinary revision summary; not a new authority/provenance DB field.
    `작성 양식: ${source.title} · 원천 판 ${source.version}`, target);
}
export function copyWikiReportTemplate(target:WikiAuthoringTarget) {
  return copyTemplate(WIKI_REPORT_TEMPLATE,'기본 자료 검토 양식으로 시작',target);
}
function copyTemplate(content:string,summary:string,target:WikiAuthoringTarget) {
  if (!target.ready || target.existing || target.version !== null || target.section !== null || target.content !== '' || target.summary !== '') return null;
  return {content,summary};
}
