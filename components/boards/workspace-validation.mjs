const clean = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
export const emptyState = () => ({schemaVersion: 1, revision: 0, updatedAt: null, boards: [{id:'inspiration', title:'아이디어', createdAt:null}], items:{}});
export function validateState(value, knownIds, previous = {items:{}}) {
  if (!value || !Array.isArray(value.boards) || typeof value.items !== 'object' || !value.items || Array.isArray(value.items)) throw new Error('INVALID_STATE');
  // 전체 saved 핀의 개인 정리를 위해 500에서 확대한다. 요청·저장 JSON은 여전히 1MiB다.
  if (value.boards.length > 100 || Object.keys(value.items).length > 10000) throw new Error('STATE_LIMIT');
  const boardIds = new Set();
  const boards = value.boards.map(board => {
    if (!board || typeof board !== 'object' || !/^[a-zA-Z0-9_-]{1,80}$/.test(board.id) || boardIds.has(board.id) || !clean(board.title,100)) throw new Error('INVALID_BOARD');
    boardIds.add(board.id);
    const sectionIds = new Set();
    const sections = board.sections ?? previous.boards?.find(b=>b.id===board.id)?.sections ?? [];
    if (!Array.isArray(sections) || sections.length > 100) throw new Error('INVALID_SECTIONS');
    const normalizedSections = sections.map(section=>{
      if (!section || !/^[a-zA-Z0-9_-]{1,80}$/.test(section.id) || sectionIds.has(section.id) || !clean(section.title,100)) throw new Error('INVALID_SECTION');
      sectionIds.add(section.id); return {id:section.id,title:clean(section.title,100)};
    });
    const result={id:board.id,title:clean(board.title,100),createdAt: typeof board.createdAt === 'string' ? board.createdAt.slice(0,30) : null};
    for(const field of ['description','secret','personalization','sourceBoardId']) {
      const v=Object.hasOwn(board,field)?board[field]:previous.boards?.find(b=>b.id===board.id)?.[field];
      if(v===undefined)continue;
      if(field==='secret'||field==='personalization'){if(typeof v!=='boolean')throw new Error('INVALID_BOARD');result[field]=v;}
      else if(field==='sourceBoardId'){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(v))throw new Error('INVALID_BOARD');result[field]=v;}
      else result[field]=clean(v,2000);
    }
    if(normalizedSections.length || Object.hasOwn(board,'sections'))result.sections=normalizedSections;
    return result;
  });
  const items = {};
  for (const [id, item] of Object.entries(value.items)) {
    if (!knownIds.has(id)) throw new Error('UNKNOWN_PIN');
    if (!item || !Array.isArray(item.boards) || !Array.isArray(item.tags)) throw new Error('INVALID_ITEM');
    if (Object.hasOwn(item,'favorite') && typeof item.favorite !== 'boolean') throw new Error('INVALID_ITEM');
    if (item.boards.some(board => !boardIds.has(board))) throw new Error('UNKNOWN_BOARD');
    items[id] = {boards:[...new Set(item.boards)], tags:[...new Set(item.tags.map(tag=>clean(tag,60)).filter(Boolean))].slice(0,30), notes:clean(item.notes,20000), inbox: item.inbox !== false, favorite: Object.hasOwn(item,'favorite') ? item.favorite : previous.items?.[id]?.favorite === true, updatedAt: new Date().toISOString()};
    const sections=Object.hasOwn(item,'sections')?item.sections:previous.items?.[id]?.sections;
    if(sections!==undefined){
      if(!sections||typeof sections!=='object'||Array.isArray(sections))throw new Error('INVALID_SECTION_MEMBERSHIP');
      items[id].sections={};
      for(const [boardId,sectionId] of Object.entries(sections)){
        const board=boards.find(b=>b.id===boardId);
        if(!board||!item.boards.includes(boardId)||!board.sections?.some(s=>s.id===sectionId))throw new Error('UNKNOWN_SECTION');
        items[id].sections[boardId]=sectionId;
      }
    }
  }
  return {schemaVersion:1,boards,items};
}
