/** Lossless (apart from JSON whitespace) JSON Canvas edits. Never recover by replacing bad input. */
export type CanvasNode = {
  [key: string]: unknown;
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type CanvasEdge = { [key: string]: unknown; id: string; fromNode: string; toNode: string };
export type CanvasDocument = { [key: string]: unknown; nodes: CanvasNode[]; edges: CanvasEdge[] };
export type CanvasParseResult = { ok: true; document: CanvasDocument } | { ok: false; error: string };
export type CanvasNodePatch = Partial<Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>> & { text?: string; file?: string; label?: string };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseCanvas(text: string): CanvasParseResult {
  try {
    const root: unknown = JSON.parse(text, (_key: string, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('JSON 숫자는 유한한 범위여야 합니다.');
      return value;
    });
    if (!record(root)) throw new Error('최상위 값은 객체여야 합니다.');
    for (const key of ['nodes', 'edges']) {
      if (Object.hasOwn(root, key) && !Array.isArray(root[key])) throw new Error(`${key}는 배열이어야 합니다.`);
    }
    const nodes = (root.nodes ?? []) as unknown[];
    const edges = (root.edges ?? []) as unknown[];
    const ids = new Set<string>();
    const checkId = (value: Record<string, unknown>, name: string) => {
      if (typeof value.id !== 'string' || !value.id.trim()) throw new Error(`${name}: 비어 있지 않은 id가 필요합니다.`);
      if (ids.has(value.id)) throw new Error(`중복 id: ${value.id}`);
      ids.add(value.id);
    };
    nodes.forEach((node, index) => {
      const name = `노드 ${index + 1}`;
      if (!record(node)) throw new Error(`${name}: 객체여야 합니다.`);
      checkId(node, name);
      if (typeof node.type !== 'string' || !node.type) throw new Error(`${name}: type이 필요합니다.`);
      if (!['x', 'y', 'width', 'height'].every(key => typeof node[key] === 'number' && Number.isFinite(node[key]))) {
        throw new Error(`${name}: x, y, width, height에 유한한 숫자가 필요합니다.`);
      }
      if ((node.width as number) <= 0 || (node.height as number) <= 0) throw new Error(`${name}: 크기는 0보다 커야 합니다.`);
      const contentKey = node.type === 'text' ? 'text' : node.type === 'file' ? 'file' : node.type === 'link' ? 'url' : null;
      if (contentKey && typeof node[contentKey] !== 'string') throw new Error(`${name}: ${contentKey} 문자열이 필요합니다.`);
      if (node.type === 'group' && Object.hasOwn(node, 'label') && typeof node.label !== 'string') throw new Error(`${name}: label은 문자열이어야 합니다.`);
    });
    const nodeIds = new Set(nodes.map(node => (node as CanvasNode).id));
    edges.forEach((edge, index) => {
      const name = `연결 ${index + 1}`;
      if (!record(edge)) throw new Error(`${name}: 객체여야 합니다.`);
      checkId(edge, name);
      if (typeof edge.fromNode !== 'string' || typeof edge.toNode !== 'string' || !nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) {
        throw new Error(`${name}: 존재하는 출발·도착 노드가 필요합니다.`);
      }
    });
    return { ok: true, document: { ...root, nodes: nodes as CanvasNode[], edges: edges as CanvasEdge[] } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function serializeCanvas(document: CanvasDocument): string {
  return JSON.stringify(document, null, 2);
}

export function canvasId(document: CanvasDocument): string {
  const ids = new Set([...document.nodes, ...document.edges].map(item => item.id));
  let id: string;
  do {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  } while (ids.has(id));
  return id;
}

export function addCanvasNode(document: CanvasDocument, type: 'text' | 'file' | 'group', x = 0, y = 0): CanvasDocument {
  if (![x, y].every(Number.isFinite)) return document;
  const node: CanvasNode = { id: canvasId(document), type, x: Math.round(x), y: Math.round(y), width: type === 'text' ? 250 : 400, height: type === 'text' ? 60 : 400 };
  if (type === 'text') node.text = '';
  if (type === 'file') node.file = '';
  if (type === 'group') node.label = '무제 그룹';
  // A group is a background rectangle, so it belongs below existing cards.
  return { ...document, nodes: type === 'group' ? [node, ...document.nodes] : [...document.nodes, node] };
}

export function updateCanvasNode(document: CanvasDocument, id: string, patch: CanvasNodePatch): CanvasDocument {
  const node = document.nodes.find(item => item.id === id);
  if (!node) return document;
  const changes: Record<string, unknown> = {};
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = patch[key];
    if (typeof value === 'number' && Number.isFinite(value) && (!(key === 'width' || key === 'height') || value > 0)) changes[key] = key === 'width' || key === 'height' ? Math.max(1, Math.round(value)) : Math.round(value);
  }
  for (const [key, type] of [['text', 'text'], ['file', 'file'], ['label', 'group']] as const) {
    if (node.type === type && typeof patch[key] === 'string') changes[key] = patch[key];
  }
  if (Object.keys(changes).every(key => changes[key] === node[key])) return document;
  return { ...document, nodes: document.nodes.map(item => item.id === id ? { ...item, ...changes } : item) };
}

export function deleteCanvasNode(document: CanvasDocument, id: string): CanvasDocument {
  if (!document.nodes.some(node => node.id === id)) return document;
  return { ...document, nodes: document.nodes.filter(node => node.id !== id), edges: document.edges.filter(edge => edge.fromNode !== id && edge.toNode !== id) };
}

export function connectCanvasNodes(document: CanvasDocument, fromNode: string, toNode: string, label = ''): CanvasDocument {
  if (![fromNode, toNode].every(id => document.nodes.some(node => node.id === id))) return document;
  return { ...document, edges: [...document.edges, { id: canvasId(document), fromNode, toNode, fromSide: 'right', toSide: 'left', label }] };
}

export function deleteCanvasEdge(document: CanvasDocument, id: string): CanvasDocument {
  if (!document.edges.some(edge => edge.id === id)) return document;
  return { ...document, edges: document.edges.filter(edge => edge.id !== id) };
}

export function canvasFileTarget(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\\]/.test(value) || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value.trim()) || value.split('/').some(part => part === '..' || part === '.')) return null;
  return value;
}

