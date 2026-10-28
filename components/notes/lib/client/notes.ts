import { parseDocument, stringify } from 'yaml';
import type { VaultFile } from './api';
import { parseFrontmatter as frontmatter, extractNoteMetadata, createLinkResolver } from './note-metadata.ts';
export { frontmatter };
export const basename = (path: string) => path.split('/').pop() || path;
export const noteName = (path: string) => basename(path).replace(/\.md$/i, '');
export const isNote = (path: string) => /\.md$/i.test(path);
export const isText = (path: string) => /\.(md|txt|json|canvas|base|css|ya?ml|csv|js|ts|html|xml|svg)$/i.test(path);
export function withModifiedDate(text: string) {
  const parsed = frontmatter(text);
  if (parsed.error) return text;
  // Preserve comments and the rest of an existing frontmatter document.
  if (parsed.raw) {
    const doc = parseDocument(parsed.raw.replace(/^---\r?\n/, '').replace(/\r?\n---(?:\r?\n|$)$/, ''));
    doc.set('modified', new Date().toISOString());
    return `---\n${doc.toString()}---\n${parsed.body}`;
  }
  return `---\n${stringify({ modified: new Date().toISOString() })}---\n${text}`;
}
export function headingId(text: string) { return text.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-'); }
export function headings(text: string) {
  let fenced = false; const seen = new Map<string, number>();
  return frontmatter(text).body.split('\n').flatMap((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = !fenced && line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    if (!match) return [];
    const base = headingId(match[2]); const count = seen.get(base) || 0; seen.set(base, count + 1);
    return [{ level: match[1].length, text: match[2], id: count ? `${base}-${count}` : base, line: index + 1 }];
  });
}
// Retain the wiki-only public shape for existing callers; shared metadata also includes Markdown links.
export function wikiLinks(text: string) {
  return extractNoteMetadata(text).links.filter(link => link.kind === 'wiki').map(({raw, embed, target, heading, alias}) => ({raw, embed, target, heading, alias}));
}
export function resolveLink(target: string, from: string, files: VaultFile[]): { path?: string; candidates: string[] } {
  return createLinkResolver(files)(target, from);
}
export function noteTags(text: string): string[] { return extractNoteMetadata(text).tags; }
export function skipReason(path: string): string | null {
  const parts = path.toLowerCase().split('/');
  if (parts.some(p => ['.git', 'node_modules', '.venv', 'venv', '.ssh', '.aws', '.gnupg', '.wrangler', '__macosx'].includes(p))) return '개발 환경·비밀 정보 폴더';
  const name = parts.at(-1) || '';
  if (name === '.ds_store') return '운영체제 메타데이터';
  if (parts.some(p => p === '.env' || p.startsWith('.env.') || p === 'keys' || p === 'secrets') || /\.(pem|key|p12|pfx|keystore)$/.test(name) || /^(id_rsa|id_ed25519|credentials|secrets?)(\.|$)/.test(name)) return '환경 변수·키·인증 정보';
  return null;
}
