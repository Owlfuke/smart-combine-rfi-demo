import {installAppMenus} from './app-menus.mjs';
import {installMeasurements} from './measurements.mjs';
import {assertNewRevisions} from './versions.mjs';
import {createSignature} from './state-signature.mjs';
import {editGrid} from "./grids.mjs";
import {installRfi} from "./rfi.mjs";
import {showRevisionHistory} from "./revision-history.mjs";
import {createBackup,readBackup,prepareRestore} from "./backup.mjs";
import "./layout.mjs";
import {displayName} from "./title-block-parser.mjs";
import {BLENDS,LIMITS,clone,project,layer,checkpoint,undo,content,referenced,rebase,identity,validate} from "./model.mjs";
import {openStore,ConflictError} from "./storage.mjs";
import {Importer,hash} from "./importer.mjs";
import {Engine} from "./engine.mjs";

const $=id=>document.getElementById(id);
let store,p=null,pool=new Map(),busy=true,importActive=false,blocked=false,saveTimer,saveFlight=null,committed="",renaming=false,dragId=null;
const compactSignature=createSignature();
const signature=q=>compactSignature({...q,revision:0,savedAt:0});
const selected=()=>p?.layers.find(l=>l.id===p.selectedId);
const base=()=>p?.layers.find(l=>l.id===p.baseId);
function toast(message,isError=false,action=null){
  const box=document.createElement("div");box.className="toast"+(isError?" error":"");
  const text=document.createElement("span");text.textContent=message;box.append(text);
  if(action){const b=document.createElement("button");b.textContent=action.label;b.addEventListener("click",()=>{box.remove();safe(action.run);});box.append(b);}
  const close=document.createElement("button");close.textContent="×";close.setAttribute("aria-label","ปิดแจ้งเตือน");close.addEventListener("click",()=>box.remove());box.append(close);
  $("toasts").append(box);setTimeout(()=>box.remove(),isError?18000:9000);
}
function undoAction(){
  const id=p.id, entry=compactSignature(p.history.at(-1));
  return {label:"ย้อนกลับ",run:()=>{
    if(p.id!==id||JSON.stringify(p.history.at(-1))!==entry){toast("มีการแก้ไขต่อแล้ว ใช้ปุ่ม Undo เพื่อย้อนตามลำดับ",true);return;}
    return historyMove(false);
  }};
}
function error(e){
  console.error(e);toast(e.message||"เกิดข้อผิดพลาด กรุณาลองใหม่",true);
}
async function safe(fn){try{await fn();}catch(e){error(e);}}
function listen(id,event,fn){$(id).addEventListener(event,e=>safe(()=>fn(e)));}
function setBusy(value){busy=value;$("workspace").inert=value||blocked;for(const id of ["new-project","rename-project","project-select","save-state","backup-project","restore-project"])$(id).disabled=value||blocked||(importActive&&id!=="save-state");}
function status(message){$("canvas-status").textContent=message;}
function savedText(){
  $("save-status").textContent=p?.savedAt?"บันทึก "+new Date(p.savedAt).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"พร้อมบันทึกอัตโนมัติ";
}
let interactionUntil=0;
function deferAutosave(){interactionUntil=performance.now()+1200;}
window.addEventListener('pointermove',e=>{if(e.buttons)deferAutosave();},{passive:true});
window.addEventListener('pointerdown',deferAutosave,{passive:true});
window.addEventListener('wheel',deferAutosave,{passive:true});
function schedule(){
  if(p?.calibration){clearTimeout(saveTimer);$("save-status").textContent="พักบันทึกอัตโนมัติระหว่าง Calibrate · กดบันทึกเองได้";return;}
  if(!p||busy||blocked)return;
  $("save-status").textContent="มีการเปลี่ยนแปลง · รอบันทึกเมื่อหยุดใช้งาน";
  clearTimeout(saveTimer);
  const attempt=()=>{if(!p||p.calibration||blocked)return;const remaining=interactionUntil-performance.now();if(busy||remaining>0){saveTimer=setTimeout(attempt,Math.max(300,remaining));return;}safe(save);};
  saveTimer=setTimeout(attempt,1200);
}
async function save(){
  clearTimeout(saveTimer);
  if(!p||blocked)return;
  if(saveFlight){await saveFlight;if(signature(p)!==committed)return save();return;}
  if(signature(p)===committed){savedText();return;}
  const current=p,sig=signature(p),record=clone(p);
  $("save-status").textContent="กำลังบันทึก…";
  saveFlight=(async()=>{
    try{
      const result=await store.save(record,pool);
      if(p===current){Object.assign(p,result);committed=sig;savedText();}
    }catch(e){
      $("save-status").textContent="บันทึกไม่สำเร็จ";
      if(e instanceof ConflictError){
        blocked=true;setBusy(false);$("error-message").textContent="งานนี้มีเวอร์ชันใหม่จากอีกแท็บ หยุดแก้ไขเพื่อไม่เขียนทับกัน กดเปิดงานล่าสุดเพื่อใช้ข้อมูลจากอีกแท็บ";
        $("error-banner").hidden=false;
      }else toast("บันทึกไม่สำเร็จ ข้อมูลเดิมยังอยู่: "+e.message,true);
      throw e;
    }
  })();
  try{await saveFlight;}finally{saveFlight=null;}
  if(p===current&&!p.calibration&&signature(p)!==committed)return save();
}
const engine=new Engine($("combined-canvas"),$("calibration-guide-canvas"),{
  change:full=>{if(full){update();schedule();}else updateView();},status,error
});
async function loadAssets(record){
  const map=new Map();
  for(const id of referenced(record)){
    const value=pool.get(id)||(await store.get("assets",id))?.blob;
    if(!value)throw Error("ไม่พบภาพที่บันทึกในงานนี้ กรุณาลองเปิดงานอีกครั้ง");
    map.set(id,value);
  }
  return map;
}
async function projects(){
  const all=(await store.all("projects")).sort((a,b)=>b.savedAt-a.savedAt);
  $("project-select").replaceChildren();
  for(const item of all){
    const option=document.createElement("option");option.value=item.id;
    option.textContent=item.name+(item.savedAt?" · "+new Date(item.savedAt).toLocaleDateString("th-TH"):"");
    $("project-select").append(option);
  }
  if(p)$("project-select").value=p.id;
}
async function openProject(id,{skipSave=false}={}){
  if(!skipSave)await save();
  setBusy(true);
  try{
    const next=validate(await store.get("projects",id));
    const assets=await loadAssets(next);
    await engine.load(next,assets);
    const migrated=next.layers.some(l=>!l.fingerprint);
    for(const l of next.layers)if(!l.fingerprint)l.fingerprint=await hash(assets.get(l.sourceId||l.assetId));
    const oldSize=next.viewSize;
    if(oldSize?.width){next.camera.x+=(engine.width-oldSize.width)/2;next.camera.y+=(engine.height-oldSize.height)/2;}
    next.viewSize={width:engine.width,height:engine.height};
    p=next;pool=assets;blocked=false;committed=signature(p);
    await store.setting("last-project",p.id);await projects();update();savedText();
    setBusy(false);
    if(!oldSize?.width&&p.layers.length)engine.fit();
    if(migrated){committed="";await save();}
    status(p.calibration?"คืนค่างานแล้ว · จับคู่กริดต่อได้":"เปิดงาน "+p.name+" แล้ว");
  }catch(e){if(p)$("project-select").value=p.id;throw e;}finally{setBusy(false);}
}
async function mutate(label,fn,{history=true,hydrate=false}={}){
  if(busy||blocked||!p)return;
  const previous=clone(p);
  try{
    if(history)checkpoint(p);
    fn(p);
    if(hydrate){setBusy(true);await engine.load(p,pool);setBusy(false);}
    update();schedule();
    if(label)toast(label,false,history?undoAction():null);
  }catch(e){p=previous;engine.p=p;update();throw e;}
  finally{if(hydrate)setBusy(false);}
}
async function historyMove(redo){
  if(busy||blocked||!p)return;
  if(p.calibration){engine.cancel();return;}
  if(!(redo?p.future:p.history).length)return;
  const next=clone(p);undo(next,redo);
  setBusy(true);
  try{
    const assets=await loadAssets(next);await engine.load(next,assets);p=next;pool=assets;update();
    status(redo?"ทำซ้ำแล้ว":"ย้อนกลับแล้ว");
  }finally{setBusy(false);}
  schedule();
}
function confirm(title,message){
  return new Promise(resolve=>{
    $("confirm-title").textContent=title;$("confirm-message").textContent=message;
    const dialog=$("confirm-dialog");
    const finish=value=>{dialog.close();$("confirm-yes").onclick=null;$("confirm-no").onclick=null;dialog.removeEventListener("cancel",cancel);resolve(value);};
    // Handlers are assigned in this local module, never in HTML attributes.
    const cancel=e=>{e.preventDefault();finish(false);};
    $("confirm-yes").onclick=()=>finish(true);$("confirm-no").onclick=()=>finish(false);
    dialog.addEventListener("cancel",cancel);dialog.showModal();
  });
}
function password(name,incorrect,signal){
  return new Promise(resolve=>{
    const dialog=$("password-dialog");$("password-file").textContent=(incorrect?"รหัสผ่านไม่ถูกต้อง · ":"")+name;$("pdf-password").value="";
    const done=value=>{dialog.close();$("password-form").removeEventListener("submit",submit);$("password-cancel").removeEventListener("click",cancel);dialog.removeEventListener("cancel",cancel);signal.removeEventListener("abort",abort);resolve(value);};
    const submit=e=>{e.preventDefault();done($("pdf-password").value);};const cancel=e=>{e.preventDefault();done(null);};const abort=()=>done(null);
    $("password-form").addEventListener("submit",submit);$("password-cancel").addEventListener("click",cancel);dialog.addEventListener("cancel",cancel);signal.addEventListener("abort",abort,{once:true});
    dialog.showModal();$("pdf-password").focus();
  });
}
const importer=new Importer({
  password,getProject:()=>p,onBusy:value=>{importActive=value;setBusy(busy);},onError:error,
  preview:l=>{const source=engine.cache.get(l.assetId)?.source;if(!source)return null;const c=document.createElement("canvas");c.width=240;c.height=Math.max(1,Math.round(source.height*240/source.width));c.getContext("2d").drawImage(source,0,0,c.width,c.height);return c.toDataURL();},
  onCommit:async(items,assets)=>{
    assertNewRevisions(items,p.layers);
    if(busy||blocked)throw Error("โปรดรอการทำงานปัจจุบันก่อนนำเข้า");
    if(p.calibration)throw Error("ยืนยันหรือยกเลิกการจับคู่กริดก่อนนำเข้าแผ่นที่ตรวจแล้ว");
    setBusy(true);try{
    const next=clone(p);checkpoint(next);
    for(const [id,blob] of assets)pool.set(id,blob);
    for(const data of items)next.layers.unshift(layer(data));
    if(!next.baseId)next.baseId=next.layers[next.layers.length-1].id;
    next.selectedId=next.layers[0].id;next.filter="ALL";
    await engine.load(next,pool);p=next;update();engine.fit();
    await save();
    toast("นำเข้า "+items.length+" แผ่นแล้ว",false,undoAction());
    }finally{setBusy(false);}
  }
});
function importFiles(files){
  if(busy||blocked||!p)return;
  if(p.calibration){toast("ยืนยันหรือยกเลิกการจับคู่กริดก่อนนำเข้า",true);return;}
  $("import-discipline").value=p.filter==="ALL"?"AR":p.filter;
  $("import-number").value="";$("import-revision").value="";
  return importer.open(files,p);
}
let editingDrawing=null;
function openDrawingName(layer){
  if(busy||blocked||layer.locked||p.calibration)return;
  editingDrawing={projectId:p.id,layerId:layer.id};
  $("drawing-title").value=layer.drawingTitle||"";
  $("drawing-number").value=layer.number||"";$("drawing-revision").value=layer.revision??"";$("drawing-revision-date").value=layer.revisionDate||"";
  $("drawing-name-dialog").showModal();$("drawing-title").focus();$("drawing-title").select();
}
listen("drawing-name-cancel","click",()=>$("drawing-name-dialog").close());
listen("drawing-name-dialog","close",()=>{editingDrawing=null;});
listen("drawing-name-form","submit",async e=>{
  e.preventDefault();
  if(busy||blocked||!editingDrawing||p.id!==editingDrawing.projectId)return;
  const layer=p.layers.find(l=>l.id===editingDrawing.layerId),title=$("drawing-title").value.trim();
  if(!title){$("drawing-title").focus();return;}
  if(!layer||layer.locked||p.calibration)return;
  const values={drawingTitle:title,number:$("drawing-number").value.trim(),revision:$("drawing-revision").value.trim(),revisionDate:$("drawing-revision-date").value.trim()};
  if(Object.entries(values).some(([key,value])=>value!==(layer[key]??"")))await mutate("บันทึกข้อมูลแบบแล้ว",()=>{Object.assign(layer,values);layer.name=displayName({title,number:layer.number,revision:layer.revision});});
  $("drawing-name-dialog").close();
});
function cardButton(text,label,fn,disabled=false){
  const b=document.createElement("button");b.type="button";b.textContent=text;b.setAttribute("aria-label",label);b.disabled=disabled;b.addEventListener("click",e=>{e.stopPropagation();safe(fn);});return b;
}
function renderLayers(){
  const properties=$('layer-properties');
  let parking=$('layer-properties-parking');if(!parking){parking=document.createElement('div');parking.id='layer-properties-parking';parking.hidden=true;document.body.append(parking);}
  parking.append(properties);
  const list=$("drawing-list");list.replaceChildren();
  $("layer-count").textContent=p.layers.length+" / "+LIMITS.layers+" แผ่น";
  const items=p.layers.filter(l=>p.filter==="ALL"||l.discipline===p.filter);
  if(!items.length){const empty=document.createElement("p");empty.className="hint";empty.textContent=p.layers.length?"ไม่มีแผ่นในสาขานี้":"ยังไม่มีแบบ · นำเข้าไฟล์เพื่อเริ่มต้น";list.append(empty);}
  for(const l of items){
    const row=document.createElement("article");row.className="layer-card"+(l.id===p.selectedId?" selected":"");row.dataset.id=l.id;
    row.draggable=!l.locked&&!p.calibration;row.tabIndex=0;row.setAttribute("aria-label","แผ่น "+l.name+" หน้า "+(l.page||1));
    const choose=()=>{if(p.calibration)return;p.selectedId=l.id;update();};
    row.addEventListener("click",choose);row.addEventListener("keydown",e=>{if(e.target===row&&(e.key==="Enter"||e.key===" ")){e.preventDefault();choose();}});
    // Disable native card dragging before a control starts its pointer gesture.
    row.addEventListener("pointerdown",e=>{row.draggable=!l.locked&&!p.calibration&&!e.target.closest('input,select,button,textarea,label,.card-layer-settings');});
    row.addEventListener("dragstart",e=>{if(!row.draggable){e.preventDefault();return;}dragId=l.id;e.dataTransfer.setData("text/plain",l.id);e.dataTransfer.effectAllowed="move";});
    row.addEventListener("dragover",e=>{if(dragId){e.preventDefault();e.dataTransfer.dropEffect="move";}});
    row.addEventListener("drop",e=>{if(!dragId)return;e.preventDefault();e.stopPropagation();const id=dragId;dragId=null;safe(()=>moveLayer(id,p.layers.findIndex(item=>item.id===l.id)));});
    row.addEventListener("dragend",()=>{dragId=null;});
    const head=document.createElement("div");head.className="row-head";
    const thumb=document.createElement("canvas");thumb.className="layer-thumb";thumb.width=108;thumb.height=108;
    const image=engine.cache.get(l.assetId)?.source;
    if(image){const x=thumb.getContext("2d");x.fillStyle="white";x.fillRect(0,0,108,108);const scale=Math.min(108/l.width,108/l.height);x.drawImage(image,(108-l.width*scale)/2,(108-l.height*scale)/2,l.width*scale,l.height*scale);}
    const title=document.createElement("div");title.className="layer-title";const strong=document.createElement("strong");strong.textContent=l.name;
    const detail=document.createElement("small");detail.textContent=l.discipline+" · หน้า "+(l.page||1)+(l.number?" · "+l.number:"")+(l.revision?" · "+l.revision:"")+(l.versionOf?" · เวอร์ชันใหม่":"");title.append(strong,detail);
    const badge=document.createElement("small");badge.textContent=l.id===p.baseId?"ฐาน":l.alignment?"จับคู่แล้ว":"ยังไม่จับคู่";title.append(badge);head.append(thumb,title);row.append(head);
    const actions=document.createElement("div");actions.className="layer-actions";
    actions.append(cardButton(l.visible?"◉ แสดง":"○ ซ่อน","เปิดปิดภาพ "+l.name,()=>mutate("",()=>{l.visible=!l.visible;}),!!p.calibration));
    actions.append(cardButton(l.locked?"🔒":"🔓","ล็อกภาพ "+l.name,()=>mutate("",()=>{l.locked=!l.locked;}),!!p.calibration));
    actions.append(cardButton("↑","เลื่อนขึ้น "+l.name,()=>moveLayer(l.id,p.layers.indexOf(l)-1),l.locked||!!p.calibration||p.layers.indexOf(l)===0));
    actions.append(cardButton("↓","เลื่อนลง "+l.name,()=>moveLayer(l.id,p.layers.indexOf(l)+1),l.locked||!!p.calibration||p.layers.indexOf(l)===p.layers.length-1));
    const del=cardButton("ลบ","ลบภาพ "+l.name,()=>remove(l),l.locked||!!p.calibration);del.className="danger";actions.append(del);actions.append(cardButton("แก้ไขชื่อ","แก้ไขชื่อแบบ "+l.name,()=>openDrawingName(l),l.locked||!!p.calibration));actions.append(cardButton("ประวัติ","ประวัติ Revision "+l.name,()=>showRevisionHistory(p.layers,l.id,engine.cache)));actions.append(cardButton("กริด","กำหนดกริด "+l.name,()=>editGrid(l,engine.cache.get(l.assetId)?.source,(lines,bands)=>mutate("บันทึกกริดแล้ว",()=>{l.gridLines=lines;l.gridBands=bands;})),l.locked||!!p.calibration));row.append(actions);list.append(row);
    {
      const settings=document.createElement('div');settings.className='card-layer-settings';const controls=l.id===p.selectedId?properties:properties.cloneNode(true);
      controls.querySelectorAll(".card-order-actions").forEach(group=>group.remove());
      if(controls!==properties){
        const fields={'drawing-discipline':'discipline','blend-mode':'blend','overlay-color-mode':'colorMode','overlay-ink-color':'color','opacity-slider':'opacity'};
        for(const [id,field] of Object.entries(fields)){const input=controls.querySelector('#'+id);input.value=field==='opacity'?Math.round(l.opacity*100):l[field];input.disabled=l.locked||!!p.calibration;
          let gesture=false;input.addEventListener('input',()=>{if(!['color','opacity'].includes(field)||l.locked||p.calibration)return;if(!gesture){checkpoint(p);gesture=true;}l[field]=field==='opacity'?Number(input.value)/100:input.value;if(field==='opacity')controls.querySelector('[data-control="opacity-value"]').textContent=input.value+'%';engine.render();});
          input.addEventListener('change',()=>safe(()=>{if(['color','opacity'].includes(field)){gesture=false;update();schedule();}else return mutate('',()=>{l[field]=input.value;});}));input.addEventListener('blur',()=>gesture=false);
        }
        controls.querySelector('#opacity-value').textContent=Math.round(l.opacity*100)+'%';
        for(const e of [controls,...controls.querySelectorAll('[id]')]){if(e.id){e.dataset.control=e.id;e.removeAttribute('id');}}
        for(const e of controls.querySelectorAll('[for]'))e.removeAttribute('for');
      }
      settings.append(controls);row.append(settings);
      const buttons=[...actions.children],topActions=document.createElement('div'),viewActions=document.createElement('div'),orderActions=document.createElement('div');
      topActions.className='card-title-actions';viewActions.className='card-view-actions';orderActions.className='card-order-actions';
      topActions.append(buttons[5],buttons[6]);head.append(topActions);
      const baseButton=cardButton('▣','ใช้เป็นแผ่นฐาน '+l.name,()=>{choose();$('set-base').click();},!!p.calibration||l.id===p.baseId);
      const calibrate=cardButton('Calibrate','Calibrate '+l.name,()=>{choose();toggleCalibratePanel(true);},!!p.calibration||l.id===p.baseId);
      viewActions.append(buttons[0],baseButton,buttons[1],calibrate,buttons[7],badge);actions.append(viewActions);
      orderActions.append(buttons[4],buttons[2],buttons[3]);controls.querySelector('.card-quick-controls').append(orderActions);
      settings.addEventListener('click',e=>e.stopPropagation());settings.addEventListener('keydown',e=>e.stopPropagation());settings.addEventListener('dragstart',e=>{e.preventDefault();e.stopPropagation();});
    }
  }
}
function moveLayer(id,index){
  const l=p.layers.find(item=>item.id===id);if(!l||l.locked||p.calibration||index<0||index>=p.layers.length)return;
  return mutate("เรียง Layers แล้ว",()=>{p.layers.splice(p.layers.indexOf(l),1);p.layers.splice(index,0,l);});
}
async function remove(l){
  if(l.locked||p.calibration)return;
  await mutate("ลบ "+l.name+" แล้ว",()=>{
    p.layers=p.layers.filter(item=>item.id!==l.id);
    if(p.baseId===l.id){p.baseId=null;for(const item of p.layers){item.alignment=null;item.check=null;}}
    if(p.selectedId===l.id)p.selectedId=p.layers[0]?.id||null;
  },{hydrate:true});
  engine.fit();await save();
}
function updateView(){
  if(!p)return;
  $("zoom-level").textContent=(p.camera.zoom*100).toFixed(1)+"%";
  $("base-label").textContent="ฐาน: "+(base()?.name||"ยังไม่เลือก");
  $("active-label").textContent="แผ่นที่เลือก: "+(selected()?.name||"—");
  $("canvas-empty-state").hidden=!!p.layers.length;
}
function update(){
  engine.refreshRfi?.();
  if(document.body.classList.contains("register-view"))renderRegisterPage();
  if(!p)return;updateView();renderLayers();
  const l=selected(),cal=p.calibration,locked=!l||l.locked||!!cal,isBase=l?.id===p.baseId;
  for(const b of document.querySelectorAll("[data-filter]"))b.setAttribute("aria-pressed",String(b.dataset.filter===p.filter));
  $("undo-button").disabled=!p.history.length&&!cal;$("redo-button").disabled=!p.future.length||!!cal;
  $("selected-name").textContent=l?l.name+" · หน้า "+(l.page||1):"เลือกแผ่นจากรายการด้านซ้าย";
  
  $("drawing-discipline").value=l?.discipline||"AR";
  for(const id of ["drawing-discipline","opacity-slider"])$(id).disabled=locked;
  for(const id of ["blend-mode","overlay-color-mode","overlay-ink-color"])$(id).disabled=locked;
  $("overlay-ink-color").disabled=locked||l?.colorMode==="original";
  $("blend-mode").value=l?.blend||"multiply";$("overlay-color-mode").value=l?.colorMode||"tint";$("overlay-ink-color").value=l?.color||"#22c55e";
  $("opacity-slider").value=Math.round((l?.opacity??1)*100);$("opacity-value").textContent=$("opacity-slider").value+"%";
  $("set-base").disabled=locked||isBase;$("set-base").setAttribute("aria-pressed",String(isBase));$("set-base").title=isBase?"แผ่นฐานปัจจุบัน":"ใช้เป็นแผ่นฐาน";
  $("marker-toggle").setAttribute("aria-pressed",String(p.showMarkers));$("marker-toggle").textContent="จุดอ้างอิง: "+(p.showMarkers?"เปิด":"ปิด");$("marker-toggle").disabled=!!cal||!l?.alignment;
  $("pan-toggle").setAttribute("aria-pressed",String(p.panMode));
  $("calibrate-button").disabled=locked||!base()||isBase||!l?.visible||!base()?.visible;
  $("calibrate-launcher").textContent=l?.alignment?"Calibrate":"Not Calibrate";
  $("calibrate-launcher").disabled=!l;
  $("calibrate-launcher").title=isBase?"แผ่นฐานอ้างอิง · เลือกแผ่นซ้อนเพื่อจับคู่กริด":l?.alignment?"จับคู่กริดแล้ว · เปิด Calibrate":"ยังไม่จับคู่กริด · เปิด Calibrate";
  $("verify-grid").disabled=$("calibrate-button").disabled||!l?.alignment;
  $("calibration-cancel").disabled=!cal;$("calibration-back").disabled=!cal||(!cal.p.length&&!cal.q.length);
  $("calibration-apply").hidden=!cal||engine.stage()!=="review";
  $("calibration-result").hidden=!cal||engine.stage()!=="review";
  const n=cal?.mode==="check"?1:2,stage=engine.stage();
  $("calibration-instruction").textContent=!cal?"เลือกแผ่นซ้อน แล้วจับคู่กริดที่ตรงกันสองคู่":stage==="review"?"ตรวจผลบน Canvas แล้วกดยืนยัน หรือย้อนจุดเพื่อแก้ไข":(stage==="base"?"แผ่นฐาน · เลือก P":"แผ่นซ้อน · เลือก Q")+(cal.mode==="check"?"3 ที่เป็นจุดตรวจอิสระ":(stage==="base"?cal.p.length+1:cal.q.length+1))+" · Esc ยกเลิก";
  [...$("calibration-steps").children].forEach((li,i)=>{const count=cal?cal.p.length+cal.q.length:0;li.className=i<count?"done":i===count&&cal?"active":"";li.hidden=cal?.mode==="check";});
  if(cal&&stage==="review"){
    const r=engine.result();$("calibration-apply").textContent=cal.mode==="check"?"บันทึกผลตรวจ":"ยืนยันผลจับคู่";
    $("calibration-result").textContent=cal.mode==="check"?"คลาดเคลื่อน "+r.errorPx.toFixed(2)+" px ("+r.relative.toFixed(3)+"% ของระยะกริด)": "Scale "+r.scale.toFixed(5)+" · หมุน "+(r.angle*180/Math.PI).toFixed(3)+"°"+(r.warning?" · "+r.warning:"");
  }
  $("verification-result").textContent=l?.check?"จุดตรวจอิสระ: "+l.check.errorPx.toFixed(2)+" px · "+l.check.relative.toFixed(3)+"% ของระยะกริด":"ยังไม่ได้ตรวจจุดอิสระ";
  $("calibration-status").textContent=l?.alignment?"จับคู่แล้ว"+(l.check?" · ตรวจจุดที่สามแล้ว":" · ยังไม่ตรวจจุดที่สาม"):"ยังไม่จับคู่กริด";
  $("blend-hint").textContent=["screen","lighten","color-dodge"].includes(l?.blend)?"โหมดเพิ่มแสงอาจทำให้เส้นจางบนพื้นขาว":"ปรับสีและ Opacity ของแผ่นที่เลือก ไม่เปลี่ยนผลจับคู่";
  for(const id of ["project-name","rfi-number","engineering-question"])if(document.activeElement!==$(id))$(id).value=p.form[id]||"";
  engine.cursor();engine.render();
}
for(const blend of BLENDS){const o=document.createElement("option");o.value=blend;o.textContent=blend==="source-over"?"Normal":blend.replaceAll("-"," ").replace(/\b\w/g,c=>c.toUpperCase());$("blend-mode").append(o);}
for(const [id,field] of [["drawing-discipline","discipline"],["blend-mode","blend"],["overlay-color-mode","colorMode"]]){
  listen(id,"change",()=>{const l=selected(),value=$(id).value;if(l&&!l.locked)return mutate("",()=>{l[field]=value;if(["drawingTitle","number","revision"].includes(field)&&l.drawingTitle)l.name=displayName({title:l.drawingTitle,number:l.number,revision:l.revision});});});
}
// One history entry per continuous slider/color gesture, with live preview.
for(const [id,field,convert] of [["opacity-slider","opacity",v=>Number(v)/100],["overlay-ink-color","color",v=>v]]){
  let gesture=false;
  listen(id,"input",()=>{const l=selected();if(!l||l.locked||p.calibration)return;if(!gesture){checkpoint(p);gesture=true;}l[field]=convert($(id).value);if(field==="opacity")$("opacity-value").textContent=$(id).value+"%";engine.render();schedule();});
  listen(id,"change",()=>{gesture=false;update();schedule();});
  listen(id,"blur",()=>{gesture=false;});
}

