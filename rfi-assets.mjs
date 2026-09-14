export const attachmentFields=['image','keyPlan','referencePlan'];
const states=p=>[p,...(p.history||[]),...(p.future||[])];
export function attachmentIds(p){return states(p).flatMap(s=>(s.rfis||[]).flatMap(r=>Object.values(r.attachmentIds||{})));}
export function packAttachments(p,assets){
 const seen=new Map();
 for(const state of states(p))for(const item of state.rfis||[])for(const field of attachmentFields){
  const value=item[field];
  if(typeof value==='string'&&value.startsWith('data:image/')){
   let id=seen.get(value);
   if(!id){const match=/^data:(image\/[\w.+-]+);base64,([\s\S]*)$/.exec(value);if(!match)throw Error('รูปแบบภาพแนบไม่รองรับ');const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));id=crypto.randomUUID();assets.set(id,new Blob([bytes],{type:match[1]}));seen.set(value,id);}
   (item.attachmentIds??={})[field]=id;
  }
  if(item.attachmentIds?.[field])delete item[field];
 }
 return p;
}
const urls=new Map();
export function hydrateAttachments(p,assets){
 for(const state of states(p))for(const item of state.rfis||[])for(const [field,id]of Object.entries(item.attachmentIds||{})){
  if(!attachmentFields.includes(field))throw Error('ชนิดภาพแนบไม่ถูกต้อง');const blob=assets.get(id);if(!blob)throw Error('ไม่พบภาพแนบ RFI: '+id);
  if(!urls.has(id))urls.set(id,URL.createObjectURL(blob));item[field]=urls.get(id);
 }
}
export function releaseAttachmentUrls(keep){for(const [id,url]of urls)if(!keep.has(id)){URL.revokeObjectURL(url);urls.delete(id);}}
