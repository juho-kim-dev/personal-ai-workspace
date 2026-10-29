export const attachmentDragType='application/x-my-grove-wiki-attachment';
export function attachmentToken(name:string){return typeof name==='string'&&name.length>0&&name.length<=180&&!/[\[\]\n\r|<>\u0000]/.test(name)?`[[파일:${name}]]`:null;}