listen("set-base","click",async()=>{
  const l=selected();if(!l)return;
  if(p.layers.some(item=>item.locked))throw Error("ปลดล็อก Layers ก่อนเปลี่ยนฐาน");
  if(p.baseId&&!(await confirm("เปลี่ยนแผ่นฐาน","จะรักษาตำแหน่งซ้อนสัมพัทธ์ไว้ แต่ล้างจุดอ้างอิงและผลตรวจของทุกแผ่น เพราะเปลี่ยนระบบพิกัด ย้อนกลับด้วย Undo ได้")))return;
  await mutate("เปลี่ยนแผ่นฐานแล้ว",()=>rebase(p,l.id));engine.fit();
});
listen("calibrate-button","click",()=>engine.begin("align"));listen("verify-grid","click",()=>engine.begin("check"));
listen("calibration-back","click",()=>engine.back());listen("calibration-cancel","click",()=>engine.cancel());
listen("calibration-apply","click",()=>{
  const cal=p.calibration;if(!cal)return;
  // History represents the pre-calibration workspace, not the temporary picking screen.
  const prior=content(p);prior.calibration=null;prior.camera=clone(cal.previousCamera);
  p.history.push(prior);if(p.history.length>LIMITS.history)p.history.shift();p.future=[];
  engine.apply();update();schedule();toast("บันทึกผลแล้ว",false,undoAction());
});
listen("marker-toggle","click",()=>{p.showMarkers=!p.showMarkers;update();});
listen("pan-toggle","click",()=>{p.panMode=!p.panMode;update();});
listen("zoom-in","click",()=>engine.zoom(1.2));listen("zoom-out","click",()=>engine.zoom(1/1.2));listen("fit-view","click",()=>engine.fit());
listen("undo-button","click",()=>historyMove(false));listen("redo-button","click",()=>historyMove(true));
document.addEventListener("keydown",e=>{
  if(e.target.closest("input,textarea,select")||document.querySelector("dialog[open]"))return;
  if(e.key==="Escape"&&p?.calibration){e.preventDefault();engine.cancel();}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();safe(()=>historyMove(e.shiftKey));}
});
for(const b of document.querySelectorAll("[data-filter]"))b.addEventListener("click",()=>{if(p.calibration)return;p.filter=b.dataset.filter;update();});
listen("drawing-file-input","change",e=>{const files=Array.from(e.target.files);e.target.value="";return importFiles(files);});
const zone=$("drawing-drop-zone");
zone.addEventListener("dragover",e=>{if(dragId)return;e.preventDefault();zone.classList.add("over");});
zone.addEventListener("dragleave",()=>zone.classList.remove("over"));
zone.addEventListener("drop",e=>{e.preventDefault();zone.classList.remove("over");if(!dragId)safe(()=>importFiles(Array.from(e.dataTransfer.files)));});
window.addEventListener("dragover",e=>e.preventDefault());window.addEventListener("drop",e=>e.preventDefault());
listen("save-state","click",save);
listen("project-select","change",e=>openProject(e.target.value));
const manageButton=document.createElement('button');manageButton.id='manage-projects';manageButton.textContent='จัดการงาน';$('rename-project').after(manageButton);
manageButton.onclick=()=>safe(async()=>{
 if(busy||blocked||importActive)return;await save();
 const dialog=document.createElement('dialog');dialog.className='project-manager';
 const title=document.createElement('h2');title.textContent='จัดการงาน';const list=document.createElement('select');list.setAttribute('aria-label','เลือกงานที่จะจัดการ');
 for(const item of await store.all('projects'))list.add(new Option(item.name,item.id));list.value=p.id;
 const details=document.createElement('p');const info=async()=>{const item=await store.get('projects',list.value);details.textContent=item?item.layers.length+' แผ่น · '+(item.rfis||[]).length+' RFI':'';};list.onchange=()=>safe(info);
 const actions=document.createElement('div');actions.className='dialog-actions';
 const action=(name,fn)=>{const b=document.createElement('button');b.textContent=name;b.onclick=()=>safe(async()=>{b.disabled=true;try{await fn();}finally{b.disabled=false;}});actions.append(b);};
 const activate=async()=>{await openProject(list.value);dialog.close();};
 action('เปิดงาน',activate);action('เปลี่ยนชื่อ',async()=>{await activate();projectDialog(true);});action('สำรองงาน',async()=>{await activate();$('backup-project').click();});
 action('ลบงาน',async()=>{const item=await store.get('projects',list.value);if(!item)return;
 if(!await confirm('ลบงาน '+item.name,'จะลบแบบ Cloud และ RFI ทั้งหมดของงานนี้ ย้อนกลับด้วย Undo ไม่ได้ ควรสำรองงานก่อน ต้องการลบหรือไม่?'))return;
 await save();const latest=await store.get('projects',item.id);if(latest.revision!==item.revision)throw Error('งานมีการเปลี่ยนแปลง กรุณาเปิดจัดการงานใหม่');
 setBusy(true);try{await store.deleteProject(item.id,item.revision);if(p.id===item.id){clearTimeout(saveTimer);await openProject(await store.get('settings','last-project'),{skipSave:true});}else await projects();dialog.close();toast('ลบงาน '+item.name+' แล้ว');}finally{setBusy(false);}
 });action('ปิด',()=>dialog.close());dialog.append(title,list,details,actions);dialog.onclose=()=>dialog.remove();document.body.append(dialog);await info();dialog.showModal();
});
function projectDialog(rename){
  renaming=rename;$("project-dialog-title").textContent=rename?"เปลี่ยนชื่องาน":"สร้างงานใหม่";
  $("project-title-input").value=rename?p.name:"";$("project-dialog").showModal();$("project-title-input").focus();
}
listen("new-project","click",()=>projectDialog(false));listen("rename-project","click",()=>projectDialog(true));
listen("project-cancel","click",()=>$("project-dialog").close());
listen("project-form","submit",async e=>{
  e.preventDefault();const name=$("project-title-input").value.trim();if(!name)throw Error("กรุณาตั้งชื่องาน");
  if(renaming){await mutate("เปลี่ยนชื่องานแล้ว",()=>{p.name=name;});await save();await projects();}
  else{
    await save();setBusy(true);
    try{const next=project(name),saved=await store.save(next,new Map());Object.assign(next,saved);await openProject(next.id,{skipSave:true});}
    finally{setBusy(false);}
  }
  $("project-dialog").close();
});
for(const id of ["project-name","rfi-number","engineering-question"])listen(id,"input",()=>{p.form[id]=$(id).value;schedule();});
listen("dismiss-error","click",()=>$("error-banner").hidden=true);
listen("recover","click",async()=>{
  if(p&&signature(p)!==committed&&!(await confirm("เปิดงานที่บันทึกไว้","การแก้ไขที่ยังบันทึกไม่สำเร็จในแท็บนี้จะถูกแทนด้วยงานที่บันทึกไว้ ต้องการดำเนินการต่อหรือไม่")))return;
  $("error-banner").hidden=true;await openProject(p?.id||await store.get("settings","last-project"),{skipSave:true});
});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")safe(save);});
window.addEventListener("beforeunload",e=>{if((p&&signature(p)!==committed)||saveFlight||busy||importActive){safe(save);e.preventDefault();e.returnValue="";}});
window.addEventListener("unhandledrejection",e=>{e.preventDefault();error(e.reason);});
window.addEventListener("error",e=>{
  $("error-message").textContent="เกิดข้อผิดพลาดในหน้าจอ ข้อมูลงานที่บันทึกไว้ยังอยู่: "+e.message;$("error-banner").hidden=false;
});
async function start(){
  try{
    store=await openStore(()=>{$("save-status").textContent="ปิดแท็บเวอร์ชันเก่าเพื่ออัปเดตที่เก็บข้อมูล";});
    store.db.onversionchange=()=>{store.db.close();blocked=true;setBusy(false);$("error-message").textContent="ที่เก็บข้อมูลอัปเดต กรุณารีโหลด";$("error-banner").hidden=false;};
    await store.migrate();
    const all=await store.all("projects");let id=await store.get("settings","last-project");
    if(!all.length){const first=project("งานใหม่ 1");await store.save(first,new Map());id=first.id;}
    else if(!all.some(item=>item.id===id))id=all.sort((a,b)=>b.savedAt-a.savedAt)[0].id;
    await openProject(id,{skipSave:true});
  }catch(e){
    blocked=true;setBusy(false);$("save-status").textContent="เปิดงานไม่สำเร็จ";
    $("error-message").textContent="เปิดงานไม่สำเร็จ ข้อมูลเดิมไม่ถูกเขียนทับ: "+e.message;$("error-banner").hidden=false;error(e);
  }
}
start();

