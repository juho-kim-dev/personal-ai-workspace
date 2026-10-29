'use client';
import {useRef,useEffect} from 'react';
type Evidence={start:boolean;over:boolean;drop:boolean};
type Rect={left:number;right:number;top:number;bottom:number};
type Props={name:string;disabled:boolean;scope:number;rect:()=>Rect|null;commit:(name:string)=>void;feedback:(message:string,evidence:Evidence)=>void;highlight:(on:boolean)=>void};
/** Pointer capture keeps a drag attached to its original handle on mouse/touch.
 * This moves an existing file reference only; OS-file drops use DataTransfer. */
export function WikiAttachmentHandle({name,disabled,scope,rect,commit,feedback,highlight}:Props){
 const pending=useRef<{id:number;x:number;y:number;scope:number;moved:boolean;start:boolean;over:boolean;target:HTMLButtonElement}|null>(null);
 const inside=(x:number,y:number)=>{const r=rect();return !!r&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;};
 function cancel(notify=true){const d=pending.current;if(!d)return;pending.current=null;try{if(d.target.hasPointerCapture(d.id))d.target.releasePointerCapture(d.id);}catch{}highlight(false);if(notify)feedback('끌어놓기가 취소됐습니다. 편집 영역 안에 놓거나 원문에 넣기 버튼을 사용하세요.',{start:d.start,over:d.over,drop:false});}
 useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&pending.current){cancel();e.preventDefault();}};window.addEventListener('keydown',escape);return()=>{window.removeEventListener('keydown',escape);cancel(false);};},[scope,disabled]);
 return <button type="button" className="attachment-drag-handle" disabled={disabled} aria-label={name+' 끌어서 넣기'} draggable={false}
 onDragStart={e=>e.preventDefault()}
 onPointerDown={e=>{if(disabled||e.button!==0||!e.isPrimary||pending.current)return;e.preventDefault();pending.current={id:e.pointerId,x:e.clientX,y:e.clientY,scope,moved:false,start:e.isTrusted,over:false,target:e.currentTarget};e.currentTarget.setPointerCapture(e.pointerId);}}
 onPointerMove={e=>{const d=pending.current;if(!d||d.id!==e.pointerId)return;if(disabled||d.scope!==scope){cancel();return;}if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<6&&!d.moved)return;d.moved=true;const over=inside(e.clientX,e.clientY);d.over=over&&e.isTrusted;highlight(over);feedback(over?'편집 영역에 도착했습니다. 놓으면 현재 편집 커서에 넣습니다.':'파일을 집었습니다. 아래 편집 영역에 놓아 주세요.',{start:d.start,over:d.over,drop:false});}}
 onPointerUp={e=>{const d=pending.current;if(!d||d.id!==e.pointerId)return;pending.current=null;highlight(false);const over=inside(e.clientX,e.clientY),accepted=!disabled&&d.scope===scope&&d.moved&&over;
   if(accepted){commit(name);feedback('첨부파일 링크를 편집 커서에 넣었습니다. 저장하면 문서에 반영됩니다.',{start:d.start,over:d.over||e.isTrusted,drop:e.isTrusted});}
   else if(d.moved)feedback('끌어놓기가 취소됐습니다. 편집 영역 안에 놓거나 원문에 넣기 버튼을 사용하세요.',{start:d.start,over:d.over,drop:false});
   try{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}catch{}
 }} onPointerCancel={()=>cancel()} onLostPointerCapture={()=>cancel()} onKeyDown={e=>{if(e.key==='Escape'){cancel();e.preventDefault();}}}>⠿ 끌기</button>;
}
