import {locateTitleBlock,pdfBoxes,groupLines} from "./title-block-parser.mjs";
const aborted=()=>new DOMException("ยกเลิกการอ่าน Title Block","AbortError");
function ensure(signal){if(signal.aborted)throw aborted();}
function crop(canvas,region,max=1500){
 const x=Math.max(0,region.x*canvas.width),y=Math.max(0,region.y*canvas.height),w=Math.min(canvas.width-x,region.w*canvas.width),h=Math.min(canvas.height-y,region.h*canvas.height);
 const c=document.createElement("canvas"),scale=Math.min(2,max/Math.max(w,h));c.width=Math.max(1,Math.round(w*scale));c.height=Math.max(1,Math.round(h*scale));
 const ctx=c.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(canvas,x,y,w,h,0,0,c.width,c.height);return c;
}

function removeTableRules(source){
 const c=document.createElement("canvas");c.width=source.width;c.height=source.height;
 const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(source,0,0);
 const im=x.getImageData(0,0,c.width,c.height),d=im.data,w=c.width,h=c.height;
 const dark=(a,b)=>{const i=(b*w+a)*4;return d[i+3]>128&&(d[i]+d[i+1]+d[i+2])<660;};
 const erase=[];
 for(let y=0;y<h;y++){let start=-1;for(let a=0;a<=w;a++){if(a<w&&dark(a,y)){if(start<0)start=a;}else if(start>=0){if(a-start>w*.25)erase.push([start,y,a,y+1]);start=-1;}}}
 for(let a=0;a<w;a++){let start=-1;for(let y=0;y<=h;y++){if(y<h&&dark(a,y)){if(start<0)start=y;}else if(start>=0){if(y-start>h*.3)erase.push([a,start,a+1,y]);start=-1;}}}
 for(const [a,b,right,bottom] of erase)for(let y=b;y<bottom;y++)for(let col=a;col<right;col++){const i=(y*w+col)*4;d[i]=d[i+1]=d[i+2]=255;}
 x.putImageData(im,0,0);return c;
}

