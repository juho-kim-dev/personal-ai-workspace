import { propertyDocument } from './core-features.ts';
import { extractNoteMetadata, validTag as tagValid } from './note-metadata.ts';

export const SEARCH_LIMITS = Object.freeze({ queryChars: 4096, terms: 128, depth: 32, tokens: 1024, textChars: 2_097_152, pathChars: 1024, yamlChars: 65_536 });
export class SearchQueryError extends Error {
  readonly code: 'syntax' | 'unsupported' | 'limit';
  /** Zero-based UTF-16 query offset; undefined for document limits. */
  readonly position?: number;
  constructor(message: string, code: 'syntax' | 'unsupported' | 'limit' = 'syntax', position?: number) {
    super(position === undefined ? message : `${message} (offset ${position})`);
    this.name = 'SearchQueryError'; this.code = code; this.position = position;
  }
}
export type CompiledSearchQuery = { test(file: { path: string }, text: string | undefined): boolean; explanation: string };
type Scope = 'path' | 'file' | 'content' | 'tag' | 'line' | 'task' | 'task-todo' | 'task-done' | 'match-case' | 'ignore-case';
const scopes = new Set<string>(['path', 'file', 'content', 'tag', 'line', 'task', 'task-todo', 'task-done', 'match-case', 'ignore-case']);
type Property = { key: string; op?: '=' | '<' | '>' | '<=' | '>='; value?: string | number | boolean | null };
type Node = { kind: 'literal'; value: string } | { kind: 'property'; property: Property } | { kind: 'and' | 'or'; children: Node[] } | { kind: 'not'; child: Node } | { kind: 'scope'; scope: Scope; child: Node };
type Token = { kind: 'word' | 'quoted' | 'property' | '(' | ')' | '-' | ':' | 'or'; value: string; at: number };
const fail = (message: string, at: number, code: 'syntax' | 'unsupported' | 'limit' = 'syntax'): never => { throw new SearchQueryError(message, code, at); };

