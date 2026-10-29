'use strict';
// One local content identity is shared by the grid, search, detail and future adapters.
(() => {
  const canonical = value => {
    const text = String(value || '');
    const match = text.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)(?:\/|$)/);
    const id = match ? match[1] : text;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('INVALID_CONTENT_ID');
    return id;
  };
  const normalize = text => String(text || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  function merge(previous, page) {
    const result = structuredClone(previous || { schema: 1, records: [], observations: [], enumeration: { status: 'unknown' } });
    const byId = new Map(result.records.map(row => [row.id, row]));
    if (result.observations.some(row => row.key === page.key)) return result;
    let added = 0;
    for (const [index, item] of page.items.entries()) {
      const id = canonical(item.id || item.permalink), old = byId.get(id);
      const membership = { collection: page.collection, order: index, observation: page.key, observedAt: page.observedAt };
      if (old) {
        old.memberships.push(membership);
        if (!old.thumbnail && item.thumbnail) old.thumbnail = item.thumbnail;
      } else {
        const row = { ...item, id, discoveredOrder: result.records.length, firstObservedAt: page.observedAt, memberships: [membership], detailStatus: 'uncollected' };
        result.records.push(row); byId.set(id, row); added++;
      }
    }
    result.observations.push({ key: page.key, evidence: page.evidence, observedAt: page.observedAt, collection: page.collection, seen: page.items.length, added, loading: page.loading ?? 'unknown', end: page.end || null });
    // Repeated counts alone never prove exhaustion. An explicit scoped end receipt is required.
    const completed = page.end?.kind === 'explicit-end' && page.end.evidence && page.loading === false && page.end.collection === page.collection;
    result.enumeration = { status: completed ? 'complete' : 'partial', collection: page.collection, endEvidence: completed ? page.end : null, resume: { observation: page.key, lastId: page.items.at(-1)?.id || null }, reason: completed ? 'explicit-source-end' : 'source-end-not-proven' };
    return result;
  }
  function search(records, query) {
    const terms = normalize(query).split(' ').filter(Boolean);
    if (!terms.length) return [];
    return records.filter(row => {
      const p = row.post || row;
      const text = normalize([p.title, p.caption, p.author, p.thumbnailDescription, ...(p.comments||[]).map(commentBody), ...(row.reading?.ocr?.segments || []).map(x => x.text), ...(row.reading?.asr?.segments || []).map(x => x.text), ...(row.reading?.sceneText?.segments || []).map(x => x.text)].join(' '));
      return terms.every(term => text.includes(term));
    });
  }
  function readingStatus(record) {
    return {
      caption: record.captionStatus || 'unknown',
      comments: record.commentsStatus || 'unknown',
      media: record.mediaStatus || 'unknown',
      ocr: record.reading?.ocr?.status || 'not-analyzed',
      asr: record.reading?.asr?.status || 'not-analyzed',
      scenes: record.reading?.scenes?.status || 'not-analyzed',
      inference: record.reading?.inference?.status || 'not-analyzed'
    };
  }
  function matches(record,query) {
    const terms=normalize(query).split(' ').filter(Boolean),p=record.post||record;
    const fields=[{kind:'author',text:p.author},{kind:'caption',text:p.caption},{kind:'thumbnail-description',text:p.thumbnailDescription}];
    for(const comment of p.comments||[])if(commentBody(comment))fields.push({kind:'comment',text:commentBody(comment),commentId:comment.id});
    for(const kind of ['ocr','asr','sceneText'])for(const segment of record.reading?.[kind]?.segments||[])fields.push({kind,...segment});
    return fields.filter(field=>terms.some(term=>normalize(field.text).includes(term)));
  }
  function location(params,count=1){
    const text=params.get('t');if(text===null||text.trim()==='')return null;
    const start=Number(text);if(!Number.isFinite(start)||start<0)return null;
    const raw=Number(params.get('img_index')||1)-1,ordinal=Number.isInteger(raw)?Math.max(0,Math.min(raw,(count||1)-1)):0;
    const kind=['asr','ocr','sceneText'].includes(params.get('reading'))?params.get('reading'):'asr';
    return {kind,start,ordinal};
  }
  function commentBody(comment){return comment.bodyStatus==='unknown'||typeof comment.text!=='string'?'':comment.text;}
  function displayCommentBody(comment){return commentBody(comment)||'댓글 본문 미확인';}
  window.MediaLibraryCorpus = Object.freeze({ canonical, normalize, merge, search, matches, readingStatus, location, commentBody, displayCommentBody });
})();
