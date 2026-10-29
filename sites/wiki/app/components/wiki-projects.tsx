'use client';
import {useState} from 'react';
import {wikiCategories} from '../../lib/wiki-text';
import {wikiHref} from '../../lib/wiki-navigation';
type Page={title:string;content:string};
export const projectTemplate='= 목표 =\n * 달성할 목표와 완료 기준을 적어 주세요.\n\n= 참고 자료 =\n * [[관련 문서]]\n\n= 작성할 문서 =\n * [[새로 작성할 문서]]\n\n= 보완할 문서 =\n * [[도움이 필요한 문서]]\n\n= 할 일 =\n * [ ] 목표 정리\n * [ ] 자료 조사\n * [ ] 결과 검토\n\n= 성과 =\n날짜와 함께 작성·보완한 문서를 연결해 주세요.\n\n= 결정 기록 =\n상단 토론에서 주제별 결정과 근거를 기록합니다. 기존 개인 메모도 별도로 사용할 수 있습니다.\n\n[[분류:프로젝트]]';
export function projectGroups(pages:Page[]){
 const roots=new Set(['프로젝트']),classified=pages.map(p=>({page:p,categories:wikiCategories(p.content)}));
 let expanded=true;
 while(expanded){expanded=false;for(const {page,categories} of classified){if(page.title.startsWith('분류:')&&!roots.has(page.title.slice(3))&&categories.some(c=>roots.has(c))){roots.add(page.title.slice(3));expanded=true;}}}
 return {
  namespace:pages.filter(p=>p.title.startsWith('프로젝트:')),
  category:classified.filter(({page,categories})=>!page.title.startsWith('프로젝트:')&&!page.title.startsWith('분류:')&&categories.some(c=>roots.has(c))).map(p=>p.page),
  categoryPages:pages.filter(p=>p.title.startsWith('분류:')&&roots.has(p.title.slice(3))),
 };
}
export function WikiProjects({pages,create}:{pages:Page[];create:(title:string)=>unknown}){
 const [name,setName]=useState(''),groups=projectGroups(pages);
 const sections:[string,Page[]][]=[['프로젝트 이름공간',groups.namespace],['프로젝트 분류 문서',groups.category],['프로젝트 하위 분류',groups.categoryPages]];
 return <section><p className="notice">프로젝트: 문서와 프로젝트 분류·하위 분류의 문서를 모았습니다. 목표, 작성·보완할 문서, 성과와 토론을 연결하세요.</p><form onSubmit={e=>{e.preventDefault();if(name.trim())create('프로젝트:'+name.trim().replace(/^프로젝트:/,''));}}><label>프로젝트 이름<input aria-label="프로젝트 이름" required maxLength={170} value={name} onChange={e=>setName(e.target.value)}/></label><button disabled={!name.trim()}>프로젝트 문서 작성</button></form>{sections.map(([label,list])=><div key={label}><h2>{label}</h2><ul>{list.map(p=><li key={p.title}><a href={wikiHref(p.title)}>{p.title}</a> · <a href={wikiHref(p.title,'discussions')}>토론</a> · <a href={wikiHref(p.title,'notes')}>개인 메모</a></li>)}</ul>{!list.length&&<p>아직 문서가 없습니다.</p>}</div>)}</section>;
}