function renderRegisterPage(){
 const grid=$("register-gallery");if(!grid||!p)return;grid.replaceChildren();
 $("register-project-name").textContent=p.name;
 $("register-summary").textContent=p.layers.length+" แผ่น · จับคู่แล้ว "+p.layers.filter(l=>l.alignment).length+" · เวอร์ชันใหม่ "+p.layers.filter(l=>l.versionOf).length;
 const query=$("register-search").value.trim().toLowerCase();
 for(const l of p.layers.filter(l=>(l.name+" "+l.number+" "+l.discipline).toLowerCase().includes(query))){
   const card=document.createElement("button");card.className="register-tile";
   const source=engine.cache.get(l.assetId)?.source;if(source){const c=document.createElement("canvas");c.width=280;c.height=180;const s=Math.min(c.width/source.width,c.height/source.height),x=c.getContext("2d");x.fillStyle="white";x.fillRect(0,0,c.width,c.height);x.drawImage(source,(c.width-source.width*s)/2,(c.height-source.height*s)/2,source.width*s,source.height*s);card.append(c);}
   const title=document.createElement("strong");title.textContent=l.number||l.name;
   const caption=document.createElement("span");caption.textContent=l.drawingTitle||l.name;
   const status=document.createElement("small");status.textContent=l.discipline+" · Rev "+(l.revision||"—")+" · "+(l.revisionDate||"ไม่ระบุวันที่")+" · "+(l.id===p.baseId?"แผ่นฐาน":l.alignment?"จับคู่แล้ว":"ยังไม่จับคู่");
   card.append(title,caption,status);card.addEventListener("click",()=>{p.selectedId=l.id;switchWorkspace("canvas");update();engine.render();});grid.append(card);
 }
 if(!grid.children.length){const text=document.createElement("p");text.textContent=p.layers.length?"ไม่พบแบบที่ค้นหา":"เริ่มต้นโดยนำเข้า PDF หรือรูปภาพ";grid.append(text);}
}
function switchWorkspace(view){
 const gallery=view==="register";document.body.classList.toggle("register-view",gallery);
 $("register-page").hidden=!gallery;
 document.querySelectorAll("[data-workspace-view]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.workspaceView===view)));
 if(gallery)renderRegisterPage();
}
document.querySelectorAll("[data-workspace-view]").forEach(b=>b.addEventListener("click",()=>switchWorkspace(b.dataset.workspaceView)));
$("register-search").addEventListener("input",renderRegisterPage);
$("register-import").addEventListener("click",()=>$("drawing-file-input").click());
document.getElementById("layout-focus").addEventListener("click",()=>{if(document.body.classList.contains("canvas-focus"))switchWorkspace("canvas");});

listen('comparison-mode','change',()=>{
 const mode=$('comparison-mode').value;
 if(mode!=='normal'&&(!p.baseId||!p.selectedId||p.baseId===p.selectedId)){error(new Error('เลือกแผ่นซ้อนที่ต่างจากแผ่นฐานก่อนเปรียบเทียบ'));$('comparison-mode').value='normal';engine.comparisonMode='normal';}
 else engine.comparisonMode=mode;
 $('comparison-split').hidden=engine.comparisonMode!=='swipe';engine.render();
});
listen('comparison-split','input',()=>{engine.comparisonSplit=+$('comparison-split').value/100;engine.render();});

listen('comparison-tools','toggle',()=>{if(!$('comparison-tools').open){$('comparison-mode').value='normal';$('comparison-split').hidden=true;engine.comparisonMode='normal';engine.render();}});

listen("backup-project","click",async()=>{
  if(busy||blocked||importActive||!p)return;
  setBusy(true);
  const button=$("backup-project");button.textContent="กำลังสำรอง…";
  try{
    await save();
    const snapshot=clone(p),assets=await loadAssets(snapshot);
    let templates=[];const raw=localStorage.getItem("smart-combine-region-templates-v1");if(raw)templates=JSON.parse(raw);
    const blob=await createBackup(snapshot,assets,templates);
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=(snapshot.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,"_").slice(0,80)||"project")+"-"+new Date().toISOString().replace(/[:.]/g,"-")+".scrfi";
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    toast("สร้างไฟล์สำรองแล้ว · โปรดเก็บไฟล์ .scrfi ที่ดาวน์โหลดไว้");
  }finally{button.textContent="สำรองโครงการ";setBusy(false);}
});

