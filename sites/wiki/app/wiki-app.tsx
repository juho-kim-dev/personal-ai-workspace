'use client';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { History, MessageCircle, Search, ArrowRight, Shuffle, UserRound, ChevronDown, Star, FilePenLine, BookOpen, EllipsisVertical, Plus, LockKeyhole, ArrowUp, ArrowDown, Link2, FolderOpen, Settings, RefreshCw, Check, FileText, X } from 'lucide-react';
import { WikiMarkup } from './wiki-markup';
import { WikiAttachmentHandle } from './components/wiki-attachment-handle';
import { WikiAuthoringTemplatePicker } from './components/wiki-authoring-template';
import { copyWikiAuthoringTemplate, copyWikiReportTemplate, type WikiAuthoringTemplate } from '../lib/wiki-authoring-template';
import { WikiHierarchy } from './components/wiki-hierarchy';
import { WikiContent } from './components/wiki-content';
import { WikiHome } from './wiki-home';
import { WikiSettings } from './components/wiki-settings';
import { WikiProjectIndex } from './components/wiki-project-index';
import { WIKI_CLIENT_HEADERS } from '../lib/wiki-client-protocol';
import { WikiDialog } from './components/wiki-dialog';
import { WikiDocumentInfo } from './components/wiki-document-info';
import { WikiTrash } from './components/wiki-trash';
import { WikiDiscussions, type DiscussionRouteNormalization } from './components/wiki-discussions';
import { WikiRecentDiscussions } from './components/wiki-recent-discussions';
import { useWikiWebMCP } from './components/wiki-webmcp';
import { attachmentToken, attachmentDragType } from '../lib/wiki-attachment-ui';
import { WikiProjects, projectTemplate } from './components/wiki-projects';
import { WikiBlame } from './components/wiki-blame';
import { WikiActivity } from './components/wiki-activity';
import { WikiKnowledge, WikiKnowledgeSummary } from './components/wiki-knowledge';
import {contributionLabel,type ContributionSummary} from '../lib/wiki-contribution-ui';
import './wiki-knowledge.css';
import { WikiEditorTools } from './components/wiki-editor-tools';
import { editWikiSource, wikiSourceOffset, wikiTextareaOffset, type WikiSourceChange } from '../lib/wiki-editor-tools';
import { createWikiEditorHistory, type WikiEditorHistory, type WikiEditorHistoryMetadata } from '../lib/wiki-editor-history';
import './wiki-editor-tools.css';
import { WikiReadingPreview } from './components/wiki-reading-preview';
import { DEFAULT_READING_PREVIEWS, READING_PREVIEWS_KEY, readReadingPreviews, type ReadingPreviews } from '../lib/wiki-reading-preview';
import { readWikiAccent as wikiAccent, DEFAULT_WIKI_ACCENT, type WikiAccent } from '../lib/wiki-theme';
import './wiki-theme.css';
import './wiki-activity.css';
import './wiki-blame.css';
import { WikiDiff } from './components/wiki-diff';
import { splitWikiTarget, wikiHref, modifiedLinkClick, wikiScrollPosition } from '../lib/wiki-navigation';
import { parseWikiHeadings, wikiCategories, wikiLinks, redirectTarget, sectionRange } from '../lib/wiki-text';
import { HOME, documentDraftKey, legacyEditorDrafts, movedEditorDrafts, parseRoute, spliceSection, savedDraft, readSessionDraft, writeSessionDraft, namespace, exactFirst, snippet, relativeTime, type EditorDraft } from '../lib/wiki-ui-state';
type Page = {
    document_id?: string | null;
    dataset_id?: string | null;
    title: string;
    content: string;
    version: string;
    updated_at: string;
};
type Revision = {
    contribution?: ContributionSummary;
    document_id?: string | null;
    id: string;
    title: string;
    content: string;
    summary: string;
    created_at: string;
    size: number;
    author?: string;
};
type Attachment = {
    name: string;
    mime: string;
    size: number;
    created_at: string;
    url: string;
};
type Open = (title: string, view?: string, extra?: Record<string, string>) => unknown;
const date = (s: string) => new Date(s).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
const emptyDraft: EditorDraft = { draft: '', baseline: '', fullBaseline: '', version: null, summary: '', section: null, sectionTitle: '' };
const cats = (p: Page) => wikiCategories(p.content);
async function responseJSON(response: Response) { const json: any = await response.json(); if (!response.ok)
    throw Object.assign(new Error(json.error || '요청을 처리하지 못했습니다.'), { status: response.status }); return json; }