/** One forward scan; no query fragment is interpreted as a regular expression. */
function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < query.length;) {
    if (/\s/u.test(query[i])) { i++; continue; }
    const at = i, c = query[i++];
    let kind: Token['kind'], value = c;
    if (c === '"' || c === '[') {
      kind = c === '"' ? 'quoted' : 'property'; value = ''; let quoted = false, closed = false;
      while (i < query.length) {
        const ch = query[i++];
        if (ch === '\\') {
          const next = query[i++];
          if (next !== '"' && next !== '\\') fail('Only escaped quote and backslash are supported', i - 2, 'unsupported');
          // Property strings are decoded separately, so retain their escapes.
          value += c === '[' ? '\\' + next : next; continue;
        }
        if (c === '[' && ch === '"') quoted = !quoted;
        if ((c === '"' && ch === '"') || (c === '[' && ch === ']' && !quoted)) { closed = true; break; }
        value += ch;
      }
      if (!closed) fail(c === '[' ? 'Unclosed property expression' : 'Unclosed quoted phrase', at);
      if (!value.trim()) fail('Empty phrase or property expression', at);
    } else if (c === '(' || c === ')' || c === '-' || c === ':') kind = c;
    else {
      if (c === "'") fail('Single-quoted query literals are unsupported; use double quotes', at, 'unsupported');
      if (c === '/') fail('Regular expressions are unsupported; quote a literal slash or path', at, 'unsupported');
      if (c === ']' || c === '\\') fail('Unexpected bracket or escape; quote literal text', at);
      kind = 'word';
      while (i < query.length && !/[\s():\[\]"]/u.test(query[i])) value += query[i++];
      if (value.includes('\\')) fail('Escapes are supported only inside quoted phrases', at, 'unsupported');
      if (value === 'OR') kind = 'or';
    }
    tokens.push({ kind, value, at });
    if (tokens.length > SEARCH_LIMITS.tokens) fail('Too many query tokens', at, 'limit');
  }
  return tokens;
}
function property(raw: string, at: number): Property {
  // Deliberately restricted literal grammar; property subqueries never fall back to text.
  const colon = raw.indexOf(':');
  const keyRaw = (colon < 0 ? raw : raw.slice(0, colon)).trim();
  const decode = (s: string): string => {
    if (!/^"(?:[^"\\]|\\["\\])*"$/.test(s)) fail('Invalid quoted property literal', at, 'unsupported');
    return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
  };
  const key = keyRaw.startsWith('"') ? decode(keyRaw) : keyRaw;
  if (!key || (!keyRaw.startsWith('"') && !/^[\p{L}\p{N}_-]+$/u.test(key))) fail('Property keys must be a simple name or quoted literal', at, 'unsupported');
  if (colon < 0) return { key };
  let valueRaw = raw.slice(colon + 1).trim();
  const comparison = /^(<=|>=|<|>)/.exec(valueRaw);
  const op = comparison ? comparison[1] as Property['op'] : '=';
  if (comparison) valueRaw = valueRaw.slice(comparison[1].length).trim();
  let value: Property['value'];
  if (valueRaw.startsWith('"')) value = decode(valueRaw);
  else if (valueRaw === 'null') value = null;
  else if (valueRaw === 'true' || valueRaw === 'false') value = valueRaw === 'true';
  else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(valueRaw)) {
    value = Number(valueRaw); if (!Number.isFinite(value)) fail('Property number must be finite', at, 'unsupported');
  } else if (/^[\p{L}\p{N}_./#-]+$/u.test(valueRaw) && !valueRaw.startsWith('/')) value = valueRaw;
  else fail('Property values support one literal only; subqueries, regex and expressions are unsupported', at, 'unsupported');
  if (op !== '=' && typeof value !== 'number') fail('Property comparisons require a finite numeric literal', at, 'unsupported');
  return { key, op, value };
}
function parse(tokens: Token[]): Node | undefined {
  let i = 0, terms = 0;
  const term = (depth: number): Node => {
    if (depth > SEARCH_LIMITS.depth) fail('Query nesting exceeds 32', tokens[i]?.at ?? 0, 'limit');
    const t = tokens[i++]; if (!t) fail('Expected a search term', tokens.at(-1)?.at ?? 0);
    if (t.kind === '-') return { kind: 'not', child: term(depth + 1) };
    if (t.kind === '(') {
      const child = expression(depth + 1);
      if (tokens[i]?.kind !== ')') fail('Expected closing parenthesis', tokens[i]?.at ?? t.at);
      i++; return child;
    }
    if (t.kind === 'word' && tokens[i]?.kind === ':') {
      i++;
      if (!scopes.has(t.value)) fail(`Unsupported search operator: ${t.value}:`, t.at, 'unsupported');
      return { kind: 'scope', scope: t.value as Scope, child: term(depth + 1) };
    }
    if (!['word', 'quoted', 'property'].includes(t.kind)) fail('Expected a search term', t.at);
    if (++terms > SEARCH_LIMITS.terms) fail('Query exceeds 128 terms', t.at, 'limit');
    return t.kind === 'property' ? { kind: 'property', property: property(t.value, t.at) } : { kind: 'literal', value: t.value };
  };
  const and = (depth: number): Node => {
    const children = [term(depth)];
    while (i < tokens.length && tokens[i].kind !== ')' && tokens[i].kind !== 'or') children.push(term(depth));
    return children.length === 1 ? children[0] : { kind: 'and', children };
  };
  const expression = (depth: number): Node => {
    const children = [and(depth)];
    while (tokens[i]?.kind === 'or') { i++; children.push(and(depth)); }
    return children.length === 1 ? children[0] : { kind: 'or', children };
  };
  if (!tokens.length) return undefined;
  const root = expression(0);
  if (i !== tokens.length) fail('Unexpected closing parenthesis', tokens[i].at);
  return root;
}

/** Mask semantic exclusions, retaining line boundaries. Each character is scanned a fixed number of times. */
function semanticLines(body: string): string[] {
  const lines: string[] = []; let fence = '', comment = '', inline = 0;
  // Pair exact backtick run lengths using a reverse index. Unclosed runs remain literal.
  const runs = new Map<number, number>(), next = new Map<number, number>();
  for (let i = body.length - 1; i >= 0; i--) if (body[i] === '`') {
    const end = i + 1; while (i >= 0 && body[i] === '`') i--;
    const start = i + 1, size = end - start;
    if (next.has(size)) runs.set(start, next.get(size)!);
    next.set(size, start);
  }
  let offset = 0, inlineEnd = -1, taskIndent: number | undefined;
  for (const line of body.split('\n')) {
    const marker = !comment && inline === 0 ? /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line) : null;
    if (marker && (!fence || (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()))) {
      fence = fence ? '' : marker[1]; lines.push(''); offset += line.length + 1; continue;
    }
    const taskStart = /^(\s*)(?:[-+*]|\d+[.)])\s+\[([ xX])\]/.exec(line);
    const continuation = taskIndent !== undefined && !!line.trim() && line.length - line.trimStart().length > taskIndent;
    if (!continuation) taskIndent = undefined;
    if (taskStart) taskIndent = taskStart[1].length;
    if (fence || (!comment && !inline && !continuation && /^(?: {4}|\t)/.test(line) && !taskStart)) {
      lines.push(''); offset += line.length + 1; continue;
    }
    let result = '';
    for (let i = 0; i < line.length;) {
      if (comment) {
        if (line.startsWith(comment, i)) { result += ' '.repeat(comment.length); i += comment.length; comment = ''; }
        else { result += ' '; i++; }
      } else if (inline) {
        if (offset + i === inlineEnd) { result += ' '.repeat(inline); i += inline; inline = 0; }
        else { result += ' '; i++; }
      } else if (line.startsWith('<!--', i) || line.startsWith('%%', i)) {
        const html = line.startsWith('<!--', i); comment = html ? '-->' : '%%'; result += html ? '    ' : '  '; i += html ? 4 : 2;
      } else if (line[i] === '\\' && i + 1 < line.length) { result += '  '; i += 2; }
      else if (line[i] === '`') {
        let end = i + 1; while (line[end] === '`') end++;
        const close = runs.get(offset + i);
        if (close !== undefined) { inline = end - i; inlineEnd = close; result += ' '.repeat(inline); }
        else result += line.slice(i, end);
        i = end;
      } else result += line[i++];
    }
    lines.push(result.replace(/\r$/, '')); offset += line.length + 1;
  }
  return lines;
}
type Semantic = { tags: string[]; tasks: { text: string; done: boolean }[] };
function semanticTasks(body: string): Semantic['tasks'] {
  const lines = semanticLines(body), tasks: Semantic['tasks'] = [];
  let current: Semantic['tasks'][number] | undefined, indent = 0;
  const originalLines = body.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], original = originalLines[index];
    const originalIndent = original.length - original.trimStart().length;
    const task = /^\s*(?:[-+*]|\d+[.)])\s+\[([ xX])\]/.test(original)
      ? /^(\s*)(?:[-+*]|\d+[.)])\s+\[([ xX])\](?:\s+(.*)|\s*)$/.exec(line) : null;
    if (task) { current = { text: task[3] ?? '', done: task[2] !== ' ' }; indent = task[1].length; tasks.push(current); }
    else if (current && line.trim() && originalIndent > indent) current.text += '\n' + line.trim();
    else current = undefined;
  }
  return tasks;
}
function describe(node: Node): string {
  switch (node.kind) {
    case 'literal': return JSON.stringify(node.value);
    case 'not': return `NOT (${describe(node.child)})`;
    case 'and': case 'or': return `(${node.children.map(describe).join(node.kind === 'and' ? ' AND ' : ' OR ')})`;
    case 'scope': return `${node.scope}:(${describe(node.child)})`;
    case 'property': return `property(${JSON.stringify(node.property)})`;
  }
}

