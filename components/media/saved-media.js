'use strict';
(() => {
  function slots(post) {
    const count=post.knownMediaCount||Math.max(1,...post.assets.map(a=>(a.ordinal||0)+1));
    return Array.from({length:count},(_,ordinal)=>({ordinal,image:post.assets.find(a=>a.ordinal===ordinal&&a.role==='image'),video:post.assets.find(a=>a.ordinal===ordinal&&a.role==='video'),poster:post.assets.find(a=>a.ordinal===ordinal&&a.role==='poster')}));
  }
  function mount(media,post,index,onSlide) {
    const all=slots(post);let current=Math.max(0,Math.min(index,all.length-1));
    const E=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
    const button=(label,fn,cls)=>{const n=E('button',cls,label);n.type='button';n.setAttribute('aria-label',label);n.addEventListener('click',fn);return n;};
    function show(ordinal,route=true) {
      media.querySelectorAll('video').forEach(v=>v.pause());media.replaceChildren();current=Math.max(0,Math.min(ordinal,all.length-1));
      const slot=all[current];media.dataset.index=String(current);media.dataset.knownCount=String(all.length);media.dataset.availableCount=String(all.filter(s=>s.image||s.video).length);
      if(slot.video){
        const v=E('video');v.src=slot.video.src;v.poster=slot.poster?.src||'';v.preload='metadata';v.playsInline=true;v.muted=true;v.setAttribute('aria-label','보존한 동영상');
        const tools=E('div','video-tools'),play=button('재생',()=>{if(v.paused)v.play().catch(()=>{play.textContent='재생 실패';});else v.pause();}),mute=button('소리 켜기',()=>{v.muted=!v.muted;}),seek=E('input');seek.type='range';seek.min='0';seek.max='0';seek.step='0.05';seek.value='0';seek.setAttribute('aria-label','동영상 위치');
        seek.addEventListener('input',()=>{v.currentTime=Number(seek.value);});v.addEventListener('loadedmetadata',()=>{if(Number.isFinite(v.duration))seek.max=String(v.duration);});v.addEventListener('timeupdate',()=>{seek.value=String(v.currentTime);});
        const sync=()=>{play.textContent=v.paused?'재생':'일시정지';play.setAttribute('aria-label',play.textContent);mute.textContent=v.muted?'소리 켜기':'소리 끄기';mute.setAttribute('aria-label',mute.textContent);};
        for(const event of ['play','pause','ended','volumechange'])v.addEventListener(event,sync);v.addEventListener('click',()=>play.click());tools.append(play,seek,mute);media.append(v,tools);
      }else if(slot.image||slot.poster){const image=E('img','main-image');image.src=(slot.image||slot.poster).src;image.alt=post.kind==='reel'?'보존한 영상 포스터':'보존한 게시물 이미지';media.append(image);if(!slot.image)media.append(E('p','unavailable','영상 파일 미보존 · 포스터만 표시'));}
      else media.append(E('p','unavailable','이 미디어는 아직 보존하지 않았습니다.'));
      if(all.length>1){const prev=button('이전 슬라이드',()=>show(current-1),'slide-prev'),next=button('다음 슬라이드',()=>show(current+1),'slide-next');prev.hidden=current===0;next.hidden=current===all.length-1;const dots=E('div','dots');for(const s of all){const dot=E('span','dot'+(s.ordinal===current?' active':''));dots.append(dot);}media.append(prev,next,dots);}
      if(route)onSlide(current);
    }
    show(current,false);
    media.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();show(current+(event.key==='ArrowRight'?1:-1));}});
    const player=Object.freeze({seek(ordinal,time){if(ordinal!==current)show(ordinal,false);onSlide(current,time);const v=media.querySelector('video');if(v){const apply=()=>{const target=Math.min(time,Number.isFinite(v.duration)?Math.max(0,v.duration-.01):time);media.dataset.seekState='requested';const verify=()=>{media.dataset.seekTime=String(v.currentTime);media.dataset.seekState=Math.abs(v.currentTime-target)<.1?'applied':'different';};v.addEventListener('seeked',verify,{once:true});v.addEventListener('error',()=>{media.dataset.seekState='media-error';},{once:true});v.currentTime=target;if(v.readyState>=2&&!v.seeking)verify();};media.dataset.seekState='pending';if(v.readyState)apply();else v.addEventListener('loadedmetadata',apply,{once:true});}}});
    media.mediaPlayer=player;return player;
  }
  window.MediaLibrarySavedMedia=Object.freeze({slots,mount});
})();
