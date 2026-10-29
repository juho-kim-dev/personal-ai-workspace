// Allowlisted, engine-native structured editing. Targets are valid only at a supplied revision.
export const capabilities={hwp:{read:true,write:true,structured:true},hwpx:{read:true,write:true,structured:true},docx:{read:false,write:false},pdf:{read:false,write:false}};
export function checked(value){const r=typeof value==='string'?JSON.parse(value):value;if(r?.ok===false||r?.error)throw Error(r.error??'Engine command rejected');return r}
export function structure(doc){
 const model=JSON.parse(doc.getCursorModel()),paragraphs=[];
 // Root list 0 is the engine's flattened body list. Section 0 is the supported edit scope.
 for(let p=0;p<doc.getParagraphCount(0);p++)paragraphs.push({target:`body:${p}`,listId:0,paragraph:p,text:doc.getTextRange(0,p,0,doc.getParagraphLength(0,p))});
 for(const c of model.lists.filter(x=>x.isCell&&x.sectionIndex===0&&x.hostListId===0))for(let p=0;p<c.paraCount;p++)paragraphs.push({target:`cell:${c.hostPara}:${c.controlIndex}:${c.cellIndex}:${p}`,listId:c.listId,paragraph:p,text:doc.getTextInCell(c.sectionIndex,c.hostPara,c.controlIndex,c.cellIndex,p,0,doc.getCellParagraphLength(c.sectionIndex,c.hostPara,c.controlIndex,c.cellIndex,p)),cell:c});
 return {fields:JSON.parse(doc.getFieldList()).map(({command,...field})=>field),scope:'section 0 body and direct table cells',pages:doc.pageCount(),paragraphs,tables:model.lists.filter(x=>x.isCell),text:doc.getTextFileUnicode()};
}
const integer=n=>Number.isInteger(n)&&n>=0;
function target(doc,id){const t=structure(doc).paragraphs.find(p=>p.target===id);if(!t)throw Error('Unknown or stale target');return t}
export function applyOperation(doc,op){
 if(!op||typeof op!=='object')throw Error('Invalid operation');
 if(op.type==='fill_field'){const field=JSON.parse(doc.getFieldList()).find(f=>f.fieldId===op.fieldId);if(!field||field.fieldType!=='clickhere'||field.location.sectionIndex!==0||typeof op.text!=='string'||op.text.length>100000||/[\r\n]/.test(op.text))throw Error('Unsupported field or value');checked(doc.setFieldValue(op.fieldId,op.text));return {ok:true,type:op.type,fieldId:op.fieldId}}
 const t=target(doc,op.target),length=[...t.text].length;
 const start=op.start??0,end=op.end??start;
 const cell=t.cell,a=cell?[0,cell.hostPara,cell.controlIndex,cell.cellIndex,t.paragraph]:[0,t.paragraph];
 if(!integer(start)||!integer(end)||start>end||end>length)throw Error('Invalid text range');
 if(op.type==='insert'||op.type==='replace'){
  if(typeof op.text!=='string'||op.text.length>100000||/[\r\n]/.test(op.text))throw Error('Text must be a single paragraph, at most 100000 UTF-16 units');
  // Exact first-scalar shape contract: no fallback font reconstruction or unit conversion.
  let anchor;
  if(op.type==='replace'&&end>start){
   const runs=JSON.parse(cell?doc.getCharShapeRunsInCellByPath(0,cell.hostPara,JSON.stringify([{controlIndex:cell.controlIndex,cellIndex:cell.cellIndex,cellParaIndex:t.paragraph}]),start,start+1):doc.getCharShapeRuns(0,t.paragraph,start,start+1));
   anchor=runs[0]?.charShapeId;if(!Number.isInteger(anchor))throw Error('Replacement character style unavailable');
   checked(cell?doc.deleteRangeInCell(...a,start,t.paragraph,end):doc.deleteRange(0,t.paragraph,start,t.paragraph,end));
  }
  checked(cell?doc.insertTextInCell(...a,start,op.text):doc.insertText(...a,start,op.text));
  if(anchor!==undefined&&op.text.length){const stop=start+[...op.text].length;checked(cell?doc.setCharShapeIdInCell(...a,start,stop,anchor):doc.setCharShapeId(0,t.paragraph,start,stop,anchor));}
 }else if(op.type==='character_format'){
  const allowed=['bold','italic','fontSize','textColor','fontFamily'];
  if(!op.properties||Object.keys(op.properties).some(k=>!allowed.includes(k)))throw Error('Unsupported character properties');
  for(const [k,v]of Object.entries(op.properties)){if(['bold','italic'].includes(k)&&typeof v!=='boolean')throw Error('Boolean format required');if(k==='fontSize'&&(!Number.isFinite(v)||v<1||v>200))throw Error('Invalid font size');if(k==='textColor'&&!/^#[0-9a-f]{6}$/i.test(v))throw Error('Invalid color');if(k==='fontFamily'&&(typeof v!=='string'||v.length>100))throw Error('Invalid font');}
  const props={...op.properties};if(props.fontSize!==undefined)props.fontSize=Math.round(props.fontSize*100);
  checked(cell?doc.applyCharFormatInCell(...a,start,end,JSON.stringify(props)):doc.applyCharFormat(...a,start,end,JSON.stringify(props)));
 }else if(op.type==='paragraph_format'){
  const allowed=['alignment','lineSpacing','spacingBefore','spacingAfter','marginLeft','marginRight','indent'];
  if(!op.properties||Object.keys(op.properties).some(k=>!allowed.includes(k)))throw Error('Unsupported paragraph properties');
  for(const [key,value]of Object.entries(op.properties)){if(key==='alignment'){if(!['left','center','right','justify','distribute','distributeSpace'].includes(value))throw Error('Invalid alignment')}else if(!Number.isFinite(value)||Math.abs(value)>100000||(key==='lineSpacing'&&value<=0))throw Error('Invalid paragraph metric')}
  checked(doc.applyParaFormatAtCursor(t.listId,t.paragraph,JSON.stringify(op.properties)));
 }else if(op.type==='create_field'){
  if(typeof op.name!=='string'||!/^[-\w가-힣.]{1,80}$/.test(op.name)||typeof (op.guide??'')!=='string')throw Error('Invalid field name');
  return checked(cell?doc.insertClickHereFieldInCell(...a,start,false,op.guide??'', '',op.name,true):doc.insertClickHereField(...a,start,op.guide??'','',op.name,true));
 }else if(op.type==='create_table'){
  if(t.listId!==0||!integer(op.rows)||!integer(op.columns)||op.rows<1||op.columns<1||op.rows*op.columns>100)throw Error('Invalid table dimensions');
  return checked(doc.createTable(0,t.paragraph,start,op.rows,op.columns));
 }else if(op.type==='paragraph_break')checked(cell?doc.splitParagraphInCell(...a,start):doc.splitParagraph(...a,start));
 else throw Error('Unsupported operation');
 return {ok:true,type:op.type,target:op.target};
}
export function fillOperations(doc,fields){
 if(!fields||Array.isArray(fields)||typeof fields!=='object')throw Error('fields must be an object');
 const operations=[],native=[],counts={};
 for(const [key,value]of Object.entries(fields)){
  if(!/^[\w가-힣.-]{1,80}$/.test(key)||typeof value!=='string')throw Error('Invalid placeholder field');
  const needle=`{{${key}}}`;counts[key]=0;
  for(const p of structure(doc).paragraphs){const matches=[];let from=0,index;while((index=p.text.indexOf(needle,from))!==-1){matches.push({type:'replace',target:p.target,start:[...p.text.slice(0,index)].length,end:[...p.text.slice(0,index+needle.length)].length,text:value});from=index+needle.length;counts[key]++}operations.push(...matches.reverse())}
  for(const f of JSON.parse(doc.getFieldList()).filter(f=>f.name===key&&f.fieldType==='clickhere'&&f.location.sectionIndex===0)){native.push({type:'fill_field',fieldId:f.fieldId,text:value});counts[key]++}
  if(!counts[key])throw Error(`Missing placeholder or supported named field: ${key}`);
 }
 operations.sort((a,b)=>a.target.localeCompare(b.target)||b.start-a.start);
 return {operations:[...operations,...native],counts};
}

// Mutates only a disposable staged document. Keep fillOperations' public ordering.
export function fillTemplateSafely(doc,fields){
 const unsafe=reason=>{throw Error(`Unsafe template fill: ${reason}`)};
 if(!fields||Array.isArray(fields)||typeof fields!=='object')throw Error('fields must be an object');
 const entries=Object.entries(fields),requests=new Map(entries);
 for(const [key,value]of entries){
  if(!/^[\w가-힣.-]{1,80}$/.test(key)||typeof value!=='string')throw Error('Invalid placeholder field');
  if(value.length>100000||/[\r\n]/.test(value))throw Error('Text must be a single paragraph, at most 100000 UTF-16 units');
 }
 const before=structure(doc),counts=Object.fromEntries(entries.map(([key])=>[key,0]));
 const scalarLength=text=>[...text].length;
 const positionKey=op=>JSON.stringify([op.target,op.key,op.start]);
 function literals(state,accept=()=>true){
  const found=[];
  for(const [key,text]of entries){
   const needle=`{{${key}}}`;
   for(const p of state.paragraphs){
    let from=0,index;
    while((index=p.text.indexOf(needle,from))!==-1){
     const start=scalarLength(p.text.slice(0,index));
     const op={type:'replace',target:p.target,start,end:start+scalarLength(needle),text,key};
     if(accept(op)){
      found.push(op);
      if(found.length>100)throw Error('Batch requires 1..100 operations');
     }
     from=index+needle.length;
    }
   }
  }
  return found;
 }
 const original=literals(before);
 const native=before.fields.filter(f=>f.fieldType==='clickhere'&&f.location.sectionIndex===0&&requests.has(f.name));
 if(original.length+native.length<1||original.length+native.length>100)throw Error('Batch requires 1..100 operations');
 for(const op of original)counts[op.key]++;
 for(const f of native)counts[f.name]++;
 for(const [key]of entries)if(!counts[key])throw Error(`Missing placeholder or supported named field: ${key}`);

 // These are visible scalar coordinates, not startPos/endPos control offsets.
 // Require the current engine to prove that its coordinates address its value.
 function span(field){
  const p=before.paragraphs.find(p=>p.listId===field.listId&&p.paragraph===field.paraInList);
  const start=field.startCharIdx,end=field.endCharIdx;
  if(!p||!integer(start)||!integer(end)||start>end||end>scalarLength(p.text)||typeof field.value!=='string'||[...p.text].slice(start,end).join('')!==field.value){
   unsafe(`native field coordinates are unavailable or do not match visible text (${field.name}); safe boundary editing unsupported`);
  }
  return {target:p.target,start,end,text:requests.get(field.name),fieldId:field.fieldId};
 }
 const spans=native.map(span);
 for(let i=0;i<spans.length;i++)for(let j=i+1;j<spans.length;j++){
  const a=spans[i],b=spans[j];
  if(a.target===b.target&&(a.start===b.start||(a.start<b.end&&b.start<a.end)))unsafe('requested native fields overlap at a boundary');
 }
 for(const op of original)for(const s of spans){
  if(op.target===s.target&&op.start<s.end&&s.start<op.end)unsafe(`requested native field and original placeholder overlap (${op.key})`);
 }

 const expected=new Map(before.paragraphs.map(p=>[p.target,p.text]));
 const descending=(a,b)=>a.target.localeCompare(b.target)||b.start-a.start;
 function editExpected(edits){
  for(const op of [...edits].sort(descending)){
   const chars=[...expected.get(op.target)];
   expected.set(op.target,chars.slice(0,op.start).concat([...op.text],chars.slice(op.end)).join(''));
  }
 }
 const expectedFields=before.fields.filter(f=>f.fieldType==='clickhere').map(f=>{
  const requested=f.location.sectionIndex===0&&requests.has(f.name);
  return {...f,value:requested?requests.get(f.name):f.value};
 });
 const signature=(f,stableIds)=>JSON.stringify([
  ...(stableIds?[f.fieldId]:[]),f.fieldType,f.cellField,f.name,f.guide,f.editableInForm,f.value
 ]);
 function verify(state,stableIds=true){
  if(state.paragraphs.length!==expected.size||state.paragraphs.some(p=>!expected.has(p.target)||p.text!==expected.get(p.target))){
   unsafe('paragraph text differs from the tracked original replacements; unsafe native field boundary or unsupported coordinates');
  }
  const actual=state.fields.filter(f=>f.fieldType==='clickhere').map(f=>signature(f,stableIds)).sort();
  const wanted=expectedFields.map(f=>signature(f,stableIds)).sort();
  if(JSON.stringify(actual)!==JSON.stringify(wanted)){
   unsafe('native field value or identity changed at a literal boundary; this engine cannot safely represent the requested fill');
  }
 }

 const results=[];
 for(const s of [...spans].sort(descending))results.push(applyOperation(doc,{type:'fill_field',fieldId:s.fieldId,text:s.text}));
 editExpected(spans);
 const afterNative=structure(doc);
 verify(afterNative);

 // Track original occurrences across native edits, then scan the CURRENT text.
 // Tokens introduced by native values are data and are deliberately excluded.
 const wanted=new Set();
 for(const op of original){
  let start=op.start;
  for(const s of spans)if(s.target===op.target&&s.end<=op.start)start+=scalarLength(s.text)-(s.end-s.start);
  wanted.add(positionKey({...op,start}));
 }
 const replacements=literals(afterNative,op=>wanted.has(positionKey(op)));
 if(replacements.length!==original.length||new Set(replacements.map(positionKey)).size!==original.length){
  unsafe('an original placeholder moved across a native field boundary; safe literal edit unsupported');
 }
 for(const op of replacements.sort(descending))results.push(applyOperation(doc,op));
 editExpected(replacements);
 verify(structure(doc));
 return {counts,results,verify};
}

