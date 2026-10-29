'use client';
import {useEffect, useRef} from 'react';

export function WikiDialog({label, onClose, children, busy = false}: {
    label: string;
    onClose: () => void;
    children: React.ReactNode;
    busy?: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const close = useRef(onClose), pending = useRef(busy);
    close.current = onClose;
    pending.current = busy;
    useEffect(() => {
        const prior = document.activeElement as HTMLElement | null;
        const root = ref.current;
        const selector = 'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]';
        (root?.querySelector<HTMLElement>(selector) || root)?.focus();
        function key(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (!pending.current) close.current();
            }
            if (event.key !== 'Tab' || !root) return;
            const items = Array.from(root.querySelectorAll<HTMLElement>(selector));
            const first = items[0], last = items.at(-1);
            if (!first) {
                event.preventDefault();
                root.focus();
            } else if (!root.contains(document.activeElement)) {
                event.preventDefault();
                (event.shiftKey ? last : first)?.focus();
            } else if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
        document.addEventListener('keydown', key);
        return () => {
            document.removeEventListener('keydown', key);
            prior?.focus();
        };
    }, []);
    return <div className="modal-shade" onMouseDown={event => {
        if (event.target === event.currentTarget && !busy) onClose();
    }}>
        <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
            {children}
        </div>
    </div>;
}