export function canvasBounds(nodes: CanvasNode[]) {
  let left = 0; let top = 0; let right = 700; let bottom = 480;
  for (const node of nodes) {
    left = Math.min(left, node.x); top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.width); bottom = Math.max(bottom, node.y + node.height);
  }
  return { left: left - 100, top: top - 100, width: right - left + 200, height: bottom - top + 200 };
}

/** Move selected cards and every card fully inside a selected group once. */
export function moveCanvasSelection(document: CanvasDocument, selectedIds: readonly string[], dx: number, dy: number): CanvasDocument {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return document;
  const moving = new Set(selectedIds.filter(id => document.nodes.some(node => node.id === id)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of document.nodes) {
      if (group.type !== 'group' || !moving.has(group.id)) continue;
      for (const node of document.nodes) {
        if (node.id === group.id || moving.has(node.id)) continue;
        if (node.x >= group.x && node.y >= group.y && node.x + node.width <= group.x + group.width && node.y + node.height <= group.y + group.height) {
          moving.add(node.id); changed = true;
        }
      }
    }
  }
  if (!moving.size) return document;
  const nodes = document.nodes.map(node => moving.has(node.id) ? { ...node, x: Math.round(node.x + dx), y: Math.round(node.y + dy) } : node);
  return nodes.every((node, i) => node.x === document.nodes[i].x && node.y === document.nodes[i].y) ? document : { ...document, nodes };
}

export function resizeCanvasNode(document: CanvasDocument, id: string, x: number, y: number, width: number, height: number): CanvasDocument {
  if (![x,y,width,height].every(Number.isFinite) || width < 1 || height < 1) return document;
  return updateCanvasNode(document,id,{x,y,width,height});
}

