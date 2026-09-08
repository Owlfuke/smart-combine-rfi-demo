// Intern large immutable strings so change detection never builds a JSON string
// containing every copy of an RFI image in all Undo/Redo snapshots.
export function createSignature(){
 const strings=new Map();let next=0;
 return value=>JSON.stringify(value,(_key,item)=>{
  if(typeof item==='string'&&item.length>4096){
   if(!strings.has(item))strings.set(item,++next);
   return {largeStringToken:strings.get(item)};
  }
  return item;
 });
}