function toggleCalibratePanel(open){document.body.classList.toggle("calibrate-open",open);$("calibrate-launcher").setAttribute("aria-expanded",String(open));}
listen("calibrate-launcher","click",()=>toggleCalibratePanel(!document.body.classList.contains("calibrate-open")));
listen("calibrate-panel-close","click",()=>{toggleCalibratePanel(false);$("calibrate-launcher").focus();});

installRfi({engine,getProject:()=>p,mutate,schedule,toast,navigate:item=>{
 if(p.calibration){toast('จบ Calibrate ก่อนเปิดตำแหน่ง RFI',true);return false;}
 const sheet=p.layers.find(l=>l.id===item.sheetId),r=item.rect;if(!sheet||!r||!Number.isFinite(r.w)||!Number.isFinite(r.h)||r.w<=0||r.h<=0){toast('ไม่พบแผ่นหรือตำแหน่ง Cloud ของรายการนี้',true);return false;}
 document.querySelector('[data-workspace-view="canvas"]')?.click();sheet.visible=true;p.selectedId=sheet.id;p.panMode=false;
 const available=Math.max(160,engine.width-390),height=Math.max(100,engine.height);const zoom=Math.max(.02,Math.min(8,available/(r.w*1.4),height/(r.h*1.4)));
 p.camera={zoom,x:available/2-(r.x+r.w/2)*zoom,y:height/2-(r.y+r.h/2)*zoom};update();engine.render();schedule();return true;
}});
installMeasurements({engine,getProject:()=>p,mutate,toast,getSource:async l=>pool.get(l.sourceId)||(await store.get('assets',l.sourceId))?.blob});
installAppMenus();

