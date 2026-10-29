'use client';
import {wikiHref,modifiedLinkClick} from '../../lib/wiki-navigation';
import {wikiNamespace} from '../../lib/wiki-title';
type Page={title:string;content:string};
export function projectIndex(pages:Page[]){
 const projects=pages.filter(p=>wikiNamespace(p.title)==='프로젝트');
 const roots=projects.filter(p=>!p.title.slice('프로젝트:'.length).includes('/'));
 const rootNames=new Set(roots.map(p=>p.title));
 return {
  roots:roots.sort((a,b)=>a.title.localeCompare(b.title,'ko')).map(page=>({page,children:projects.filter(p=>p.title.startsWith(page.title+'/'))})),
  unrooted:projects.filter(p=>p.title.includes('/')&&!rootNames.has(p.title.split('/')[0])),
 };
}
export function WikiProjectIndex({pages,open}:{pages:Page[];open:(title:string,view?:string)=>unknown}){
 const {roots,unrooted}=projectIndex(pages);
 function Link({title,children}:{title:string;children:React.ReactNode}){return <a href={wikiHref(title)} onClick={e=>{if(modifiedLinkClick(e))return;e.preventDefault();open(title)}}>{children}</a>}
 return <section className="project-hub-index" aria-label="프로젝트 대표 문서">
  <h2 className="simple-heading">프로젝트 찾아보기</h2>
  {roots.length?<ul className="project-hub-list">{roots.map(({page,children})=><li key={page.title}><Link title={page.title}><strong>{page.title.slice('프로젝트:'.length)}</strong></Link><small>하위 문서 {children.length}개</small></li>)}</ul>:<p>아직 프로젝트 대표 문서가 없습니다.</p>}
  {unrooted.length>0&&<><h3>대표 문서가 없는 기록</h3><p>상위 문서가 아직 없는 기록입니다.</p><ul>{unrooted.map(p=><li key={p.title}><Link title={p.title}>{p.title}</Link></li>)}</ul></>}
 </section>;
}