export class TitleBlockReader{
 constructor(progress){this.progress=progress;this.worker=null;this.pending=null;this.closed=false;this.layout=null;}
 async getWorker(signal){
   if(this.closed)throw Error("หยุด OCR แล้ว · กรุณากรอกชื่อเอง");
   if(this.worker)return this.worker;
   if(!this.pending)this.pending=(async()=>{
     const {default:Tesseract}=await import("./vendor/ocr/tesseract.esm.min.js"); const {createWorker}=Tesseract;ensure(signal);
     const worker=await createWorker(["eng","tha"],1,{
       workerPath:new URL("./vendor/ocr/worker.min.js",import.meta.url).href,
       corePath:new URL("./vendor/ocr/core/",import.meta.url).href,
       langPath:new URL("./vendor/ocr/lang",import.meta.url).href.replace(/\/$/,""),
       workerBlobURL:false,gzip:false,cacheMethod:"none",
       logger:m=>{if(!this.closed&&m.status==="recognizing text")this.progress(m.progress>=1?"OCR อ่านข้อความแล้ว · กำลังจัดเตรียมผล":"OCR "+Math.round(m.progress*100)+"%");}
     });
     if(this.closed||signal.aborted){await worker.terminate();throw aborted();}
     this.worker=worker;await worker.setParameters({tessedit_pageseg_mode:"11"});return worker;
   })();
   return this.pending;
 }
 async ocr(canvas,signal,numberOnly=false,raw=false){
   const operation=(async()=>{
     const worker=await this.getWorker(signal);ensure(signal);
     const language=numberOnly==="thai"?"tha":"eng+tha";if((this.language||"eng+tha")!==language){await worker.reinitialize(language);this.language=language;}if(numberOnly==="thai")numberOnly=false;
     await worker.setParameters({tessedit_pageseg_mode:numberOnly&&!raw?"6":"11",tessedit_char_whitelist:numberOnly?"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-./ ":""});ensure(signal);
     const prepared=raw?crop(canvas,{x:0,y:0,w:1,h:1},2400):removeTableRules(canvas);const ocrWidth=prepared.width,ocrHeight=prepared.height;let data;try{({data}=await worker.recognize(prepared,{}, {text:true,blocks:true}));}finally{prepared.width=prepared.height=0;}ensure(signal);
     const words=[];
     for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[])for(const word of line.words||[]){
       if(!numberOnly&&word.confidence<25&&!/[ก-๙]/.test(word.text)&&!/^\d{1,4}$/.test(word.text))continue;
       const b=word.bbox;words.push({text:word.text,x:b.x0/ocrWidth,y:(line.bbox?.y0??b.y0)/ocrHeight,w:(b.x1-b.x0)/ocrWidth,h:((line.bbox?.y1??b.y1)-(line.bbox?.y0??b.y0))/ocrHeight});
     }
     return words;
   })();
   let cancel;
   const stopped=new Promise((_,reject)=>{cancel=()=>{this.stop();reject(aborted());};signal.addEventListener("abort",cancel,{once:true});if(signal.aborted)cancel();});
   const skipped=new Promise((_,reject)=>{this.skip=()=>{this.stop();reject(Error("หยุด OCR · กรุณาตรวจและกรอกชื่อเอง"));};});
   try{return await Promise.race([operation,stopped,skipped]);}finally{this.skip=null;signal.removeEventListener("abort",cancel);}
 }
 async read(item,canvas,signal){
   ensure(signal);const started=performance.now();let best=null,method="PDF text",textBoxes=[],numberEvidence=[];
   if(item.doc.type==="pdf"){
     const page=await item.doc.pdf.getPage(item.page);
     try{const text=await page.getTextContent();ensure(signal);textBoxes=pdfBoxes(text.items,page.getViewport({scale:1}));best=locateTitleBlock(textBoxes);numberEvidence=textBoxes;}
     finally{page.cleanup();}
   }
   if(!best?.fields.number||!best?.fields.title||(!best?.fields.revisionDate&&textBoxes.some(b=>/DESCRIPTION|รายละเอียด/i.test(b.text))&&textBoxes.some(b=>/REVISION|R\s+E\s+V|การแก้ไข/i.test(b.text)))){
     const anchors=textBoxes.filter(b=>/DRAWING|DRWAING|DWG|ชื่อแบบ|หมายเลขแบบ|REVISION|R\s+E\s+V|การแก้ไข/i.test(b.text));
     let targeted=null;
     if(anchors.length){const left=Math.max(0,Math.min(...anchors.map(b=>b.x))-.03),top=Math.max(0,Math.min(...anchors.map(b=>b.y))-.25);targeted={x:left,y:top,w:1-left,h:1-top};}
     const areas=[targeted||this.layout||{x:.48,y:.48,w:.52,h:.52},{x:0,y:.7,w:1,h:.3},{x:.7,y:0,w:.3,h:1},{x:0,y:0,w:1,h:1}];
     for(let i=0;i<areas.length;i++){
       ensure(signal);this.progress("ค้นหา Title Block ด้วย OCR · บริเวณ "+(i+1)+"/"+areas.length);
       const area=areas[i],image=crop(canvas,area,i===3?3000:2000);
       try{
         const words=await this.ocr(image,signal);
         const boxes=words.map(b=>({...b,x:area.x+b.x*area.w,y:area.y+b.y*area.h,w:b.w*area.w,h:b.h*area.h}));
         this.progress("จัดข้อมูล Title Block · บริเวณ "+(i+1));
         await new Promise(resolve=>setTimeout(resolve,0));ensure(signal);
         const result=locateTitleBlock(boxes);if(drawingNumberRegions(boxes).length)numberEvidence=boxes;
         best=mergeReadings(best,result);method=textBoxes.length?"PDF text + OCR":"OCR ไทย/อังกฤษ";
         if(best.fields.number&&best.fields.title)break;
       }finally{image.width=image.height=0;}
     }
   }
   ensure(signal);
   best ||= locateTitleBlock([]);

   if(!this.closed&&method!=="PDF text"){
     const regions=drawingNumberRegions(numberEvidence),readings=[];
     for(const region of regions){ensure(signal);this.progress("ตรวจเลขแบบเฉพาะช่อง Drawing No.");const image=crop(canvas,region,1800);try{readings.push(...numberCandidates(await this.ocr(image,signal,true)));}finally{image.width=image.height=0;}}
     const candidates=[...new Set(readings)];
     if(candidates.length===1&&!best.fields.number){best.fields.number=candidates[0];best.quality.number="อ่านเฉพาะช่อง Drawing No. · ตรวจยืนยัน";}
     else if(candidates.length&&(!candidates.includes(best.fields.number)||candidates.length>1)){best.numberCandidates=[...new Set([best.fields.number,...candidates].filter(Boolean))];best.fields.number="";best.quality.number="ผลอ่านขัดกัน · เลือกตรวจเลขแบบเอง";}
   }
   const preview=crop(canvas,best.region,900),previewUrl=preview.toDataURL("image/png");preview.width=preview.height=0;
   if(best.fields.number&&best.fields.title)this.layout={x:Math.max(0,best.region.x-.03),y:Math.max(0,best.region.y-.25),w:1-Math.max(0,best.region.x-.03),h:1-Math.max(0,best.region.y-.25)};
   return {...best,method,previewUrl,elapsedMs:Math.round(performance.now()-started)};
 }
 stop(){this.closed=true;if(this.worker){this.worker.terminate().catch(()=>{});this.worker=null;}}
}

