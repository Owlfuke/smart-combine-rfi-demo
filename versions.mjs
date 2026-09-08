
export const sheetKey=value=>(value||"").normalize("NFKC").toUpperCase().replace(/[–—−]/g,"-").replace(/\s+/g,"");
export function conflicts(item,items,selected,layers){
 const key=sheetKey(item.meta?.number);if(!key)return {existing:[],incoming:[]};
 return {existing:layers.filter(l=>sheetKey(l.number)===key),incoming:items.filter(other=>other!==item&&selected.has(other.key)&&sheetKey(other.meta?.number)===key)};
}