export function updateCanvasEdge(document: CanvasDocument, id: string, patch: {label?: string; color?: string; fromEnd?: 'arrow' | 'none'; toEnd?: 'arrow' | 'none'; fromNode?: string; toNode?: string; fromSide?: 'top' | 'right' | 'bottom' | 'left'; toSide?: 'top' | 'right' | 'bottom' | 'left'}): CanvasDocument {
  const edge = document.edges.find(item => item.id === id);
  if (!edge) return document;
  const changes: Record<string, unknown> = {};
  for (const key of ['fromNode','toNode'] as const) if (patch[key] !== undefined) {
    if (!document.nodes.some(node => node.id === patch[key])) return document;
    changes[key] = patch[key];
  }
  for (const key of ['fromSide','toSide'] as const) if (patch[key] !== undefined) changes[key] = patch[key];
  for (const key of ['fromEnd','toEnd'] as const) if (patch[key] !== undefined) changes[key] = patch[key];
  if (typeof patch.label === 'string') changes.label = patch.label;
  if (typeof patch.color === 'string') changes.color = patch.color;
  if (Object.keys(changes).every(key => edge[key] === changes[key])) return document;
  return { ...document, edges: document.edges.map(item => item.id === id ? { ...item, ...changes } : item) };
}

export function setCanvasEdgeDirection(document: CanvasDocument, id: string, direction: 'none' | 'one' | 'both'): CanvasDocument {
  const edge=document.edges.find(item=>item.id===id);
  if(!edge)return document;
  const current=edge.fromEnd==='arrow'&&edge.toEnd!=='none'?'both':edge.toEnd==='none'&&edge.fromEnd!=='arrow'?'none':'one';
  if(current===direction)return document;
  const next: CanvasEdge={...edge};delete next.fromEnd;delete next.toEnd;
  if(direction==='none')next.toEnd='none';if(direction==='both')next.fromEnd='arrow';
  if(JSON.stringify(next)===JSON.stringify(edge))return document;
  return {...document,edges:document.edges.map(item=>item.id===id?next:item)};
}
export function connectCanvasSides(document: CanvasDocument, fromNode: string, fromSide: 'top' | 'right' | 'bottom' | 'left', toNode: string, toSide: 'top' | 'right' | 'bottom' | 'left'): CanvasDocument {
  if (!document.nodes.some(node => node.id === fromNode) || !document.nodes.some(node => node.id === toNode)) return document;
  return { ...document, edges: [...document.edges, { id: canvasId(document), fromNode, fromSide, toNode, toSide }] };
}
/** Echoes of our own onChange must not erase undo; genuinely external text starts a new history. */
export type CanvasHistory = { source: string; present: string; past: string[]; future: string[]; pending: string[] };
export function createCanvasHistory(text: string): CanvasHistory {
  return { source: text, present: text, past: [], future: [], pending: [] };
}
export function receiveCanvasText(history: CanvasHistory, text: string): CanvasHistory {
  if (text === history.source) return history;
  const echo = history.pending.lastIndexOf(text);
  if (echo >= 0) return { ...history, source: text, pending: history.pending.slice(echo + 1) };
  if (text === history.present) return { ...history, source: text, pending: [] };
  return createCanvasHistory(text);
}
export function editCanvasHistory(history: CanvasHistory, text: string): CanvasHistory {
  if (text === history.present) return history;
  return { ...history, present: text, past: [...history.past, history.present].slice(-80), future: [], pending: [...history.pending, text].slice(-160) };
}
export function stepCanvasHistory(history: CanvasHistory, direction: 'undo' | 'redo'): CanvasHistory {
  const stack = direction === 'undo' ? history.past : history.future;
  if (!stack.length) return history;
  const present = stack[stack.length - 1];
  return { ...history, present, past: direction === 'undo' ? history.past.slice(0, -1) : [...history.past, history.present].slice(-80), future: direction === 'undo' ? [...history.future, history.present] : history.future.slice(0, -1), pending: [...history.pending, present].slice(-160) };
}