export function mergeReadings(previous,next){
 if(!previous)return next;
 const merged={...previous,fields:{...previous.fields},quality:{...previous.quality}};
 let added=false;
 for(const key of ["number","title","revision","revisionDate"]){
   if(!merged.fields[key]&&next.fields[key]){merged.fields[key]=next.fields[key];merged.quality[key]=next.quality?.[key];added=true;}
 }
 if(next.revisionHistory?.length&&!previous.revisionHistory?.length){
   merged.revisionHistory=next.revisionHistory;merged.fields.revision=next.fields.revision;merged.fields.revisionDate=next.fields.revisionDate;added=true;
 }
 if(added&&next.region&&previous.region){
   const a=previous.region,b=next.region,x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
   merged.region={name:"บริเวณที่อ่านข้อมูล",x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};
 }
 merged.score=(merged.fields.number?4:0)+(merged.fields.title?4:0)+(merged.fields.revision?1:0);
 return merged;
}

export function drawingNumberRegions(boxes){
 const lines=groupLines(boxes);
 return lines.filter(b=>/^(?:DRA(?:WING|IWNG)|DRWAING|DWG|DRG|SHEET)\.?\s*(?:NO\.?|NUMBER|#)|^(?:เลขที่แบบ|หมายเลขแบบ|รหัสแบบ)/i.test(b.text)).slice(0,2).map(b=>{
  const x=Math.max(0,b.x-.01),y=Math.max(0,b.y+b.h*.85),w=Math.min(1-x,Math.max(b.w*2,.18)),h=Math.min(1-y,Math.max(b.h*4,.055));
  return {x,y,w,h};
 });
}
export function numberCandidates(boxes){
 return [...new Set(groupLines(boxes).map(b=>b.text.toUpperCase().replace(/[–—−]/g,"-").replace(/\s*-\s*/g,"-").replace(/-{2,}/g,"-").trim()).filter(s=>/^[A-Z]{1,6}(?:[-./][A-Z0-9]{1,12}){1,4}$/.test(s)&&/\d/.test(s)))];
}
