/** All lengths and selections are UTF-16 SOURCE offsets; no newline normalization. */
export type WikiEditorSnapshot = { value: string; start: number; end: number };
export type WikiEditorHistoryMetadata = {
  kind: 'input' | 'tool' | 'composition';
  inputType?: string;
  /** Monotonic milliseconds supplied by the caller; omitted timestamps never group. */
  timestamp?: number;
  /** Only an automatic tool change; manual summary edits remain independent. */
  summary?: { before: string; after: string };
};
export type WikiEditorHistoryResult =
  | { ok: true; status: 'recorded' | 'grouped' | 'selection' | 'undone' | 'redone' | 'reset'; snapshot: WikiEditorSnapshot; summaryChange?: { expected: string; value: string } }
  | { ok: false; reason: 'mismatch' | 'limit' | 'empty' };

export const WIKI_EDITOR_HISTORY_LIMITS = Object.freeze({
  text: 200_000,
  entries: 100,
  retainedUnits: 2_000_000,
  groupMilliseconds: 1_000,
});

export interface WikiEditorHistory {
  readonly snapshot: WikiEditorSnapshot;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Counts both snapshots per transaction, plus the active snapshot, conservatively. */
  readonly stats: { entries: number; undoDepth: number; redoDepth: number; retainedUnits: number };
  record(before: WikiEditorSnapshot, after: WikiEditorSnapshot, metadata: WikiEditorHistoryMetadata): WikiEditorHistoryResult;
  /** Live source is mandatory: selection alone cannot guard against unrelated source. */
  undo(current: WikiEditorSnapshot, currentSummary?: string): WikiEditorHistoryResult;
  redo(current: WikiEditorSnapshot, currentSummary?: string): WikiEditorHistoryResult;
  reset(snapshot: WikiEditorSnapshot): WikiEditorHistoryResult;
  breakGroup(): void;
}

function normalize(snapshot: WikiEditorSnapshot): WikiEditorSnapshot {
  const offset = (value: number) => Number.isFinite(value)
    ? Math.max(0, Math.min(snapshot.value.length, Math.trunc(value))) : 0;
  const start = offset(snapshot.start), end = offset(snapshot.end);
  return { value: snapshot.value, start: Math.min(start, end), end: Math.max(start, end) };
}

/** Only a verified, collapsed, local native edit can join a typing group. */
function groupingType(before: WikiEditorSnapshot, after: WikiEditorSnapshot, metadata: WikiEditorHistoryMetadata): string | undefined {
  if (metadata.kind !== 'input' || !Number.isFinite(metadata.timestamp)
    || before.start !== before.end || after.start !== after.end) return;
  const delta = after.value.length - before.value.length;
  let from: number, to: number, inserted: string;
  if (metadata.inputType === 'insertText' && delta > 0 && after.start === before.start + delta) {
    from = to = before.start;
    inserted = after.value.slice(from, after.start);
  } else if (metadata.inputType === 'deleteContentBackward' && delta < 0 && after.start === before.start + delta) {
    from = after.start;
    to = before.start;
    inserted = '';
  } else if (metadata.inputType === 'deleteContentForward' && delta < 0 && after.start === before.start) {
    from = before.start;
    to = from - delta;
    inserted = '';
  } else return;
  if (/[\r\n]/.test(inserted) || /[\r\n]/.test(before.value.slice(from, to))
    || before.value.slice(0, from) + inserted + before.value.slice(to) !== after.value) return;
  return metadata.inputType;
}

