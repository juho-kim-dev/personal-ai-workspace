export function splitWikiTarget(value:string){const raw=value.trim().normalize('NFC'),at=raw.indexOf('#');return {title:(at<0?raw:raw.slice(0,at)).trim(),anchor:at<0?'':raw.slice(at+1)}}
export function wikiHref(title:string,view='read',extra:Record<string,string>={}){const target=view==='search'?{title:title.trim().normalize('NFC'),anchor:''}:splitWikiTarget(title);const params=new URLSearchParams({doc:target.title,view,...(target.anchor?{anchor:target.anchor}:{}),...extra});return '#'+params.toString()}
export function modifiedLinkClick(e:{button?:number;metaKey:boolean;ctrlKey:boolean;shiftKey:boolean;altKey:boolean}){return (e.button!==undefined&&e.button!==0)||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey}

/** Scroll snapshots belong to an exact history entry, never another document. */
export function wikiScrollPosition(state: unknown, hash: string): {x:number;y:number}|null {
  const value = (state as {wiki42Scroll?:{hash?:unknown;x?:unknown;y?:unknown}} | null)?.wiki42Scroll;
  return value?.hash === hash && typeof value.x === 'number' && Number.isFinite(value.x) && value.x >= 0 && typeof value.y === 'number' && Number.isFinite(value.y) && value.y >= 0 ? {x:value.x,y:value.y} : null;
}
