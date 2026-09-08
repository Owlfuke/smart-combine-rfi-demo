import {editRegions} from "./region-editor.mjs";
import {readRegions} from "./regions.mjs";
import {conflicts} from "./versions.mjs";
import {LIMITS} from "./model.mjs";
import {TitleBlockReader} from "./title-block-reader.mjs";
import {displayName} from "./title-block-parser.mjs";
const $=id=>document.getElementById(id);
const abortError=()=>new DOMException("ยกเลิกการนำเข้า","AbortError");
const check=signal=>{if(signal.aborted)throw abortError();};
export async function hash(blob) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,"0")).join("");
}
export async function typeOfFile(file) {
  if(!file.size)throw Error("ไฟล์ว่าง");
  if(file.size>LIMITS.fileBytes)throw Error("ไฟล์เกิน 100 MB");
  const bytes=new Uint8Array(await file.slice(0,1024).arrayBuffer());
  const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const pdf=new TextDecoder("latin1").decode(bytes).includes("%PDF-");
  const ext=file.name.split(".").pop().toLowerCase();
  if(pdf&&ext==="pdf")return "pdf";
  if(png&&ext==="png")return "image";
  if(jpg&&["jpg","jpeg"].includes(ext))return "image";
  throw Error("เนื้อหาไฟล์ไม่ตรงชนิด PDF / PNG / JPG ที่รองรับ");
}
let pdfLibrary;
async function pdfjs(){
  if(!pdfLibrary){
    pdfLibrary=await import("./vendor/pdfjs/build/pdf.mjs");
    pdfLibrary.GlobalWorkerOptions.workerSrc=new URL("./vendor/pdfjs/build/pdf.worker.mjs",import.meta.url).href;
  }
  return pdfLibrary;
}
async function loadPdf(file,signal,password){
  const lib=await pdfjs();check(signal);
  const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,
    useWasm:false,stopAtErrors:true,enableXfa:false,
    cMapUrl:new URL("./vendor/pdfjs/cmaps/",import.meta.url).href,cMapPacked:true,
    standardFontDataUrl:new URL("./vendor/pdfjs/standard_fonts/",import.meta.url).href,
    wasmUrl:new URL("./vendor/pdfjs/wasm/",import.meta.url).href});
  const stop=()=>{task.destroy().catch(()=>{});};
  signal.addEventListener("abort",stop,{once:true});
  task.onPassword=async(update,reason)=>{
    try{const value=await password(file.name,reason===2,signal);if(value===null)stop();else update(value);}
    catch{stop();}
  };
  try{
    const pdf=await task.promise;
    if(pdf.numPages>LIMITS.pages){await task.destroy();throw Error("PDF เกิน 300 หน้า กรุณาแบ่งไฟล์ก่อนนำเข้า");}
    return pdf;
  }catch(error){if(signal.aborted)throw abortError();throw Error(error.name==="InvalidPDFException"?"โครงสร้าง PDF เสียหรืออ่านไม่ได้":error.name==="PasswordException"?"PDF ต้องใช้รหัสผ่าน":error.message);}
  finally{signal.removeEventListener("abort",stop);}
}
async function pdfCanvas(pdf,n,thumbnail,signal){
  check(signal);const page=await pdf.getPage(n);check(signal);
  const v=page.getViewport({scale:1});
  const scale=thumbnail?Math.min(220/v.width,160/v.height):Math.min(2.5,6000/Math.max(v.width,v.height),Math.sqrt(LIMITS.pagePixels/(v.width*v.height)));
  const view=page.getViewport({scale});
  const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.ceil(view.width));canvas.height=Math.max(1,Math.ceil(view.height));
  const task=page.render({canvasContext:canvas.getContext("2d"),viewport:view,background:"white"});
  const stop=()=>task.cancel();signal.addEventListener("abort",stop,{once:true});
  try{await task.promise;check(signal);return canvas;}finally{signal.removeEventListener("abort",stop);page.cleanup();}
}
const toBlob=c=>new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error("สร้างภาพไม่สำเร็จ")),"image/png"));
export class Importer{
  constructor({password,onCommit,onBusy,onError,preview,getProject}){
    Object.assign(this,{password,onCommit,onBusy,onError,preview,getProject});this.documents=[];this.selected=new Set();this.batch=0;this.generation=0;this.controller=null;
    $("define-regions").addEventListener("click",async()=>{if(!this.controller||this.reviewing||this.previewing||this.editingRegions)return;const items=this.items.filter(i=>this.selected.has(i.key));if(!items.length){this.report("เลือกหน้าต้นแบบและหน้าที่ต้องการอ่านก่อน");return;}this.editingRegions=true;try{const template=await editRegions(items,items[0].regionTemplate,this.controller.signal);if(template){for(const item of items){item.regionTemplate=structuredClone(template);delete item.meta;} $("region-summary").textContent=template.name+" · "+items.length+" หน้า";}}catch(e){this.report(e.message);}finally{this.editingRegions=false;}});
    $("clear-regions").addEventListener("click",()=>{for(const item of this.items||[])if(this.selected.has(item.key)){delete item.regionTemplate;delete item.meta;}$("region-summary").textContent="ใช้ค้นหาอัตโนมัติ";});
    $("review-to-queue").addEventListener("click",()=>this.showQueue());
    $("ocr-queue-stop").addEventListener("click",()=>$("title-skip-ocr").click());
    $("ocr-queue-cancel").addEventListener("click",()=>this.cancel());
    $("ocr-queue-confirm").addEventListener("click",()=>$("title-confirm-all").click());
    $("ocr-queue-commit").addEventListener("click",()=>this.commit());
    $("title-skip-ocr").addEventListener("click",()=>{this.titleReader?.skip?.();this.titleReader?.stop();$("title-skip-ocr").disabled=true;});
    $("import-cancel").addEventListener("click",()=>this.reviewMode?this.showQueue():this.cancel());
    $("import-dialog").addEventListener("cancel",e=>{e.preventDefault();this.reviewMode?this.showQueue():this.cancel();});
    $("import-prev").addEventListener("click",()=>this.showBatch(this.batch-1));
    $("import-next").addEventListener("click",()=>this.showBatch(this.batch+1));
    $("import-all").addEventListener("click",()=>{for(const item of this.visible||[])this.selected.add(item.key);this.refreshChecks();});
    $("import-none").addEventListener("click",()=>{this.selected.clear();this.refreshChecks();});
    $("import-add").addEventListener("click",()=>this.reviewMode?this.commit():this.prepareReview());
    $("title-review-back").addEventListener("click",()=>{if(this.reviewing)return;this.setReviewMode(false);this.showBatch(this.batch);});
    $("title-confirm-all").addEventListener("click",()=>{if(this.reviewing)return;for(const item of this.items.filter(item=>this.selected.has(item.key))){if(!this.canApprove(item))continue;item.meta.confirmed=true;item.meta.confirmedAt=Date.now();}this.renderReview();});
  }
  currentProject(){const current=this.getProject?.()||this.project;if(current.id!==this.project.id)throw Error("โครงการเปลี่ยนระหว่างนำเข้า");return current;}
  progress(text,value,max){
    $("import-progress-text").textContent=text;
    const bar=$("import-progress");if(max){bar.max=max;bar.value=value;}else bar.removeAttribute("value");
  }
  report(text){const p=document.createElement("p");p.textContent=text;$("import-errors").append(p);
 let panel=document.getElementById('queue-import-errors');if(!panel){panel=document.createElement('div');panel.id='queue-import-errors';panel.setAttribute('role','alert');$('ocr-queue').append(panel);}const line=document.createElement('p');line.textContent=text;panel.append(line);}
  async open(files,p){
    if(this.controller)return;
    $("region-summary").textContent="ยังไม่กำหนดกรอบ";this.project=p;this.documents=[];this.selected.clear();this.batch=0;
    this.reviewing=false;this.setReviewMode(false);this.titleReader=new TitleBlockReader(text=>this.progress(text));
    this.controller=new AbortController();const signal=this.controller.signal;
    this.onBusy(true);$("import-errors").replaceChildren();$("thumbnail-grid").replaceChildren();
    $("import-add").disabled=true;$("import-cancel").disabled=false;
    $("import-dialog").showModal();
    try{
      if(files.length>10||files.reduce((s,f)=>s+f.size,0)>200*1024*1024)throw Error("เลือกได้ครั้งละไม่เกิน 10 ไฟล์ รวมไม่เกิน 200 MB");
      const known=new Set();
      for(let i=0;i<files.length;i++){
        const file=files[i];check(signal);this.progress("ตรวจไฟล์ "+(i+1)+"/"+files.length+" · "+file.name,i,files.length);
        try{
          const type=await typeOfFile(file),id=await hash(file);check(signal);
          if(known.has(id)){this.report(file.name+" — ไฟล์ซ้ำในชุดที่เลือก");continue;}
          known.add(id);
          if(type==="pdf"){
            const pdf=await loadPdf(file,signal,this.password);
            if(signal.aborted){await pdf.loadingTask.destroy();throw abortError();}
            this.documents.push({file,id,type,pdf,pages:pdf.numPages});
          }else{
            const bitmap=await createImageBitmap(file);
            try{
              check(signal);
              if(bitmap.width*bitmap.height>LIMITS.imagePixels||Math.max(bitmap.width,bitmap.height)>16384)throw Error("ภาพเกิน 24 ล้านพิกเซลหรือด้านยาวเกิน 16,384 px");
              this.documents.push({file,id,type,pages:1,width:bitmap.width,height:bitmap.height});
            }finally{bitmap.close();}
          }
        }catch(e){if(signal.aborted)throw e;this.report(file.name+" — "+e.message);}
      }
      this.items=this.documents.flatMap((doc,di)=>Array.from({length:doc.pages},(_,i)=>({doc,di,page:i+1,key:doc.id+":"+(i+1)})));
      if(!this.items.length){this.progress("ไม่มีไฟล์ที่อ่านได้",0,1);return;}
      await this.showBatch(0);
    }catch(e){if(!signal.aborted)this.report(e.message);}
  }
  async showBatch(index){
    if(!this.controller||!this.items?.length||this.compiling)return;
    const gen=++this.generation,signal=this.controller.signal;this.previewing=true;
    this.batch=Math.max(0,Math.min(Math.ceil(this.items.length/12)-1,index));
    $("import-prev").disabled=this.batch===0;$("import-next").disabled=(this.batch+1)*12>=this.items.length;
    this.visible=this.items.slice(this.batch*12,this.batch*12+12);
    const grid=$("thumbnail-grid");grid.replaceChildren();
    this.progress("สร้างภาพตัวอย่าง",0,this.visible.length);$("import-add").disabled=true;
    for(let i=0;i<this.visible.length;i++){
      const item=this.visible[i];if(signal.aborted||gen!==this.generation)return;
      const label=document.createElement("label");label.className="thumbnail-card";
      const input=document.createElement("input");input.type="checkbox";input.dataset.key=item.key;input.checked=this.selected.has(item.key);
      const duplicate=this.currentProject().layers.some(l=>l.fingerprint===item.doc.id&&l.page===item.page);
      input.disabled=duplicate;label.append(input);
      const title=document.createElement("span");title.textContent=item.doc.file.name+" · หน้า "+item.page+(duplicate?" · มีในงานแล้ว":"");label.append(title);grid.append(label);
      input.addEventListener("change",()=>{input.checked?this.selected.add(item.key):this.selected.delete(item.key);this.refreshChecks();});
      try{
        let c;
        if(item.doc.type==="pdf")c=await pdfCanvas(item.doc.pdf,item.page,true,signal);
        else{
          const bitmap=await createImageBitmap(item.doc.file);
          c=document.createElement("canvas");const scale=Math.min(220/bitmap.width,160/bitmap.height);
          c.width=Math.ceil(bitmap.width*scale);c.height=Math.ceil(bitmap.height*scale);c.getContext("2d").drawImage(bitmap,0,0,c.width,c.height);bitmap.close();
        }
        if(signal.aborted||gen!==this.generation)return;
        item.thumbnail=c.toDataURL("image/png");label.prepend(c);
      }catch(e){if(signal.aborted)return;input.disabled=true;this.selected.delete(item.key);this.report(item.doc.file.name+" หน้า "+item.page+" — "+e.message);}
      this.progress("ภาพตัวอย่าง "+(this.batch*12+i+1)+"/"+this.items.length,i+1,this.visible.length);
    }
    this.previewing=false;this.refreshChecks();
  }
  refreshChecks(){
    for(const input of $("thumbnail-grid").querySelectorAll("input")){
      if(input.disabled)this.selected.delete(input.dataset.key);
      input.checked=this.selected.has(input.dataset.key);
    }
    $("import-count").textContent="เลือก "+this.selected.size+" หน้า · ชุด "+(this.batch+1)+"/"+Math.max(1,Math.ceil((this.items?.length||0)/12));
    $("import-add").disabled=!this.selected.size||this.compiling||this.previewing;
  }

