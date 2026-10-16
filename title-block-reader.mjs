import {locateTitleBlock,pdfBoxes,groupLines} from "./title-block-parser.mjs";
import {regionImage,readTitleImage,titleReading,titleIsReadable,inRegion,drawingCodes} from "./regions.mjs";
import {completeReview} from './ocr-review.mjs';
const aborted=()=>new DOMException("ยกเลิกการอ่าน Title Block","AbortError");
function ensure(signal){if(signal.aborted)throw aborted();}
function evidenceRegion(boxes,pad=.004){
 const x=Math.max(0,Math.min(...boxes.map(box=>box.x))-pad),y=Math.max(0,Math.min(...boxes.map(box=>box.y))-pad);
 return {x,y,w:Math.min(1,Math.max(...boxes.map(box=>box.x+box.w))+pad)-x,h:Math.min(1,Math.max(...boxes.map(box=>box.y+box.h))+pad)-y};
}
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
 async ocr(canvas,signal,numberOnly=false,raw=false,options={}){
   const operation=(async()=>{
     const worker=await this.getWorker(signal);ensure(signal);
     const language=numberOnly==="thai"?"tha":numberOnly==="english"||numberOnly===true?"eng":"eng+tha";if((this.language||"eng+tha")!==language){await worker.reinitialize(language);this.language=language;}if(numberOnly==="thai"||numberOnly==="english")numberOnly=false;
     const psm=[6,7,11,13].includes(options.psm)?String(options.psm):numberOnly&&!raw?"6":"11";
     await worker.setParameters({tessedit_pageseg_mode:psm,tessedit_char_whitelist:numberOnly?"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-./ ":""});ensure(signal);
     const prepared=raw?crop(canvas,{x:0,y:0,w:1,h:1},2400):removeTableRules(canvas);const ocrWidth=prepared.width,ocrHeight=prepared.height;let data;try{({data}=await worker.recognize(prepared,{}, {text:true,blocks:true}));}finally{prepared.width=prepared.height=0;}ensure(signal);
     const words=[];
     for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[])for(const word of line.words||[]){
       if(!numberOnly&&word.confidence<25&&!/[ก-๙]/.test(word.text)&&!/^\d{1,4}$/.test(word.text))continue;
       const b=word.bbox;words.push({text:word.text,confidence:word.confidence,x:b.x0/ocrWidth,y:(line.bbox?.y0??b.y0)/ocrHeight,w:(b.x1-b.x0)/ocrWidth,h:((line.bbox?.y1??b.y1)-(line.bbox?.y0??b.y0))/ocrHeight});
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

   if(!this.closed){
     const regions=best.fieldEvidence?.number?.length?[evidenceRegion(best.fieldEvidence.number)]:drawingNumberRegions(numberEvidence),readings=[];
     for(const region of regions){ensure(signal);this.progress("ตรวจเลขแบบเฉพาะช่อง Drawing No.");const image=await regionImage(item,region,signal);try{readings.push(...numberCandidates(await this.ocr(image,signal,true,true,{psm:6})));best.previews={...best.previews,number:image.toDataURL()};}finally{image.width=image.height=0;}}
     const candidates=[...new Set(readings)];
     if(candidates.length===1&&!best.fields.number){best.fields.number=candidates[0];best.quality.number="อ่านเฉพาะช่อง Drawing No. · ตรวจยืนยัน";}
     else if(candidates.length===1&&candidates[0]===best.fields.number&&method==='PDF text'){best.quality.number='PDF และ OCR ตรงกัน · ตรวจยืนยัน';}
     else if(candidates.length&&(!candidates.includes(best.fields.number)||candidates.length>1)){best.numberCandidates=[...new Set([best.fields.number,...candidates].filter(Boolean))];if(!drawingCodes([{text:best.fields.number,x:0,y:0,w:1,h:.1}]).length)best.fields.number="";best.quality.number="ข้อความ PDF และ OCR ขัดกัน · ตรวจเลขแบบก่อนยืนยัน";best.review={...best.review,number:{value:best.fields.number,source:method==='PDF text'?'ข้อความ PDF ต้นฉบับ':'ผลอ่านในช่องเลขแบบ',status:'check',issues:['เลขแบบจากแต่ละแหล่งไม่ตรงกัน · ตรวจเทียบภาพ'],flagged:[],candidates:best.numberCandidates.map(value=>({value,source:value===best.fields.number?'ค่าที่เลือก':'OCR ภาพ'}))}};}
   }
   if(!this.closed){
     const lines=groupLines(item.doc.type==='pdf'&&textBoxes.length?textBoxes:numberEvidence),label=lines.find(b=>/^(?:(?:DRAWING|SHEET)\s*(?:TITLE|NAME)|ชื่อแบบ)/i.test(b.text));
     if(label){
       this.progress("ตรวจชื่อแบบจากภาพ · ไทย อังกฤษ และตัวเลข");
       const x=Math.max(0,label.x-.01),y=Math.max(0,label.y-.01);
       const next=lines.filter(b=>b.x>=label.x-.015&&b.y>label.y+label.h&&/^(?:DRAWING\s*(?:NO|NUMBER)|DWG\s*NO|REVISION|SCALE|DATE\s*[:：]|หมายเลขแบบ|เลขที่แบบ|มาตราส่วน)/i.test(b.text)).sort((a,b)=>a.y-b.y)[0];
       const bottom=Math.min(1,next?next.y+Math.max(.035,next.h):label.y+Math.max(.22,label.h*10));
       const region={x,y,w:Math.min(1-x,Math.max(.35,label.w*2.5)),h:Math.max(.05,bottom-y)};
       const titleBoxes=best.fieldEvidence?.title;
       const reliablePdf=item.doc.type==='pdf'&&titleIsReadable(best.fields.title)&&!/[ก-๙]|\.{3,}/.test(best.fields.title);
       const titleRegion=reliablePdf&&titleBoxes?.length?evidenceRegion(titleBoxes):region;
       const image=await regionImage(item,titleRegion,signal);
       try{
         const pdfTitle=item.doc.type==='pdf'?(reliablePdf&&titleBoxes?.length?best.fields.title:titleReading(textBoxes.filter(b=>inRegion(b,titleRegion)&&b.y>label.y+label.h*.6&&(!next||b.y<next.y)))):'';
         const valueBoxes=(titleBoxes||[]).filter(box=>!/^\s*(?:DRAWING|SHEET)\s*(?:TITLE|NAME)\b|^ชื่อแบบ/i.test(box.text));
         const pdfWords=valueBoxes.map(box=>({...box,x:(box.x-titleRegion.x)/titleRegion.w,y:(box.y-titleRegion.y)/titleRegion.h,w:box.w/titleRegion.w,h:box.h/titleRegion.h}));
         const picked=await readTitleImage(image,this,signal,pdfTitle,(label.y+label.h-titleRegion.y)/titleRegion.h,pdfWords);
         best.fields.title=picked.value;best.quality.title=picked.source+" · ตรวจเทียบภาพก่อนยืนยัน";
         best.review={...best.review,title:picked.review};best.previews={...best.previews,title:image.toDataURL()};
       }finally{image.width=image.height=0;}
     }
   }
   if(best.fieldEvidence?.revisionTable?.length){
    const tableRegion=evidenceRegion(best.fieldEvidence.revisionTable),image=await regionImage(item,tableRegion,signal);
    try{const ctx=image.getContext('2d'),row=best.revisionHistory?.[0]?.evidence;if(row?.length){const bounds=evidenceRegion(row,.001);ctx.strokeStyle='#22c55e';ctx.lineWidth=3;ctx.strokeRect((bounds.x-tableRegion.x)/tableRegion.w*image.width,(bounds.y-tableRegion.y)/tableRegion.h*image.height,bounds.w/tableRegion.w*image.width,bounds.h/tableRegion.h*image.height);}const preview=image.toDataURL();best.previews={...best.previews,revision:preview,revisionDate:preview};}finally{image.width=image.height=0;}
   }
   const suffix=best.fields.number?.match(/-R(\d+)$/i);
   const revisionNumber=best.fields.revision?.match(/^(?:R(?:EV)?\.?\s*)?(\d+)$/i)?.[1];
   if(suffix&&best.fields.revision&&Number(suffix[1])!==Number(revisionNumber))best.review={...best.review,revision:{value:best.fields.revision,source:'ตาราง Revision',status:'check',issues:['Revision ในตารางไม่ตรงกับท้ายเลขแบบ · ตรวจภาพก่อนยืนยัน'],flagged:[],candidates:[{value:best.fields.revision,source:'ตาราง Revision'},{value:suffix[1],source:'ท้ายเลขแบบ'}]}};
   const preview=crop(canvas,best.region,900),previewUrl=preview.toDataURL("image/png");preview.width=preview.height=0;
   if(best.fields.number&&best.fields.title)this.layout={x:Math.max(0,best.region.x-.03),y:Math.max(0,best.region.y-.25),w:1-Math.max(0,best.region.x-.03),h:1-Math.max(0,best.region.y-.25)};
   return completeReview({...best,method,previewUrl,elapsedMs:Math.round(performance.now()-started)});
 }
 stop(){this.closed=true;if(this.worker){this.worker.terminate().catch(()=>{});this.worker=null;}}
}

export function mergeReadings(previous,next){
 if(!previous)return next;
 const merged={...previous,fields:{...previous.fields},quality:{...previous.quality},fieldEvidence:{...previous.fieldEvidence}};
 let added=false;
 for(const key of ["number","title","revision","revisionDate"]){
   if(!merged.fields[key]&&next.fields[key]){merged.fields[key]=next.fields[key];merged.quality[key]=next.quality?.[key];merged.fieldEvidence[key]=next.fieldEvidence?.[key];added=true;}
 }
 if(next.revisionHistory?.length&&!previous.revisionHistory?.length){
   merged.revisionHistory=next.revisionHistory;merged.fields.revision=next.fields.revision;merged.fields.revisionDate=next.fields.revisionDate;merged.fieldEvidence.revisionTable=next.fieldEvidence?.revisionTable;added=true;
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
 return lines.filter(b=>!/\.{3,}/.test(b.text)&&/^(?:DRA(?:WING|IWNG)|DRWAING|DWG|DRG|SHEET)\.?\s*(?:NO\.?|NUMBER|#)|^(?:เลขที่แบบ|หมายเลขแบบ|รหัสแบบ)/i.test(b.text)).slice(0,2).map(b=>{
  const x=Math.max(0,b.x-.01),y=Math.max(0,b.y-b.h*.6),w=Math.min(1-x,Math.max(b.w*5,.20)),h=Math.min(1-y,Math.max(b.h*5,.055));
  return {x,y,w,h};
 });
}
export function numberCandidates(boxes){
 return drawingCodes(boxes);
}
