// Compatibility changes are made only on an independently exported document.
import {styleFingerprint,fieldFingerprint} from './invariants.mjs';
import {archiveEntries as readArchiveEntries} from './archive-proof.mjs';
export const archiveEntries = bytes => readArchiveEntries(bytes, {profile:'engine'});
export function compatibilityMode(format,mode='preserve'){
 if(!['preserve','hancom-web'].includes(mode))throw Error('Unknown compatibility mode');
 if(mode==='hancom-web'&&format!=='hwpx')throw Error('한컴 Web 호환 사본은 HWPX 형식만 지원합니다.');
 return mode;
}
const json=s=>JSON.parse(s),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const decodeXml=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
function sameProperties(a,b){
 if(Object.is(a,b))return true;
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return equal(ak,bk)&&ak.every(k=>sameProperties(a[k],b[k]));
}
const sameBytes=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const key=c=>`${c.secIdx}:${c.paraIdx}:${c.controlIdx}`;
const rect=c=>({x:c.x,y:c.y,w:c.w??c.width,h:c.h??c.height});
const valid=r=>[r.x,r.y,r.w,r.h].every(Number.isFinite)&&r.w>0&&r.h>0;
const intersects=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
const spanningWarning='쪽 나눔 금지 표가 한 쪽을 넘습니다. 다른 편집기에서 내용이 가려질 수 있습니다. 작업실에서는 내용을 이어 표시합니다.';
export function layoutSnapshot(doc){return Array.from({length:doc.pageCount()},(_,i)=>({info:json(doc.getPageInfo(i)),text:json(doc.getPageTextLayout(i)),controls:json(doc.getPageControlLayout(i))}))}
function spanningTables(layout){
 const seen=new Map();layout.forEach((p,page)=>{for(const c of p.controls.controls??[])if(c.type==='table'){const k=key(c),item=seen.get(k)??{c,pages:new Set()};item.pages.add(page);seen.set(k,item)}});
 return [...seen.values()].filter(item=>item.pages.size>1);
}
export function spanningTableWarnings(layout,doc){return spanningTables(layout).some(({c})=>json(doc.getTableProperties(c.secIdx,c.paraIdx,c.controlIdx)).pageBreak===0)?[spanningWarning]:[]}
export function exportDocument(doc,format){const r=format==='hwp'?doc.exportHwpWithReport():doc.exportHwpxWithReport();try{return {bytes:r.takeBytes(),report:json(r.contentLoss())}}finally{r.free()}}
export async function portabilityWarnings(doc){try{return spanningTableWarnings(layoutSnapshot(doc),doc)}catch{return []}}
function xmlValue(value){
 const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
 return value.replace(/&([^;]*);|&/g,(token,entity)=>{if(Object.hasOwn(named,entity))return named[entity];let n;if(/^#\d+$/.test(entity??''))n=Number(entity.slice(1));else if(/^#x[\da-f]+$/i.test(entity??''))n=parseInt(entity.slice(2),16);if(!Number.isInteger(n)||!([9,10,13].includes(n)||(n>=32&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||(n>=0x10000&&n<=0x10ffff)))throw Error('Unsupported XML entity in table proof');return String.fromCodePoint(n)});
}
// Structural XML reader for proof only. It never serializes or rewrites XML.
// Attribute value offsets identify the exact permitted archival differences.
function xmlTree(xml){
 let at=0,root=null,nodes=0,declared=false;const stack=[];
 const text=end=>{const value=xmlValue(xml.slice(at,end));if(value.trim()){if(!stack.length)throw Error('Unexpected XML text outside section');stack[stack.length-1].hasText=true}};
 while(at<xml.length){
  const lt=xml.indexOf('<',at);if(lt<0){text(xml.length);at=xml.length;break}text(lt);at=lt;
  if(xml.startsWith('<!--',at)){const end=xml.indexOf('-->',at+4);if(end<0||xml.slice(at+4,end).includes('--'))throw Error('Invalid XML comment');at=end+3;continue}
  if(xml.startsWith('<?',at)){const end=xml.indexOf('?>',at+2);if(end<0||root||declared||!/^<\?xml\s[^?]*\?>$/.test(xml.slice(at,end+2)))throw Error('Unsupported XML processing instruction');declared=true;at=end+2;continue}
  if(xml.startsWith('<!',at))throw Error('XML declarations and CDATA are outside table proof scope');
  let end=at+1,quote=null;for(;end<xml.length;end++){const ch=xml[end];if(quote){if(ch===quote)quote=null}else if(ch==='"'||ch==="'")quote=ch;else if(ch==='>')break}
  if(end===xml.length||quote)throw Error('Unterminated XML tag');const token=xml.slice(at,end+1);
  if(token.startsWith('</')){const m=/^<\/([A-Za-z_][\w.:-]*)\s*>$/.exec(token),node=stack.pop();if(!m||!node||node.name!==m[1])throw Error('Unbalanced XML table structure');node.end=end+1;at=end+1;continue}
  const m=/^<([A-Za-z_][\w.:-]*)/.exec(token);if(!m)throw Error('Invalid XML start tag');const selfClosing=xml[end-1]==='/',stop=end-(selfClosing?1:0),attrs=Object.create(null),spans=Object.create(null);let cursor=at+m[0].length;
  while(cursor<stop){const ws=/^\s+/.exec(xml.slice(cursor,stop));if(!ws)throw Error('Invalid XML attribute separator');cursor+=ws[0].length;if(cursor===stop)break;const a=/^([A-Za-z_][\w.:-]*)\s*=\s*(["'])/.exec(xml.slice(cursor,stop));if(!a||Object.hasOwn(attrs,a[1]))throw Error('Invalid or duplicate XML attribute');const start=cursor+a[0].length,finish=xml.indexOf(a[2],start);if(finish<0||finish>=stop||xml.slice(start,finish).includes('<'))throw Error('Invalid XML attribute value');attrs[a[1]]=xmlValue(xml.slice(start,finish));spans[a[1]]={start,end:finish};cursor=finish+1}
  const parent=stack[stack.length-1]??null,node={name:m[1],attrs,spans,parent,children:[],hasText:false,start:at,openEnd:end+1,end:selfClosing?end+1:null};
  if(++nodes>250000||stack.length>=128)throw Error('XML table proof limit exceeded');if(parent)parent.children.push(node);else{if(root)throw Error('Multiple XML roots');root=node}if(!selfClosing)stack.push(node);at=end+1;
 }
 if(stack.length||!root)throw Error('Incomplete XML section');return root;
}
const tableSchema={
 'hp:tbl':[['id','zOrder','numberingType','textWrap','textFlow','lock','dropcapstyle','pageBreak','repeatHeader','rowCnt','colCnt','cellSpacing','borderFillIDRef','noAdjust'],['hp:sz','hp:pos','hp:outMargin','hp:inMargin','hp:tr','hp:cellzoneList']],
 'hp:sz':[['width','widthRelTo','height','heightRelTo','protect'],[]],
 'hp:pos':[['treatAsChar','affectLSpacing','flowWithText','allowOverlap','holdAnchorAndSO','vertRelTo','horzRelTo','vertAlign','horzAlign','vertOffset','horzOffset'],[]],
 'hp:outMargin':[['left','right','top','bottom'],[]],
 'hp:inMargin':[['left','right','top','bottom'],[]],
 'hp:tr':[[],['hp:tc']],
 'hp:tc':[['name','header','hasMargin','protect','editable','dirty','borderFillIDRef'],['hp:subList','hp:cellAddr','hp:cellSpan','hp:cellSz','hp:cellMargin']],
 'hp:subList':[['id','textDirection','lineWrap','vertAlign','linkListIDRef','linkListNextIDRef','textWidth','textHeight','hasTextRef','hasNumRef'],['hp:p']],
 'hp:p':[['id','paraPrIDRef','styleIDRef','pageBreak','columnBreak','merged'],['hp:run','hp:linesegarray']],
 'hp:run':[['charPrIDRef'],['hp:t','hp:tbl']],
 'hp:t':[['xml:space'],['hp:tab','hp:lineBreak','hp:nbSpace','hp:fwSpace','hp:hyphen']],
 'hp:tab':[['width','leader','type'],[]],
 'hp:lineBreak':[[],[]],
 'hp:nbSpace':[[],[]],
 'hp:fwSpace':[[],[]],
 'hp:hyphen':[[],[]],
 'hp:linesegarray':[[],['hp:lineseg']],
 'hp:lineseg':[['textpos','vertpos','vertsize','textheight','baseline','spacing','horzpos','horzsize','flags'],[]],
 'hp:cellAddr':[['colAddr','rowAddr'],[]],
 'hp:cellSpan':[['colSpan','rowSpan'],[]],
 'hp:cellSz':[['width','height'],[]],
 'hp:cellMargin':[['left','right','top','bottom'],[]],
 'hp:cellzoneList':[['count'],['hp:cellzone']],
 'hp:cellzone':[['startRowAddr','startColAddr','endRowAddr','endColAddr','borderFillIDRef'],[]]
};
const children=(node,name)=>node.children.filter(n=>n.name===name);
function one(node,name){const found=children(node,name);if(found.length!==1)throw Error(`표의 ${name} 구조를 확인할 수 없습니다.`);return found[0]}
function xmlInteger(node,name,min=0,max=1000000){const value=node.attrs[name];if(!/^\d+$/.test(value??''))throw Error(`표의 ${name} 값이 올바르지 않습니다.`);const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(`표의 ${name} 값이 검증 범위를 넘습니다.`);return n}
function tableProof(xml,c,doc,{allowCell=false,width=false,parsedRoot=null}={}){
 if(![c.secIdx,c.paraIdx,c.controlIdx].every(n=>Number.isInteger(n)&&n>=0))throw Error('표의 논리 위치를 확인할 수 없습니다.');
 const root=parsedRoot??xmlTree(xml);if(root.name!=='hs:sec'||root.attrs['xmlns:hp']!=='http://www.hancom.co.kr/hwpml/2011/paragraph'||root.attrs['xmlns:hs']!=='http://www.hancom.co.kr/hwpml/2011/section')throw Error('표 구역의 XML 이름 공간을 확인할 수 없습니다.');
 const visitNamespace=node=>{for(const child of node.children){if(Object.keys(child.attrs).some(n=>n==='xmlns'||n.startsWith('xmlns:')))throw Error('중첩 XML 이름 공간은 표 검증 범위를 벗어납니다.');visitNamespace(child)}};visitNamespace(root);
 if(root.hasText||root.children.some(n=>n.name!=='hp:p')||root.children.length!==doc.getParagraphCount(c.secIdx))throw Error('구역의 최상위 문단과 엔진 문단이 일치하지 않습니다.');
 const host=root.children[c.paraIdx];if(!host)throw Error('표의 최상위 문단이 없습니다.');const tables=host.children.filter(n=>n.name==='hp:run').flatMap(run=>children(run,'hp:tbl'));
 if(c.controlIdx!==0||tables.length!==1)throw Error('문단의 단일 첫 번째 최상위 표만 검증할 수 있습니다.');const table=tables[0];
 const walk=node=>{if(node.name==='hp:tbl'&&node!==table)throw Error('중첩 표는 변경하지 않습니다.');const rule=tableSchema[node.name];if(!rule)throw Error(`표에 지원하지 않는 컨트롤 또는 요소가 있습니다: ${node.name}`);for(const name of Object.keys(node.attrs))if(!rule[0].includes(name))throw Error(`표에 지원하지 않는 속성이 있습니다: ${node.name}/${name}`);if(node.hasText&&node.name!=='hp:t')throw Error('표의 예상하지 못한 XML 텍스트는 검증할 수 없습니다.');for(const child of node.children){if(!rule[1].includes(child.name))throw Error(`표에 지원하지 않는 자식 요소가 있습니다: ${child.name}`);walk(child)}if(node.name==='hp:subList'){if(node.attrs.textDirection!=='HORIZONTAL')throw Error('세로쓰기 셀은 변경하지 않습니다.');for(const name of ['linkListIDRef','linkListNextIDRef','hasTextRef','hasNumRef'])if(node.attrs[name]!==undefined&&node.attrs[name]!=='0')throw Error('연결 또는 참조 셀은 변경하지 않습니다.');if(!children(node,'hp:p').length)throw Error('빈 셀 문단 목록은 검증할 수 없습니다.')}};walk(host);
 if(!(allowCell?['NONE','CELL']:['NONE']).includes(table.attrs.pageBreak)||!table.attrs.id||!table.spans.pageBreak)throw Error('XML 표의 지원하는 쪽 나눔 정책과 식별자를 확인할 수 없습니다.');
 const rowCount=xmlInteger(table,'rowCnt',1),colCount=xmlInteger(table,'colCnt',1),rows=children(table,'hp:tr');if(rowCount*colCount>65536||rows.length!==rowCount)throw Error('표의 행·열 구조가 검증 범위를 벗어납니다.');const size=one(table,'hp:sz');one(table,'hp:pos');for(const name of ['hp:outMargin','hp:inMargin','hp:cellzoneList'])if(children(table,name).length>1)throw Error('표의 중복 속성 요소는 검증할 수 없습니다.');
 const occupied=new Set(),cells=[],rowExtents=Array(rowCount).fill(0);let verticalMerges=0,declaredWidth=null;
 if(width){
  if(size.attrs.widthRelTo!=='ABSOLUTE')throw Error('Width proof requires explicit ABSOLUTE widthRelTo');
  declaredWidth=xmlInteger(size,'width',1,2147483647);
  if(xmlInteger(table,'cellSpacing',0,2147483647)!==0)throw Error('Width proof requires zero cellSpacing');
 }
 rows.forEach((row,rowIndex)=>{let previous=-1;for(const cell of children(row,'hp:tc')){
  const address=one(cell,'hp:cellAddr'),span=one(cell,'hp:cellSpan'),list=one(cell,'hp:subList'),cellSize=one(cell,'hp:cellSz');one(cell,'hp:cellMargin');
  const r=xmlInteger(address,'rowAddr'),col=xmlInteger(address,'colAddr'),rs=xmlInteger(span,'rowSpan',1),cs=xmlInteger(span,'colSpan',1);
  if(r!==rowIndex||col<=previous||r+rs>rowCount||col+cs>colCount)throw Error('표의 셀 읽기 순서 또는 병합 범위가 올바르지 않습니다.');previous=col;if(rs>1)verticalMerges++;
  const dimensions=width?{width:xmlInteger(cellSize,'width',1,2147483647),height:xmlInteger(cellSize,'height',0,2147483647)}:{};
  for(let y=r;y<r+rs;y++){
   if(width){const extent=rowExtents[y]+dimensions.width;if(!Number.isSafeInteger(extent)||extent>4294967295||extent>2147483647)throw Error('Complete cell-row width exceeds u32 or signed layout range');rowExtents[y]=extent}
   for(let x=col;x<col+cs;x++){const slot=y*colCount+x;if(occupied.has(slot))throw Error('표의 병합 셀이 겹칩니다.');occupied.add(slot)}
  }
  cells.push({paragraphs:children(list,'hp:p').length,row:r,col,rowSpan:rs,colSpan:cs,...dimensions});
 }});
 if(!cells.length||occupied.size!==rowCount*colCount)throw Error('표의 셀 영역에 누락이 있습니다.');
 const model=json(doc.getCursorModel()),reading=model.lists.filter(l=>l.isCell&&l.sectionIndex===c.secIdx&&l.hostPara===c.paraIdx&&l.controlIndex===c.controlIdx);
 if(reading.length!==cells.length||reading.some((l,i)=>l.hostListId!==0||l.cellIndex!==i||l.paraCount!==cells[i].paragraphs||!equal(cellAddress(l),{row:cells[i].row,col:cells[i].col,rowSpan:cells[i].rowSpan,colSpan:cells[i].colSpan})))throw Error('XML 셀과 커서 모델의 셀 읽기 순서·좌표·병합 범위가 일치하지 않습니다.');
 if(width)for(let i=0;i<cells.length;i++){const native=json(doc.getCellProperties(c.secIdx,c.paraIdx,c.controlIdx,i));if(native.width!==cells[i].width||native.height!==cells[i].height)throw Error('XML and native cell dimensions differ')}
 const maximum=rowExtents.reduce((a,b)=>Math.max(a,b),0);
 return {patch:table.attrs.pageBreak==='NONE'?{...table.spans.pageBreak,before:'NONE',after:'CELL',identity:key(c)}:null,identity:{entry:`Contents/section${c.secIdx}.xml`,paragraph:c.paraIdx,control:c.controlIdx,tableId:table.attrs.id},rowCount,colCount,cellCount:cells.length,verticalMerges,width:width?{before:declaredWidth,after:maximum,rowExtents,cells,patch:{...size.spans.width,before:xml.slice(size.spans.width.start,size.spans.width.end),after:String(maximum),identity:key(c),element:'hp:sz',attribute:'width'}}:null};
}
function supportedTableProofs(entries,doc,layout,live){
 const names=Object.keys(entries).filter(name=>/^Contents\/section\d+\.xml$/.test(name)),visible=new Map(layout.flatMap(p=>p.controls.controls??[]).filter(c=>c.type==='table').map(c=>[key(c),c]));
 const sections=names.map(name=>{const xml=decodeXml(entries[name]),root=xmlTree(xml),tables=[];const visit=node=>{if(node.name==='hp:tbl')tables.push(node);for(const child of node.children)visit(child)};visit(root);return {name,xml,root,tables}});
 if(!sections.some(s=>s.tables.length)){if(visible.size)throw Error('Native tables have no supported structural XML identity');return []}
 if(!equal(names,['Contents/section0.xml']))throw Error('Table width proof supports only a single section 0');
 const {xml,root,tables}=sections[0],ids=new Set(),plans=[];
 for(const table of tables){
  const host=table.parent?.parent,paragraph=root.children.indexOf(host),identity=`0:${paragraph}:0`;
  try{
   if(table.parent?.name!=='hp:run'||host?.name!=='hp:p'||host.parent!==root)throw Error('중첩 표는 변경하지 않습니다.');
   const c=visible.get(identity);if(!c)throw Error('XML table has no verified native layout identity');
   const proof=tableProof(xml,c,doc,{allowCell:true,width:true,parsedRoot:root});
   if(ids.has(proof.identity.tableId))throw Error('Duplicate XML table ID');ids.add(proof.identity.tableId);
   const properties=json(doc.getTableProperties(c.secIdx,c.paraIdx,c.controlIdx)),sourceProperties=json(live.getTableProperties(c.secIdx,c.paraIdx,c.controlIdx));
   if(!sameProperties(properties,sourceProperties))throw Error('Normal-save table properties differ from the live baseline');
   if(properties.tableWidth!==proof.width.before||properties.pageBreak!==(table.attrs.pageBreak==='NONE'?0:2))throw Error('XML table width or policy differs from native tableWidth/pageBreak');
   plans.push({c,properties,proof});
  }catch(error){error.tableIdentity=identity;throw error}
 }
 if(plans.length!==visible.size)throw Error('Native and XML table identities are not one-to-one');
 return plans;
}
function pictureProof(xml,c,p){
 if(/<hp:(header|footer|container|ole|textart|footNote|endNote)\b/.test(xml))throw Error('머리말·꼬리말 또는 복합 개체의 안전성을 확인할 수 없습니다.');
 const pics=[...xml.matchAll(/<hp:pic\b[\s\S]*?<\/hp:pic>/g)];if(pics.length!==1)throw Error('단일 최상위 그림만 검증할 수 있습니다.');const pic=pics[0][0],prefix=xml.slice(0,pics[0].index);
 const tokens=prefix.match(/<\/?hp:(?:p|tbl|tc)\b[^>]*>/g)??[];const stack=[];let para=-1;for(const t of tokens){if(t.startsWith('</'))stack.pop();else if(!t.endsWith('/>')){if(/^<hp:p\b/.test(t)&&stack.length===0)para++;stack.push(t.match(/^<hp:(\w+)/)[1])}}
 if(!equal(stack,['p'])||para!==c.paraIdx||!/groupLevel="0"/.test(pic)||/<hp:caption\b/.test(pic))throw Error('중첩 또는 캡션 그림은 변경하지 않습니다.');
 for(const tag of ['transMatrix','scaMatrix','rotMatrix']){const m=pic.match(new RegExp(`<hc:${tag} ([^>]+)/>`));if(!m)throw Error('그림 변환 정보가 없습니다.');const attrs=Object.fromEntries([...m[1].matchAll(/(e[1-6])="([^"]+)"/g)].map(m=>[m[1],Number(m[2])]));if(!equal(attrs,{e1:1,e2:0,e3:0,e4:0,e5:1,e6:0}))throw Error('변환된 그림은 변경하지 않습니다.')}
 if(!/<hp:effects>\s*<\/hp:effects>/.test(pic)||p.borderWidth!==0)throw Error('그림 효과 또는 테두리는 검증할 수 없습니다.');
 if(p.treatAsChar!==false||p.vertRelTo!=='Paper'||p.horzRelTo!=='Paper'||p.vertAlign!=='Top'||p.horzAlign!=='Left'||p.textWrap!=='Square'||p.rotationAngle!==0||p.hasCaption!==false||p.horzFlip!==false||p.vertFlip!==false)throw Error('단순 PAPER/TOP/LEFT/SQUARE 그림이 아닙니다.');
 for(const n of ['outerMarginLeft','outerMarginRight','outerMarginTop','outerMarginBottom','paddingLeft','paddingRight','paddingTop','paddingBottom'])if(p[n]!==0)throw Error('그림 외부 여백을 검증할 수 없습니다.');
 const opening=pic.slice(0,pic.indexOf('>')+1),wraps=[...opening.matchAll(/\btextWrap="SQUARE"/g)];if(wraps.length!==1)throw Error('그림 XML의 감싸기 정책을 확인할 수 없습니다.');const start=pics[0].index+wraps[0].index+'textWrap="'.length;
 return {start,end:start+'SQUARE'.length,before:'SQUARE',after:'BEHIND_TEXT',identity:key(c)};
}
function expectedXml(xml,patches){
 let previous=xml.length;for(const patch of [...patches].sort((a,b)=>b.start-a.start)){if(!Number.isInteger(patch.start)||!Number.isInteger(patch.end)||patch.start<0||patch.end>previous||patch.start>=patch.end||xml.slice(patch.start,patch.end)!==patch.before)throw Error('Approved XML identity or attribute span changed');xml=xml.slice(0,patch.start)+patch.after+xml.slice(patch.end);previous=patch.start}return xml;
}
function geometry(layout,approved){return layout.map(p=>({...p,controls:{...p.controls,controls:(p.controls.controls??[]).map(c=>{if(!approved.has(key(c)))return c;const {wrap,plane,...rest}=c;return rest})}}))}
function contentSnapshot(doc){return {text:doc.getTextFileUnicode(),cursor:json(doc.getCursorModel()),styles:styleFingerprint(doc),fields:fieldFingerprint(doc)}}
function proofInteger(object,names,min=0){
 const values=names.filter(name=>Object.hasOwn(object,name)).map(name=>object[name]);if(!values.length||values.some(value=>!Number.isSafeInteger(value)||value<min||value!==values[0]))throw Error('Unsupported or ambiguous proof identity: '+names.join('/'));return values[0];
}
function cellAddress(cell){return {row:proofInteger(cell,['row','rowIdx','rowIndex']),col:proofInteger(cell,['col','colIdx','colIndex']),rowSpan:proofInteger(cell,['rowSpan'],1),colSpan:proofInteger(cell,['colSpan'],1)}}
function inside(inner,outer){const tolerance=0.2;return valid(inner)&&valid(outer)&&inner.x>=outer.x-tolerance&&inner.y>=outer.y-tolerance&&inner.x+inner.w<=outer.x+outer.w+tolerance&&inner.y+inner.h<=outer.y+outer.h+tolerance}
// Logical Unicode scalar offsets, independently checked against every rendered
// paragraph. Empty layout runs contribute neither coverage nor glyph bounds.
function visibleCoverage(doc,layout){
 const model=json(doc.getCursorModel());if(!Array.isArray(model.lists))throw Error('Unsupported cursor lists for table reflow');
 const paragraphs=new Map(),cells=new Map(),seenFragments=new Set();
 const add=(identity,text,cell=null)=>{if(typeof text!=='string'||/[\t\uD800-\uDFFF]/u.test(text))throw Error('Tabs or unsupported Unicode in table reflow proof');if(paragraphs.has(identity))throw Error('Duplicate logical paragraph identity');paragraphs.set(identity,{identity,characters:Array.from(text),covered:0,cell})};
 const bodyCount=doc.getParagraphCount(0);if(!Number.isSafeInteger(bodyCount)||bodyCount<0)throw Error('Unsupported body paragraph count');
 for(let p=0;p<bodyCount;p++){const length=doc.getParagraphLength(0,p);if(!Number.isSafeInteger(length)||length<0)throw Error('Unsupported body paragraph length');add(`body:0:${p}`,doc.getTextRange(0,p,0,length))}
 for(const list of model.lists){
  if(list.sectionIndex!==0||typeof list.isCell!=='boolean'||(list.isCell?list.hostListId!==0:list.hostListId!==undefined&&list.hostListId!==null&&list.hostListId!==0))throw Error('Nested or multisection lists are outside the table reflow proof');
  if(!list.isCell)continue;
  const host=proofInteger(list,['hostPara']),control=proofInteger(list,['controlIndex']),index=proofInteger(list,['cellIndex']),count=proofInteger(list,['paraCount'],1),address=cellAddress(list),identity=`0:${host}:${control}:${index}`;
  if(host>=bodyCount||cells.has(identity))throw Error('Unsupported or duplicate model cell');
  const cell={identity,host,control,index,...address};cells.set(identity,cell);
  for(let cp=0;cp<count;cp++){const length=doc.getCellParagraphLength(0,host,control,index,cp);if(!Number.isSafeInteger(length)||length<0)throw Error('Unsupported cell paragraph length');add(`cell:${identity}:${cp}`,doc.getTextInCell(0,host,control,index,cp,0,length),cell)}
 }
 for(const page of layout){
  if(proofInteger(page.info,['sectionIndex','sectionIdx','secIdx','section'])!==0)throw Error('Only section 0 physical pages support table reflow');
  const paper={x:0,y:0,w:page.info.width,h:page.info.height};if(!valid(paper)||!Array.isArray(page.text.runs)||!Array.isArray(page.controls.controls))throw Error('Unsupported physical page layout');
  const fragments=new Map();
  for(const table of page.controls.controls.filter(c=>c.type==='table')){
   if(table.secIdx!==0||!Number.isSafeInteger(table.paraIdx)||!Number.isSafeInteger(table.controlIdx)||!Array.isArray(table.cells)||!table.cells.length)throw Error('Unsupported visible table fragments');
   const canonical=[...cells.values()].filter(cell=>cell.host===table.paraIdx&&cell.control===table.controlIdx);if(!canonical.length)throw Error('Table fragment has no direct model cells');
   for(const fragment of table.cells){
    const address=cellAddress(fragment),box=rect(fragment);if(!valid(box))throw Error('Unsupported visible cell fragment bounds');
    // Fragment-local cellIdx is deliberately ignored. A continuation of a
    // vertical merge must intersect exactly one canonical row span.
    const matches=canonical.filter(cell=>cell.col===address.col&&cell.colSpan===address.colSpan&&cell.row<address.row+address.rowSpan&&address.row<cell.row+cell.rowSpan);
    if(matches.length!==1)throw Error('Ambiguous or wrong canonical cell fragment');
    const cell=matches[0],boxes=fragments.get(cell.identity)??[];boxes.push(box);fragments.set(cell.identity,boxes);seenFragments.add(cell.identity);
   }
  }
  for(const run of page.text.runs){
   if(typeof run.text!=='string')throw Error('Unsupported rendered text run');if(run.text==='')continue;
   if(proofInteger(run,['secIdx','sectionIndex','sectionIdx'])!==0)throw Error('Unsupported rendered section identity');
   let identity;
   if(run.cellIdx===undefined||run.cellIdx===null||run.cellIdx===-1){
    if(run.isCell===true)throw Error('Unsupported rendered cell identity');identity=`body:0:${proofInteger(run,['paraIdx'])}`;
   }else{
    const cell=proofInteger(run,['cellIdx']),host=proofInteger(run,['parentParaIdx']),control=proofInteger(run,['controlIdx']),cp=proofInteger(run,[run.cellParaIdx===undefined?'paraIdx':'cellParaIdx']);identity=`cell:0:${host}:${control}:${cell}:${cp}`;
   }
   const paragraph=paragraphs.get(identity);if(!paragraph)throw Error('Unsupported rendered paragraph identity');
   const start=proofInteger(run,['charStart']),characters=Array.from(run.text);
   if(start!==paragraph.covered||paragraph.characters.slice(start,start+characters.length).join('')!==run.text)throw Error('Missing, duplicate or out-of-order paragraph glyphs');
   const box=rect(run);if(!inside(box,paper))throw Error('Rendered glyph outside physical paper');
   if(paragraph.cell&&(fragments.get(paragraph.cell.identity)??[]).filter(fragment=>inside(box,fragment)).length!==1)throw Error('Rendered glyph outside its canonical cell fragment');
   paragraph.covered+=characters.length;
  }
 }
 for(const cell of cells.values())if(!seenFragments.has(cell.identity))throw Error('Missing visible canonical cell fragment');
 const coverage=[...paragraphs.values()].map(paragraph=>{if(paragraph.covered!==paragraph.characters.length)throw Error('Missing paragraph glyphs');return {identity:paragraph.identity,glyphs:paragraph.characters.length,covered:paragraph.covered}});
 return {glyphs:coverage.reduce((sum,p)=>sum+p.glyphs,0),paragraphs:coverage,physicalBoundsAndCellBounds:true};
}
async function approvedArchive(entries,bytes,patches){
 const output=await archiveEntries(bytes);if(!equal(Object.keys(entries),Object.keys(output)))throw Error('Archive membership changed');
 for(const name of Object.keys(entries)){if(patches.has(name)){const expected=new TextEncoder().encode(expectedXml(decodeXml(entries[name]),patches.get(name)));if(!sameBytes(expected,output[name]))throw Error('Unexpected serialized table, picture or document change: '+name)}else if(!sameBytes(entries[name],output[name]))throw Error('Archive content changed: '+name)}
}
export async function preparePortable(doc,format,mode='preserve',{HwpDocument,pixels,pixelDelta}={}){
 mode=compatibilityMode(format,mode);if(mode==='hancom-web'&&doc.pageCount()>50)throw Error('호환 검증은 50쪽 이하 문서만 지원합니다. 기본 저장을 사용해 주세요.');const before=layoutSnapshot(doc),ledger={mode,changedObjects:[],changedTables:[],changedWidths:[],beforePages:before.length,afterPages:before.length,checks:[],warnings:[],refusals:[]};
 if(mode==='preserve'){ledger.warnings=await portabilityWarnings(doc);return {...exportDocument(doc,format),compatibility:ledger}}
 if(!HwpDocument||typeof pixels!=='function')throw Error('Compatibility proof requires a clone and actual canvas pixels');
 const source=exportDocument(doc,'hwpx');if(source.report.count!==0)throw Error('Clone export reports content loss');const entries=await archiveEntries(source.bytes),liveContent=contentSnapshot(doc);ledger.warnings=spanningTableWarnings(before,doc);
 const section=sec=>{const name=`Contents/section${sec}.xml`;if(!Object.hasOwn(entries,name))throw Error('Table or picture section is unavailable');return decodeXml(entries[name])};
 const copyDisplay=target=>{target.setFallbackFont(doc.getFallbackFont());for(const name of ['ShowControlCodes','ShowParagraphMarks','ShowTransparentBorders'])target['set'+name](doc['get'+name]())};const clone=new HwpDocument(source.bytes);
 try{
  copyDisplay(clone);if(!equal(layoutSnapshot(clone),before))throw Error('Clone geometry differs from live document');const originalPixels=await pixels(doc),clonePixels=await pixels(clone);ledger.baseline={kind:'normal-save',livePixelsEqual:equal(originalPixels,clonePixels),live:originalPixels,normalSave:clonePixels};if(!ledger.baseline.livePixelsEqual){if(!pixelDelta)throw Error('Normal-save pixel delta measurement unavailable');ledger.baseline.liveVsNormalSaveDelta=await pixelDelta(doc,clone);ledger.warnings.push('기본 저장 사본과 현재 화면의 미세한 픽셀 차이가 있습니다. 호환 사본은 기본 저장 사본을 기준으로 검증했습니다.');}
  const normalContent=contentSnapshot(clone),baselineExport=exportDocument(clone,'hwpx');if(baselineExport.report.count!==0||!sameBytes(source.bytes,baselineExport.bytes))throw Error('Normal-save serialization is not stable');if(!equal(normalContent,liveContent))throw Error('Normal-save baseline changed document content or style');
  const baseline2=new HwpDocument(baselineExport.bytes);try{copyDisplay(baseline2);if(!equal(layoutSnapshot(baseline2),before)||!equal(await pixels(baseline2),clonePixels)||!equal(contentSnapshot(baseline2),normalContent))throw Error('Normal-save baseline is not stable');const again=exportDocument(baseline2,'hwpx');if(again.report.count!==0||!sameBytes(again.bytes,baselineExport.bytes))throw Error('Fresh normal-save serialization is not stable')}finally{baseline2.free()}
  const approvedPictures=new Set(),picturePlans=[],tablePlans=[],widthPlans=[],patches=new Map();
  const addPatch=(name,patch)=>{const list=patches.get(name)??[];list.push(patch);patches.set(name,list)};
  let structuralPlans;
  try{structuralPlans=supportedTableProofs(entries,clone,before,doc)}catch(error){ledger.refusals.push({table:error.tableIdentity??'structural',reason:error.message});throw error}
  const byIdentity=new Map(structuralPlans.map(plan=>[key(plan.c),plan]));
  for(const {c,pages} of spanningTables(before)){
   const plan=byIdentity.get(key(c));if(!plan)throw Error('Spanning table has no shared structural proof');
   if(plan.properties.pageBreak===0){if(!plan.proof.patch)throw Error('Spanning NONE table has no exact policy attribute proof');tablePlans.push({...plan,pages})}
  }
  widthPlans.push(...structuralPlans.filter(plan=>plan.proof.width.after>plan.proof.width.before));
  const hasTableReflow=tablePlans.length>0||widthPlans.length>0,tableExpectations=new Map();
  for(const plan of [...tablePlans,...widthPlans])if(!tableExpectations.has(key(plan.c)))tableExpectations.set(key(plan.c),{c:plan.c,expected:plan.properties});
  const checkTableProperties=(target,label)=>{for(const {c,expected} of tableExpectations.values())if(!sameProperties(json(target.getTableProperties(c.secIdx,c.paraIdx,c.controlIdx)),expected))throw Error(label+': '+key(c))};
  let sourceCoverage=null,tableCoverage=null;
  if(hasTableReflow){
   if(!equal(Object.keys(entries).filter(name=>/^Contents\/section\d+\.xml$/.test(name)),['Contents/section0.xml']))throw Error('Table reflow supports only a single section 0');
   sourceCoverage=visibleCoverage(clone,before);
   const freshNormal=new HwpDocument(baselineExport.bytes);try{copyDisplay(freshNormal);if(!equal(visibleCoverage(freshNormal,layoutSnapshot(freshNormal)),sourceCoverage))throw Error('Fresh normal-save glyph coverage differs');checkTableProperties(freshNormal,'Fresh normal-save table properties differ')}finally{freshNormal.free()}
  }
  for(const {c,proof} of tablePlans){
   checkTableProperties(clone,'Table properties changed before policy setter');
   const item=tableExpectations.get(key(c)),result=json(clone.setTableProperties(c.secIdx,c.paraIdx,c.controlIdx,JSON.stringify({pageBreak:2})));
   if(!result.ok)throw Error(`표 ${key(c)}의 쪽 나눔 변경에 실패했습니다.`);
   item.expected={...item.expected,pageBreak:2};checkTableProperties(clone,'Table policy setter changed unrelated properties');addPatch(proof.identity.entry,proof.patch);
  }
  for(const {c,proof} of widthPlans){
   checkTableProperties(clone,'Table properties changed before width setter');
   const item=tableExpectations.get(key(c));let result;
   try{result=json(clone.setTableProperties(c.secIdx,c.paraIdx,c.controlIdx,JSON.stringify({normalizeWidthToCellRows:true})))}catch(error){throw Error(`Width normalization API unavailable for ${key(c)}; use preserve export. ${error.message??String(error)}`)}
   if(!result||!sameProperties(result,{ok:true,changed:true,tableWidth:proof.width.after}))throw Error('Unsupported width normalization API or invalid setter result: '+key(c)+'; use preserve export');
   item.expected={...item.expected,tableWidth:proof.width.after};checkTableProperties(clone,'Width setter changed properties other than tableWidth');addPatch(proof.identity.entry,proof.width.patch);
  }
  const tableLayout=layoutSnapshot(clone);
  if(hasTableReflow){
   if(tableLayout.length!==before.length)throw Error('표 쪽 나눔으로 전체 쪽 수가 달라졌습니다. 현재 호환 사본은 같은 쪽 수만 지원합니다.');
   if(!equal(tableLayout.map(p=>p.info),before.map(p=>p.info)))throw Error('Table reflow changed physical page information');
   if(!equal(contentSnapshot(clone),normalContent))throw Error('Table reflow changed document content, cursor, styles or fields');
   tableCoverage=visibleCoverage(clone,tableLayout);if(!equal(tableCoverage,sourceCoverage))throw Error('Table reflow changed logical paragraph coverage');
  }else if(!equal(tableLayout,before))throw Error('Compatibility changed full page geometry');
  const tablePixels=hasTableReflow?await pixels(clone):clonePixels;
  if(hasTableReflow){
   if(!Array.isArray(tablePixels)||!Array.isArray(clonePixels)||tablePixels.length!==tableLayout.length||clonePixels.length!==before.length)throw Error('Table reflow requires a renderer snapshot for every physical page');
   let measuredPixelDelta;
   if(widthPlans.length){
    if(typeof pixelDelta!=='function')throw Error('Table width reflow pixel delta measurement unavailable');
    const normalForDelta=new HwpDocument(baselineExport.bytes);try{
     copyDisplay(normalForDelta);if(!equal(layoutSnapshot(normalForDelta),before)||!equal(await pixels(normalForDelta),clonePixels)||!equal(contentSnapshot(normalForDelta),normalContent))throw Error('Normal-save pixel delta baseline differs');
     measuredPixelDelta=await pixelDelta(normalForDelta,clone);if(!Array.isArray(measuredPixelDelta)||measuredPixelDelta.length!==before.length)throw Error('Table width reflow requires pixel deltas for every physical page');
    }finally{normalForDelta.free()}
   }
   ledger.tableReflow={beforePages:before.length,afterPages:tableLayout.length,changed:!equal(before,tableLayout),sourceAndOutputGlyphs:{source:sourceCoverage.glyphs,output:tableCoverage.glyphs},perParagraphCoverage:sourceCoverage.paragraphs.map((p,i)=>({identity:p.identity,glyphs:p.glyphs,sourceRendered:p.covered,outputRendered:tableCoverage.paragraphs[i].covered})),physicalBoundsAndCellBounds:true,rendererBaseline:widthPlans.length?'after approved table policy and width':'after approved table policy',changedPixelPages:tablePixels.flatMap((value,i)=>equal(value,clonePixels[i])?[]:[i+1]),...(widthPlans.length?{pixelDelta:measuredPixelDelta}:{}),beforeLayout:before,afterLayout:tableLayout,beforePixels:clonePixels,afterPixels:tablePixels};
   const tableExport=exportDocument(clone,'hwpx');if(tableExport.report.count!==0)throw Error('Table-policy export reports content loss');await approvedArchive(entries,tableExport.bytes,patches);
   const freshTable=new HwpDocument(tableExport.bytes);try{
    copyDisplay(freshTable);if(!equal(layoutSnapshot(freshTable),tableLayout)||!equal(await pixels(freshTable),tablePixels))throw Error('Fresh table-policy geometry or pixels differ');
    if(!equal(contentSnapshot(freshTable),normalContent)||!equal(visibleCoverage(freshTable,layoutSnapshot(freshTable)),tableCoverage))throw Error('Fresh table-policy content or glyph coverage differs');
    checkTableProperties(freshTable,'Fresh table-policy properties differ');
    const again=exportDocument(freshTable,'hwpx');if(again.report.count!==0||!sameBytes(again.bytes,tableExport.bytes))throw Error('Fresh table-policy serialization is not stable');
   }finally{freshTable.free()}
  }
  // Picture guards use the approved table-policy geometry and renderer baseline.
  const candidates=tableLayout.flatMap(p=>p.controls.controls??[]).filter(c=>c.type==='image'&&c.wrap==='square');
  if(candidates.length>1)throw Error('Multiple picture safety proof unavailable');
  for(const c of candidates){try{
   const p=json(clone.getPictureProperties(c.secIdx,c.paraIdx,c.controlIdx)),patch=pictureProof(section(c.secIdx),c,p),r=rect(c);if(!valid(r))throw Error('그림의 실제 영역을 확인할 수 없습니다.');
   for(const page of tableLayout){const i=page.info;if(r.x<0||r.y<0||r.x+r.w>i.width||r.y+r.h>i.height)throw Error('그림이 용지 경계를 넘습니다.');if(i.columns?.length!==1)throw Error('다단 영역은 검증할 수 없습니다.');const body={x:i.bodyLeft,y:i.marginTop+i.marginHeader,w:i.bodyRight-i.bodyLeft,h:i.height-i.marginBottom-i.marginFooter-i.marginTop-i.marginHeader};if(!valid(body)||!valid(rect(i.headerArea??{}))||!valid(rect(i.footerArea??{})))throw Error('본문과 머리말·꼬리말 경계를 확인할 수 없습니다.');if(intersects(r,body)||intersects(r,rect(i.headerArea))||intersects(r,rect(i.footerArea)))throw Error('그림이 본문 또는 머리말·꼬리말 영역과 겹칩니다.');for(const other of [...page.text.runs.filter(r=>!(r.text===''&&r.w===0&&[r.x,r.y,r.h].every(Number.isFinite)&&r.h>0)),...page.controls.controls.filter(x=>key(x)!==key(c))]){const box=rect(other);if(!valid(box)||intersects(r,box))throw Error('다른 글자·개체와의 비간섭을 입증할 수 없습니다.')}}
   picturePlans.push({c,patch});
  }catch(e){ledger.refusals.push({object:key(c),reason:e.message})}}
  // A refused picture discards the independently mutated table-policy clone.
  if(ledger.refusals.length)throw Error(ledger.refusals.map(r=>r.reason).join('; '));
  for(const {c,patch} of picturePlans){const result=json(clone.setPictureProperties(c.secIdx,c.paraIdx,c.controlIdx,JSON.stringify({textWrap:'BehindText'})));if(!result.ok)throw Error('그림 속성 변경 실패');approvedPictures.add(key(c));addPatch(`Contents/section${c.secIdx}.xml`,patch)}
  const after=layoutSnapshot(clone);if(!equal(geometry(tableLayout,approvedPictures),geometry(after,approvedPictures)))throw Error('Compatibility changed full page geometry after the table-policy baseline');
  if(!equal(await pixels(clone),tablePixels))throw Error('Compatibility changed rendered pixels after the table-policy baseline');
  if(hasTableReflow&&!equal(visibleCoverage(clone,after),tableCoverage))throw Error('Picture policy changed paragraph glyph coverage');
  if(!equal(contentSnapshot(clone),normalContent)||!equal(contentSnapshot(doc),liveContent))throw Error('Compatibility changed document content or style');
  const result=exportDocument(clone,format);if(result.report.count!==0)throw Error('Compatibility export reports content loss');await approvedArchive(entries,result.bytes,patches);
  const reopened=new HwpDocument(result.bytes);try{copyDisplay(reopened);const reopenedLayout=layoutSnapshot(reopened);if(!equal(reopenedLayout,after)||!equal(geometry(reopenedLayout,approvedPictures),geometry(tableLayout,approvedPictures))||!equal(await pixels(reopened),tablePixels))throw Error('Reopened compatibility copy differs');if(hasTableReflow&&!equal(visibleCoverage(reopened,reopenedLayout),tableCoverage))throw Error('Reopened compatibility glyph coverage differs');if(!equal(contentSnapshot(reopened),normalContent))throw Error('Reopened compatibility content, cursor, cells, styles or fields differ');checkTableProperties(reopened,'Reopened table policy or width differs');const fresh=exportDocument(reopened,format);if(fresh.report.count!==0||!sameBytes(fresh.bytes,result.bytes))throw Error('Fresh compatibility serialization is not stable')}finally{reopened.free()}
  const liveAgain=exportDocument(doc,'hwpx');if(liveAgain.report.count!==0||!sameBytes(liveAgain.bytes,source.bytes)||!equal(layoutSnapshot(doc),before)||!equal(contentSnapshot(doc),liveContent)||!equal(await pixels(doc),originalPixels))throw Error('Live original changed during compatibility proof');
  for(const {c,properties} of structuralPlans)if(!sameProperties(json(doc.getTableProperties(c.secIdx,c.paraIdx,c.controlIdx)),properties))throw Error('Live original table properties changed');
  ledger.afterPages=after.length;
  ledger.changedWidths=widthPlans.map(({c,proof})=>({key:key(c),section:c.secIdx,paragraph:c.paraIdx,control:c.controlIdx,property:'tableWidth',before:proof.width.before,after:proof.width.after,xmlIdentity:{...proof.identity,element:'hp:sz',attribute:'width',valueSpan:{start:proof.width.patch.start,end:proof.width.patch.end}},rowExtents:[...proof.width.rowExtents],basis:'maximum complete rowspan-aware cell-row extent',cellWidthsChanged:false,cells:proof.width.cells.map(cell=>({...cell}))}));
  ledger.changedObjects=picturePlans.map(({c})=>({section:c.secIdx,paragraph:c.paraIdx,control:c.controlIdx,property:'textWrap',before:'Square',after:'BehindText'}));
  const verifiedScope=[...(hasTableReflow?['approved table reflow: unchanged physical page count and page information','every direct body and cell paragraph rendered exactly once in scalar-offset reading order','all nonempty glyph runs within paper and canonical visible cell fragments','recorded normal-save versus approved table geometry and renderer snapshots','picture-only normalized geometry and exact renderer snapshots against the approved table and width baseline']:['exact full-page text/glyph and control geometry','exact normal-save renderer snapshots before/after/fresh']),...(widthPlans.length?['exact standalone width setter response and complete table properties; only tableWidth changed','complete XML/native cell dimensions unchanged; complete rowspan-aware row extents','recorded normal-save versus approved table and width pixel deltas']:[]),'full text and cursor model including cell reading order','selected styles and fields','all archive entries and image bytes; only exact approved pageBreak, table hp:sz width and picture wrap attribute spans differ','fresh reopened complete table properties and byte-stable reexport'];
  ledger.changedTables=tablePlans.map(({c,pages,proof})=>({key:key(c),section:c.secIdx,paragraph:c.paraIdx,control:c.controlIdx,xmlIdentity:proof.identity,property:'pageBreak',before:{engine:0,xml:'NONE'},after:{engine:2,xml:'CELL'},beforePages:before.length,afterPages:after.length,laidOutPages:[...pages].map(p=>p+1),rowCount:proof.rowCount,colCount:proof.colCount,cellCount:proof.cellCount,verticalMerges:proof.verticalMerges,verifiedScope:[...verifiedScope]}));
  // Recompute only the warning this policy can resolve; keep other warnings.
  ledger.warnings=ledger.warnings.filter(w=>w!==spanningWarning);ledger.warnings.push(...spanningTableWarnings(after,clone));ledger.verifiedScope=verifiedScope;
  ledger.checks=['live to normal-save full geometry','normal-save reexport bytes and reopened pixels stable',...(hasTableReflow?['approved table reflow with unchanged physical pages and complete bounded paragraph glyph coverage','fresh approved table geometry, renderer snapshots, content and serialization stable','picture-only normalized full geometry and exact renderer snapshots against approved table and width baseline']:['full text/control geometry','exact normal-save baseline canvas pixels']),...(widthPlans.length?['standalone width API and complete native properties verified','rowspan-aware row extents and unchanged cell dimensions','normal-save to approved table and width pixel deltas recorded']:[]),'text/cells/styles/fields','archive bytes including images; only exact approved table pageBreak, table hp:sz width and picture wrap attribute spans differ','fresh reopened geometry and pixels','fresh reopened complete table properties, text/cursor/styles/fields and byte-stable reexport','live original geometry/content/pixels/export bytes and table properties unchanged'];return {...result,compatibility:ledger};
 }catch(error){if(!ledger.refusals.length)ledger.refusals.push({scope:'compatibility-proof',reason:error.message??String(error)});ledger.changedObjects=[];ledger.changedTables=[];ledger.changedWidths=[];ledger.afterPages=ledger.beforePages;if(ledger.tableReflow)ledger.tableReflow.candidateDiscarded=true;error.compatibility??=ledger;throw error}finally{clone.free()}
}
export async function canvasPixels(doc){
 await document.fonts.ready;const result=[];let totalPixels=0;if(doc.pageCount()>50)throw Error('호환 검증은 50쪽 이하 문서만 지원합니다. 기본 저장을 사용해 주세요.');for(let i=0;i<doc.pageCount();i++){const info=json(doc.getPageInfo(i)),canvas=document.createElement('canvas');canvas.width=Math.ceil(info.width);canvas.height=Math.ceil(info.height);totalPixels+=canvas.width*canvas.height;if(canvas.width*canvas.height>8000000||totalPixels>50000000)throw Error('Canvas proof limit exceeded');doc.renderPageToCanvas(i,canvas,1);const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;result.push({width:canvas.width,height:canvas.height,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(n=>n.toString(16).padStart(2,'0')).join('')})}return result;
}
export async function canvasPixelDelta(a,b){
 const results=[];for(let i=0;i<a.pageCount();i++){const read=doc=>{const c=document.createElement('canvas');doc.renderPageToCanvas(i,c,1);return {width:c.width,height:c.height,data:c.getContext('2d').getImageData(0,0,c.width,c.height).data}};const x=read(a),y=read(b);if(x.width!==y.width||x.height!==y.height)throw Error('Pixel delta dimensions differ');let count=0,left=x.width,top=x.height,right=0,bottom=0;for(let j=0;j<x.data.length;j+=4){if(x.data[j]!==y.data[j]||x.data[j+1]!==y.data[j+1]||x.data[j+2]!==y.data[j+2]||x.data[j+3]!==y.data[j+3]){count++;const col=j/4%x.width,row=Math.floor(j/4/x.width);left=Math.min(left,col);right=Math.max(right,col);top=Math.min(top,row);bottom=Math.max(bottom,row)}}results.push({page:i,changedPixels:count,bounds:count?{left,top,right,bottom}:null})}return results;
}
