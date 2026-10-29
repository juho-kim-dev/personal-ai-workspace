// Selected invariants only. Shape IDs are deliberately excluded: exporters remap them.
export function styleFingerprint(doc){
 const model=JSON.parse(doc.getCursorModel()),chars=[],paras=[],cells=[];
 const pick=(value,keys)=>Object.fromEntries(keys.map(k=>[k,value[k]]));
 const charKeys=['fontFamily','fontSize','bold','italic','textColor'];
 for(let p=0;p<doc.getParagraphCount(0);p++){
  paras.push(JSON.parse(doc.getParaShapeSet(0,p)));
  const runs=[];for(let o=0;o<doc.getParagraphLength(0,p);o++)runs.push(pick(JSON.parse(doc.getCharPropertiesAt(0,p,o)),charKeys));chars.push(runs);
 }
 for(const c of model.lists.filter(l=>l.isCell)){
  const a=[c.sectionIndex,c.hostPara,c.controlIndex,c.cellIndex],props=JSON.parse(doc.getCellProperties(...a));
  const paragraphs=[];for(let p=0;p<c.paraCount;p++){
   const runs=[];for(let o=0;o<doc.getCellParagraphLength(...a,p);o++)runs.push(pick(JSON.parse(doc.getCellCharPropertiesAt(...a,p,o)),charKeys));
   paragraphs.push({chars:runs,para:pick(JSON.parse(doc.getCellParaPropertiesAt(...a,p)),['alignment','lineSpacing','marginLeft','marginRight','indent','spacingBefore','spacingAfter'])});
  }
  cells.push({props:pick(props,['width','height','borderLeft','borderRight','borderTop','borderBottom','fillType','fillColor']),paragraphs});
 }
 return {scope:'section 0 body and cursor-model cells; selected properties; no visual equivalence',chars,paras,cells};
}

export function fieldFingerprint(doc){return JSON.parse(doc.getFieldList()).map(({fieldType,name,value,location,editableInForm})=>({fieldType,name,value,location,editableInForm}))}