async function api(op: string, data?: Record<string, unknown>) { return responseJSON(await fetch('/api/wiki' + (data ? '' : '?' + new URLSearchParams({ op })), data ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...WIKI_CLIENT_HEADERS }, body: JSON.stringify({ op, ...data }) } : { cache: 'no-store' })); }
async function get(op: string, title = '', extra: Record<string, string> = {}) { return responseJSON(await fetch('/api/wiki?' + new URLSearchParams({ op, ...(title ? { title } : {}), ...extra }), { cache: 'no-store' })); }
async function getRevision(title: string, id: string, documentId?: string) {
    const result: Revision = await get('revision', title, {id, ...(documentId ? {document_id:documentId} : {})});
    if (!result || result.id !== id || documentId && result.document_id !== documentId) throw new Error('요청한 판의 문서 소속을 확인할 수 없습니다.');
    return result;
}
export default function WikiApp() {
    const [pages, setPages] = useState<Page[]>([]), [title, setTitle] = useState(HOME), [view, setView] = useState('read'), [loading, setLoading] = useState(true), [error, setError] = useState(''), [toast, setToast] = useState(''), [query, setQuery] = useState(''), [suggest, setSuggest] = useState(false), [selected, setSelected] = useState(-1), [bookmarks, setBookmarks] = useState<string[]>([]), [theme, setTheme] = useState('light');
    const [routeDocumentId, setRouteDocumentId] = useState(''), [datasetId, setDatasetId] = useState<string | null>(null);
    const [draftCandidates, setDraftCandidates] = useState<{key: string; title: string; value: EditorDraft}[]>([]);
    const [unownedDrafts, setUnownedDrafts] = useState<{key:string; value:EditorDraft}[]>([]);
    const [movedDraft, setMovedDraft] = useState<{title:string; documentId:string} | null>(null);
    const editorDraftKey = useRef('');
    const [readingPreviews, setReadingPreviews] = useState<ReadingPreviews>(DEFAULT_READING_PREVIEWS);
    useEffect(() => {
        const sync = () => { try { setReadingPreviews(readReadingPreviews(localStorage.getItem(READING_PREVIEWS_KEY))); } catch {} };
        sync(); window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync);
    }, []);
    function changeReadingPreview(key: keyof ReadingPreviews, value: boolean) {
        const next = {...readingPreviews, [key]:value}; setReadingPreviews(next);
        try { localStorage.setItem(READING_PREVIEWS_KEY, JSON.stringify(next)); } catch { notify("미리보기 설정은 현재 화면에만 적용됐습니다."); }
    }
    const [accent, setAccent] = useState<WikiAccent>(DEFAULT_WIKI_ACCENT);
    const [draft, setDraft] = useState(''), [baseline, setBaseline] = useState(''), [version, setVersion] = useState<string | null>(null), [summary, setSummary] = useState(''), [saving, setSaving] = useState(false), [editorLoading, setEditorLoading] = useState(false), [editorMode, setEditorMode] = useState('source'), [sectionLine, setSectionLine] = useState<number | null>(null), [sectionTitle, setSectionTitle] = useState(''), [recovery, setRecovery] = useState<EditorDraft | null>(null), [conflict, setConflict] = useState<{
        latest: Page;
        local: string;
    } | null>(null), [sessionWarning, setSessionWarning] = useState(false);
    const [revId, setRevId] = useState(''), [rev, setRev] = useState<Revision | null>(null), [anchor, setAnchor] = useState(''), [bypass, setBypass] = useState(false), [revs, setRevs] = useState<Revision[]>([]), [historyOffset, setHistoryOffset] = useState(0), [historyLoading, setHistoryLoading] = useState(false), [compareIds, setCompareIds] = useState<string[]>([]), [comparison, setComparison] = useState<{
        before: string;
        after: string;
        left: string;
        right: string;
    } | null>(null), [revisionLoading, setRevisionLoading] = useState(false);
    const [notes, setNotes] = useState<{
        id: string;
        body: string;
        created_at: string;
    }[]>([]), [note, setNote] = useState(''), [notesLoading, setNotesLoading] = useState(false), [, setNoteSaving] = useState(false);
    const [editorPanel, setEditorPanel] = useState('write');
    const [searchTarget, setSearchTarget] = useState('title_content'), [searchNamespace, setSearchNamespace] = useState(''), [results, setResults] = useState<Page[]>([]), [searchHasMore,setSearchHasMore]=useState(false), [resultKey, setResultKey] = useState(''), [searchLoading, setSearchLoading] = useState(false), [searchOffset, setSearchOffset] = useState(0), [backNamespace, setBackNamespace] = useState(''), [backKind, setBackKind] = useState('all');
    const [changes, setChanges] = useState<Revision[]>([]), [recent, setRecent] = useState<Revision[]>([]), [changesOffset, setChangesOffset] = useState(0), [changesLoading, setChangesLoading] = useState(false), [files, setFiles] = useState<Attachment[]>([]), [filesLoading, setFilesLoading] = useState(false), [dragFeedback, setDragFeedback] = useState(''), [dragEvidence, setDragEvidence] = useState({start:false,over:false,drop:false}), [draggingFile, setDraggingFile] = useState(false), [uploading, setUploading] = useState(false), [fileError, setFileError] = useState('');
    const [newModal, setNewModal] = useState(false), [newTitle, setNewTitle] = useState(''), [confirmRestore, setConfirmRestore] = useState<Revision | null>(null), [moveModal, setMoveModal] = useState(false), [moveTitle, setMoveTitle] = useState(''), [moveSummary, setMoveSummary] = useState(''), [moveError, setMoveError] = useState(''), [moving, setMoving] = useState(false);
    const [threadId, setThreadId] = useState(''), [deletePage, setDeletePage] = useState<Page | null>(null), [deleteReason, setDeleteReason] = useState(''), [deleteError, setDeleteError] = useState(''), [deleting, setDeleting] = useState(false), [availability, setAvailability] = useState<'checking'|'missing'|'trash'|'error'>('checking');
    const [documentInfoOpen, setDocumentInfoOpen] = useState(false);
    const deletePending = useRef(false);
    const dragDepth = useRef(0), dragCompleted = useRef(false);
    const projectStarts = useRef(new Set<string>());
    const searchRef = useRef<HTMLInputElement>(null), editorRef = useRef<HTMLTextAreaElement>(null), fileRef = useRef<HTMLInputElement>(null);
    const editorCursor = useRef<{ title: string; line: number | null; request: number; start: number; end: number } | null>(null);
    const pendingEditorSelection = useRef<({ request: number; element: HTMLTextAreaElement | null } & WikiSourceChange) | null>(null);
    const composingRef = useRef(false), [composing, setComposing] = useState(false);
    const editorHistory = useRef<WikiEditorHistory | null>(null);
    const [historyState, setHistoryState] = useState({ undo: false, redo: false });
    const [historyNotice, setHistoryNotice] = useState('');
    const inputBefore = useRef<{ request: number; snapshot: WikiSourceChange; inputType: string } | null>(null);
    const compositionBefore = useRef<{ request: number; snapshot: WikiSourceChange } | null>(null);
    const fileListUploads = useRef<Map<string, Attachment> | null>(null);
    const draftRef = useRef({ ...emptyDraft, title: HOME, view: 'read', line: null as number | null });
    const pendingDrafts = useRef(new Map<string, EditorDraft>()), noteDrafts = useRef(new Map<string, string>());
    const snapshotRequest = useRef(0);
    const webSearchSnapshot = useRef('');
    const searchRequest = useRef(0);
    const webExecution = useRef<{ route: number } | null>(null);
    const scrollPending = useRef(true), scrollHash = useRef('');
    const scrollEntries = useRef(new Map<string, {x:number;y:number}>());
    const [scrollVisit, setScrollVisit] = useState(0);
    const internalHash = useRef(''), editorRequest = useRef(0), savePending = useRef(false), editorReady = useRef(false), uploadPending = useRef(false), noteReadEpoch = useRef(0), notePending = useRef(new Set<string>()), movePending = useRef(false), restoring = useRef(false);
    draftRef.current = { ...draftRef.current, title, view, draft, baseline, version, summary, line: sectionLine };
    const sourcePage = pages.find(p => routeDocumentId ? p.document_id === routeDocumentId : p.title === title);
    const identityExtra = (p?: { document_id?: string | null } | null): Record<string, string> => p?.document_id ? { document_id: p.document_id } : {};
    const sourceIdentity = routeDocumentId ? {document_id: routeDocumentId} : identityExtra(sourcePage);
    let page = sourcePage, redirectError = '', redirectAnchor = '';
    const redirectChain: string[] = [];
    if (view === 'read' && !revId && !bypass) {
        const visited = new Set([title]);
        for (let i = 0; i < 12; i++) {
            const target = page && redirectTarget(page.content);
            if (!target)
                break;
            const parsedTarget = splitWikiTarget(target), destination = parsedTarget.title;
            redirectAnchor = parsedTarget.anchor || redirectAnchor;
            if (visited.has(destination)) {
                redirectError = '넘겨주기가 순환합니다. 원문을 확인해 주세요.';
                page = sourcePage;
                break;
            }
            visited.add(destination);
            redirectChain.push(page!.title);
            page = pages.find(p => p.title === destination);
            if (!page) {
                redirectError = `넘겨줄 문서 “${destination}”가 없습니다.`;
                page = sourcePage;
                break;
            }
            if (i === 11) {
                redirectError = '넘겨주기가 너무 많습니다. 원문을 확인해 주세요.';
                page = sourcePage;
            }
        }
    }
    const templateIndex=useRef<{pages:Page[]|null;sources:Record<string,string>}>({pages:null,sources:{}});
    if(templateIndex.current.pages!==pages)templateIndex.current={pages,sources:Object.fromEntries(pages.map(p=>[p.title,p.content]))};
    const templateSources=templateIndex.current.sources;
    const effectiveTitle = page?.title || title, known = pages.map(p => p.title), categoryNames = [...new Set(pages.flatMap(cats))].sort(), namespaces = [...new Set(pages.map(p => namespace(p.title)))].sort();
    function notify(message: string) { setToast(message); setTimeout(() => setToast(''), 4000); }
    function invalidateSnapshots() { snapshotRequest.current++; }
    async function refresh() { const request = ++snapshotRequest.current; const [p, b] = await Promise.all([api('list'), api('bookmarks')]); if (request === snapshotRequest.current) { setPages(p); setBookmarks(b);  } return p as Page[]; }
    function dataChanged() { invalidateSnapshots(); void refresh().catch(e => setError(e.message)); }
    function rememberDraft() {
        const c = draftRef.current;
        if (!editorReady.current || c.view !== 'edit') return;
        const key = editorDraftKey.current || documentDraftKey(c.title, c.line, c);
        const dirty = c.draft !== c.baseline || !!c.summary || savePending.current;
        const hadDraft = pendingDrafts.current.has(key) || readSessionDraft(key) !== null;
        if (dirty) pendingDrafts.current.set(key, {...c}); else pendingDrafts.current.delete(key);
        if ((dirty || hadDraft || !key.startsWith('wiki-draft-id:')) && !writeSessionDraft(key, dirty ? c : null)) setSessionWarning(true);
    }
    function refreshHistoryState() { setHistoryState({undo: !!editorHistory.current?.canUndo, redo: !!editorHistory.current?.canRedo}); }
    function setEditor(value: EditorDraft) { draftRef.current = { ...draftRef.current, ...value }; setDraft(value.draft); setBaseline(value.baseline); setVersion(value.version); setSummary(value.summary); setSectionTitle(value.sectionTitle); editorHistory.current = value.draft.length <= 200000 ? createWikiEditorHistory({value:value.draft,start:0,end:0}) : null; inputBefore.current = compositionBefore.current = null; setHistoryNotice(''); refreshHistoryState(); }
    function changeView(t: string, v: string, extra: Record<string, string> = {}) { composingRef.current = false; setComposing(false); pendingEditorSelection.current = null; document.querySelectorAll?.('details.nav-more[open],details.action-more[open]').forEach(menu => menu.removeAttribute('open')); const route = parseRoute(wikiHref(t, v, extra)); editorRequest.current++; editorReady.current = false; draftRef.current = { ...draftRef.current, title: route.title, view: v, line: route.section }; setTitle(route.title); setRouteDocumentId(route.documentId); setView(v); setThreadId(route.thread); setDeletePage(null); setAvailability('checking'); setSectionLine(route.section); setAnchor(route.anchor); setRevId(route.revision); setBypass(route.bypass); setRev(null); setComparison(null); setCompareIds([]); setHistoryOffset(0); setChangesOffset(0); setSearchOffset(0); setError(''); setConflict(null); setRecovery(null); setDraftCandidates([]); setUnownedDrafts([]); setMovedDraft(null); editorDraftKey.current = ''; setNewModal(false); setMoveModal(false); setDocumentInfoOpen(false); setEditorPanel('write'); setConfirmRestore(null); setFileError(''); setDraggingFile(false); setDragFeedback(''); setDragEvidence({start:false,over:false,drop:false}); dragDepth.current=0; setEditorLoading(v === 'edit'); if (v === 'edit')
        setEditor({ ...emptyDraft, document_id:null, dataset_id:null }); setNotes([]); setNote(noteDrafts.current.get(route.title) || ''); setQuery(v === 'search' ? route.title : ''); setSuggest(false); setSelected(-1); }
    function scrollEntry() {
        let id = window.history.state?.wiki42ScrollEntry as string | undefined;
        if (!id) {
            id = crypto.randomUUID();
            window.history.replaceState({...window.history.state,wiki42ScrollEntry:id}, '');
        }
        return id;
    }
    function trackScroll() {
        if (scrollPending.current || scrollHash.current !== window.location.hash) return;
        scrollEntries.current.set(scrollEntry(), {x:window.scrollX || 0,y:window.scrollY || 0});
    }
    function rememberScroll() {
        trackScroll();
        if (scrollPending.current || scrollHash.current !== window.location.hash) return;
        window.history.replaceState({...window.history.state, wiki42Scroll:{hash:window.location.hash,x:window.scrollX || 0,y:window.scrollY || 0}}, '');
    }
    function replaceScrollHash(hash: string) {
        const position = wikiScrollPosition(window.history.state, window.location.hash);
        window.history.replaceState({...window.history.state, ...(position ? {wiki42Scroll:{hash,...position}} : {})}, '', hash);
        scrollHash.current = hash; internalHash.current = '';
    }
    function setHash(t: string, v: string, extra: Record<string, string> = {}) { const hash = wikiHref(t, v, extra).slice(1); if (window.location.hash.slice(1) !== hash) {
        rememberScroll();
        scrollPending.current = true;
        setScrollVisit(n => n + 1);
        internalHash.current = hash;
        window.location.hash = hash;
    } }
    function navigate(t: string, v = 'read', extra: Record<string, string> = {}) { if (webExecution.current) return false; const target = v === 'search' ? { title: t.trim().normalize('NFC'), anchor: '' } : splitWikiTarget(t); t = (target.title || draftRef.current.title).normalize('NFC'); if (['read','edit','raw','history','notes','activity','blame','discussions'].includes(v) && !extra.document_id) extra = {...identityExtra(pages.find(p => p.title === t)), ...extra}; if (target.anchor)
        extra = { anchor: target.anchor, ...extra }; const current = draftRef.current; if (current.view === 'edit' && (current.draft !== current.baseline || current.summary) && !window.confirm('저장하지 않은 초안을 보관하고 편집을 나갈까요?'))
        return false; rememberScroll(); scrollPending.current = true; setScrollVisit(n => n + 1); if (wikiHref(t,v,extra) === window.location.hash) { scrollEntries.current.delete(scrollEntry()); window.history.replaceState({...window.history.state,wiki42Scroll:null}, ''); } rememberDraft(); changeView(t, v, extra); setHash(t, v, extra); if (v === 'edit')
        void loadEditor(t, extra.section === undefined ? null : Number(extra.section), extra.document_id, extra.section_version); return true; }
    function normalizeDiscussionRoute(resolved: DiscussionRouteNormalization) {
        const current = parseRoute(window.location.hash);
        if (!resolved.isCurrent() || current.documentId !== routeDocumentId || current.view !== 'discussions' || current.title !== resolved.fromTitle ||
            current.thread !== resolved.threadId || current.anchor !== resolved.anchor ||
            draftRef.current.view !== 'discussions' || draftRef.current.title !== resolved.fromTitle || webExecution.current || savePending.current ||
            uploadPending.current || movePending.current || deletePending.current || restoring.current) return false;
        const extra = { ...identityExtra({document_id:resolved.documentId}), thread: resolved.threadId, ...(resolved.anchor ? { anchor: resolved.anchor } : {}) };
        const hash = wikiHref(resolved.title, 'discussions', extra);
        // The same authenticated thread keeps its ID-based draft. Replace the old
        // address rather than adding another Back entry or navigating via an editor.
        replaceScrollHash(hash);
        changeView(resolved.title, 'discussions', extra);
        return true;
    }
    async function loadEditor(t: string, line: number | null = null, documentId = '', sectionVersion = '') {
        const request = ++editorRequest.current;
        setEditorLoading(true);
        try {
            const p: Page | null = await get('read', t, identityExtra({document_id:documentId})).catch(e => { if (e.status !== 404 || documentId) throw e; return null; });
            if (request !== editorRequest.current) return;
            if (documentId && p?.document_id !== documentId) throw new Error('요청한 문서 식별자와 응답이 다릅니다.');
            if (!p) { try { await get('trash_read', t); throw new Error('휴지통에 보관된 문서입니다. 휴지통에서 복원해 주세요.'); } catch (e) { if ((e as {status?:number}).status !== 404) throw e; } }
            if (request !== editorRequest.current) return;
            if (p) {
                if (p.dataset_id) setDatasetId(p.dataset_id);
                t = p.title;
                setPages(ps => [p, ...ps.filter(x => x.title !== p.title && (!p.document_id || x.document_id !== p.document_id))]);
                draftRef.current.title = t; setTitle(t);
                if (p.document_id) {
                    const params = new URLSearchParams(window.location.hash.slice(1)); params.set('doc', t); params.set('document_id', p.document_id);
                    replaceScrollHash('#' + params.toString()); setRouteDocumentId(p.document_id);
                }
            }
            const identity = p?.document_id && p.dataset_id ? {document_id:p.document_id, dataset_id:p.dataset_id} : {};
            const key = documentDraftKey(t, line, identity);
            editorDraftKey.current = key;
            if (p?.document_id && p.dataset_id) {
                for (const moved of movedEditorDrafts(t, line, p.dataset_id, p.document_id)) {
                    try {
                        const owner: Page = await get('read', '', {document_id:moved.documentId});
                        if (request !== editorRequest.current) return;
                        if (owner.document_id === moved.documentId) setMovedDraft({title:owner.title, documentId:moved.documentId});
                    } catch { /* The scoped draft remains available at its fixed document address. */ }
                }
                if (request !== editorRequest.current) return;
            }
            const content = p?.content ?? (projectStarts.current.has(t) ? projectTemplate : '');
            let range = null;
            try { range = line === null ? null : sectionRange(content, line); } catch { /* An older scoped section draft can still be recovered with its own baseline. */ }
            const fresh: EditorDraft = {...identity, document_id:p?.document_id, dataset_id:p?.dataset_id, draft:range?.content ?? content, baseline:range?.content ?? content, fullBaseline:content, section:range, sectionTitle:line === null ? '' : parseWikiHeadings(content).find(h => h.index === line)?.text || '선택한 문단', version:p?.version ?? null, summary:''};
            let value = pendingDrafts.current.get(key);
            if (!value) {
                const recovered = readSessionDraft(key);
                if (recovered) {
                    if (recovered.document_id && recovered.document_id !== p?.document_id || recovered.dataset_id && recovered.dataset_id !== p?.dataset_id) throw new Error('보관된 초안의 문서 식별 범위가 다릅니다. 원본 초안을 보존했습니다.');
                }
                // A scoped tombstone prevents a preserved legacy draft from being
                // offered again after this document's draft was saved/discarded.
                let scopedStored = false;
                try { scopedStored = key.startsWith('wiki-draft-id:') && sessionStorage.getItem(key) !== null; } catch { setSessionWarning(true); }
                const candidates: {key:string;title:string;value:EditorDraft}[] = [];
                if (p?.document_id && p.dataset_id) {
                    for (const candidate of legacyEditorDrafts(t, line)) {
                        if (candidate.value.document_id && candidate.value.document_id !== p.document_id || candidate.value.dataset_id && candidate.value.dataset_id !== p.dataset_id) continue;
                        let owned = candidate.value.version === p.version;
                        if (!owned && candidate.value.version) {
                            try {
                                const revision: Revision = await get('revision', candidate.title, {id:candidate.value.version, document_id:p.document_id});
                                owned = revision.document_id === p.document_id;
                            } catch { /* A failed ownership check must never attach the draft. */ }
                        }
                        if (request !== editorRequest.current) return;
                        if (owned) candidates.push({...candidate, value:{...candidate.value, ...identity}});
                        else if (candidate.title === t) {
                            setUnownedDrafts(ds => [...ds.filter(d => d.key !== candidate.key), candidate]);
                            try {
                                if (!candidate.value.version) continue;
                                const revision: Revision = await get('revision', t, {id:candidate.value.version});
                                if (revision.document_id && revision.document_id !== p.document_id) {
                                    const owner: Page = await get('read', '', {document_id:revision.document_id});
                                    if (request === editorRequest.current) setMovedDraft({title:owner.title, documentId:revision.document_id});
                                }
                            } catch { /* The original draft remains stored for manual recovery. */ }
                        }
                    }
                    if (request !== editorRequest.current) return;
                }
                if (recovered) {
                    const otherDrafts = candidates.filter(c => c.value.draft !== recovered.draft || c.value.summary !== recovered.summary || c.value.version !== recovered.version || c.value.fullBaseline !== recovered.fullBaseline);
                    if (otherDrafts.length) setUnownedDrafts(ds => [...ds, ...otherDrafts]);
                    setEditor(fresh); setRecovery({...recovered,...identity}); setEditorLoading(false); return;
                }
                if (candidates.length && !scopedStored) {
                    setEditor(fresh); setDraftCandidates(candidates); setRecovery(candidates[0].value); setEditorLoading(false); return;
                }
                if (candidates.length) setUnownedDrafts(ds => [...ds, ...candidates]);
                if (line !== null && sectionVersion && p?.version !== sectionVersion) throw new Error('문단을 선택한 뒤 원문이 변경되었습니다. 최신 문서를 다시 열어 문단을 선택해 주세요.');
                if (line !== null && !range) throw new Error('이 문단을 찾을 수 없습니다. 전체 문서 편집으로 전환해 주세요.');
                value = fresh;
            }
            if (request !== editorRequest.current) return;
            setEditor({...value, ...identity}); editorReady.current = true; setEditorLoading(false);
        } catch (e) {
            if (request === editorRequest.current) { setError((e as Error).message); setEditorLoading(false); }
        }
    }
    function restoreDraft(value: EditorDraft) {
        setEditor(value); editorReady.current = true; setRecovery(null); setDraftCandidates([]);
        pendingDrafts.current.set(editorDraftKey.current, value);
        writeSessionDraft(editorDraftKey.current, value);
    }
    function discardDraft() {
        // The title-keyed original is retained when recovery connected it to an ID.
        writeSessionDraft(editorDraftKey.current, null); pendingDrafts.current.delete(editorDraftKey.current);
        setRecovery(null); setDraftCandidates([]); void loadEditor(title, sectionLine, routeDocumentId, parseRoute(window.location.hash).sectionVersion);
    }
    function replaceResolvedRoute(resolvedTitle: string, documentId: string) {
        const current = parseRoute(window.location.hash);
        if (current.documentId !== documentId) return;
        const params = new URLSearchParams(window.location.hash.slice(1)); params.set('doc', resolvedTitle);
        replaceScrollHash('#' + params.toString());
    }
    async function edit(t = effectiveTitle, line?: number) { navigate(t, 'edit', line === undefined ? {} : { section: String(line), ...(pages.find(p => p.title === t)?.version ? {section_version:pages.find(p => p.title === t)!.version} : {}) }); }
    function expandSection() {
        const current = draftRef.current;
        if (!editorReady.current || current.line === null) {
            void edit(title);
            return;
        }
        const key = documentDraftKey(current.title, null, current), retained = pendingDrafts.current.get(key) || readSessionDraft(key);
        if (retained && !window.confirm('보관된 전체 문서 초안이 있습니다. 현재 문단 초안을 포함한 원문으로 바꿀까요?'))
            return;
        const value: EditorDraft = { ...current, draft: spliceSection(current), baseline: current.fullBaseline, fullBaseline: current.fullBaseline, section: null, sectionTitle: '' };
        pendingDrafts.current.delete(editorDraftKey.current);
        writeSessionDraft(editorDraftKey.current, null);
        editorDraftKey.current = key;
        draftRef.current.line = null;
        setSectionLine(null);
        setEditor(value);
        setHash(current.title, 'edit', identityExtra(current));
        pendingDrafts.current.set(key, value);
        writeSessionDraft(key, value);
    }
    function updateDraft(value: string) { draftRef.current.draft = value; setDraft(value); }
    function recordEditorChange(before: WikiSourceChange, after: WikiSourceChange, metadata: WikiEditorHistoryMetadata) {
        if (after.value.length > 200000) { setError('원문은 200,000자 이하여야 합니다. 변경하지 않았습니다.'); return false; }
        let history = editorHistory.current;
        if (!history) {
            editorHistory.current = createWikiEditorHistory(before.value.length <= 200000 ? before : after);
            history = editorHistory.current;
            if (before.value.length > 200000) { refreshHistoryState(); return true; }
        }
        if (history.snapshot.value !== before.value) history.reset(before);
        const result = history.record(before, after, metadata);
        if (!result.ok) { setError('편집 기록을 적용하지 못했습니다. 원문은 변경하지 않았습니다.'); return false; }
        refreshHistoryState(); setHistoryNotice(''); return true;
    }
    function inputSnapshot(textarea: HTMLTextAreaElement): WikiSourceChange {
        return {value:textarea.value, start:wikiSourceOffset(textarea.value,textarea.selectionStart), end:wikiSourceOffset(textarea.value,textarea.selectionEnd)};
    }
    function captureEditorInput(event: { inputType?: string; isComposing?: boolean; preventDefault(): void }) {
        const current = draftRef.current;
        if (current.view !== 'edit' || !editorReady.current || composingRef.current || event.isComposing) return;
        if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
            event.preventDefault(); changeEditorHistory(event.inputType === 'historyUndo' ? 'undo' : 'redo'); return;
        }
        if (event.inputType || !inputBefore.current)
            inputBefore.current = {request:editorRequest.current,snapshot:editorSelection(),inputType:event.inputType || ''};
    }
    function changeEditorInput(textarea: HTMLTextAreaElement, inputType = '') {
        const after = inputSnapshot(textarea), pending = inputBefore.current;
        const before = pending?.request === editorRequest.current ? pending.snapshot : editorSelection();
        inputBefore.current = null; pendingEditorSelection.current = null;
        if (!composingRef.current && !recordEditorChange(before, after, {kind:'input',inputType:pending?.inputType || inputType,timestamp:Date.now()})) return;
        updateDraft(after.value);
        const current = draftRef.current;
        editorCursor.current = {title:current.title,line:current.line,request:editorRequest.current,start:after.start,end:after.end};
    }
    function startEditorComposition() {
        compositionBefore.current = {request:editorRequest.current,snapshot:editorSelection()};
        inputBefore.current = null; editorHistory.current?.breakGroup(); composingRef.current = true; setComposing(true);
    }
    function finishEditorComposition(textarea: HTMLTextAreaElement) {
        const before = compositionBefore.current, after = inputSnapshot(textarea);
        composingRef.current = false; setComposing(false); compositionBefore.current = inputBefore.current = null;
        if (before?.request === editorRequest.current && !recordEditorChange(before.snapshot,after,{kind:'composition'})) { commitEditorChange(before.snapshot,false); return; }
        updateDraft(after.value);
        const current = draftRef.current;
        editorCursor.current = {title:current.title,line:current.line,request:editorRequest.current,start:after.start,end:after.end};
    }
    function changeEditorHistory(direction: 'undo'|'redo') {
        const current = draftRef.current;
        if (current.view !== 'edit' || !editorReady.current || composingRef.current || savePending.current || uploadPending.current) return;
        const history = editorHistory.current, latest = editorSelection();
        if (!history) return;
        const result = history[direction](latest, current.summary);
        if (result.ok) { commitEditorChange(result.snapshot,false); if (result.summaryChange && current.summary === result.summaryChange.expected) { draftRef.current.summary = result.summaryChange.value; setSummary(result.summaryChange.value); } setHistoryNotice(direction === 'undo' ? '이 편집의 변경을 되돌렸습니다.' : '이 편집의 변경을 다시 실행했습니다.'); }
        refreshHistoryState();
    }
    function rememberEditorCursor() {
        const current = draftRef.current, textarea = editorRef.current;
        const pending = pendingEditorSelection.current;
        if (pending?.request === editorRequest.current && pending.value === current.draft && (!textarea || !pending.element || textarea === pending.element)) return;
        if (pending) pendingEditorSelection.current = null;
        if (textarea && current.view === 'edit' && editorReady.current)
            editorCursor.current = { title: current.title, line: current.line, request: editorRequest.current, start: wikiSourceOffset(current.draft, textarea.selectionStart), end: wikiSourceOffset(current.draft, textarea.selectionEnd) };
    }
    function attachmentCursor() {
        rememberEditorCursor();
        const current = draftRef.current, saved = editorCursor.current;
        const start = saved && saved.title === current.title && saved.line === current.line && saved.request === editorRequest.current ? saved.start : current.draft.length;
        return Math.max(0, Math.min(start, current.draft.length));
    }
    function editorSelection(): WikiSourceChange {
        rememberEditorCursor();
        const current = draftRef.current, saved = editorCursor.current;
        const same = saved && saved.title === current.title && saved.line === current.line && saved.request === editorRequest.current;
        return { value: current.draft, start: same ? saved.start : current.draft.length, end: same ? saved.end : current.draft.length };
    }
    function applyEditorChange(change: WikiSourceChange) {
        const current = draftRef.current;
        if (current.view !== 'edit' || !editorReady.current || composingRef.current || savePending.current || uploadPending.current) return;
        commitEditorChange(change);
    }
    function applyAuthoringTemplate(source?: WikiAuthoringTemplate) {
        const current = draftRef.current;
        const target = {
            ready: current.view === 'edit' && editorReady.current && !composingRef.current && !savePending.current && !uploadPending.current && !webExecution.current && availability === 'missing',
            existing: !!sourcePage, version: current.version, section: current.line, content: current.draft, summary: current.summary,
        };
        const copy = source ? copyWikiAuthoringTemplate(source,target) : copyWikiReportTemplate(target);
        if (!copy || (source && source.dataset_id !== datasetId) || !commitEditorChange({value:copy.content,start:0,end:0}, true, {kind:'tool',summary:{before:current.summary,after:copy.summary}})) return false;
        draftRef.current.summary = copy.summary; setSummary(copy.summary);
        rememberDraft();
        return true;
    }
    async function loadAuthoringTemplate(documentId: string): Promise<WikiAuthoringTemplate> {
        const request = editorRequest.current;
        const source = await get('read', '', {document_id:documentId});
        if (request !== editorRequest.current || draftRef.current.view !== 'edit') throw new Error('편집 위치가 바뀌었습니다. 양식을 다시 선택해 주세요.');
        if (source.document_id !== documentId || !source.dataset_id) throw new Error('양식의 문서 식별자를 확인할 수 없습니다.');
        setDatasetId(source.dataset_id);
        return source;
    }
    function commitEditorChange(change: WikiSourceChange, record = true, metadata: WikiEditorHistoryMetadata = {kind:'tool'}) {
        const current = draftRef.current, request = editorRequest.current;
        if (change.value.length > 200000) { setError('원문은 200,000자 이하여야 합니다. 변경하지 않았습니다.'); return false; }
        if (record && !recordEditorChange(editorSelection(), change, metadata)) return false;
        inputBefore.current = null;
        const pending = { ...change, request, element: editorRef.current }; pendingEditorSelection.current = pending;
        updateDraft(change.value); setEditorMode('source');
        editorCursor.current = { title: current.title, line: current.line, request, start: change.start, end: change.end };
        setTimeout(() => {
            if (pendingEditorSelection.current !== pending) return;
            if (editorRequest.current !== request || draftRef.current.view !== 'edit' || draftRef.current.draft !== change.value) { pendingEditorSelection.current = null; return; }
            editorRef.current?.focus(); editorRef.current?.setSelectionRange(wikiTextareaOffset(change.value, change.start), wikiTextareaOffset(change.value, change.end));
            pendingEditorSelection.current = null;
        }, 0);
        return true;
    }
    function insert(before: string, after = '', placeholder = '') { const {value, start, end} = editorSelection(); const selectedText = value.slice(start, end) || placeholder; applyEditorChange({value: value.slice(0, start) + before + selectedText + after + value.slice(end), start: start + before.length, end: start + before.length + selectedText.length}); }
    async function save() { if (webExecution.current || savePending.current || !editorReady.current || draftRef.current.view !== 'edit')
        return; const submitted = { ...draftRef.current }, submittedRequest = editorRequest.current, key = editorDraftKey.current || documentDraftKey(submitted.title, submitted.line, submitted); savePending.current = true; setSaving(true); setError(''); try {
        const p: Page = await api('save', { ...identityExtra(submitted), title: submitted.title, content: spliceSection(submitted), summary: submitted.summary || '문서 편집', expected_version: submitted.version });
        invalidateSnapshots();
        setPages(ps => p.document_id && ps.some(x => x.document_id && (x.title === p.title && x.document_id !== p.document_id || x.document_id === p.document_id && x.title !== p.title)) ? ps : [p, ...ps.filter(x => x.title !== p.title)]);
        const current = draftRef.current, isCurrent = editorRequest.current === submittedRequest && current.document_id === submitted.document_id && current.dataset_id === submitted.dataset_id && current.title === submitted.title && current.view === 'edit' && current.line === submitted.line;
        const retained = isCurrent && editorReady.current ? current : pendingDrafts.current.get(key);
        if (retained) {
            if (retained.draft === submitted.draft && retained.summary === submitted.summary) {
                pendingDrafts.current.delete(key);
                writeSessionDraft(key, null);
            }
            else {
                const next = {...savedDraft(retained, p.content, p.version, submitted.draft), document_id:p.document_id, dataset_id:p.dataset_id};
                pendingDrafts.current.set(key, next);
                writeSessionDraft(key, next);
            }
        }
        if (isCurrent) {
            editorDraftKey.current = documentDraftKey(p.title, submitted.line, p);
            editorRequest.current++;
            editorReady.current = true;
            setEditorLoading(false);
            setEditor({...savedDraft(current, p.content, p.version, submitted.draft), document_id:p.document_id, dataset_id:p.dataset_id});
            if (current.draft === submitted.draft && current.summary === submitted.summary) {
                setEditor({ ...savedDraft(current, p.content, p.version, submitted.draft), summary: '' });
                changeView(p.title, 'read', identityExtra(p));
                setHash(p.title, 'read', identityExtra(p));
            }
        }
        notify('문서를 저장했습니다.');
    }
    catch (e) {
        const active = draftRef.current;
        if (editorRequest.current === submittedRequest && active.document_id === submitted.document_id && active.title === submitted.title && active.view === 'edit' && active.line === submitted.line) {
            setError((e as Error).message);
            if ((e as {
                status?: number;
            }).status === 409) {
                try {
                    const latest = await get('read', submitted.title, identityExtra(submitted));
                    if (submitted.document_id && (latest.document_id !== submitted.document_id || latest.title !== submitted.title)) throw new Error('문서가 이동했습니다. 보관된 초안을 현재 고정 주소에서 확인해 주세요.');
                    if (!submitted.document_id && latest.document_id) {
                        if (!submitted.version) throw new Error('기존 문서와 새 초안을 자동 연결할 수 없습니다.');
                        await getRevision(submitted.title, submitted.version, latest.document_id);
                    }
                    if (editorRequest.current === submittedRequest && draftRef.current.document_id === submitted.document_id && draftRef.current.title === submitted.title && draftRef.current.view === 'edit' && draftRef.current.line === submitted.line)
                        setConflict({ latest, local: spliceSection(draftRef.current) });
                }
                catch {
                    setError('충돌한 최신 원문을 불러오지 못했습니다. 초안은 보관되어 있습니다.');
                }
            }
        }
        else
            notify('이전 문서의 저장에 실패했습니다. 보관된 초안을 확인해 주세요.');
    }
    finally {
        savePending.current = false;
        setSaving(false);
    } }
    function acceptMerge() {
        if (!conflict) return;
        const c = draftRef.current, oldKey = editorDraftKey.current;
        if (c.document_id && (conflict.latest.document_id !== c.document_id || conflict.latest.title !== c.title)) return;
        const value: EditorDraft = {...emptyDraft, document_id:conflict.latest.document_id ?? c.document_id, dataset_id:conflict.latest.dataset_id ?? c.dataset_id, draft:conflict.local, baseline:conflict.latest.content, fullBaseline:conflict.latest.content, version:conflict.latest.version, summary:c.summary};
        const identityConnected = !!value.document_id && !c.document_id;
        if (!identityConnected) { pendingDrafts.current.delete(oldKey); writeSessionDraft(oldKey, null); }
        draftRef.current.line = null; setSectionLine(null);
        editorDraftKey.current = documentDraftKey(c.title, null, value);
        setEditor(value); setConflict(null); setError(''); setHash(c.title, 'edit', identityExtra(value)); setRouteDocumentId(value.document_id || ''); editorReady.current = true;
        pendingDrafts.current.set(editorDraftKey.current, value); writeSessionDraft(editorDraftKey.current, value);
    }
    useEffect(() => { rememberDraft(); }, [draft, summary, baseline, version]);
    useEffect(() => {
        const textarea = editorRef.current;
        if (view !== 'edit' || editorMode !== 'source' || !textarea) return;
        const before = (event: InputEvent) => captureEditorInput(event);
        textarea.addEventListener?.('beforeinput',before);
        return () => textarea.removeEventListener?.('beforeinput',before);
    }, [view, editorMode, loading]);
    useEffect(() => { let saved = 'light', savedAccent: WikiAccent = DEFAULT_WIKI_ACCENT; try { saved = localStorage.getItem('wiki-theme') === 'dark' ? 'dark' : 'light'; savedAccent = wikiAccent(localStorage.getItem('wiki-accent')); } catch { /* Settings remain usable when browser storage is unavailable. */ } setTheme(saved); setAccent(savedAccent); document.documentElement.dataset.theme = saved; document.documentElement.dataset.accent = savedAccent; void (async () => { const request = ++snapshotRequest.current; try {
        let p = await api('list');
        if (!p.length) {
            await api('initialize', {});
            p = await api('list');
        }
        const b = await api('bookmarks');
        if (request === snapshotRequest.current) { setPages(p); setBookmarks(b);  }
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setLoading(false);
    } })(); function route() { if (location.hash.slice(1) === internalHash.current && internalHash.current) {
        internalHash.current = '';
        return;
    } internalHash.current = ''; scrollPending.current = true; setScrollVisit(n => n + 1); if (location.hash && !new URLSearchParams(location.hash.slice(1)).has('doc') && !new URLSearchParams(location.hash.slice(1)).has('document_id')) {
        setAnchor(location.hash.slice(1));
        return;
    } const r = parseRoute(location.hash); rememberDraft(); const extra = { ...identityExtra({document_id:r.documentId}), ...(r.thread ? { thread: r.thread } : {}), ...(r.revision ? { rev: r.revision } : {}), ...(r.anchor ? { anchor: r.anchor } : {}), ...(r.section !== null ? { section: String(r.section) } : {}), ...(r.sectionVersion ? {section_version:r.sectionVersion} : {}), ...(r.bypass ? { redirect: 'no' } : {}) }; changeView(r.title, r.view, extra); if (r.view === 'edit')
        void loadEditor(r.title, r.section, r.documentId, r.sectionVersion); } const previousRestoration = window.history.scrollRestoration; window.history.scrollRestoration = 'manual';
        function pop() { scrollPending.current = true; if (location.hash === scrollHash.current) route(); }
        route(); window.addEventListener('hashchange', route); window.addEventListener('popstate', pop); window.addEventListener('scroll', trackScroll, {passive:true}); function before(e: BeforeUnloadEvent) { rememberDraft(); const c = draftRef.current; if (savePending.current || pendingDrafts.current.size || (c.view === 'edit' && (c.draft !== c.baseline || c.summary))) {
        e.preventDefault();
        e.returnValue = '';
    } } window.addEventListener('beforeunload', before); const keyboard = (e: KeyboardEvent) => { if (e.defaultPrevented || e.isComposing || composingRef.current || e.keyCode === 229 || document.querySelector?.('[role="dialog"]'))
        return; if ((e.ctrlKey || e.metaKey) && e.key === 's' && draftRef.current.view === 'edit') {
        e.preventDefault();
        void save();
        return;
    } if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchRef.current?.focus();
    } if (e.key === 'Escape') {
        setSuggest(false);
        setSelected(-1);
    } }; window.addEventListener('keydown', keyboard); return () => { editorRequest.current++; window.history.scrollRestoration = previousRestoration; window.removeEventListener('scroll', trackScroll); window.removeEventListener('popstate', pop); window.removeEventListener('hashchange', route); window.removeEventListener('beforeunload', before); window.removeEventListener('keydown', keyboard); }; }, []);
    useEffect(() => {
        let cancelled = false;
        const requestedId = routeDocumentId || sourcePage?.document_id;
        if (!requestedId || view === 'edit') return;
        get('read', '', {document_id:requestedId}).then((p: Page) => {
            if (cancelled || p.document_id !== requestedId) return;
            if (p.dataset_id) setDatasetId(p.dataset_id);
            setPages(ps => [p, ...ps.filter(x => x.title !== p.title && x.document_id !== p.document_id)]);
            if (routeDocumentId) { setTitle(p.title); draftRef.current.title = p.title; replaceResolvedRoute(p.title, routeDocumentId); }
        }).catch(e => { if (!cancelled) { setError(e.message); setAvailability('error'); } });
        return () => { cancelled = true; };
    }, [routeDocumentId, view, sourcePage?.document_id]);
    useEffect(() => {
        if (!routeDocumentId || !sourcePage || view === 'edit' || sourcePage.title === title) return;
        setTitle(sourcePage.title); draftRef.current.title = sourcePage.title; replaceResolvedRoute(sourcePage.title, routeDocumentId);
    }, [routeDocumentId, sourcePage?.title, title, view]);
    useEffect(() => { if (loading || view === 'edit')
        return; void refresh().catch(e => setError(e.message)); const focus = () => { if (draftRef.current.view !== 'edit')
        void refresh().catch(() => { }); }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, [title, view, loading]);
    useEffect(() => {
        if (!scrollPending.current || loading || revisionLoading || editorLoading) return;
        // The route may already have changed while React still displays the departing page.
        const hash = window.location.hash, route = parseRoute(hash);
        if (route.title !== title || route.view !== view || route.documentId !== routeDocumentId || route.revision !== revId) return;
        if (revId && rev?.id !== revId) return;
        if (view === 'read' && routeDocumentId && !sourcePage && availability === 'checking') return;
        const destination = anchor || redirectAnchor;
        let frame = 0;
        const timer = setTimeout(() => {
            if (window.location.hash !== hash) return;
            const element = document.getElementById(destination); let parent = element?.parentElement;
            while (parent) {
                if (parent.tagName === 'DETAILS') parent.setAttribute('open', '');
                parent.querySelector<HTMLButtonElement>(':scope > .folding-controls > button[aria-expanded="false"]')?.click();
                parent = parent.parentElement;
            }
            frame = requestAnimationFrame(() => {
                if (window.location.hash !== hash) return;
                const position = scrollEntries.current.get(scrollEntry()) || wikiScrollPosition(window.history.state, hash);
                if (position) window.scrollTo({left:position.x,top:position.y,behavior:'instant'});
                else if (element) element.scrollIntoView({block:'start',behavior:'instant'});
                else window.scrollTo({left:0,top:0,behavior:'instant'});
                scrollHash.current = hash; scrollPending.current = false; trackScroll();
            });
        }, 0);
        return () => { clearTimeout(timer); if (frame) cancelAnimationFrame(frame); };
    }, [scrollVisit, anchor, redirectAnchor, title, view, routeDocumentId, revId, rev?.id, loading, revisionLoading, editorLoading, page?.version, availability, threadId]);
    useEffect(() => { let cancelled = false; if (view === 'history') {
        setRevs([]);
        setHistoryLoading(true);
        get('history', title, { ...sourceIdentity, offset: String(historyOffset), limit: '50' }).then((r: Revision[]) => {
            if (!Array.isArray(r) || sourceIdentity.document_id && r.some(item => item.document_id !== sourceIdentity.document_id)) throw new Error('역사 응답의 문서 소속을 확인할 수 없습니다.');
            if (!cancelled) setRevs(r); }).catch(e => { if (!cancelled)
            setError(e.message); }).finally(() => { if (!cancelled)
            setHistoryLoading(false); });
    } return () => { cancelled = true; }; }, [title, view, historyOffset, sourceIdentity.document_id]);
    useEffect(() => { let cancelled = false; if (['read','raw','blame'].includes(view) && revId) {
        setRev(null);
        setRevisionLoading(true);
        getRevision(title, revId, routeDocumentId).then((r: Revision) => { if (!cancelled) {
            setRev(r);
            if (!routeDocumentId && r.document_id) {
                const params = new URLSearchParams(window.location.hash.slice(1)); params.set('doc', r.title); params.set('document_id', r.document_id);
                replaceScrollHash('#' + params.toString());
                setRouteDocumentId(r.document_id); setTitle(r.title); draftRef.current.title = r.title;
            }
        } }).catch(e => { if (!cancelled)
            setError(e.message); }).finally(() => { if (!cancelled)
            setRevisionLoading(false); });
    }
    else
        setRevisionLoading(false); return () => { cancelled = true; }; }, [title, view, revId, routeDocumentId]);
    useEffect(() => { let cancelled = false; const epoch = ++noteReadEpoch.current; if (view === 'notes') {
        setNotes([]);
        setNotesLoading(true);
        setNote(noteDrafts.current.get(title) || '');
        get('notes', title, sourceIdentity).then(r => { if (!cancelled && epoch === noteReadEpoch.current)
            setNotes(r); }).catch(e => { if (!cancelled)
            setError(e.message); }).finally(() => { if (!cancelled)
            setNotesLoading(false); });
    } return () => { cancelled = true; }; }, [title, view, sourceIdentity.document_id]);
    const searchKey = JSON.stringify([title, searchTarget, searchNamespace, searchOffset]);
    const webMcp = useWikiWebMCP({
        getGuard: () => ({
            dirty: (draftRef.current.view === 'edit' && (draftRef.current.draft !== draftRef.current.baseline || !!draftRef.current.summary)) || (view === 'notes' && !!note.trim()),
            busy: loading || editorLoading || savePending.current || uploadPending.current || movePending.current || deletePending.current || restoring.current || notePending.current.size > 0 || !!newModal || !!moveModal || !!deletePage || !!confirmRestore || !!recovery || !!conflict || view === 'discussions' || (webExecution.current !== null && webExecution.current.route !== editorRequest.current),
        }),
        onPendingChange: pending => { webExecution.current = pending ? { route: editorRequest.current } : null; },
        onSearch: (found, input) => {
            const scope = (input.namespace || '').trim().normalize('NFC'), query = input.query.trim().normalize('NFC');
            const key = JSON.stringify([query, input.target, scope, 0]);
            searchRequest.current++;
            webSearchSnapshot.current = key;
            flushSync(() => {
                setSearchTarget(input.target); setSearchNamespace(scope);
                rememberDraft(); changeView(query, 'search'); setHash(query, 'search'); window.scrollTo({ top: 0 });
                setResults(exactFirst(scope === '문서' ? found.filter(p => namespace(p.title) === '문서') : found, input.query).slice(0,20)); setSearchHasMore(found.length>20);
                setResultKey(key); setSearchLoading(false);
            });
        },
        onRead: fetched => {
            invalidateSnapshots();
            flushSync(() => {
                setPages(current => [...current.filter(p => p.title !== fetched.title), fetched]);
                rememberDraft(); changeView(fetched.title, 'read', { ...identityExtra(fetched), redirect: 'no' }); setHash(fetched.title, 'read', { ...identityExtra(fetched), redirect: 'no' }); window.scrollTo({ top: 0 });
            });
        },
        onSave: saved => {
            invalidateSnapshots();
            flushSync(() => {
                setPages(current => [...current.filter(p => p.title !== saved.title), saved]);
                rememberDraft(); changeView(saved.title, 'read', { ...identityExtra(saved), redirect: 'no' }); setHash(saved.title, 'read', { ...identityExtra(saved), redirect: 'no' }); window.scrollTo({ top: 0 });
                notify('새 판을 저장했습니다. 역사에서 변경 내용과 기여 기록을 확인할 수 있습니다.');
            });
        },
    });
    useEffect(() => { let cancelled = false; const request = ++searchRequest.current;
        const supplied = webSearchSnapshot.current === searchKey;
        webSearchSnapshot.current = '';
        if (view === 'search') {
        if (supplied) return;
        setError('');
        setSearchLoading(true);
        setResults([]);
        setResultKey('');
        get('search', '', { q: title, target: searchTarget, namespace: searchNamespace, paged:'true',offset:String(searchOffset),limit:'20' }).then(r => { if (!cancelled && request === searchRequest.current) {
            const rows=Array.isArray(r)?r:r.items; if(!Array.isArray(rows))throw new Error('검색 결과 형식을 확인할 수 없습니다.');
            setResults(exactFirst(searchNamespace === '문서' ? rows.filter((p: Page) => namespace(p.title) === '문서') : rows, title));setSearchHasMore(Array.isArray(r)?rows.length===20:!!r.has_more);
            setResultKey(searchKey);
        } }).catch(e => { if (!cancelled && request === searchRequest.current)
            setError(e.message); }).finally(() => { if (!cancelled && request === searchRequest.current)
            setSearchLoading(false); });
    } return () => { cancelled = true; }; }, [title, view, searchTarget, searchNamespace, searchOffset]);
    useEffect(() => { let cancelled = false; if (view === 'changes') {
        setChanges([]);
        setChangesLoading(true);
        get('changes', '', { offset: String(changesOffset), limit: '50' }).then(r => { if (!cancelled)
            setChanges(r); }).catch(e => { if (!cancelled)
            setError(e.message); }).finally(() => { if (!cancelled)
            setChangesLoading(false); });
    } return () => { cancelled = true; }; }, [view, changesOffset]);
    useEffect(() => { let cancelled = false; get('changes', '', { offset: '0', limit: '9' }).then(r => { if (!cancelled)
        setRecent(r); }).catch(() => { }); return () => { cancelled = true; }; }, [pages]);
    useEffect(() => { let cancelled = false; if (view === 'files' || view === 'edit') {
        const completed = new Map<string, Attachment>();
        fileListUploads.current = completed;
        setFileError('');
        setFilesLoading(true);
        fetch('/api/files', { cache: 'no-store' }).then(responseJSON).then(r => { if (!cancelled)
            // A list snapshot may predate uploads completed while this GET was pending.
            setFiles([...new Map<string, Attachment>([...r.map((file: Attachment) => [file.name, file] as const), ...completed]).values()]); }).catch(e => { if (!cancelled)
            setFileError(e.message); }).finally(() => { if (!cancelled)
            setFilesLoading(false); });
    } return () => { cancelled = true; fileListUploads.current = null; }; }, [view]);
    async function submitNote(e: React.FormEvent) { e.preventDefault(); const submittedTitle = title, body = note; if (!body.trim() || notePending.current.has(submittedTitle))
        return; notePending.current.add(submittedTitle); setNoteSaving(true); try {
        const result = await api('note', { ...sourceIdentity, title: submittedTitle, body });
        if (noteDrafts.current.get(submittedTitle) === body)
            noteDrafts.current.delete(submittedTitle);
        if (draftRef.current.title === submittedTitle && draftRef.current.view === 'notes') {
            noteReadEpoch.current++;
            setNotesLoading(false);
            setNotes(result);
            setNote(noteDrafts.current.get(submittedTitle) || '');
            notify('메모를 남겼습니다.');
        }
    }
    catch (e) {
        if (draftRef.current.title === submittedTitle && draftRef.current.view === 'notes')
            setError((e as Error).message);
    }
    finally {
        notePending.current.delete(submittedTitle);
        setNoteSaving(false);
    } }
    function fileFailure(message: string) { setFileError(message); setDragFeedback(message); }
    async function upload(file: File | undefined) { if (!file || webExecution.current || uploadPending.current)
        return; setFileError(''); if (file.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'].includes(file.type)) {
        fileFailure('업로드할 수 없습니다. 10 MiB 이하의 PNG, JPEG, WebP, GIF, PDF 파일을 선택해 주세요.');
        if(fileRef.current)fileRef.current.value='';return;
    } const origin = { title, view, line: sectionLine, request: editorRequest.current }, input = fileRef.current;
    const isCurrent = () => { const current = draftRef.current; return current.title === origin.title && current.view === origin.view && current.line === origin.line && editorRequest.current === origin.request; };
    rememberEditorCursor(); uploadPending.current = true; setUploading(true); setDragFeedback('파일을 업로드하고 있습니다…'); try {
        const form = new FormData();
        form.append('file', file);
        const result: Attachment = await responseJSON(await fetch('/api/files', { method: 'POST', headers: WIKI_CLIENT_HEADERS, body: form }));
        fileListUploads.current?.set(result.name, result);
        setFiles(f => [result, ...f.filter(x => x.name !== result.name)]);
        if (isCurrent()) { setFileError(''); setDragFeedback('파일을 업로드했습니다. 파일 목록에서 확인할 수 있습니다.'); }
        const current = draftRef.current;
        if (origin.view === 'edit' && isCurrent() && editorReady.current) {
            const token = attachmentToken(result.name);
            if (!token) { fileFailure('업로드는 완료했지만 파일 링크를 만들 수 없습니다. 파일 목록에서 확인하세요.'); return; }
            // Use the live caret, or its last position before Preview unmounted the textarea.
            // Insertion never replaces the selection or an older snapshot of the draft.
            const cursor = attachmentCursor();
            if (!commitEditorChange({value:current.draft.slice(0,cursor)+token+current.draft.slice(cursor),start:cursor+token.length,end:cursor+token.length})) { fileFailure('업로드는 완료했지만 원문 길이 한도로 링크를 넣지 못했습니다. 파일 목록에서 확인하세요.'); return; }
            setDragFeedback('파일을 업로드하고 편집 커서에 링크를 넣었습니다.');notify('파일을 업로드하고 링크를 넣었습니다.');
        }
        else
            notify('파일을 업로드했습니다. 파일 목록에서 확인할 수 있습니다.');
    }
    catch (e) {
        const message = `파일 업로드 실패: ${(e as Error).message}`;
        if (isCurrent()) fileFailure(message);
        else notify(`${origin.title}에서 시작한 ${file.name || '파일'} 업로드 실패: ${(e as Error).message}`);
    }
    finally {
        uploadPending.current = false;
        setUploading(false);
        if (input) input.value = '';
    } }
    function fileDrop(e: React.DragEvent) {
        const types = Array.from(e.dataTransfer.types);
        if (!types.includes('Files') && !types.includes(attachmentDragType)) return;
        e.preventDefault(); setDraggingFile(false); dragDepth.current=0; dragCompleted.current=true; setDragEvidence(v=>({...v,drop:e.isTrusted}));
        if (blocked || uploadPending.current) { fileFailure(uploadPending.current ? '다른 파일을 업로드하고 있습니다. 완료 후 다시 넣어 주세요.' : '편집할 원문을 불러온 뒤 파일을 넣어 주세요.'); return; }
        if (e.dataTransfer.files.length) {
            if (e.dataTransfer.files.length !== 1) { fileFailure('파일은 한 번에 하나씩 넣어 주세요.'); return; }
            void upload(e.dataTransfer.files[0]); return;
        }
        const name = e.dataTransfer.getData(attachmentDragType), token = attachmentToken(name);
        if (!token || !files.some(f => f.name === name)) { fileFailure('이 위키의 첨부파일 목록에서 파일을 선택해 주세요.'); return; }
        if (!insertAttachment(name)) { fileFailure('원문 길이 한도로 첨부파일 링크를 넣지 못했습니다.'); return; }
        setDragFeedback('첨부파일 링크를 편집 커서에 넣었습니다. 저장하면 문서에 반영됩니다.');
    }
    function insertAttachment(name: string) {
        const token=attachmentToken(name); if(!token || !editorReady.current) return false;
        const current=draftRef.current, cursor=attachmentCursor();
        return commitEditorChange({value:current.draft.slice(0,cursor)+token+current.draft.slice(cursor),start:cursor+token.length,end:cursor+token.length});
    }
    async function toggleStar() { try {
        setBookmarks(await api('bookmark', { ...identityExtra(page), title: effectiveTitle, on: !bookmarks.includes(effectiveTitle) }));
    }
    catch (e) {
        setError((e as Error).message);
    } }
    async function restore(r: Revision) { if (webExecution.current || restoring.current)
        return; restoring.current = true; setSaving(true); const origin = r.title; try {
        const current = await get('read', origin, identityExtra(r));
        if (r.document_id && current.document_id !== r.document_id) throw new Error('복원할 판의 문서 식별자가 다릅니다.');
        await api('save', { ...identityExtra(current), title: current.title, content: r.content, summary: `${date(r.created_at)} 판으로 복원`, expected_version: current.version });
        invalidateSnapshots();
        await refresh();
        setConfirmRestore(null);
        if (draftRef.current.title === origin)
            navigate(origin);
        notify('이전 판을 새 이력으로 복원했습니다.');
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        restoring.current = false;
        setSaving(false);
    } }
    async function compare() { const ids = [...compareIds], origin = title; setHistoryLoading(true); try {
        const a: Revision = await getRevision(origin, ids[0], sourceIdentity.document_id), b = ids[1] ? await getRevision(origin, ids[1], sourceIdentity.document_id) : await get('read', origin, sourceIdentity);
        if (sourceIdentity.document_id && b.document_id !== sourceIdentity.document_id) throw new Error('비교할 원문의 문서 소속을 확인할 수 없습니다.');
        if (draftRef.current.title === origin && draftRef.current.view === 'history')
            setComparison({ before: a.content, after: b.content, left: date(a.created_at), right: ids[1] ? date(b.created_at) : '현재 판' });
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setHistoryLoading(false);
    } }
    async function move(e: React.FormEvent) { e.preventDefault(); if (webExecution.current || movePending.current || !page)
        return; movePending.current = true; setMoving(true); setMoveError(''); const origin = effectiveTitle; try {
        const result = await api('move', { ...identityExtra(page), title: origin, new_title: moveTitle.trim().normalize('NFC'), expected_version: page.version, summary: moveSummary });
        invalidateSnapshots();
        await refresh();
        setMoveModal(false);
        if (draftRef.current.title === origin || effectiveTitle === origin && draftRef.current.title === title)
            navigate(result.page.title, 'read', identityExtra(result.page));
        notify('문서를 이동했습니다. 이전 제목은 새 문서로 넘어갑니다.');
    }
    catch (e) {
        setMoveError((e as Error).message);
    }
    finally {
        movePending.current = false;
        setMoving(false);
    } }
    async function requestRestore(id: string) { const origin = title; try {
        const r = await getRevision(origin, id, sourceIdentity.document_id);
        if (draftRef.current.title === origin && draftRef.current.view === 'history')
            setConfirmRestore(r);
    }
    catch (e) {
        if (draftRef.current.title === origin)
            setError((e as Error).message);
    } }
    useEffect(() => {
        let active = true;
        if (loading || sourcePage || !['read', 'edit', 'raw'].includes(view)) return;
        setAvailability('checking');
        get('trash_read', title, sourceIdentity).then(() => { if(active) { setAvailability('trash'); if(draftRef.current.title === title) editorReady.current = false; } }).catch(e => { if(active) setAvailability(e.status === 404 ? 'missing' : 'error'); });
        return () => { active = false; };
    }, [title, view, loading, sourcePage, routeDocumentId]);
    async function softDelete() {
        if (webExecution.current || !deletePage || !deleteReason.trim() || deletePending.current) return;
        const captured = deletePage;
        deletePending.current = true; setDeleting(true); setDeleteError('');
        try {
            await api('trash', {...identityExtra(captured), title:captured.title, expected_version:captured.version, summary:deleteReason.trim()});
            invalidateSnapshots();
            setPages(ps => ps.filter(p => p.title !== captured.title));
            setBookmarks(bs => bs.filter(t => t !== captured.title));
            setDeletePage(null); notify('휴지통으로 이동했습니다. 이력은 보존됩니다.');
            if(draftRef.current.title === captured.title) navigate('휴지통', 'trash');
        } catch(e) { setDeleteError((e as Error).message); }
        finally { deletePending.current = false; setDeleting(false); }
    }
    function changeTheme() { const t = theme === 'light' ? 'dark' : 'light'; setTheme(t); document.documentElement.dataset.theme = t; try { localStorage.setItem('wiki-theme', t); } catch { notify('화면 설정은 현재 화면에만 적용됐습니다.'); } }
    function changeAccent(value: WikiAccent) { const next = wikiAccent(value); setAccent(next); document.documentElement.dataset.accent = next; try { localStorage.setItem('wiki-accent', next); } catch { notify('강조색은 현재 화면에만 적용됐습니다.'); } }
    function search(e: React.FormEvent) { e.preventDefault(); if (query.trim())
        navigate(query.trim(), 'search'); }
    const suggestions = exactFirst(pages.filter(p => p.title.toLocaleLowerCase().includes(query.trim().normalize('NFC').toLocaleLowerCase())), query).slice(0, 6);
    const titleLabel = ({ changes: '최근 변경', all: '모든 문서', favorites: '즐겨찾는 문서', files: '파일', settings: 'PAW Wiki 설정', trash: '휴지통', projects: '프로젝트', 'recent-discussions': '최근 토론' } as Record<string, string>)[view] || (view === 'search' ? `검색: ${title}` : view === 'read' ? effectiveTitle : title);
    useEffect(()=>{document.title=title+' — PAW Wiki';},[title]);
    const documentView = ['read','edit','knowledge','history','activity','blame','notes','discussions','backlinks','raw'].includes(view);
    const infoUsesRevision = ['read','raw','blame'].includes(view) && !!revId;
    const infoPage = view === 'read' ? page : sourcePage;
    const documentInfoSource = !loading && documentView && view !== 'edit' && !revisionLoading
        ? infoUsesRevision
            ? rev?.id === revId ? { title: rev.title, content: rev.content, version: rev.id, document_id: rev.document_id } : null
            : infoPage
        : null;
    const blocked = editorLoading || !!recovery || !editorReady.current || (!sourcePage && availability !== 'missing');
    const visibleResults = resultKey === searchKey ? results : [];
    const members = pages.filter(p => cats(p).includes(effectiveTitle.replace(/^분류:/, '')));
    const backlinks = pages.filter(p => { const target = redirectTarget(p.content); const redirect = target && splitWikiTarget(target).title === title; const linked = wikiLinks(p.content).some(link => splitWikiTarget(link).title === title); const category = title.startsWith('분류:') && cats(p).includes(title.slice(3)); return (!backNamespace || namespace(p.title) === backNamespace) && (backKind === 'redirect' ? redirect : backKind === 'category' ? category : backKind === 'link' ? linked && !redirect : linked || redirect || category); });
    return <><div inert={webMcp.pending || undefined}><header className="topbar"><div className="top-inner"><WikiAnchor title={HOME} open={navigate} className="brand"><img className="brand-mark" src="/wiki42-icon.svg" width="30" height="30" alt=""/><span className="brand-wordmark" lang="en">PAW<span className="brand-number" style={{marginLeft:"0.22em"}}>Wiki</span></span></WikiAnchor><nav className="main-nav" aria-label="주 메뉴"><WikiAnchor title="최근 변경" view="changes" open={navigate}><History size={18}/><span>최근 변경</span></WikiAnchor><WikiAnchor title="최근 토론" view="recent-discussions" open={navigate}><MessageCircle size={18}/><span>최근 토론</span></WikiAnchor><WikiAnchor title="모든 문서" view="all" open={navigate}><BookOpen size={18}/><span>모든 문서</span></WikiAnchor><details className="nav-more"><summary><FolderOpen size={18}/><span>특수 기능</span><ChevronDown size={13}/></summary><div className="dropdown"><button onClick={() => setNewModal(true)}><Plus size={16}/>새 문서</button><WikiAnchor title="PAW Wiki:프로젝트" open={navigate}>프로젝트</WikiAnchor><WikiAnchor title="검토할 항목" view="review-queue" open={navigate}>검토할 항목</WikiAnchor><WikiAnchor title="휴지통" view="trash" open={navigate}>휴지통</WikiAnchor><WikiAnchor title="파일" view="files" open={navigate}>파일</WikiAnchor><WikiAnchor title="즐겨찾는 문서" view="favorites" open={navigate}>즐겨찾기</WikiAnchor><WikiAnchor title="PAW Wiki 설정" view="settings" open={navigate}>설정 및 백업</WikiAnchor><WikiAnchor title={effectiveTitle} extra={{ anchor: 'toc' }} open={navigate}>현재 문서 목차</WikiAnchor></div></details></nav><div className="top-right"><button className="random" aria-label="아무 문서로 이동" onClick={() => { if (pages.length)
        navigate(pages[Math.floor(Math.random() * pages.length)].title); }}><Shuffle size={18}/></button><form className="search" onSubmit={search}><input ref={searchRef} role="combobox" aria-autocomplete="list" aria-expanded={suggest && !!query} aria-controls="wiki-suggestions" aria-activedescendant={selected >= 0 ? `suggestion-${selected}` : undefined} aria-label="여기에서 검색" placeholder="여기에서 검색 (/)" value={query} onChange={e => { setQuery(e.target.value); setSuggest(true); setSelected(-1); }} onFocus={() => setSuggest(true)} onBlur={() => setTimeout(() => setSuggest(false), 180)} onKeyDown={e => { if (e.key === 'Escape') {
        setSuggest(false);
        setSelected(-1);
    }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggest(true);
        setSelected(n => e.key === 'ArrowDown' ? Math.min(n + 1, suggestions.length - 1) : Math.max(n - 1, 0));
    }
    else if (e.key === 'Enter' && suggest && selected >= 0 && suggestions[selected]) {
        e.preventDefault();
        navigate(suggestions[selected].title);
    } }}/><button aria-label="검색" type="submit"><Search size={17}/></button><button type="button" aria-label="문서로 바로 이동" onClick={() => query.trim() && navigate(query.trim())}><ArrowRight size={20}/></button>{suggest && query && <div className="suggestions"><div id="wiki-suggestions" role="listbox" aria-label="문서 제안">{suggestions.map((p, i) => <WikiAnchor key={p.title} title={p.title} open={navigate} role="option" id={`suggestion-${i}`} aria-selected={selected === i} onMouseDown={e => e.preventDefault()}><FileText size={14}/>{p.title}</WikiAnchor>)}</div><button type="submit">‘{query}’ 전체 검색</button><WikiAnchor title={query.trim()} view="edit" open={navigate}>이 제목으로 문서 작성</WikiAnchor></div>}</form><button className="profile" aria-label="개인 설정" onClick={() => navigate('PAW Wiki 설정', 'settings')}><UserRound size={22}/></button></div></div></header>
 <div className="page-layout"><main className={'article-panel' + (view === 'edit' ? ' editing' : '') + (view === 'read' && page?.title === HOME && !revId ? ' home-panel' : '')}><div className="article-heading" hidden={view === 'read' && page?.title === HOME && !revId}><div><h1>{!loading && documentView ? <WikiAnchor title={effectiveTitle} extra={identityExtra(page)} open={navigate} className="article-title-link">{view === 'read' && page?.title === HOME && !revId ? '대문' : titleLabel}</WikiAnchor> : titleLabel}{['edit', 'knowledge', 'history', 'activity', 'blame', 'notes', 'discussions', 'backlinks', 'raw'].includes(view) && <small> ({({ edit: '편집', knowledge: '근거·검토', history: '역사', activity: '활동', blame: '줄별 편집 이력', notes: '메모', discussions: '토론', backlinks: '역링크', raw: 'RAW' } as Record<string, string>)[view]})</small>}</h1><p className="modified">{rev ? `판 저장 시각: ${date(rev.created_at)}` : page ? `최근 수정 시각: ${date(page.updated_at)}` : '편집장의 개인 안내서'}<span className="private-inline"><LockKeyhole size={11}/> 비공개</span></p></div>{!loading && ['read','edit','knowledge','history','activity','blame','notes','discussions','backlinks','raw'].includes(view) && <div className="article-actions"><div className="article-action-group"><button className="article-icon-action" aria-label="즐겨찾기" aria-pressed={bookmarks.includes(effectiveTitle)} onClick={() => void toggleStar()}><Star size={17} fill={bookmarks.includes(effectiveTitle) ? 'currentColor' : 'none'}/></button><button className={view === 'edit' ? 'active' : ''} onClick={() => void edit()}><FilePenLine size={15}/><span>편집</span></button><WikiAnchor title={effectiveTitle} view="discussions" extra={identityExtra(page)} open={navigate} aria-current={view === 'discussions' ? 'page' : undefined}><MessageCircle size={15}/>토론</WikiAnchor><WikiAnchor title={effectiveTitle} view="history" extra={identityExtra(page)} open={navigate} aria-current={view === 'history' ? 'page' : undefined}><History size={15}/>역사</WikiAnchor></div><details className="action-more"><summary aria-label="더 보기"><EllipsisVertical size={18}/></summary><div className="dropdown right"><WikiAnchor title={effectiveTitle} view="activity" extra={identityExtra(page)} open={navigate} aria-current={view === 'activity' ? 'page' : undefined}>활동</WikiAnchor><WikiAnchor title={effectiveTitle} view="knowledge" extra={{...identityExtra(page),...(revId?{rev:revId}:{})}} open={navigate} aria-current={view === 'knowledge' ? 'page' : undefined}>근거·검토</WikiAnchor><button disabled={!documentInfoSource} aria-haspopup="dialog" onClick={event => { const menu = event.currentTarget.closest('details'); menu?.removeAttribute('open'); menu?.querySelector('summary')?.focus(); setDocumentInfoOpen(true); }}>문서 정보</button><WikiAnchor title={effectiveTitle} extra={identityExtra(page)} open={navigate}>문서 읽기</WikiAnchor><WikiAnchor title={effectiveTitle} view="notes" extra={identityExtra(page)} open={navigate}>개인 메모</WikiAnchor><WikiAnchor title={effectiveTitle} view="backlinks" open={navigate}>역링크</WikiAnchor><button disabled={!page || view === 'edit'} onClick={() => { setDeletePage(page ? {...page} : null); setDeleteReason(''); setDeleteError(''); }}>휴지통으로 이동</button><WikiAnchor title={title} view="raw" extra={{ ...sourceIdentity, ...(revId ? { rev: revId } : {}) }} open={navigate}>RAW</WikiAnchor><button disabled={!page || view === 'edit'} onClick={() => { setMoveTitle(effectiveTitle); setMoveSummary(''); setMoveError(''); setMoveModal(true); }}>문서 이동</button>{page?.document_id && <WikiAnchor title={page.title} extra={identityExtra(page)} open={navigate}>고정 주소</WikiAnchor>}<button onClick={() => void navigator.clipboard.writeText(location.href).then(() => notify('문서 주소를 복사했습니다.')).catch(() => notify('주소창에서 문서 주소를 복사해 주세요.'))}>주소 복사</button><button onClick={() => window.print()}>문서 인쇄</button></div></details></div>}</div>
 {['read','raw','history','activity','blame','notes','discussions','backlinks'].includes(view) && (effectiveTitle.includes('/') || pages.some(p=>p.title.startsWith(effectiveTitle+'/'))) && <WikiHierarchy title={effectiveTitle} pages={pages} open={navigate}/>}
 {error && <div className="error" role="alert">{error}<button aria-label="오류 닫기" onClick={() => setError('')}><X size={16}/></button></div>}
 {loading ? <Loading text="문서를 불러오는 중입니다."/> : <>
 {view === 'read' && page && (page.title !== HOME || !!revId) && cats(rev ? { ...page, content: rev.content } : page).length > 0 && <div className="category-strip">분류: {cats(rev ? { ...page, content: rev.content } : page).map((c, i) => <span key={c}>{i > 0 && ' | '}<WikiAnchor title={'분류:' + c} open={navigate}>{c}</WikiAnchor></span>)}</div>}
 {(view === 'read' || view === 'raw') && revId && <div className="notice">과거 판 · <code>{revId}</code><span> · 포함된 틀은 현재 판을 사용합니다.</span><WikiAnchor title={title} extra={sourceIdentity} open={navigate}>현재 판 보기</WikiAnchor>{rev && <button disabled={!sourcePage} onClick={() => setConfirmRestore(rev)}>이 판으로 복원</button>}</div>}
 {view === 'read' && <>{page?.document_id && page.title !== HOME && !revisionLoading && (!revId || rev) && <WikiKnowledgeSummary key={JSON.stringify([page.document_id,rev?.id||page.version])} documentId={page.document_id} version={rev?.id||page.version} title={effectiveTitle} open={navigate}/>} {page?.title === HOME && !revId && <WikiHome pages={pages} sources={templateSources} bookmarks={bookmarks} open={navigate} create={() => setNewModal(true)}/>} {redirectChain.length > 0 && !revId && <div className="notice">{redirectChain.join(' → ')}에서 넘어옴 · <WikiAnchor title={title} extra={{ ...sourceIdentity, redirect: 'no' }} open={navigate}>넘겨주기 원문 보기</WikiAnchor></div>}{redirectError && <p className="error" role="alert">{redirectError}</p>}{bypass && sourcePage && redirectTarget(sourcePage.content) && <div className="notice">넘겨주기 문서입니다. <WikiAnchor title={redirectTarget(sourcePage.content)!} open={navigate}>대상 문서로 이동</WikiAnchor><button onClick={() => void edit(title)}>넘겨주기 편집</button></div>}{revisionLoading ? <Loading text="선택한 판을 불러오는 중입니다."/> : revId && !rev ? <p className="empty">선택한 판을 표시할 수 없습니다.</p> : rev ? <WikiContent title={title} revision={revId} onAnchor={a => { setAnchor(a); setHash(title, 'read', { ...sourceIdentity, rev: revId, anchor: a }); }} content={rev.content} sources={templateSources} documentTitle={title} open={navigate} known={known}/> : page?.title === HOME ? null : page ? <WikiContent key={page.version} title={title} bypass={bypass} onAnchor={a => { setAnchor(a); setHash(title, 'read', { ...sourceIdentity, anchor: a, ...(bypass ? { redirect: 'no' } : {}) }); }} content={page.content} sources={templateSources} documentTitle={effectiveTitle} open={navigate} edit={line => void edit(effectiveTitle, line)} known={known}/> : !title.startsWith('분류:') ? <div className="missing-page">{availability !== 'missing' ? <><h2>{availability === 'trash' ? '휴지통에 보관된 문서입니다.' : availability === 'error' ? '문서 상태를 확인할 수 없습니다.' : '문서 상태를 확인하는 중입니다.'}</h2><p>새 문서를 만들기 전에 문서 상태를 확인하세요. 휴지통 문서는 복원해서 사용할 수 있으며 역사는 보존됩니다.</p><WikiAnchor title="휴지통" view="trash" open={navigate}>휴지통 열기</WikiAnchor><WikiAnchor title={title} view="history" extra={sourceIdentity} open={navigate}>보존된 역사</WikiAnchor></> : <><h2>아직 작성되지 않은 문서입니다.</h2><p>이 제목으로 새로운 지식을 남겨 보세요.</p><button className="primary" onClick={() => void edit()}>“{title}” 문서 만들기</button></>}</div> : null}{!revId && page?.title === 'PAW Wiki:프로젝트' && <WikiProjectIndex pages={pages} open={navigate}/>}{!revId && ['PAW Wiki:안내', 'PAW Wiki:규칙과 지침'].includes(page?.title || '') && <section id="wiki42-pages" className="wiki42-page-index" aria-label="PAW Wiki 문서 전체"><h2 className="simple-heading">PAW Wiki 문서 전체</h2><p>PAW Wiki 이름공간의 현재 문서입니다. 안내·예시·초안이 함께 포함될 수 있습니다.</p><PageList list={pages.filter(p => namespace(p.title) === 'PAW Wiki').sort((a,b) => a.title.localeCompare(b.title,'ko'))} open={navigate}/></section>}{!revId && effectiveTitle.startsWith('분류:') && <><h2 className="simple-heading">하위 분류</h2><PageList list={members.filter(p => p.title.startsWith('분류:'))} open={navigate}/><h2 className="simple-heading">분류에 속하는 문서</h2><GroupedPages list={members.filter(p => !p.title.startsWith('분류:'))} open={navigate}/></>}</>}
 {view === 'raw' && (revisionLoading ? <Loading text="원문을 불러오는 중입니다."/> : <><div className="result-heading"><WikiAnchor title={title} extra={{ ...sourceIdentity, ...(revId ? { rev: revId } : {}) }} open={navigate}>문서 보기</WikiAnchor><button disabled={revId ? !rev : !sourcePage} onClick={() => void navigator.clipboard.writeText(revId ? rev?.content || '' : sourcePage?.content || '').then(() => notify('원문을 복사했습니다.')).catch(() => notify('원문을 선택해 복사해 주세요.'))}>원문 복사</button></div><pre className="raw-source">{revId ? rev?.content : sourcePage?.content}</pre></>)}
 {view === 'edit' && <>{!sourcePage && availability !== 'missing' && <p className="notice">{availability === 'trash' ? '휴지통에 보관된 문서입니다. 새로 만들지 말고 복원하세요.' : '문서 상태를 확인할 수 있어야 편집할 수 있습니다.'} <WikiAnchor title="휴지통" view="trash" open={navigate}>휴지통 열기</WikiAnchor></p>}<div className="edit-notice"><FilePenLine size={17}/>{sectionLine !== null ? `문단 편집: ${sectionTitle || '선택한 문단'}` : version ? '문서를 편집하고 있습니다. 저장하면 새 이력이 생성됩니다.' : '새 문서를 작성하고 있습니다.'}<WikiAnchor title="PAW Wiki:문법" open={navigate}>문법 도움말</WikiAnchor>{sectionLine !== null && <button disabled={saving || !!recovery} onClick={expandSection}>전체 문서 편집</button>}</div>{sessionWarning && <p className="error" role="alert">이 브라우저에서 초안을 보관할 수 없습니다. 나가기 전에 원문을 복사해 주세요.</p>}{recovery && <div className="draft-recovery" role="status"><strong>이 탭에서 작성하던 초안이 있습니다.</strong><p>원문·편집 요약과 당시의 기준 판을 함께 복구합니다.</p>{draftCandidates.length <= 1 && <pre>{recovery.draft}</pre>}{draftCandidates.length > 1 && <p>서로 다른 초안 {draftCandidates.length}개가 있습니다. 원본은 그대로 보관됩니다.</p>}{draftCandidates.length > 1 ? draftCandidates.map(candidate => <div key={candidate.key}><strong>{candidate.title}</strong><pre>{candidate.value.draft}</pre><button onClick={() => restoreDraft(candidate.value)}>이 초안 복구</button></div>) : <button onClick={() => restoreDraft(recovery)}>초안 복구</button>}<button onClick={discardDraft}>초안 버리기</button></div>}{unownedDrafts.length > 0 && <section className="draft-recovery"><h2>보관된 이전 제목 초안</h2><p>현재 문서에 자동 복구하지 않습니다. 원본 초안은 보관되어 있으며 아래 내용을 별도로 복사할 수 있습니다.</p>{unownedDrafts.map(d => <pre key={d.key}>{d.value.draft}</pre>)}</section>}{movedDraft && <p className="notice">이전 제목에서 작성한 초안은 이동된 문서에 보관되어 있습니다. <WikiAnchor title={movedDraft.title} view="edit" extra={{document_id:movedDraft.documentId}} open={navigate}>이동된 문서에서 초안 확인</WikiAnchor></p>}{editorLoading && <p role="status">편집할 원문을 불러오는 중입니다.</p>}
 <div className="editor-toolbar"><div className="editor-tabs" role="tablist" aria-label="편집 화면">{[['source', '원문'], ['preview', '미리보기'], ['changes', '변경 사항']].map(([id, label]) => <button role="tab" aria-selected={editorMode === id} key={id} onClick={() => { rememberEditorCursor(); setEditorMode(id); }}>{label}</button>)}</div><div><button disabled={blocked || composing || saving || uploading || !historyState.undo} title="되돌리기 Ctrl/⌘+Z" onClick={() => changeEditorHistory('undo')}>되돌리기</button><button disabled={blocked || composing || saving || uploading || !historyState.redo} title="다시 실행 Ctrl/⌘+Shift+Z · Ctrl+Y" onClick={() => changeEditorHistory('redo')}>다시 실행</button><button disabled={blocked} title="선택한 글을 제목으로" onClick={() => insert('\n== ', ' ==\n', '새 문단')}>제목</button><button disabled={blocked} title="선택한 글에 링크 넣기" onClick={() => { const selection = editorSelection(); const result = editWikiSource(selection.value, {type:'link'}, selection); if (result.ok) applyEditorChange(result.change); else setError(result.error); }}>링크</button><button disabled={blocked} onClick={() => insert("'''", "'''", '강조')}>굵게</button><button disabled={blocked || uploading} onClick={() => fileRef.current?.click()}>{uploading ? '업로드 중…' : '파일 넣기'}</button></div></div>
 <input className="visually-hidden" ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" aria-label="첨부파일 선택" onChange={e => void upload(e.target.files?.[0])}/>{fileError && <p className="error" role="alert">{fileError}</p>}
 {historyNotice && <p role="status" className="editor-history-notice">{historyNotice}</p>}
 {!sourcePage && sectionLine === null && <WikiAuthoringTemplatePicker key={editorRequest.current} pages={pages} disabled={blocked || saving || uploading || composing || !!draft || !!summary || !!version} load={loadAuthoringTemplate} apply={applyAuthoringTemplate} applyReport={() => applyAuthoringTemplate()}/>}
 <div className="editor-aux-nav" role="group" aria-label="작성 보조 메뉴">{[['write','작성'],['tools','찾기·서식'],['files','기존 첨부파일']].map(([id,label])=><button key={id} aria-pressed={editorPanel===id} onClick={()=>{rememberEditorCursor();setEditorPanel(id);}}>{label}</button>)}</div>
 <div hidden={editorPanel !== 'tools'}><WikiEditorTools key={JSON.stringify([title, sectionLine, editorRequest.current])} value={draft} disabled={blocked || composing} busy={saving || uploading} getSelection={editorSelection} apply={applyEditorChange}/></div><section hidden={editorPanel !== 'files'} className="attachment-palette" aria-label="기존 첨부파일 넣기"><p>파일 옆 손잡이를 편집 영역으로 끌면 현재 편집 커서에 넣습니다. 선택한 글자는 보존합니다.</p>{filesLoading ? <p>첨부파일을 불러오는 중…</p> : files.length ? <ul>{files.map(f => <li key={f.name}><WikiAttachmentHandle name={f.name} disabled={blocked||uploading} scope={editorRequest.current} rect={()=>document.querySelector('.file-drop-zone')?.getBoundingClientRect()||null} commit={insertAttachment} highlight={setDraggingFile} feedback={(message,evidence)=>{setDragFeedback(message);setDragEvidence(evidence);}}/><a href={'/api/files?' + new URLSearchParams({name:f.name})} target="_blank" rel="noopener noreferrer">{f.name}</a><button disabled={blocked} onClick={() => insertAttachment(f.name)}>원문에 넣기</button></li>)}</ul> : <p>업로드한 파일이 없습니다.</p>}</section>
 {dragFeedback&&<p role="status" className="attachment-drag-status" aria-label="첨부파일 끌어놓기 상태" data-start-trusted={String(dragEvidence.start)} data-over-trusted={String(dragEvidence.over)} data-drop-trusted={String(dragEvidence.drop)}>{dragFeedback}</p>}
 <div className={"editor-grid single file-drop-zone" + (draggingFile ? " dragging" : "")} role="tabpanel" onDragEnter={e=>{if(Array.from(e.dataTransfer.types).some(t=>t==='Files'||t===attachmentDragType)){e.preventDefault();dragDepth.current++;setDraggingFile(true);}}} onDragOver={e => { if (Array.from(e.dataTransfer.types).some(t => t === 'Files' || t === attachmentDragType)) { e.preventDefault(); e.dataTransfer.dropEffect = blocked || uploading ? 'none' : 'copy'; if(!draggingFile)setDraggingFile(true); if(!dragEvidence.over)setDragEvidence(v=>({...v,over:e.isTrusted})); } }} onDragLeave={e=>{if(!Array.from(e.dataTransfer.types).some(t=>t==='Files'||t===attachmentDragType))return;dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDraggingFile(false);}} onDrop={fileDrop}>{editorMode === 'source' && <textarea disabled={blocked} ref={editorRef} onSelect={rememberEditorCursor} onBlur={rememberEditorCursor} onBeforeInput={e => captureEditorInput(e.nativeEvent as InputEvent)} onCompositionStart={startEditorComposition} onCompositionEnd={e => finishEditorComposition(e.currentTarget)} spellCheck={false} aria-label="문서 원문" maxLength={200000} value={draft} onChange={e => changeEditorInput(e.currentTarget || e.target, (e.nativeEvent as InputEvent)?.inputType)} onKeyDown={e => { if (!composingRef.current && !e.nativeEvent?.isComposing && e.nativeEvent?.keyCode !== 229 && (e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === 'z' || e.ctrlKey && e.key.toLowerCase() === 'y')) { e.preventDefault(); changeEditorHistory(e.shiftKey || e.key.toLowerCase() === 'y' ? 'redo' : 'undo'); return; } if (!composingRef.current && !e.nativeEvent?.isComposing && e.nativeEvent?.keyCode !== 229 && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && ['b','i','k'].includes(e.key.toLowerCase())) {
                e.preventDefault();
                if (blocked || saving || uploading) return;
                const latest = editorSelection(), action = ({ b: 'bold', i: 'italic', k: 'link' } as const)[e.key.toLowerCase() as 'b'|'i'|'k'];
                const result = editWikiSource(latest.value, {type: action}, latest);
                if (result.ok) applyEditorChange(result.change); else setError(result.error);
                return;
            } if (!composingRef.current && !e.nativeEvent?.isComposing && e.nativeEvent?.keyCode !== 229 && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                void save();
            } }}/>} {editorMode === 'preview' && <div className="edit-preview"><WikiMarkup content={draft} sources={templateSources} documentTitle={title} open={navigate} known={known} idPrefix="preview-"/></div>}{editorMode === 'changes' && <WikiDiff before={baseline} after={draft}/>}</div>
 <p className="attachment-hint">파일 하나를 편집 영역에 끌어 놓으면 업로드해 현재 편집 커서에 링크를 넣습니다. 글자 선택·이동은 브라우저 기본 동작을 사용합니다.</p>
 <label className="summary-label">편집 요약<input disabled={blocked} aria-label="편집 요약" maxLength={300} placeholder="무엇을 바꾸었나요?" value={summary} onChange={e => { draftRef.current.summary = e.target.value; setSummary(e.target.value); }}/></label><div className="editor-footer"><span>{draft.length.toLocaleString()}자 · {draft !== baseline || summary ? '저장하지 않은 변경 사항' : '변경 사항 없음'} · 저장 Ctrl/⌘+S</span><button onClick={() => navigate(title)}>취소</button><button disabled={saving || blocked || !!conflict} className="primary" onClick={() => void save()}>{saving ? <RefreshCw className="spin" size={15}/> : <Check size={15}/>}저장</button></div>
 {conflict && <section className="conflict-panel"><h2>다른 판이 먼저 저장되었습니다.</h2><p>최신 원문과 내 초안을 확인하고, 아래에 보존할 전체 원문을 직접 병합해 주세요. 확인 후에도 저장 버튼을 눌러야 반영됩니다.</p><WikiDiff before={conflict.latest.content} after={conflict.local} left="서버의 최신 원문" right="내 초안"/><label>병합할 전체 원문<textarea aria-label="병합 원문" value={conflict.local} onChange={e => setConflict({ ...conflict, local: e.target.value })}/></label><button onClick={acceptMerge}>병합 원문 확인 · 편집 계속</button><button onClick={() => setConflict(null)}>초안으로 돌아가기</button></section>}</>}
 {view === 'activity' && <WikiActivity key={JSON.stringify([title, sourceIdentity.document_id])} title={title} documentId={sourceIdentity.document_id}/>}
 {view === 'blame' && (revisionLoading ? <Loading text="선택한 판의 문서를 확인하는 중입니다."/> : revId && !rev ? <p className="empty">선택한 판을 표시할 수 없습니다.</p> : <WikiBlame key={JSON.stringify([title, revId, routeDocumentId])} title={title} documentId={sourceIdentity.document_id} revision={revId}/>)}
 {view === 'history' && <><div className="notice">판 하나를 선택하면 현재 판과, 두 개를 선택하면 선택한 판끼리 비교합니다. 복원은 새 이력으로 남습니다.</div><div className="result-heading"><WikiAnchor title={title} view="activity" extra={sourceIdentity} open={navigate}>이 문서 활동</WikiAnchor><WikiAnchor title={title} view="blame" extra={sourceIdentity} open={navigate}>현재 판 줄별 편집 이력 (Blame)</WikiAnchor><span>{compareIds.length}개 판 선택</span><button disabled={!compareIds.length || historyLoading} onClick={() => void compare()}>선택한 판 비교</button></div>{historyLoading ? <Loading text="이력을 불러오는 중입니다."/> : <div className="history-list">{revs.length ? revs.map(r => <div className="revision" key={r.id}><input type="checkbox" aria-label={`${r.id} 판 선택`} checked={compareIds.includes(r.id)} disabled={!compareIds.includes(r.id) && compareIds.length === 2} onChange={e => setCompareIds(ids => e.target.checked ? [...ids, r.id] : ids.filter(id => id !== r.id))}/><div><WikiAnchor title={title} extra={{ ...identityExtra(r), rev: r.id }} open={navigate}>{date(r.created_at)}</WikiAnchor><code className="rev-id" title={r.id}>{r.id.slice(0, 8)}</code>{page?.version === r.id && <small> 현재</small>}<p>{r.summary || '편집 요약 없음'}</p><small>{contributionLabel(r.contribution)} · {r.size.toLocaleString()}자</small></div><div className="rev-actions"><WikiAnchor title={title} extra={{ ...identityExtra(r), rev: r.id }} open={navigate}>보기</WikiAnchor><WikiAnchor title={title} view="raw" extra={{ ...identityExtra(r), rev: r.id }} open={navigate}>RAW</WikiAnchor><WikiAnchor title={title} view="blame" extra={{ ...identityExtra(r), rev: r.id }} open={navigate}>줄별 편집 이력</WikiAnchor><button disabled={!sourcePage} onClick={() => void requestRestore(r.id)}>복원</button></div></div>) : <p className="empty">저장된 이력이 없습니다.</p>}</div>}<Pagination offset={historyOffset} count={revs.length} size={50} loading={historyLoading} change={n => { setHistoryOffset(n); setComparison(null); }}/>{comparison && <WikiDiff {...comparison}/>}</>}
 {view === 'trash' && <WikiTrash changed={dataChanged}/>}
 {view === 'projects' && <WikiProjects pages={pages} create={t => { projectStarts.current.add(t); void edit(t); }}/>}
 {(view === 'knowledge' || view === 'review-queue') && <WikiKnowledge key={JSON.stringify([view,title,page?.version,revId])} page={page} title={title} queue={view === 'review-queue'} revisionId={revId || undefined} open={navigate} changed={dataChanged}/>}
 {view === 'recent-discussions' && <WikiRecentDiscussions open={navigate}/>}
 {view === 'discussions' && <WikiDiscussions title={title} documentId={sourcePage?.document_id || routeDocumentId || null} datasetId={sourcePage?.dataset_id || datasetId} threadId={threadId} anchor={anchor} open={navigate} known={known} normalizeRoute={normalizeDiscussionRoute}/>}
 {view === 'notes' && <><div className="notice">이 문서에 관한 생각과 다음에 보완할 내용을 남기는 개인 메모입니다.</div><form className="note-form" onSubmit={submitNote}><textarea required maxLength={10000} aria-label="문서 메모" placeholder="이 문서에 대해 기억하고 싶은 것…" value={note} onChange={e => { noteDrafts.current.set(title, e.target.value); setNote(e.target.value); }}/><button disabled={notePending.current.has(title) || !note.trim()} className="primary">메모 남기기</button></form>{notesLoading ? <Loading text="메모를 불러오는 중입니다."/> : notes.length ? notes.map(n => <div key={n.id} className="note"><small>메모 · {date(n.created_at)}</small><p>{n.body}</p></div>) : <p className="muted">아직 메모가 없습니다.</p>}</>}
 {view === 'backlinks' && <><div className="notice">“{title}” 문서를 가리키는 문서입니다.</div><div className="filter-bar"><NamespaceSelect value={backNamespace} values={namespaces} onChange={setBackNamespace}/><label>종류<select aria-label="역링크 종류" value={backKind} onChange={e => setBackKind(e.target.value)}><option value="all">전체</option><option value="link">일반 링크</option><option value="redirect">넘겨주기</option><option value="category">분류</option></select></label></div><GroupedPages list={backlinks} open={navigate}/></>}
 {view === 'search' && <><div className="filter-bar"><label>검색 범위<select aria-label="검색 범위" value={searchTarget} onChange={e => { setSearchTarget(e.target.value); setSearchOffset(0); }}><option value="title">제목</option><option value="content">본문</option><option value="title_content">제목 + 본문</option></select></label><NamespaceSelect value={searchNamespace} values={namespaces} onChange={v => { setSearchNamespace(v); setSearchOffset(0); }}/></div>{searchLoading || (resultKey !== searchKey && !error) ? <Loading text="검색 중입니다."/> : <><div className="result-heading"><span>{visibleResults.length ? `${searchOffset+1}–${searchOffset+visibleResults.length}번째 결과` : '0건'}{searchHasMore&&' · 다음 결과 있음'}</span><button onClick={() => void edit(title)}>이 제목으로 문서 작성</button></div>{visibleResults.length ? visibleResults.map(p => <div className="search-result" key={p.title}><h2><WikiAnchor title={p.title} open={navigate}><Highlight text={p.title} query={title}/></WikiAnchor></h2><p><Highlight text={snippet(p.content, title)} query={title}/></p><small>{p.title.toLocaleLowerCase().includes(title.toLocaleLowerCase()) ? '제목 일치 · ' : ''}{namespace(p.title)} · {date(p.updated_at)}</small></div>) : <p className="empty">{error ? '검색 결과를 불러오지 못했습니다. 검색 조건을 바꾸거나 다시 검색해 주세요.' : '검색 결과가 없습니다.'}</p>}<Pagination offset={searchOffset} count={visibleResults.length} size={20} hasNext={searchHasMore} change={setSearchOffset}/></>}</>}
 {(view === 'all' || view === 'favorites') && <><div className="result-heading"><span>{view === 'favorites' ? bookmarks.length : pages.length}개 문서</span><button onClick={() => setNewModal(true)}><Plus size={15}/>새 문서</button></div><div className="category-cloud">{categoryNames.map(c => <WikiAnchor key={c} title={'분류:' + c} open={navigate}>{c}</WikiAnchor>)}</div><GroupedPages list={view === 'favorites' ? pages.filter(p => bookmarks.includes(p.title)) : [...pages].sort((a, b) => a.title.localeCompare(b.title, 'ko'))} open={navigate}/></>}
 {view === 'changes' && <>{changesLoading ? <Loading text="최근 변경을 불러오는 중입니다."/> : changes.length ? <div className="history-list">{changes.map(r => <div className="revision" key={r.id}><div><WikiAnchor title={r.title} extra={{ ...identityExtra(r), rev: r.id }} open={navigate}>{r.title}</WikiAnchor><code className="rev-id">{r.id.slice(0, 8)}</code><p>{r.summary || '편집 요약 없음'}</p><small>{contributionLabel(r.contribution)} · {r.size.toLocaleString()}자</small></div><time dateTime={r.created_at}>{date(r.created_at)}</time><WikiAnchor title={r.title} view="history" extra={identityExtra(r)} open={navigate}>역사</WikiAnchor></div>)}</div> : <p className="empty">아직 변경 이력이 없습니다.</p>}<Pagination offset={changesOffset} count={changes.length} size={50} loading={changesLoading} change={setChangesOffset}/></>}
 {view === 'files' && <><div className="notice">PNG · JPEG · WebP · GIF · PDF, 파일당 최대 10 MiB</div><label className="upload-control">파일 업로드<input ref={fileRef} disabled={uploading} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" aria-label="파일 업로드" onChange={e => void upload(e.target.files?.[0])}/></label>{uploading && <p role="status">업로드 중입니다…</p>}{fileError && <p className="error" role="alert">{fileError}</p>}{filesLoading ? <Loading text="파일을 불러오는 중입니다."/> : files.length ? <div className="file-list">{files.map(f => <div key={f.name}><strong>{f.name}</strong><small>{(f.size / 1024).toFixed(1)} KiB · {date(f.created_at)}</small><a href={'/api/files?' + new URLSearchParams({ name: f.name })} target="_blank" rel="noopener noreferrer">열기</a><a href={'/api/files?' + new URLSearchParams({ name: f.name })} download={f.name}>다운로드</a></div>)}</div> : !fileError && <p className="empty">아직 업로드한 파일이 없습니다.</p>}</>}
 {view === 'settings' && <WikiSettings theme={theme} accent={accent} readingPreviews={readingPreviews} changeTheme={changeTheme} changeAccent={changeAccent} changeReadingPreview={changeReadingPreview} dataChanged={dataChanged} webMcp={webMcp} navigate={navigate}/>}
 </>}</main>
 <aside className="sidebar"><button className="new-document" onClick={() => setNewModal(true)}><Plus size={18}/>새 문서 만들기</button><section className="side-card"><h2><History size={18}/><WikiAnchor title="최근 변경" view="changes" open={navigate}>최근 변경</WikiAnchor></h2>{recent.length ? <ul>{recent.slice(0, 9).map(r => <li key={r.id}><WikiAnchor title={r.title} extra={{ ...identityExtra(r), rev: r.id }} open={navigate}>{r.title}</WikiAnchor><time title={date(r.created_at)}>{relativeTime(r.created_at)}</time></li>)}</ul> : <p className="side-empty">표시할 변경 이력이 없습니다.</p>}</section><section className="side-card"><h2><Star size={17}/>즐겨찾는 문서</h2>{bookmarks.length ? <ul>{bookmarks.slice(0, 7).map(t => <li key={t}><WikiAnchor title={t} open={navigate}>{t}</WikiAnchor></li>)}</ul> : <p className="side-empty">문서의 ☆을 눌러 모아 두세요.</p>}</section><section className="side-card"><h2><FolderOpen size={17}/>분류</h2><div className="side-categories">{categoryNames.map(c => <WikiAnchor key={c} title={'분류:' + c} open={navigate}>{c}</WikiAnchor>)}</div></section><section className="side-card"><WikiAnchor title="파일" view="files" open={navigate}>파일 목록</WikiAnchor><p className="side-empty">{pages.length}개 문서 · 소유자 전용</p></section></aside></div>
 <div className="float-controls"><button aria-label="맨 위로" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><ArrowUp size={21}/></button><button aria-label="맨 아래로" onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}><ArrowDown size={21}/></button></div>{toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
 {documentInfoOpen && documentInfoSource && <WikiDocumentInfo source={documentInfoSource} currentVersion={infoUsesRevision ? sourcePage?.version : infoPage?.version} historical={infoUsesRevision && documentInfoSource.version !== sourcePage?.version} documentTitle={infoUsesRevision ? title : documentInfoSource.title} sources={templateSources} pages={pages} open={navigate} onClose={() => setDocumentInfoOpen(false)}/>}
 {deletePage && <WikiDialog label="문서 휴지통 이동" busy={deleting} onClose={() => setDeletePage(null)}><h2>“{deletePage.title}” 휴지통으로 이동</h2><p>일반 목록에서 숨기고 제목을 예약합니다. 원문·역사·메모·토론·첨부파일은 보존되며 휴지통에서 복원할 수 있습니다.</p><p>대상 판: <code>{deletePage.version}</code></p><label>삭제 사유<input aria-label="삭제 사유" maxLength={300} disabled={deleting} value={deleteReason} onChange={e => setDeleteReason(e.target.value)}/></label>{deleteError && <p role="alert" className="error">{deleteError}</p>}<div className="modal-buttons"><button disabled={deleting} onClick={() => setDeletePage(null)}>취소</button><button disabled={deleting || !deleteReason.trim()} onClick={() => void softDelete()}>사유와 함께 휴지통 이동</button></div></WikiDialog>}
 {newModal && <WikiDialog label="새 문서 만들기" onClose={() => setNewModal(false)}><form onSubmit={e => { e.preventDefault(); if (!newTitle.trim())
        return; const t = newTitle.trim().normalize('NFC'); setNewModal(false); setNewTitle(''); void edit(t); }}><h2>새 문서 만들기</h2><label>문서 제목<input required maxLength={180} value={newTitle} onChange={e => setNewTitle(e.target.value)}/></label><div className="modal-buttons"><button type="button" onClick={() => setNewModal(false)}>취소</button><button className="primary">문서 작성</button></div></form></WikiDialog>}
 {confirmRestore && <WikiDialog label="이전 판 복원" busy={saving} onClose={() => setConfirmRestore(null)}><h2>이전 판으로 복원할까요?</h2>{error && <p className="error" role="alert">{error}</p>}<p>{date(confirmRestore.created_at)}의 내용으로 새 판을 저장합니다. 현재 판도 이력에 남습니다.</p><div className="modal-buttons"><button disabled={saving} onClick={() => setConfirmRestore(null)}>취소</button><button className="primary" disabled={saving} onClick={() => void restore(confirmRestore)}>복원</button></div></WikiDialog>}
 {moveModal && <WikiDialog label="문서 이동" busy={moving} onClose={() => setMoveModal(false)}><form onSubmit={move}><h2>문서 이동</h2><p>이전 제목에는 새 제목을 가리키는 넘겨주기가 남습니다.</p><label>새 제목<input aria-label="이동할 제목" required maxLength={180} disabled={moving} value={moveTitle} onChange={e => setMoveTitle(e.target.value)}/></label><label>이동 요약<input aria-label="이동 요약" maxLength={300} disabled={moving} value={moveSummary} onChange={e => setMoveSummary(e.target.value)}/></label>{moveError && <p className="error" role="alert">{moveError}</p>}<div className="modal-buttons"><button type="button" disabled={moving} onClick={() => setMoveModal(false)}>취소</button><button className="primary" disabled={moving || !moveTitle.trim() || moveTitle.trim() === effectiveTitle}>{moving ? '이동 중…' : '이동'}</button></div></form></WikiDialog>}
 <WikiReadingPreview pages={pages} preferences={readingPreviews} routeKey={JSON.stringify([title,view,revId,page?.version,webMcp.pending])}/></div>{webMcp.pending && <div className="toast" role="status">위키 작업을 처리하고 있습니다…</div>}</>;
}
function WikiAnchor({ title, view = 'read', extra = {}, open, children, ...props }: Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'title' | 'href' | 'onClick'> & {
    title: string;
    view?: string;
    extra?: Record<string, string>;
    open: Open;
}) { return <a {...props} href={wikiHref(title, view, extra)} onClick={e => { if (modifiedLinkClick(e))
    return; e.preventDefault(); open(title, view, extra); }}>{children}</a>; }
