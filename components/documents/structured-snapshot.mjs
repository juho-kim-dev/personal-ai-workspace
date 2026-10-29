import {applyOperation,fillTemplateSafely,structure} from './structured.mjs';

function nativeFormat(doc){
 const format=doc.getSourceFormat();
 if(format!=='hwp'&&format!=='hwpx')throw Error('Unsupported structured source format');
 return format;
}

function checkedSnapshot(doc,lossMessage){
 const format=nativeFormat(doc);
 const result=format==='hwp'?doc.exportHwpWithReport():doc.exportHwpxWithReport();
 try{
  const report=JSON.parse(result.contentLoss());
  if(report.count)throw Error(lossMessage);
  return {bytes:result.takeBytes(),structure:structure(doc),report};
 }finally{result.free()}
}

// The live bridge synchronizes fields through onBeforeExport before calling this.
export function structuredSnapshot(doc){
 return checkedSnapshot(doc,'Snapshot would lose content');
}

// Use the constructor imported by the caller's frame; never mutate the live doc.
export function structuredStage(HwpDocument,bytes,operations,fields){
 const doc=new HwpDocument(bytes);
 try{
  nativeFormat(doc);
  let fill=null;
  const results=[];
  if(fields){
   try{fill=fillTemplateSafely(doc,fields);results.push(...fill.results)}
   catch(e){throw Error(`${e.message}; no changes committed`)}
  }else{
   const ops=operations;
   if(!Array.isArray(ops)||ops.length<1||ops.length>100)throw Error('Batch requires 1..100 operations');
   for(let i=0;i<ops.length;i++){
    try{results.push(applyOperation(doc,ops[i]))}
    catch(e){throw Error(`Operation ${i}: ${e.message}; no changes committed`)}
   }
  }
  const snapshot=checkedSnapshot(doc,'Staged export would lose content');
  if(fill){
   try{
    fill.verify(snapshot.structure);
    const reopened=new HwpDocument(snapshot.bytes);
    try{
     if(nativeFormat(reopened)!==nativeFormat(doc))throw Error('Unsafe template fill: source format changed on reopen');
     fill.verify(structure(reopened),false);
    }finally{reopened.free()}
   }catch(e){throw Error(`${e.message}; no changes committed`)}
  }
  return {bytes:snapshot.bytes,results,fill:fill?.counts,structure:snapshot.structure};
 }finally{doc.free()}
}