  setReviewMode(value){
    document.querySelector(".region-actions").hidden=value;this.reviewMode=value;document.querySelector("#import-dialog .import-heading h2").textContent=value?"Review sheets · ตรวจแบบ":"เลือกหน้าที่ต้องการนำเข้า";$("review-to-queue").hidden=!value;$("import-dialog").classList.toggle("sheet-review-dialog",value);
    $("title-review").hidden=!value;
    $("thumbnail-grid").hidden=value;
    document.querySelector(".import-selection").hidden=value;
    document.querySelector(".import-fields").hidden=value;
    $("import-prev").hidden=$("import-next").hidden=value;
    $("title-review-back").hidden=!value;
    $("import-add").textContent=value?"นำเข้าหน้าที่ยืนยันแล้ว":"อ่าน Title Block และตรวจชื่อ";
  }

  showQueue(){
    $("import-dialog").close();$("ocr-queue").hidden=false;document.querySelector('[data-workspace-view="register"]').click();this.renderQueue();
  }
  openSheet(key){
    if(!this.items.find(i=>i.key===key)?.meta)return;
    this.reviewKey=key;if(!$("import-dialog").open)$("import-dialog").showModal();this.renderReview();
  }
  renderQueue(){
    const grid=$("ocr-queue-grid");grid.replaceChildren();
    const chosen=(this.items||[]).filter(i=>this.selected.has(i.key));
    let ready=0,duplicates=0;
    for(const item of chosen){
      const m=item.meta,c=conflicts(item,this.items,this.selected,this.currentProject().layers);
      const duplicate=m&&(c.duplicates.length||c.incoming.length);if(m)ready++;if(duplicate)duplicates++;
      const card=document.createElement("button");card.className="ocr-sheet-card";card.disabled=!m;
      const img=document.createElement("img");img.src=item.thumbnail||m?.previewUrl||"";img.alt=item.doc.file.name+" หน้า "+item.page;if(img.getAttribute("src"))card.append(img);
      const name=document.createElement("strong");name.textContent=m?.number||item.doc.file.name+" · "+item.page;
      const badge=document.createElement("span");badge.className="sheet-badge "+(!m?"processing":m.confirmed?"confirmed":duplicate?"conflict":"pending");
      badge.textContent=!m?(item.reading?"◌ กำลัง OCR":"◌ รอ OCR"):m.confirmed?"✓ ยืนยันแล้ว":duplicate?"⚠ Version conflict":"⚠ รอตรวจชื่อ";
      card.append(name,badge);card.addEventListener("click",()=>this.openSheet(item.key));grid.append(card);
    }
    $("ocr-queue-status").textContent="อ่านแล้ว "+ready+"/"+chosen.length+" · เลขแบบและ Revision ซ้ำ "+duplicates+" · รอยืนยัน "+chosen.filter(i=>i.meta&&!i.meta.confirmed).length;
    $("ocr-queue-commit").disabled=this.compiling||!chosen.some(i=>i.meta?.confirmed&&this.canApprove(i));
    $("ocr-queue-confirm").disabled=this.reviewing;
  }

