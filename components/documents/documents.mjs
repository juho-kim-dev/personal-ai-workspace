import {styleFingerprint,fieldFingerprint} from './invariants.mjs';
import init,{HwpDocument} from './engine/rhwp.js';
let initialized;
export function initCore(input){return initialized??=init(input?{module_or_path:input}:undefined)}
export function checked(result){const r=typeof result==='string'?JSON.parse(result):result;if(r?.ok===false)throw Error(r.error??'문서 명령을 적용하지 못했습니다.');return r}
export function fingerprint(doc){
 const model=JSON.parse(doc.getCursorModel());
 return {styles:styleFingerprint(doc),text:doc.getTextFileUnicode(),cells:model.lists.filter(l=>l.isCell).map(({sectionIndex,hostPara,controlIndex,cellIndex,row,col,rowSpan,colSpan})=>({sectionIndex,hostPara,controlIndex,cellIndex,row,col,rowSpan,colSpan}))};
}
export function makeDocument(sample=false,format='hwp'){
 const doc=HwpDocument.createEmpty();
 try{
  checked(doc.createBlankDocument());
  if(sample){
   const phrase='한글 문서 작업실 — 함께 쓰는 첫 문서';checked(doc.insertText(0,0,0,phrase));
   const table=checked(doc.createTable(0,0,phrase.length,3,2));
   ['항목','내용','인사','안녕하세요, 한글입니다.','확인','표 안에서도 편집할 수 있어요.'].forEach((text,cell)=>checked(doc.insertTextInCell(0,table.paraIdx,table.controlIdx,cell,0,0,text)));
  }
  const result=format==='hwp'?doc.exportHwpWithReport():doc.exportHwpxWithReport();
  try{const report=JSON.parse(result.contentLoss());if(report.count!==0)throw Error('예제 문서 생성 중 보존 문제를 발견했습니다.');return result.takeBytes()}finally{result.free()}
 }finally{doc.free()}
}
export function validateOutput(bytes,expected){
 const doc=new HwpDocument(bytes);
 try{
  const actual=fingerprint(doc);return {...(expected.fields===undefined?{}:{fieldsPreserved:JSON.stringify(fieldFingerprint(doc))===JSON.stringify(expected.fields)}),stylesPreserved:JSON.stringify(actual.styles)===JSON.stringify(expected.styles),reopened:true,pageCount:doc.pageCount(),textPreserved:actual.text===expected.text,tablesPreserved:JSON.stringify(actual.cells)===JSON.stringify(expected.cells),cellCount:actual.cells.length};
 }finally{doc.free()}
}
