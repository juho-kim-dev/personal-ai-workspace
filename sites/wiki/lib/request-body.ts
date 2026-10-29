import {WikiError} from './wiki';
export async function boundedBody(request:Request,limit:number){
  const declared=Number(request.headers.get('content-length')||0);
  if(Number.isFinite(declared)&&declared>limit)throw new WikiError('요청이 너무 큽니다.',413);
  const reader=request.body?.getReader();
  if(!reader)return new Uint8Array();
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new WikiError('요청이 너무 큽니다.',413)}chunks.push(value)}}finally{reader.releaseLock()}
  const body=new Uint8Array(size);let cursor=0;for(const chunk of chunks){body.set(chunk,cursor);cursor+=chunk.length}return body;
}
export async function boundedJSON(request:Request,limit=1000000){
  try{return JSON.parse(new TextDecoder().decode(await boundedBody(request,limit)))}catch(e){if(e instanceof WikiError)throw e;throw new WikiError('요청 형식을 확인해 주세요.')}
}