  canApprove(item){
    if(!item.meta?.title.trim())return false;const c=conflicts(item,this.items,this.selected,this.currentProject().layers);
    return !c.incoming.length&&!c.duplicates.length;
  }
  reviewStatus(){
    const chosen=(this.items||[]).filter(item=>this.selected.has(item.key));
    const count=chosen.filter(item=>item.meta?.confirmed&&this.canApprove(item)).length;
    $("title-review-count").textContent="ยืนยัน "+count+" / "+chosen.length+" หน้า · ตรวจเลขแบบซ้ำกับงานปัจจุบันก่อนยืนยัน";
    $("title-confirm-all").disabled=this.reviewing||!chosen.length||chosen.some(item=>!item.meta?.title.trim());
    $("import-add").disabled=this.compiling||!count;
  }
  renderReview(){
    this.renderQueue();
    if(this.reviewing&&(!$("import-dialog").open||document.activeElement?.matches("#title-review-list input")))return;
    let picker=$("review-sheet-picker");if(!picker){picker=document.createElement("select");picker.id="review-sheet-picker";picker.setAttribute("aria-label","เลือกแผ่นที่ต้องการตรวจ");$("title-review-list").before(picker);picker.addEventListener("change",()=>this.openSheet(picker.value));}picker.replaceChildren();for(const i of this.items.filter(i=>this.selected.has(i.key)&&i.meta))picker.add(new Option(i.doc.file.name+" · หน้า "+i.page,i.key));picker.value=this.reviewKey||picker.options[0]?.value||"";
    const list=$("title-review-list");list.replaceChildren();
    for(const item of this.items.filter(item=>this.selected.has(item.key)&&(!this.reviewKey||item.key===this.reviewKey))){
      const m=item.meta;if(!m){const waiting=document.createElement("article");waiting.className="title-review-card";waiting.textContent=item.doc.file.name+" · หน้า "+item.page+" · "+(item.reading?"กำลังอ่าน / ตรวจเลขแบบ":"รออ่าน");if(item.thumbnail){const img=document.createElement("img");img.src=item.thumbnail;img.alt="หน้าที่รอตรวจ";waiting.append(img);}list.append(waiting);continue;}
      const row=document.createElement("article");row.className="title-review-card";row.dataset.page=String(item.page);
      const visual=document.createElement("div");
      const heading=document.createElement("strong");heading.textContent=item.doc.file.name+" · หน้า "+item.page;visual.append(heading);
      
      const previewFields=[["number","เลขแบบ"],["revision","ครั้งที่แก้ไข / Revision"],["revisionDate","วันที่แก้ไข"],["title","ชื่อแบบ"]];
      const previews=document.createElement("div");previews.className="field-previews";
      for(const [key,label] of previewFields){
        const figure=document.createElement("figure");figure.dataset.previewField=key;
        const caption=document.createElement("figcaption");caption.textContent=label;figure.append(caption);
        if(m.previews?.[key]){const image=document.createElement("img");image.src=m.previews[key];image.alt=label+" · ภาพพื้นที่อ่าน หน้า "+item.page;figure.append(image);}
        else{const unavailable=document.createElement("p");unavailable.className="hint";unavailable.textContent="ไม่ได้กำหนดกรอบภาพสำหรับช่องนี้";figure.append(unavailable);}
        if(m.quality?.[key]){const note=document.createElement("small");note.textContent=m.quality[key];figure.append(note);}
        previews.append(figure);
      }
      visual.append(previews);
      if(!m.previews&&m.previewUrl){const image=document.createElement("img");image.src=m.previewUrl;image.alt="ภาพรวม Title Block หน้า "+item.page;visual.append(image);}

      const note=document.createElement("p");note.className="hint";note.textContent=m.note;visual.append(note);
      if(item.regionTemplate?.regions?.revisionTable){
       const retry=document.createElement('button');retry.textContent='อ่านตารางนี้ซ้ำ · R7';retry.className='retry-revision-table';retry.disabled=this.reviewing||this.compiling;
       retry.addEventListener('click',async()=>{
        if(this.reviewing||this.compiling||!this.controller)return;this.compiling=true;retry.disabled=true;
        const reader=new TitleBlockReader(text=>{retry.textContent=text;});
        try{const found=await readRegions(item,{...item.regionTemplate,regions:{revisionTable:item.regionTemplate.regions.revisionTable}},reader,this.controller.signal);
         m.revision=found.fields.revision||'';m.revisionDate=found.fields.revisionDate||'';m.revisionHistory=found.revisionHistory||[];m.confirmed=false;
         m.previews={...m.previews,...found.previews};m.quality={...m.quality,...found.quality};
        }catch(e){if(e.name!=='AbortError')this.report(e.message);}finally{reader.stop();this.compiling=false;if(this.controller){this.renderReview();this.renderQueue();}}
       });visual.append(retry);
      }
      const fields=document.createElement("div");fields.className="title-review-fields";
      const summary=document.createElement("output");summary.className="title-review-name";
      const state=document.createElement("span");state.className="title-review-state";
      const approve=document.createElement("button");approve.type="button";approve.className="confirm-title";
      const newHeading=document.createElement("h3");newHeading.textContent="New sheet";fields.prepend(newHeading);
      const conflictPanel=document.createElement("div");conflictPanel.className="version-conflict";
      const refresh=()=>{
        const c=conflicts(item,this.items,this.selected,this.currentProject().layers);
        conflictPanel.replaceChildren();const existingHeading=document.createElement("h3");existingHeading.textContent="Existing sheet";conflictPanel.append(existingHeading);
        const info=document.createElement("p");info.textContent=c.incoming.length?"เลขแบบและ Revision ซ้ำกับหน้าอื่นในชุดนี้ · แก้ Revision หรือข้ามหน้า":c.duplicates.length?"เลขแบบและ Revision นี้มีอยู่แล้ว · ห้ามนำเข้าซ้ำ แม้เลือกแบบเดิม":c.existing.length?"พบเลขแบบเดิม "+c.existing.length+" เวอร์ชัน · ตรวจเทียบก่อนเพิ่ม":"ไม่พบเลขแบบซ้ำในงานนี้";conflictPanel.append(info);
        if(c.existing.length){const choose=document.createElement("select");choose.className="version-parent";choose.setAttribute("aria-label","เลือกแบบเดิมเพื่อเพิ่มเป็นเวอร์ชันใหม่");choose.add(new Option("เลือกแบบเดิมเพื่อเพิ่มเป็นเวอร์ชันใหม่",""));for(const old of c.existing)choose.add(new Option(old.name+" · "+(old.revisionDate||"ไม่ระบุวันที่"),old.id));choose.value=m.versionOf||"";choose.addEventListener("change",()=>{m.versionOf=choose.value;m.confirmed=false;refresh();});conflictPanel.append(choose);const old=c.existing.find(l=>l.id===m.versionOf)||c.existing[0];const oldText=document.createElement("p");oldText.textContent="Sheet Number: "+(old.number||"—")+" · Drawing Title: "+(old.drawingTitle||old.name)+" · Revision "+(old.revision||"ไม่ระบุ")+" · "+(old.revisionDate||"ไม่ระบุวันที่")+" — เก็บแบบเดิมไว้";conflictPanel.append(oldText);for(const [label,value] of [["Sheet Number",old.number],["Drawing Title",old.drawingTitle||old.name],["วันที่ Revision",old.revisionDate],["ครั้งที่ Revision",old.revision]]){const field=document.createElement("label");field.textContent=label;const input=document.createElement("input");input.readOnly=true;input.value=value||"ไม่ระบุ";field.append(input);conflictPanel.append(field);}const url=this.preview?.(old);if(url){const img=document.createElement("img");img.src=url;img.alt="แบบเดิมที่เคยนำเข้า";conflictPanel.append(img);}}
        summary.textContent=displayName(m);
        state.textContent=m.confirmed?"✓ ยืนยันแล้ว":"รอยืนยัน";
        approve.textContent=m.confirmed?"ยืนยันแล้ว":"ยืนยันชื่อนี้";
        approve.disabled=m.confirmed||!this.canApprove(item);
        row.classList.toggle("confirmed",!!m.confirmed);
        this.reviewStatus();this.renderQueue();const single=row.querySelector(".import-one-sheet");if(single)single.disabled=!this.canApprove(item)||this.compiling;
      };
      for(const [field,labelText,max] of [["number","เลขแบบ",60],["revision","ครั้งที่แก้ไข / Revision",40],["revisionDate","วันที่แก้ไข",60],["title","ชื่อแบบ",180]]){
        const label=document.createElement("label");label.textContent=labelText;
        const input=document.createElement("input");input.type="text";input.className="review-"+field;input.value=m[field]||"";input.maxLength=max;
        input.placeholder=field==="revisionDate"?"ไม่พบวันที่แก้ไข / กรอกตามตาราง":field==="revision"?"ไม่พบ / ไม่ระบุ":field==="number"?"ไม่พบเลขแบบ กรุณาตรวจ":"กรอกชื่อแบบ";
        input.addEventListener("input",()=>{m[field]=input.value;if(field==="number")m.versionOf="";m.confirmed=false;m.confirmedAt=null;refresh();});
        if(field==="number")input.addEventListener("change",()=>this.renderReview());label.append(input);fields.append(label);
      }
      approve.addEventListener("click",()=>{if(!this.canApprove(item))return;m.confirmed=true;m.confirmedAt=Date.now();refresh();});
      const skip=document.createElement("button");skip.textContent="ข้ามหน้านี้";skip.className="skip-import-page";skip.disabled=this.reviewing;skip.addEventListener("click",()=>{this.selected.delete(item.key);this.renderReview();});
      const importOne=document.createElement("button");importOne.className="import-one-sheet primary";importOne.textContent="ยืนยันและนำเข้าแผ่นนี้";importOne.disabled=!this.canApprove(item)||this.compiling;importOne.addEventListener("click",()=>{if(!this.canApprove(item))return;m.confirmed=true;m.confirmedAt=Date.now();this.commit(item.key);});
      fields.append(summary,state,approve,importOne,skip);row.append(visual,fields,conflictPanel);list.append(row);refresh();
    }
    this.reviewStatus();
  }
  async prepareReview(){
    if(!this.controller||this.reviewing||this.compiling)return;
    const chosen=this.items.filter(item=>this.selected.has(item.key));
    if(!chosen.length)return;
    if(chosen.length+this.currentProject().layers.length>LIMITS.layers){this.report("เลือกแผ่นเกินขีดจำกัด 24 แผ่นต่อหนึ่งงาน");return;}
    this.reviewKey=null;this.reviewing=true;this.setReviewMode(true);this.showQueue();$("title-skip-ocr").hidden=false;$("title-skip-ocr").disabled=false;
    $("title-review-back").disabled=true;$("title-confirm-all").disabled=true;$("import-add").disabled=true;
    $("title-review-list").replaceChildren();
    const signal=this.controller.signal;
    try{
      for(let i=0;i<chosen.length;i++){
        check(signal);const item=chosen[i];if(!this.selected.has(item.key)||item.meta)continue;item.reading=true;this.renderReview();
        this.progress("อ่าน Title Block · หน้า "+(i+1)+"/"+chosen.length+" · "+item.doc.file.name,i,chosen.length);
        let c,found;
        try{
          if(item.regionTemplate){found=await readRegions(item,item.regionTemplate,this.titleReader,signal);}
          else {
          if(item.doc.type==="pdf")c=await pdfCanvas(item.doc.pdf,item.page,false,signal);
          else{const bitmap=await createImageBitmap(item.doc.file);try{c=document.createElement("canvas");c.width=bitmap.width;c.height=bitmap.height;c.getContext("2d").drawImage(bitmap,0,0);}finally{bitmap.close();}}
          check(signal);
          item.preparedBlob=item.doc.type==="pdf"?await toBlob(c):item.doc.file;
          found=await this.titleReader.read(item,c,signal);
          }
        }catch(e){
          if(signal.aborted)throw e;
          found={fields:{},quality:{},method:"อ่านอัตโนมัติไม่สำเร็จ",region:null};
          this.report(item.doc.file.name+" หน้า "+item.page+" — "+e.message+" · ยังแก้ชื่อและยืนยันเองได้");
        }finally{if(c)c.width=c.height=0;}
        check(signal);
        const missing=["number","title","revision"].filter(key=>!found.fields[key]);
        item.meta={
          number:found.fields.number||$("import-number").value.trim(),
          revisionDate:found.fields.revisionDate||"",revisionHistory:found.revisionHistory||[],
          revision:item.regionTemplate?.regions?.revisionTable?(found.fields.revision||""):(found.fields.revision||$("import-revision").value.trim()||"0"),
          title:found.fields.title||(item.doc.file.name.replace(/\.[^.]+$/,"")+(item.doc.pages>1?" หน้า "+item.page:"")),
          elapsedMs:found.elapsedMs,method:found.method,region:found.region,quality:found.quality,previewUrl:found.previewUrl,previews:found.previews,
          note:(found.numberCandidates?.length?"ผลเลขแบบขัดกัน: "+found.numberCandidates.join(" / ")+" · ":"")+found.method+(found.elapsedMs?" · "+(found.elapsedMs/1000).toFixed(1)+" วินาที":"")+" · "+(found.region?.name||"ไม่พบบริเวณชัดเจน")+
            (missing.length?" · ต้องตรวจ: "+missing.map(key=>({number:"เลขแบบ",title:"ชื่อแบบ (ใช้ชื่อไฟล์ชั่วคราว)",revision:"Revision"}[key])).join(", "):" · โปรดตรวจเทียบภาพก่อนยืนยัน"),
          confirmed:false,confirmedAt:null
        };
        this.renderReview();await new Promise(resolve=>setTimeout(resolve,0));
      }
      check(signal);this.progress("อ่านครบแล้ว · ตรวจและยืนยันชื่อก่อนนำเข้า",chosen.length,chosen.length);
    }catch(e){if(!signal.aborted)this.report(e.message);}
    finally{
      this.reviewing=false;$("title-skip-ocr").hidden=true;
      if(this.controller&&!signal.aborted){$("title-review-back").disabled=false;this.renderReview();if(!this.selected.size&&!this.compiling)await this.close();}
    }
  }