/** Compile once, then apply to supplied snapshots. Never reads vault files or executes query code. */
export function compileSearchQuery(query: string): CompiledSearchQuery {
  if (query.length > SEARCH_LIMITS.queryChars) throw new SearchQueryError('Query exceeds 4096 UTF-16 characters', 'limit');
  const root = parse(tokenize(query));
  let paths = false, needsProperties = false;
  function validate(node: Node, target?: Scope): void {
    if (node.kind === 'scope') {
      const isCase = node.scope === 'match-case' || node.scope === 'ignore-case';
      if (!isCase && target) throw new SearchQueryError(`Nested target scopes (${target}: and ${node.scope}:) are unsupported`, 'unsupported');
      if (node.scope === 'path' || node.scope === 'file') paths = true;
      if (node.scope === 'tag' || node.scope.startsWith('task')) needsProperties = true;
      validate(node.child, isCase ? target : node.scope);
    } else if (node.kind === 'property') {
      if (target) throw new SearchQueryError('Properties inside target scopes are unsupported', 'unsupported');
      needsProperties = true;
    } else if (node.kind === 'literal') {
      if (target === 'tag' && !tagValid(node.value.replace(/^#/, ''))) throw new SearchQueryError('tag: requires a literal tag name', 'unsupported');
    } else if (node.kind === 'not') validate(node.child, target);
    else node.children.forEach(child => validate(child, target));
  }
  if (root) validate(root);
  return {
    explanation: root ? describe(root) : 'All visible notes and canvases (empty query)',
    test(file, text) {
      const path = file.path;
      if (path.length > SEARCH_LIMITS.pathChars) throw new SearchQueryError('File path exceeds 1024 characters', 'limit');
      if (!path || path.includes('\\') || path.split('/').some(p => !p || p.startsWith('.'))) return false;
      const note = /\.(?:md|canvas)$/i.test(path), markdown = /\.md$/i.test(path);
      if (!note && !paths) return false;
      if (text !== undefined && text.length > SEARCH_LIMITS.textChars) throw new SearchQueryError('Document exceeds 2097152 UTF-16 characters', 'limit');
      if (!root) return note;
      const content = note ? text ?? '' : '';
      let doc: ReturnType<typeof propertyDocument> | undefined, semantic: Semantic | undefined;
      const properties = () => {
        if (!doc) {
          // Bound input to the shared YAML parser before it can expand aliases.
          if (/^\uFEFF?---[ \t]*\r?\n/.test(content)) {
            const end = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm; end.lastIndex = content.indexOf('\n') + 1;
            const close = end.exec(content);
            if (!close || close.index > SEARCH_LIMITS.yamlChars) throw new SearchQueryError('Unclosed frontmatter or YAML exceeds 65536 characters', 'limit');
          }
          try { doc = propertyDocument(content); }
          catch { throw new SearchQueryError('Invalid or unsafe YAML frontmatter', 'syntax'); }
        }
        return doc;
      };
      const semanticData = () => semantic ??= { tasks: semanticTasks(needsProperties ? properties().body : content), tags: extractNoteMetadata(content).tags };
      const contains = (haystack: string, needle: string, sensitive: boolean) => sensitive ? haystack.includes(needle) : haystack.toLowerCase().includes(needle.toLowerCase());
      // Missing index entries are unknown, not empty documents. In particular,
      // negation must never turn an unread note into a false positive.
      function evaluate(node: Node, sensitive = false, candidate?: string, tag = false): boolean | undefined {
        switch (node.kind) {
          case 'literal': {
            if (candidate !== undefined) {
              if (!tag) return contains(candidate, node.value, sensitive);
              const actual = sensitive ? candidate : candidate.toLowerCase(), wanted = (sensitive ? node.value : node.value.toLowerCase()).replace(/^#/, '');
              return actual === wanted || actual.startsWith(wanted + '/');
            }
            if (!note) return false;
            if (contains(path, node.value, sensitive)) return true;
            return text === undefined ? undefined : contains(content, node.value, sensitive);
          }
          case 'not': { const value = evaluate(node.child, sensitive, candidate, tag); return value === undefined ? undefined : !value; }
          case 'and': { const values = node.children.map(n => evaluate(n, sensitive, candidate, tag)); return values.includes(false) ? false : values.includes(undefined) ? undefined : true; }
          case 'or': { const values = node.children.map(n => evaluate(n, sensitive, candidate, tag)); return values.includes(true) ? true : values.includes(undefined) ? undefined : false; }
          case 'property': {
            if (!markdown) return false;
            if (text === undefined) return undefined;
            const p = node.property, entry = properties().entries.find(e => sensitive ? e.key === p.key : e.key.toLowerCase() === p.key.toLowerCase());
            if (!entry) return false;
            if (!p.op) return true;
            const match = (value: unknown): boolean => {
              if (p.op === '=') return typeof value === 'string' && typeof p.value === 'string' ? contains(value, p.value, sensitive) : value === p.value;
              if (typeof value !== 'number' || !Number.isFinite(value) || typeof p.value !== 'number') return false;
              return p.op === '<' ? value < p.value : p.op === '>' ? value > p.value : p.op === '<=' ? value <= p.value : value >= p.value;
            };
            return Array.isArray(entry.value) ? entry.value.some(match) : match(entry.value);
          }
          case 'scope': {
            if (node.scope === 'match-case' || node.scope === 'ignore-case') return evaluate(node.child, node.scope === 'match-case', candidate, tag);
            if (node.scope === 'path') return evaluate(node.child, sensitive, path);
            if (node.scope === 'file') return evaluate(node.child, sensitive, path.split('/').at(-1)!);
            if (!note) return false;
            if (text === undefined) return undefined;
            if (node.scope === 'content') return evaluate(node.child, sensitive, content);
            if (node.scope === 'line') return content.split(/\r?\n/).some(line => evaluate(node.child, sensitive, line));
            if (!markdown) return false;
            if (node.scope === 'tag') return semanticData().tags.some(value => evaluate(node.child, sensitive, value, true));
            return semanticData().tasks.some(task => (node.scope === 'task' || task.done === (node.scope === 'task-done')) && evaluate(node.child, sensitive, task.text));
          }
        }
      }
      return evaluate(root) === true;
    },
  };
}

/** A bounded literal excerpt; negative/path-only clauses never become body highlights. */
export function searchExcerpt(query:string,text:string,width=140):{before:string;match:string;after:string} {
  const content=text.slice(0,SEARCH_LIMITS.textChars), terms:{value:string;sensitive:boolean}[]=[];
  if(query.length<=SEARCH_LIMITS.queryChars) {
    try {
      const root=parse(tokenize(query));
      function visit(node:Node,sensitive=false){
        if(node.kind==='literal')terms.push({value:node.value,sensitive});
        else if(node.kind==='and' || node.kind==='or')node.children.forEach(child=>visit(child,sensitive));
        else if(node.kind==='scope' && !['path','file'].includes(node.scope))visit(node.child,node.scope==='match-case'?true:node.scope==='ignore-case'?false:sensitive);
      }
      if(root)visit(root);
    }catch{/* The query parser reports syntax errors in the search panel. */}
  }
  const span=Math.max(40,Math.min(300,width));
  for(const term of terms){
    const haystack=term.sensitive?content:content.toLowerCase(),needle=term.sensitive?term.value:term.value.toLowerCase(),at=haystack.indexOf(needle);
    // Case folds that change UTF-16 length cannot safely index the original text.
    if(at<0 || haystack.length!==content.length || needle.length!==term.value.length)continue;
    const start=Math.max(0,at-Math.floor(span/3)),end=Math.min(content.length,Math.max(at+needle.length,start+span));
    return {before:(start?'…':'')+content.slice(start,at),match:content.slice(at,at+needle.length),after:content.slice(at+needle.length,end)+(end<content.length?'…':'')};
  }
  return {before:content.slice(0,span)+(content.length>span?'…':''),match:'',after:''};
}
