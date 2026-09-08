import {referenced,validate} from './model.mjs';
const magic=new TextEncoder().encode('SCRFIB01');
export async function createBackup(project,assets,templates=[]){
  const snapshot=structuredClone(validate(project)),entries=[],parts=[];
  let offset=0;
  for(const id of referenced(snapshot)){
    const blob=assets.get(id);if(!(blob instanceof Blob))throw Error('ไฟล์ประกอบไม่ครบ: '+id);
    const bytes=await blob.arrayBuffer();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
    entries.push({id,type:blob.type,size:blob.size,offset,sha256:hash});parts.push(blob);offset+=blob.size;
  }
  const manifest=new TextEncoder().encode(JSON.stringify({format:'smart-combine-project-backup',version:1,createdAt:new Date().toISOString(),project:snapshot,ocrTemplates:templates,assets:entries}));
  const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,manifest.length,true);
  return new Blob([magic,length,manifest,...parts],{type:'application/octet-stream'});
}
// Used to verify archive integrity independently of the live workspace.
export async function readBackup(blob){
  const header=new Uint8Array(await blob.slice(0,12).arrayBuffer());
  if(header.length!==12||!magic.every((v,i)=>header[i]===v))throw Error('ไฟล์สำรองไม่ถูกต้อง');
  const size=new DataView(header.buffer).getUint32(8,true),start=12+size;
  if(start>blob.size)throw Error('ไฟล์สำรองไม่ครบ');
  const data=JSON.parse(await blob.slice(12,start).text());
  if(data.version!==1||data.format!=='smart-combine-project-backup')throw Error('รุ่นไฟล์สำรองไม่รองรับ');
  validate(data.project);const assets=new Map();let offset=0;
  for(const entry of data.assets){
    if(entry.offset!==offset||!Number.isSafeInteger(entry.size)||entry.size<0||start+offset+entry.size>blob.size||assets.has(entry.id))throw Error('ข้อมูลไฟล์ประกอบไม่ถูกต้อง');
    const asset=blob.slice(start+offset,start+offset+entry.size,entry.type);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==entry.sha256)throw Error('ไฟล์ประกอบเสียหาย');
    assets.set(entry.id,asset);offset+=entry.size;
  }
  if(start+offset!==blob.size||[...referenced(data.project)].some(id=>!assets.has(id)))throw Error('ไฟล์สำรองไม่ครบ');
  return {...data,assets};
}
// Isolate restored assets from existing projects, including Undo/Redo references.
export function prepareRestore(data){
 const p=structuredClone(data.project),assets=new Map(),ids=new Map();
 for(const [id,blob] of data.assets){const next=crypto.randomUUID();ids.set(id,next);assets.set(next,blob);}
 for(const state of [p,...p.history,...p.future]){
  validate({...p,...state,history:[],future:[]});
  for(const l of state.layers){l.assetId=ids.get(l.assetId);if(l.sourceId)l.sourceId=ids.get(l.sourceId);}
 }
 p.id=crypto.randomUUID();p.name=(p.name||'โครงการ')+' (กู้คืน)';p.revision=0;p.savedAt=0;
 return {project:p,assets};
}
