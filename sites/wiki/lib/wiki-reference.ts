import { wikiLinkBody } from './wiki-inline-style';
import { normalizeWikiTitle } from './wiki-title';

export function safeWikiURL(value: string): string | null {
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; }
}

/** URL-looking input must pass URL validation, never fall back to an internal link.
 * HTTP:안내 is an ordinary title. Dangerous schemes remain literal in every form. */
export function wikiTargetKind(target: string): 'internal' | 'external' | 'invalid' {
  if (/[\u0000-\u001f\u007f]/.test(target) || /^(?:(?:ftp|mailto|javascript|data|vbscript|file):|\/\/)/i.test(target)) return 'invalid';
  if (/^https?:\/\//i.test(target)) return safeWikiURL(target) ? 'external' : 'invalid';
  return 'internal';
}

export type WikiReference = {
  target: string;
  label?: string;
  kind: 'internal' | 'external' | 'category' | 'file' | 'invalid';
};

/** A literal stored title, without activating category/file syntax or a label. */
export function wikiTitleReference(title: string): string {
  return '[[' + title.replace(/[\\[\]|:]/g, '\\$&') + ']]';
}

/** Only the target decodes \|, \[, \], \\ and \:. The first unescaped pipe
 * separates the label, which keeps the existing inline grammar unchanged. */
export function parseWikiReference(token: string): WikiReference | null {
  if (!token.startsWith('[[')) return null;
  const body = wikiLinkBody(token);
  if (body === null || !body.trim()) return null;
  let separator = -1;
  for (let at = 0; at < body.length; at++) {
    if (body[at] === '\\' && /[|[\]\\:]/.test(body[at + 1] || '')) { at++; continue; }
    if (body[at] === '|') { separator = at; break; }
  }
  const source = separator < 0 ? body : body.slice(0, separator);
  const raw = source.trim(), explicit = raw.startsWith(':');
  const target = normalizeWikiTitle((explicit ? raw.slice(1) : raw).replace(/\\([|[\]\\:])/g, '$1'));
  const label = separator < 0 ? undefined : body.slice(separator + 1);
  let kind: WikiReference['kind'] = wikiTargetKind(target);
  // Check before trim: whitespace around an ordinary title is allowed, controls
  // around a URL (or inside any target) cannot disappear during validation.
  if (!target || /[\u0000-\u001f\u007f]/.test(source)) kind = 'invalid';
  if (kind !== 'invalid') {
    if (explicit) kind = 'internal';
    else if (source.startsWith('분류:')) kind = 'category';
    else if (raw.startsWith('파일:')) kind = 'file';
  }
  return { target, label, kind };
}
