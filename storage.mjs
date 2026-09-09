import {project,layer,identity,referenced,validate} from "./model.mjs";
export class ConflictError extends Error {}
const done = tx => new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error("ยกเลิกการบันทึก"));tx.onerror=()=>{};});
export async function openStore(onBlocked) {
  const db=await new Promise((resolve,reject)=>{
    const req=indexedDB.open("smart-combine-to-rfi",2);
    req.onupgradeneeded=()=>{
      for(const name of ["workspace","images","projects","assets","settings"]){
        if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name,["images","projects","assets"].includes(name)?{keyPath:"id"}:undefined);
      }
    };
    req.onblocked=onBlocked;req.onerror=()=>reject(req.error);req.onsuccess=()=>resolve(req.result);
  });
  return new Store(db);
}
export class Store {
  constructor(db){this.db=db;}
  async get(name,key) {
    const tx=this.db.transaction(name),req=tx.objectStore(name).get(key);await done(tx);return req.result;
  }
  async all(name) {
    const tx=this.db.transaction(name),req=tx.objectStore(name).getAll();await done(tx);return req.result;
  }
  async setting(key,value){const tx=this.db.transaction("settings","readwrite");tx.objectStore("settings").put(value,key);await done(tx);}
  async save(p,assets) {
    const record=structuredClone(p),expected=record.revision,ids=referenced(record);
    record.revision++;record.savedAt=Date.now();
    const tx=this.db.transaction(["projects","assets"],"readwrite");
    let conflict=false;
    const req=tx.objectStore("projects").get(record.id);
    req.onsuccess=()=>{
      if((req.result?.revision||0)!==expected){conflict=true;tx.abort();return;}
      for(const id of ids)if(assets.has(id)){ const existing=tx.objectStore("assets").get(id); existing.onsuccess=()=>{if(!existing.result)tx.objectStore("assets").put({id,blob:assets.get(id)});}; }
      tx.objectStore("projects").put(record);
      const all=tx.objectStore("projects").getAll();
      all.onsuccess=()=>{const keep=new Set(all.result.flatMap(item=>[...referenced(item)]));const cursor=tx.objectStore("assets").openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;if(!keep.has(row.key))row.delete();row.continue();};};
    };
    try{await done(tx);}catch(error){if(conflict)throw new ConflictError("งานนี้ถูกแก้จากอีกแท็บ");throw error;}
    return {revision:record.revision,savedAt:record.savedAt};
  }
  async deleteProject(id,revision) {
    const tx=this.db.transaction(['projects','assets','settings'],'readwrite');let conflict=false;
    const request=tx.objectStore('projects').get(id);
    request.onsuccess=()=>{if(!request.result||request.result.revision!==revision){conflict=true;tx.abort();return;}
      tx.objectStore('projects').delete(id);
      const all=tx.objectStore('projects').getAll();all.onsuccess=()=>{
        const keep=new Set(all.result.flatMap(item=>[...referenced(item)]));
        const cursor=tx.objectStore('assets').openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;if(!keep.has(row.key))row.delete();row.continue();};
        if(!all.result.length){const fresh=project('งานใหม่');tx.objectStore('projects').put(fresh);all.result.push(fresh);}
        tx.objectStore('settings').put(all.result[0].id,'last-project');
      };
    };
    try{await done(tx);}catch(e){if(conflict)throw new ConflictError('งานเปลี่ยนแปลงจากอีกแท็บ กรุณาเปิดรายการใหม่ก่อนลบ');throw e;}
  }
  async migrate() {
    // Read legacy records without mutating them. The marker and migrated project commit atomically.
    if(await this.get("settings","legacy-migrated"))return;
    const old=await this.get("workspace","current");const images=old?await this.all("images"):[];
    let p;
    if(old && Array.isArray(old.drawings)){
      p=project(old.form?.["project-name"]||"งานเดิมก่อนอัปเดต");
      p.layers=old.drawings.map(d=>layer({...d,assetId:d.id,sourceId:d.id,width:1,height:1,
        visible:d.id===old.baseId||d.id===old.overlayId,legacyDimensions:true}));
      p.baseId=old.baseId;p.selectedId=old.overlayId||old.baseId;p.camera=old.camera||p.camera;p.viewSize=old.viewport||p.viewSize;
      p.showMarkers=!!old.showMarkers;p.panMode=!!old.panMode;p.form=old.form||{};
      const over=p.layers.find(l=>l.id===old.overlayId);
      if(over){
        const t=old.transform;
        if(t){const a=t.scale*Math.cos(t.angle),b=t.scale*Math.sin(t.angle);over.transform={a,b,c:-b,d:a,e:t.p.x-a*t.q.x+b*t.q.y,f:t.p.y-b*t.q.x-a*t.q.y};}
        over.opacity=old.opacity??1;over.blend=old.blendMode||"multiply";over.colorMode=old.colorMode||"tint";over.color=old.inkColor||"#22c55e";
        if(old.calibrated&&old.points)over.alignment={...old.points,baseId:p.baseId};
      }
      if(old.calibration && old.overlayId && old.baseId) p.calibration={mode:"align",layerId:old.overlayId,p:old.calibration.p||[],q:old.calibration.q||[],previousCamera:old.calibration.previousCamera||p.camera};
      p.savedAt=Date.now();p.revision=1;
    }
    const tx=this.db.transaction(["settings","projects","assets"],"readwrite");
    const check=tx.objectStore("settings").get("legacy-migrated");
    check.onsuccess=()=>{
      if(check.result)return;
      if(p){
        tx.objectStore("projects").put(p);
        for(const asset of images)tx.objectStore("assets").put(asset);
        tx.objectStore("settings").put(p.id,"last-project");
      }
      tx.objectStore("settings").put(true,"legacy-migrated");
    };
    await done(tx);
  }
}
