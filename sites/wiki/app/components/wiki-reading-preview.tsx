'use client';
import { useEffect, useRef, useState } from 'react';
import { documentPreview, type ReadingPreviews } from '../../lib/wiki-reading-preview';

export function WikiReadingPreview({ pages, preferences, routeKey }: {
  pages: {title:string;content:string}[]; preferences: ReadingPreviews; routeKey: string;
}) {
  const [preview, setPreview] = useState<{title:string;body:string;detail:string;left:number;top:number;width:number}|null>(null);
  const popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active: HTMLAnchorElement | null = null;
    let pendingLink: HTMLAnchorElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previousDescription: string | null = null;
    const cancel = () => { if (timer) clearTimeout(timer); };
    const close = () => {
      cancel();
      if (active) {
        if (previousDescription === null) active.removeAttribute('aria-describedby');
        else active.setAttribute('aria-describedby', previousDescription);
      }
      active = null; pendingLink = null; setPreview(null);
    };
    const show = (link: HTMLAnchorElement) => {
      cancel(); if (active === link) return;
      close();
      const note = link.dataset.wikiNote;
      let value;
      if (note && preferences.notes) {
        const body = document.getElementById(note)?.querySelector('.wiki-note-body')?.textContent;
        if (!body) return;
        value = { title: `각주 ${link.textContent}`, body: body.slice(0, 1200), detail: body.length > 1200 ? '긴 각주의 앞부분 · 번호를 눌러 전체 보기' : '번호를 누르면 각주로 이동합니다.' };
      } else if (link.dataset.wikiPreview && preferences.documents) {
        value = documentPreview(link.dataset.wikiPreview, pages);
      } else return;
      active = link; previousDescription = link.getAttribute('aria-describedby');
      link.setAttribute('aria-describedby', [previousDescription, 'wiki-reading-preview'].filter(Boolean).join(' '));
      setPreview({ ...value, ...position(link) });
    };
    const position = (link: HTMLAnchorElement) => {
      const viewportWidth = document.documentElement.clientWidth;
      const rect = link.getBoundingClientRect(), width = Math.min(360, viewportWidth - 24);
      const maxHeight = Math.min(240, window.innerHeight - 24);
      return { width, left: Math.max(12, Math.min(rect.left, viewportWidth - width - 12)),
        top: rect.bottom + 8 + maxHeight <= window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - maxHeight - 8) };
    };
    const enter = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType !== 'mouse') return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('#wiki-reading-preview')) { cancel(); return; }
      const link = target?.closest<HTMLAnchorElement>('a[data-wiki-preview],a[data-wiki-note]');
      if (!link) return;
      cancel(); pendingLink = link; timer = setTimeout(() => show(link), event.type === 'focusin' ? 80 : 180);
    };
    const leave = (event: Event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target || !(active?.contains(target) || pendingLink?.contains(target) || popup.current?.contains(target))) return;
      if (event.type === 'pointerout' && active === document.activeElement) return;
      const next = (event as FocusEvent).relatedTarget;
      if (next instanceof Node && (active?.contains(next) || popup.current?.contains(next))) { cancel(); return; }
      cancel(); timer = setTimeout(close, 140);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const scroll = (event: Event) => {
      if (!active || (event.target instanceof Node && popup.current?.contains(event.target))) return;
      if (active === document.activeElement) {
        const next = position(active); setPreview(value => value && {...value, ...next});
      } else close();
    };
    close();
    document.addEventListener('pointerover', enter); document.addEventListener('focusin', enter);
    document.addEventListener('pointerout', leave); document.addEventListener('focusout', leave);
    document.addEventListener('keydown', escape); document.addEventListener('click', close);
    window.addEventListener('scroll', scroll, true); window.addEventListener('resize', close);
    return () => {
      close();
      document.removeEventListener('pointerover', enter); document.removeEventListener('focusin', enter);
      document.removeEventListener('pointerout', leave); document.removeEventListener('focusout', leave);
      document.removeEventListener('keydown', escape); document.removeEventListener('click', close);
      window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', close);
    };
  }, [pages, preferences.documents, preferences.notes, routeKey]);
  return preview && <div id="wiki-reading-preview" ref={popup} role="tooltip" className="reading-preview" style={{left:preview.left,top:preview.top,width:preview.width}}>
    <strong>{preview.title}</strong><p>{preview.body}</p><small>{preview.detail}</small>
  </div>;
}
