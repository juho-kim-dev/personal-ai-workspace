'use client';
import { useState, type KeyboardEvent } from 'react';
import { LockKeyhole, Moon, Sun, Network } from 'lucide-react';
import type { WikiAccent } from '../../lib/wiki-theme';
import type { ReadingPreviews } from '../../lib/wiki-reading-preview';
import { wikiHref, modifiedLinkClick } from '../../lib/wiki-navigation';
import { WikiAccentSettings } from './wiki-accent-settings';
import { WikiBackup } from './wiki-backup';
import { WikiPreservation } from './wiki-preservation';
import { WikiIdentity } from './wiki-identity';
import { WikiMcpCheck } from './wiki-mcp-check';
import './wiki-settings.css';

type Props = {
 theme: string; accent: WikiAccent; readingPreviews: ReadingPreviews;
 changeTheme: () => void; changeAccent: (value: WikiAccent) => void;
 changeReadingPreview: (key: keyof ReadingPreviews, value: boolean) => void;
 dataChanged: () => void; webMcp: { status: string };
 navigate: (title: string) => unknown;
};
export function WikiSettings({theme,accent,readingPreviews,changeTheme,changeAccent,changeReadingPreview,dataChanged,webMcp,navigate}: Props) {
 const [active,setActive] = useState('settings-appearance');
 function tabKey(event: KeyboardEvent<HTMLElement>) {
  const ids=['settings-appearance','settings-data','settings-connections'];
  const index=ids.indexOf(active);
  const next=event.key==='ArrowRight' ? (index+1)%3 : event.key==='ArrowLeft' ? (index+2)%3 : event.key==='Home' ? 0 : event.key==='End' ? 2 : -1;
  if(next<0)return;
  event.preventDefault();setActive(ids[next]);document.getElementById('tab-'+ids[next])?.focus();
 }

 return <div className="wiki-settings"><section className="settings-intro"><h2><LockKeyhole size={21}/>비공개 개인 위키</h2><p>문서와 이력은 소유자만 사용할 수 있는 공간에 저장됩니다.</p></section>
 <div className="settings-layout"><nav className="settings-index" role="tablist" aria-label="설정 구역" onKeyDown={tabKey}>
  <button id="tab-settings-appearance" role="tab" tabIndex={active==='settings-appearance'?0:-1} aria-selected={active==='settings-appearance'} aria-controls="settings-appearance" onClick={()=>setActive('settings-appearance')}>화면 설정</button>
  <button id="tab-settings-data" role="tab" tabIndex={active==='settings-data'?0:-1} aria-selected={active==='settings-data'} aria-controls="settings-data" onClick={()=>setActive('settings-data')}>백업·자료 관리</button>
  <button id="tab-settings-connections" role="tab" tabIndex={active==='settings-connections'?0:-1} aria-selected={active==='settings-connections'} aria-controls="settings-connections" onClick={()=>setActive('settings-connections')}>AI 연결</button>
 </nav><div className="settings-sections">
 <div id="settings-appearance" className="settings-group" role="tabpanel" aria-labelledby="tab-settings-appearance" hidden={active!=='settings-appearance'}><section className="settings-block"><h2>화면 설정</h2><button onClick={changeTheme}>{theme === 'light' ? <Moon size={16}/> : <Sun size={16}/>} {theme === 'light' ? '어두운 화면으로' : '밝은 화면으로'}</button><WikiAccentSettings value={accent} onChange={changeAccent}/><fieldset className="reading-preview-settings"><legend>읽기 미리보기</legend><label><input type="checkbox" checked={readingPreviews.documents} onChange={e => changeReadingPreview("documents",e.target.checked)}/>내부 문서 미리보기</label><label><input type="checkbox" checked={readingPreviews.notes} onChange={e => changeReadingPreview("notes",e.target.checked)}/>각주 미리보기</label><p>링크 위에 마우스를 올리거나 키보드로 초점을 맞추면 표시합니다. 클릭·터치는 원래 링크로 이동합니다. 이 브라우저에 저장됩니다.</p></fieldset></section></div>
 <div id="settings-data" className="settings-group" role="tabpanel" aria-labelledby="tab-settings-data" hidden={active!=='settings-data'}><WikiBackup changed={dataChanged}/><WikiPreservation changed={dataChanged}/><WikiIdentity changed={dataChanged}/><section className="settings-block"><h2>데이터 저장 방식</h2><p>문서·판 이력·휴지통·토론·메모·즐겨찾기는 서버의 D1(SQLite) DB에, 첨부파일 본체는 R2에 저장합니다. 사이트 업데이트 후에도 유지됩니다. 화면 설정은 이 브라우저에, 편집·토론 초안은 이 탭의 임시 저장 공간에 보관됩니다.</p><p>전체 백업에는 위키 문서·기록과 첨부파일이 함께 들어갑니다. 보관한 외부 원본 묶음은 보관 목록에서 각각 내보내야 합니다. 자동 외부 백업은 설정되어 있지 않습니다.</p></section></div>
 <div id="settings-connections" className="settings-group" role="tabpanel" aria-labelledby="tab-settings-connections" hidden={active!=='settings-connections'}><WikiMcpCheck changed={dataChanged}/><section className="settings-block"><h2>브라우저 AI 연결 · WebMCP</h2><p role="status">{webMcp.status === 'registered' ? '연결됨 · 이 탭에서 문서 검색·읽기·저장을 사용할 수 있습니다.' : webMcp.status === 'registering' ? '브라우저 AI 도구를 연결하고 있습니다…' : webMcp.status === 'error' ? '브라우저 AI 도구를 연결하지 못했습니다. 페이지를 새로고침해 주세요.' : '이 브라우저는 WebMCP를 제공하지 않습니다. 개인 플러그인의 MCP 도구는 계속 사용할 수 있습니다.'}</p><p>열려 있는 이 탭의 로그인 권한을 사용합니다. 저장은 새 판으로 남으며, 저장하지 않은 편집 내용이나 열린 토론이 있으면 먼저 마무리해 주세요.</p></section><section className="settings-block"><h2>AI 연결</h2><p>개인 플러그인에서 문서 검색·읽기·저장, 휴지통·복원, 토론 도구를 사용합니다. 위 연결 진단으로 서버 도구 목록과 실제 동작을 확인할 수 있습니다.</p><a href={wikiHref("PAW Wiki:AI 연결")} onClick={event=>{if(modifiedLinkClick(event))return;event.preventDefault();navigate("PAW Wiki:AI 연결");}}><Network size={16}/> MCP 연결 안내</a></section></div>
 </div></div></div>;
}
