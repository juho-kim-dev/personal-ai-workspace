'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createWikiWebMCP, type WikiWebMCPBindings, type WikiWebMCPStatus } from '../../lib/wiki-webmcp';

/** Call once in WikiApp, even when settings are closed. No fallback registry. */
export function useWikiWebMCP(bindings: WikiWebMCPBindings): WikiWebMCPStatus & { pending: boolean } {
  const latest = useRef(bindings);
  useLayoutEffect(() => { latest.current = bindings; });
  const [state, setState] = useState<WikiWebMCPStatus>({ status: 'unavailable' });
  const [pending, setPending] = useState(false);
  const mounted = useRef(false);
  const runtime = useRef<ReturnType<typeof createWikiWebMCP> | null>(null);
  useEffect(() => {
    mounted.current = true;
    if (!runtime.current) runtime.current = createWikiWebMCP(() => ({
      ...latest.current,
      onPendingChange(value) {
        if (mounted.current) setPending(value);
        latest.current.onPendingChange?.(value);
      },
    }));
    const stop = runtime.current.register((document as Document & { modelContext?: unknown }).modelContext, setState);
    return () => { mounted.current = false; stop(); };
  }, []);
  return { ...state, pending };
}
