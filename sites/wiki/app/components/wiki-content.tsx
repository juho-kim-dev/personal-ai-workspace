'use client';
import { useEffect, useRef, useState } from 'react';
import { List, X } from 'lucide-react';
import { WikiMarkup } from '../wiki-markup';
import { modifiedLinkClick, wikiHref } from '../../lib/wiki-navigation';

/** Supplies document routes to local fragments; the renderer owns expansion. */
export function WikiContent({ title, revision = '', bypass = false, onAnchor, ...props }: React.ComponentProps<typeof WikiMarkup> & {
    title: string;
    revision?: string;
    bypass?: boolean;
    onAnchor: (anchor: string) => void;
}) {
    const root = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null);
    const [items, setItems] = useState<{id: string; label: string; indent: string}[]>([]);
    const [passed, setPassed] = useState(false), [opened, setOpened] = useState(false), [active, setActive] = useState('');
    useEffect(() => {
        const node = root.current;
        node?.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach(link => {
            const hash = link.getAttribute('href')!.slice(1);
            if (new URLSearchParams(hash).has('doc')) return;
            let anchor = hash;
            try { anchor = decodeURIComponent(hash); } catch { }
            link.dataset.wikiLocalAnchor = anchor;
            link.href = wikiHref(title, 'read', { anchor, ...(revision ? { rev: revision } : {}), ...(bypass ? { redirect: 'no' } : {}) });
        });
        const toc = node?.querySelector<HTMLElement>('#toc');
        const entries = Array.from(toc?.querySelectorAll<HTMLAnchorElement>('a[data-wiki-local-anchor]') || []).map(link => ({id: link.dataset.wikiLocalAnchor!, label: link.textContent || '', indent: link.parentElement?.style.paddingInlineStart || '0px'}));
        setItems(entries); setOpened(false);
        if (!toc) { setPassed(false); return; }
        let frame = 0;
        const update = () => {
            frame = 0;
            const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0) + 8;
            const gone = !!toc && toc.getBoundingClientRect().bottom <= top;
            setPassed(gone);
            if (!gone) setOpened(false);
            let current = '';
            for (const entry of entries) if ((document.getElementById(entry.id)?.getBoundingClientRect().top ?? Infinity) <= top + 48) current = entry.id;
            setActive(current);
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
        update();
        window.addEventListener('scroll', schedule, {passive: true}); window.addEventListener('resize', schedule);
        const observer = new ResizeObserver(schedule); if (node) observer.observe(node);
        return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
    }, [title, revision, bypass, props.content, props.sources]);
    useEffect(() => {
        if (!opened) return;
        const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpened(false); };
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpened(false); toggle.current?.focus(); } };
        document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
        (menu.current?.querySelector<HTMLAnchorElement>('a[aria-current="location"]') || menu.current?.querySelector<HTMLAnchorElement>('a'))?.focus({preventScroll:true});
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
    }, [opened]);
    return <div ref={root} onClickCapture={event => {
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-wiki-local-anchor]');
        if (!link || modifiedLinkClick(event)) return;
        const previousHash = window.location.hash;
        window.history.replaceState({...window.history.state, wiki42Scroll: {hash: previousHash, x: window.scrollX, y: window.scrollY}}, '');
        onAnchor(link.dataset.wikiLocalAnchor!);
        if (window.location.hash === previousHash) window.history.pushState({...window.history.state, wiki42ScrollEntry: null, wiki42Scroll: null}, '', previousHash);
        else window.history.replaceState({...window.history.state, wiki42Scroll: null}, '');
    }}>
        <WikiMarkup {...props}/>
        {passed && items.length > 0 && <div className="wiki-floating-toc" ref={menu}>
            <button ref={toggle} type="button" aria-expanded={opened} aria-controls="floating-toc-panel" onClick={() => setOpened(value => !value)}><List size={18}/>목차</button>
            {opened && <nav id="floating-toc-panel" aria-label="빠른 목차">
                <div className="floating-toc-heading"><strong>목차</strong><button type="button" aria-label="목차 닫기" onClick={() => {setOpened(false);toggle.current?.focus();}}><X size={18}/></button></div>
                <ol>{items.map(item => <li key={item.id} style={{paddingInlineStart:item.indent}}><a href={wikiHref(title,'read',{anchor:item.id,...(revision?{rev:revision}:{}),...(bypass?{redirect:'no'}:{})})} aria-current={active===item.id?'location':undefined} onClick={event => {
                    if (modifiedLinkClick(event)) return;
                    event.preventDefault();
                    const original = Array.from(root.current?.querySelectorAll<HTMLAnchorElement>('#toc a[data-wiki-local-anchor]') || []).find(link => link.dataset.wikiLocalAnchor === item.id);
                    original?.click(); setOpened(false);
                    const heading = document.getElementById(item.id); if (heading) {heading.tabIndex=-1;heading.focus({preventScroll:true});}
                }}>{item.label}</a></li>)}</ol>
            </nav>}
        </div>}
    </div>;
}
