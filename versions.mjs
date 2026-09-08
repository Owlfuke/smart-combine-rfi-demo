export const sheetKey=value=>String(value??'').normalize('NFKC').toUpperCase().replace(/[–—−]/g,'-').replace(/\s+/g,'');
export const revisionKey=value=>{const s=sheetKey(value);return /^\d+$/.test(s)?s.replace(/^0+(?=\d)/,''):s;};
export const sameRevision=(a,b)=>!!sheetKey(a.number)&&sheetKey(a.number)===sheetKey(b.number)&&revisionKey(a.revision)===revisionKey(b.revision);
export function conflicts(item,items,selected,layers){
 const existing=layers.filter(l=>sheetKey(item.meta?.number)&&sheetKey(l.number)===sheetKey(item.meta.number));
 return {existing,duplicates:existing.filter(l=>sameRevision(l,item.meta)),incoming:items.filter(other=>other!==item&&selected.has(other.key)&&other.meta&&sameRevision(other.meta,item.meta||{}))};
}
export function assertNewRevisions(items,layers){
 const seen=[...layers];for(const item of items){if(seen.some(old=>sameRevision(old,item)))throw Error('เลขแบบ '+item.number+' · Revision '+(item.revision||'ไม่ระบุ')+' มีอยู่แล้ว กรุณาแก้ Revision หรือข้ามแผ่นนี้');seen.push(item);}
}