/** Deterministic, in-memory only. No DOM, timers, persistence, or shared document state. */
export function createWikiEditorHistory(initialSnapshot: WikiEditorSnapshot): WikiEditorHistory {
  const limits = WIKI_EDITOR_HISTORY_LIMITS;
  if (initialSnapshot.value.length > limits.text) throw new RangeError('History source exceeds 200000 UTF-16 units');
  let current = normalize(initialSnapshot);
  const entries: { before: WikiEditorSnapshot; after: WikiEditorSnapshot; summary?: { before: string; after: string }; summaryIgnored?: boolean }[] = [];
  let cursor = 0, transactionUnits = 0;
  let group: { type: string; startedAt: number; lastAt: number } | undefined;
  const cost = (entry: typeof entries[number]) => entry.before.value.length + entry.after.value.length + (entry.summary ? entry.summary.before.length + entry.summary.after.length : 0);
  const success = (status: Extract<WikiEditorHistoryResult, { ok: true }>['status'], summaryChange?: { expected: string; value: string }): WikiEditorHistoryResult =>
    ({ ok: true, status, snapshot: { ...current }, ...(summaryChange ? { summaryChange } : {}) });
  const validate = (snapshot: WikiEditorSnapshot): WikiEditorHistoryResult | undefined => {
    if (snapshot.value.length > limits.text) return { ok: false, reason: 'limit' };
    if (snapshot.value !== current.value) return { ok: false, reason: 'mismatch' };
  };
  const navigate = (live: WikiEditorSnapshot, direction: 'undo' | 'redo', currentSummary?: string): WikiEditorHistoryResult => {
    const error = validate(live);
    if (error) return error;
    current = normalize(live);
    group = undefined;
    if (direction === 'undo') {
      if (cursor === 0) return { ok: false, reason: 'empty' };
      const entry = entries[--cursor];
      entry.after = current;
      current = entry.before;
      return success('undone', navigateSummary(entry, 'after', 'before', currentSummary));
    }
    if (cursor === entries.length) return { ok: false, reason: 'empty' };
    const entry = entries[cursor++];
    entry.before = current;
    current = entry.after;
    return success('redone', navigateSummary(entry, 'before', 'after', currentSummary));
  };
  function navigateSummary(entry: typeof entries[number], from: 'before' | 'after', to: 'before' | 'after', live?: string) {
    if (!entry.summary || entry.summaryIgnored) return;
    // Once a user changes the automatic value, neither Undo nor later Redo
    // owns that field. Text history remains fully usable.
    if (live !== entry.summary[from]) { entry.summaryIgnored = true; return; }
    return { expected: entry.summary[from], value: entry.summary[to] };
  }
  return {
    get snapshot() { return { ...current }; },
    get canUndo() { return cursor > 0; },
    get canRedo() { return cursor < entries.length; },
    get stats() {
      return { entries: entries.length, undoDepth: cursor, redoDepth: entries.length - cursor,
        retainedUnits: transactionUnits + current.value.length };
    },
    record(beforeSnapshot, afterSnapshot, metadata) {
      const error = validate(beforeSnapshot);
      if (error) return error;
      if (afterSnapshot.value.length > limits.text) return { ok: false, reason: 'limit' };
      if (metadata.summary && (metadata.summary.before.length > 300 || metadata.summary.after.length > 300)) return { ok: false, reason: 'limit' };
      const before = normalize(beforeSnapshot), after = normalize(afterSnapshot);
      const summary = metadata.summary && metadata.summary.before !== metadata.summary.after ? { ...metadata.summary } : undefined;
      if (before.value === after.value && !summary) {
        current = after;
        group = undefined;
        return success('selection');
      }
      // Discard only the abandoned branch; ordinary typing never scans history.
      while (entries.length > cursor) transactionUnits -= cost(entries.pop()!);
      const type = summary ? undefined : groupingType(before, after, metadata);
      const timestamp = metadata.timestamp!;
      const previous = entries[cursor - 1];
      const joins = type !== undefined && group !== undefined && previous !== undefined
        && group.type === type && timestamp >= group.lastAt
        && timestamp - group.startedAt <= limits.groupMilliseconds
        && current.start === before.start && current.end === before.end
        && previous.after.start === before.start && previous.after.end === before.end;
      if (joins) {
        transactionUnits += after.value.length - previous.after.value.length;
        previous.after = after;
        group!.lastAt = timestamp;
      } else {
        const entry = { before, after, ...(summary ? { summary } : {}) };
        entries.push(entry);
        transactionUnits += cost(entry);
        cursor++;
        group = type === undefined ? undefined : { type, startedAt: timestamp, lastAt: timestamp };
      }
      current = after;
      // Reserve a maximum-sized active source so navigation cannot exceed the budget.
      // Evict complete oldest transactions; the next entry's before is the new boundary.
      while (entries.length > limits.entries || transactionUnits + limits.text > limits.retainedUnits) {
        transactionUnits -= cost(entries.shift()!);
        cursor--;
      }
      return success(joins ? 'grouped' : 'recorded');
    },
    undo(live, summary) { return navigate(live, 'undo', summary); },
    redo(live, summary) { return navigate(live, 'redo', summary); },
    reset(snapshot) {
      if (snapshot.value.length > limits.text) return { ok: false, reason: 'limit' };
      current = normalize(snapshot);
      entries.length = 0;
      cursor = transactionUnits = 0;
      group = undefined;
      return success('reset');
    },
    breakGroup() { group = undefined; },
  };
}
