'use client';
import {BookOpen,Plus,Star,History,ClipboardCheck} from 'lucide-react';
import {wikiHref,modifiedLinkClick} from '../lib/wiki-navigation';
import {WikiMarkup} from './wiki-markup';
type Page={title:string;content:string;updated_at:string};
// Existing PAW sites selected for the home portal; Alder and Cedar are intentionally omitted.
const sisterProjects: {name:string;description?:string;url?:string;logo:string;candidate?:boolean}[]=[
 {name:'Threads',description:'대화 원문과 맥락',logo:'yarnbox.svg'},
 {name:'Documents',description:'한글 문서 편집',logo:'yeobaek.svg'},
 {name:'Notes',description:'노트·그래프·캔버스',logo:'naid.svg'},
 {name:'Community',description:'게시물과 댓글 보관',logo:'acra.svg'},
 {name:'Media',description:'이미지와 영상',logo:'marga.svg'},
 {name:'Boards',description:'출처와 자료 보드',logo:'tseret.svg'},
 {name:'Study',description:'원문과 번역 나란히 읽기',logo:'nalanhi.svg'},
 {name:'Projects',logo:'tig.svg',candidate:true},
];
export function WikiHome({pages,sources,bookmarks=[],open,create}:{pages:Page[];sources:Record<string,string>;bookmarks?:string[];open:(title:string,view?:string)=>unknown;create:()=>void}){
 const recent=[...pages].filter(p=>p.title!=='PAW Wiki:대문').sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).slice(0,5);
 const favorites=bookmarks.filter(title=>pages.some(p=>p.title===title)).slice(0,5);
 function Link({title,children,view='read'}:{title:string;children:React.ReactNode;view?:string}){return <a href={wikiHref(title,view)} onClick={e=>{if(modifiedLinkClick(e))return;e.preventDefault();open(title,view)}}>{children}</a>}
 return <section className="wiki-home" aria-label="내 위키 바로가기">
  <header className="home-masthead">
   <div className="home-masthead-kicker"><span>PAW WIKI</span><span lang="en">PAW · PERSONAL AI WORKSPACE</span></div>
   <div className="home-masthead-title"><h1 lang="en">DON’T<br/>PANIC!</h1><img src="/wiki42-icon.svg" width={64} height={64} alt=""/></div>
   <p><span>기록은 기억보다 오래갑니다. 아, 착각도요.</span></p>
  </header>
  <section className="home-guide" aria-label="PAW Wiki 안내"><WikiMarkup content="[include(틀:대문 둘러보기)]" sources={sources} documentTitle="PAW Wiki:대문" known={pages.map(p=>p.title)} open={open} idPrefix="home-guide" linkViews={{'PAW Wiki 설정':'settings'}}/></section>
  <nav className="home-shortcuts" aria-label="위키 작업"><button className="primary" onClick={create}><Plus size={16}/>새 문서</button><Link title="검토할 항목" view="review-queue"><ClipboardCheck size={16}/>검토할 항목</Link><Link title="모든 문서" view="all"><BookOpen size={16}/>모든 문서 <small>{pages.length}</small></Link></nav>
  <div className="home-columns"><section className="home-section"><h2><History size={16}/>최근 고친 문서<Link title="최근 변경" view="changes">전체 이력</Link></h2>{recent.length?<ul>{recent.map(p=><li key={p.title}><Link title={p.title}>{p.title}</Link><time dateTime={p.updated_at}>{new Date(p.updated_at).toLocaleDateString('ko-KR',{month:'short',day:'numeric'})}</time></li>)}</ul>:<p>첫 문서를 작성하면 여기에 표시됩니다.</p>}</section>
  <section className="home-section"><h2><Star size={16}/>즐겨찾기<Link title="즐겨찾는 문서" view="favorites">전체 보기</Link></h2>{favorites.length?<ul>{favorites.map(title=><li key={title}><Link title={title}>{title}</Link></li>)}</ul>:<p>다시 읽을 문서의 ☆을 눌러 모아 두세요.</p>}</section></div>
  <section className="home-sisters" aria-labelledby="paw-sisters-title"><h2 id="paw-sisters-title">PAW 작업공간</h2><ul className="sister-projects">{sisterProjects.map(project=><li key={project.name}>{!project.url?<div className="sister-pending"><img className="sister-logo" src={'/paw-projects/'+project.logo} width={40} height={40} alt=""/><strong>{project.name}</strong><span>{project.candidate?"공개 후보":"공개 준비 중"}</span></div>:<a className="sister-link" href={project.url} target="_blank" rel="noopener noreferrer"><img className="sister-logo" src={'/paw-projects/'+project.logo} width={40} height={40} alt=""/><span><strong>{project.name}</strong><span>{project.description}</span></span><span className="sr-only">새 탭에서 열림</span></a>}</li>)}</ul></section>
 </section>;
}