function PageList({ list, open }: {
    list: Page[];
    open: Open;
}) { return <div className="page-list">{list.length ? list.map(p => <div key={p.title}><WikiAnchor title={p.title} open={open}>{p.title}</WikiAnchor><time dateTime={p.updated_at}>{date(p.updated_at)}</time></div>) : <p className="muted">해당하는 문서가 없습니다.</p>}</div>; }
function GroupedPages({ list, open }: {
    list: Page[];
    open: Open;
}) { const groups = [...new Set(list.map(p => namespace(p.title)))].sort(); return groups.length ? <div className="namespace-groups">{groups.map(group => <section key={group}><h3>{group} <small>{list.filter(p => namespace(p.title) === group).length}</small></h3><PageList list={list.filter(p => namespace(p.title) === group)} open={open}/></section>)}</div> : <p className="empty">해당하는 문서가 없습니다.</p>; }
function NamespaceSelect({ value, values, onChange }: {
    value: string;
    values: string[];
    onChange: (value: string) => void;
}) { return <label>이름공간<select aria-label="이름공간" value={value} onChange={e => onChange(e.target.value)}><option value="">전체</option>{values.map(v => <option key={v} value={v}>{v}</option>)}</select></label>; }
function Pagination({ offset, count, size, change, loading = false, hasNext = count === size }: {
    offset: number;
    count: number;
    size: number;
    change: (offset: number) => void;
    loading?: boolean;
    hasNext?: boolean;
}) { return <nav className="pagination" aria-label="페이지 이동"><button disabled={!offset || loading} onClick={() => change(Math.max(0, offset - size))}>이전</button><span>{Math.floor(offset / size) + 1} 페이지</span><button disabled={!hasNext || loading} onClick={() => change(offset + size)}>다음</button></nav>; }
function Loading({ text }: {
    text: string;
}) { return <div className="empty" role="status"><RefreshCw className="spin" size={22}/><p>{text}</p></div>; }
function Highlight({ text, query }: {
    text: string;
    query: string;
}) { if (!query)
    return <>{text}</>; const parts: React.ReactNode[] = []; let at = 0; const lower = text.toLocaleLowerCase(), q = query.toLocaleLowerCase(); while (at < text.length) {
    const found = lower.indexOf(q, at);
    if (found < 0) {
        parts.push(text.slice(at));
        break;
    }
    parts.push(text.slice(at, found), <mark key={found}>{text.slice(found, found + query.length)}</mark>);
    at = found + query.length;
} return <>{parts}</>; }