  async commit(onlyKey=null){
    if(!this.controller||this.compiling)return;
    const approved=this.items.filter(item=>this.selected.has(item.key)&&(!onlyKey||item.key===onlyKey)&&item.meta?.confirmed&&this.canApprove(item));
    if(!approved.length||approved.some(item=>!item.meta?.confirmed||!this.canApprove(item))){this.report("กรุณายืนยันชื่อทุกหน้าที่เลือกก่อนนำเข้า");return;}
    this.compiling=true;$("import-add").disabled=true;const signal=this.controller.signal;
    $("import-prev").disabled=$("import-next").disabled=$("import-all").disabled=$("import-none").disabled=true;
    try{
      const chosen=approved;
      if(chosen.length+this.currentProject().layers.length>LIMITS.layers)throw Error("งานหนึ่งมีได้ไม่เกิน 24 แผ่น กรุณาเลือกให้น้อยลง");
      let pixels=this.currentProject().layers.reduce((s,l)=>s+l.width*l.height,0);
      const result=[],assets=new Map(),successful=[],failures=[];
      for(let i=0;i<chosen.length;i++){
        check(signal);const item=chosen[i];this.progress("เตรียมแผ่น "+(i+1)+"/"+chosen.length+" · "+item.doc.file.name,i,chosen.length);
        let c;
        try{
          if(item.preparedBlob){const bitmap=await createImageBitmap(item.preparedBlob);try{c=document.createElement("canvas");c.width=bitmap.width;c.height=bitmap.height;c.getContext("2d").drawImage(bitmap,0,0);}finally{bitmap.close();}}
          else if(item.doc.type==="pdf")c=await pdfCanvas(item.doc.pdf,item.page,false,signal);
          else{
            const bitmap=await createImageBitmap(item.doc.file);c=document.createElement("canvas");c.width=bitmap.width;c.height=bitmap.height;c.getContext("2d").drawImage(bitmap,0,0);bitmap.close();
          }
          const available=Math.floor((LIMITS.pixels-pixels)/(chosen.length-i));
          if(available<1000000)throw Error('พื้นที่ภาพในงานเหลือไม่พอ: ใช้ '+(pixels/1000000).toFixed(1)+' / 64 ล้านพิกเซล · กรุณาแยกงานหรือลบแผ่นที่ไม่ใช้');
          let resized=false;
          if(c.width*c.height>available){const ratio=Math.sqrt(available/(c.width*c.height)),scaled=document.createElement('canvas');scaled.width=Math.max(1,Math.floor(c.width*ratio));scaled.height=Math.max(1,Math.floor(c.height*ratio));scaled.getContext('2d').drawImage(c,0,0,scaled.width,scaled.height);c.width=c.height=0;c=scaled;resized=true;}

          const assetId=(item.doc.type==="pdf"||resized)?item.key+":raster-v1":item.doc.id;
          const blob=resized?await toBlob(c):(item.preparedBlob||(item.doc.type==="pdf"?await toBlob(c):item.doc.file));check(signal);
          assets.set(assetId,blob);assets.set(item.doc.id,item.doc.file);
          result.push({versionOf:item.meta.versionOf||conflicts(item,this.items,this.selected,this.currentProject().layers).existing[0]?.id||null,importedAt:Date.now(),name:displayName(item.meta),drawingTitle:item.meta.title.trim(),originalName:item.doc.file.name,
            titleBlock:{method:item.meta.method,region:item.meta.region,quality:item.meta.quality,confirmed:true,confirmedAt:item.meta.confirmedAt},page:item.page,pageCount:item.doc.pages,fingerprint:item.doc.id,
            sourceId:item.doc.id,assetId,width:c.width,height:c.height,discipline:$("import-discipline").value,
            revisionDate:(item.meta.revisionDate||"").trim(),revisionHistory:item.meta.revisionHistory||[],number:item.meta.number.trim(),revision:item.meta.revision.trim()});
          successful.push(item.key);pixels+=c.width*c.height;
        }catch(e){if(signal.aborted)throw e;failures.push(item.doc.file.name+" หน้า "+item.page+" — "+e.message);this.report(failures.at(-1));}
        finally{if(c)c.width=c.height=0;}
      }
      check(signal);
      if(!result.length)throw Error(failures[0]||"ไม่มีหน้าที่พร้อมนำเข้า กรุณาตรวจข้อความข้อผิดพลาด");
      this.committing=true;$("import-cancel").disabled=true;await this.onCommit(result,assets);for(const key of successful)this.selected.delete(key);this.reviewKey=null;if(!this.selected.size&&!this.reviewing)await this.close();else this.showQueue();
    }catch(e){if(!signal.aborted){this.report(e.message);this.onError(e);}}
    finally{this.committing=false;$("import-cancel").disabled=false;this.compiling=false;$("import-all").disabled=$("import-none").disabled=false;if(this.controller){if(this.reviewMode){this.reviewStatus();this.renderQueue();}else this.refreshChecks();}}
  }
  async cancel(){if(this.committing)return;this.controller?.abort();await this.close();}
  async close(){
    $("ocr-queue").hidden=true;this.reviewKey=null;this.generation++;this.controller?.abort();this.controller=null;this.titleReader?.stop();
    $("import-dialog").close();this.onBusy(false);
    const docs=this.documents;this.documents=[];this.items=[];this.selected.clear();
    for(const d of docs)if(d.pdf)await d.pdf.loadingTask.destroy().catch(()=>{});
  }
}