listen("restore-project","click",()=>{if(!busy&&!blocked&&!importActive)$("restore-file").click();});
listen("restore-file","change",async()=>{
 const file=$("restore-file").files[0];$("restore-file").value="";if(!file||busy||blocked||importActive)return;
 setBusy(true);$("restore-project").textContent="กำลังกู้คืน…";
 try{
  const data=await readBackup(file),restored=prepareRestore(data);
  // Decode each distinct rendered asset before committing anything to storage.
  const checked=new Set();for(const state of [restored.project,...restored.project.history,...restored.project.future])for(const l of state.layers){if(checked.has(l.assetId))continue;const image=await createImageBitmap(restored.assets.get(l.assetId));try{if(image.width*image.height>LIMITS.imagePixels)throw Error("ภาพในไฟล์สำรองใหญ่เกินขีดจำกัด");}finally{image.close();}checked.add(l.assetId);}
  await save();
  await store.save(restored.project,restored.assets);
  let templateWarning=false;
  try{const key="smart-combine-region-templates-v1",existing=JSON.parse(localStorage.getItem(key)||"[]");if(!Array.isArray(existing))throw Error("แม่แบบเดิมไม่ถูกต้อง");for(const template of data.ocrTemplates||[]){if(template&&typeof template==='object'&&!existing.some(t=>JSON.stringify(t)===JSON.stringify(template)))existing.push(template);}localStorage.setItem(key,JSON.stringify(existing));}catch{templateWarning=true;}
  await openProject(restored.project.id,{skipSave:true});
  toast("กู้คืนเป็นโครงการใหม่แล้ว"+(templateWarning?" · แม่แบบ OCR กู้คืนไม่สำเร็จ แต่ข้อมูลโครงการครบ":""),templateWarning);
 }finally{$("restore-project").textContent="กู้คืนไฟล์สำรอง";setBusy(false);}
});
