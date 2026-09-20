import {referenced,validate} from './model.mjs';

export function formatBytes(value){
 if(!Number.isFinite(value)||value<0)return 'ไม่ทราบ';
 const units=['B','KB','MB','GB'];let size=value,index=0;
 while(size>=1024&&index<units.length-1){size/=1024;index++;}
 return (index?size.toFixed(size>=100?0:size>=10?1:2):String(size))+' '+units[index];
}

export async function inspectProjectHealth({project,store,memoryAssets=new Map(),dirty=false,storage=navigator.storage}){
 const issues=[];let valid=true;
 try{validate(project);}catch(error){valid=false;issues.push('โครงสร้างงานไม่ถูกต้อง: '+error.message);}
 const ids=valid?[...referenced(project)]:[];
 const records=await Promise.all(ids.map(async id=>[id,memoryAssets.get(id)||(await store.get('assets',id))?.blob]));
 const missing=[],invalid=[];let assetBytes=0;
 for(const [id,blob]of records){if(!blob)missing.push(id);else if(!(blob instanceof Blob)||blob.size<=0)invalid.push(id);else assetBytes+=blob.size;}
 if(missing.length)issues.push('ไม่พบไฟล์ประกอบ '+missing.length+' รายการ');
 if(invalid.length)issues.push('ไฟล์ประกอบเสียหายหรือว่าง '+invalid.length+' รายการ');
 if(dirty)issues.push('มีการแก้ไขที่ยังไม่ได้บันทึกลงเครื่อง');
 let usage=null,quota=null,persisted=null;
 try{const estimate=await storage?.estimate?.();usage=estimate?.usage??null;quota=estimate?.quota??null;}catch{}
 try{persisted=await storage?.persisted?.();}catch{}
 const ratio=quota?usage/quota:null;
 if(ratio!==null&&ratio>=.9)issues.push('พื้นที่จัดเก็บเหลือน้อยกว่า 10% ควรสำรองและลบงานที่ไม่ใช้');
 else if(ratio!==null&&ratio>=.75)issues.push('ใช้พื้นที่จัดเก็บเกิน 75% ควรสร้างไฟล์กู้คืนไว้');
 return {status:!valid||missing.length||invalid.length?'error':issues.length?'warning':'ok',valid,formatVersion:project?.version??null,assetCount:ids.length,assetBytes,missing,invalid,dirty,usage,quota,ratio,persisted,issues};
}
