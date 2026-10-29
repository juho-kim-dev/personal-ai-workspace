/** Offline contract prototype only. No runtime import, storage or production migration.
 * Uses current title guards; structured parts require explicit evidence, never guesses.
 */
import {isWikiNamespace, normalizeWikiTitle, validWikiTitle, wikiNamespace} from '../../lib/wiki-title';

export type ExplicitTitleParts = {namespace: string; pathSegments: string[]; disambiguator: string | null; decompositionSource: string};
function balanced(value:string) {
 let depth=0;
 for(const c of value){if(c==='(')depth++;else if(c===')'&&--depth<0)return false;}
 return depth===0;
}
export function inspectDocumentAddress(raw:string) {
 const title=normalizeWikiTitle(raw), namespace=wikiNamespace(title);
 const localTitle=namespace?title.slice(namespace.length+1):title;
 const segments=localTitle.split('/');
 const advice:string[]=[];
 if(segments.some(segment=>!segment.trim()))advice.push('empty-hierarchy-segment');
 if(!balanced(localTitle))advice.push('unbalanced-parentheses');
 if(localTitle.endsWith(')'))advice.push('terminal-parentheses-uninterpreted');
 return {raw,title,namespace,localTitle,navigationSegments:segments,validForCurrentWriter:validWikiTitle(title),normalizationChanged:raw!==title,explicitParts:null,advice};
}
export function composeDocumentAddress(parts:ExplicitTitleParts) {
 if(parts.namespace!==''&&!isWikiNamespace(parts.namespace))throw new Error('Unknown namespace; keep unregistered prefixes inside the headword.');
 if(!Array.isArray(parts.pathSegments)||!parts.pathSegments.length||parts.pathSegments.some(segment=>typeof segment!=='string'||!segment.trim()))throw new Error('Explicit nonempty title segments are required.');
 if(typeof parts.decompositionSource!=='string'||!parts.decompositionSource.trim())throw new Error('Decomposition provenance is required; a raw title is not explicit evidence.');
 if(parts.disambiguator!==null&&(typeof parts.disambiguator!=='string'||!parts.disambiguator.trim()||!balanced(parts.disambiguator)))throw new Error('Disambiguator must be explicit nonempty balanced text.');
 const localTitle=parts.pathSegments.join('/')+(parts.disambiguator===null?'':'('+parts.disambiguator+')');
 const raw=(parts.namespace?parts.namespace+':':'')+localTitle;
 const address=inspectDocumentAddress(raw);
 if(!address.validForCurrentWriter)throw new Error('Current title storage limits apply.');
 if(address.title!==raw)throw new Error('Explicit parts must already express a canonical trim/NFC address; preserve raw observations separately.');
 // Do not accidentally promote a main-namespace headword such as "틀:A" to
 // another namespace, or silently remove local spelling from supplied parts.
 if(address.namespace!==parts.namespace||address.localTitle!==localTitle.normalize('NFC'))throw new Error('Explicit parts do not round trip through the current address contract.');
 return { ...address, explicitParts: {...parts,pathSegments:[...parts.pathSegments]}};
}
export function attachExplicitTitleParts(raw:string,parts:ExplicitTitleParts) {
 const observed=inspectDocumentAddress(raw),composed=composeDocumentAddress(parts);
 if(observed.title!==composed.title)throw new Error('Decomposition must reproduce the observed title; do not rename legacy data.');
 return {...observed,explicitParts:composed.explicitParts};
}


/** Preserve every explicit claim; a shared address cannot pick its own meaning. */
export function diagnoseTitleDeclarations(declarations:{raw:string;parts:ExplicitTitleParts}[]) {
 const groups=new Map<string,{title:string;claims:ReturnType<typeof attachExplicitTitleParts>[];conflict:boolean}>();
 for(const declaration of declarations){
  const claim=attachExplicitTitleParts(declaration.raw,declaration.parts);
  const group=groups.get(claim.title)??{title:claim.title,claims:[],conflict:false};
  group.claims.push(claim);groups.set(claim.title,group);
 }
 for(const group of groups.values()){
  const meanings=new Set(group.claims.map(claim=>JSON.stringify([claim.explicitParts.namespace,claim.explicitParts.pathSegments,claim.explicitParts.disambiguator])));
  group.conflict=meanings.size>1;
 }
 return [...groups.values()];
}

export type PrototypeThread = {
 id:string;kind:string;subject:string;state:string;
 bindings:{kind:string;id:string;[key:string]:unknown}[];
 entries:{id:string;sequence:number;kind:string;body:string;[key:string]:unknown}[];
 [key:string]:unknown;
};
// Examples for the experiment, not a closed production kind registry.
const demonstratedKinds=new Set(['discussion','ai-conversation','worklog']);
function nonempty(value:unknown):value is string{return typeof value==='string'&&!!value.trim();}
export function inspectThreadPrototype(value:PrototypeThread) {
 if(!value||!nonempty(value.id)||!nonempty(value.kind)||typeof value.subject!=='string'||!nonempty(value.state)||!Array.isArray(value.bindings)||!Array.isArray(value.entries))throw new Error('Incomplete generic thread envelope.');
 const ids=new Set<string>(),numbers=new Set<number>();
 for(const entry of value.entries){
  if(!entry||!nonempty(entry.id)||!nonempty(entry.kind)||typeof entry.body!=='string'||!Number.isSafeInteger(entry.sequence)||entry.sequence<1||ids.has(entry.id)||numbers.has(entry.sequence))throw new Error('Invalid or duplicate thread entry.');
  ids.add(entry.id);numbers.add(entry.sequence);
 }
 const bindings=new Set<string>();
 for(const ref of value.bindings){
  const key=JSON.stringify([ref?.kind,ref?.id]);
  if(!ref||!nonempty(ref.kind)||!nonempty(ref.id)||bindings.has(key))throw new Error('Invalid or duplicate typed binding.');
  bindings.add(key);
 }
 return {thread:value,interpretation:demonstratedKinds.has(value.kind)?'demonstrated':'opaque',stateInterpretation:'kind-specific'};
}
export const DOMAIN_EXPERIMENT_FORMAT='wiki42-domain-contract-experiment-v1';
export function decodeThreadExperiment(raw:string):PrototypeThread[] {
 const data=JSON.parse(raw);
 if(data?.format!==DOMAIN_EXPERIMENT_FORMAT||!Array.isArray(data.threads))throw new Error('Not a domain experiment; never import this format into production.');
 const ids=new Set<string>();
 for(const thread of data.threads){inspectThreadPrototype(thread);if(ids.has(thread.id))throw new Error('Duplicate thread ID.');ids.add(thread.id);}
 return data.threads;
}
