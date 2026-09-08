
import {pdfBoxes,groupLines,revisionTable} from "./title-block-parser.mjs";
export const fields={number:"เลขแบบ",revision:"ครั้งที่แก้ไข / Revision",revisionDate:"วันที่แก้ไข",title:"ชื่อแบบ",revisionTable:"ตาราง Revision ทั้งตาราง"};
const check=s=>{if(s.aborted)throw new DOMException("ยกเลิก","AbortError");};
export function inRegion(b,r){return b.x+b.w/2>=r.x&&b.x+b.w/2<=r.x+r.w&&b.y+b.h/2>=r.y&&b.y+b.h/2<=r.y+r.h;}
export function searchRegion(r,column=false){
 const dx=column?0:Math.min(.012,Math.max(.003,r.w*.12)),dy=Math.min(.012,Math.max(.003,r.h*.25));
 const x=Math.max(0,r.x-dx),y=Math.max(0,r.y-dy);
 return {x,y,w:Math.min(1,r.x+r.w+dx)-x,h:Math.min(1,r.y+r.h+dy)-y};
}
export function drawingCodes(boxes){
 return [...new Set(groupLines(boxes).flatMap(b=>b.text.toUpperCase().replace(/[–—−]/g,'-').replace(/\s*-\s*/g,'-').match(/[A-Z]{1,8}(?:-[A-Z0-9]{1,12}){1,5}/g)||[]).filter(v=>/\d/.test(v)))];
}
export async function regionImage(item,r,signal,max=1800){
 check(signal);
 const c=document.createElement("canvas");
 if(item.doc.type==="pdf"){
  const page=await item.doc.pdf.getPage(item.page),v=page.getViewport({scale:1});
  const scale=Math.min(5,max/Math.max(v.width*r.w,v.height*r.h)),view=page.getViewport({scale});
  c.width=Math.max(1,Math.ceil(view.width*r.w));c.height=Math.max(1,Math.ceil(view.height*r.h));
  const task=page.render({canvasContext:c.getContext("2d"),viewport:view,transform:[1,0,0,1,-r.x*view.width,-r.y*view.height],background:"white"});
  const abort=()=>task.cancel();signal.addEventListener("abort",abort,{once:true});
  try{await task.promise;check(signal);}finally{signal.removeEventListener("abort",abort);page.cleanup();}
 }else{
  const b=await createImageBitmap(item.doc.file);
  try{const scale=Math.min(1,max/Math.max(b.width*r.w,b.height*r.h));c.width=Math.max(1,Math.ceil(b.width*r.w*scale));c.height=Math.max(1,Math.ceil(b.height*r.h*scale));const x=c.getContext("2d");x.fillStyle="white";x.fillRect(0,0,c.width,c.height);x.drawImage(b,r.x*b.width,r.y*b.height,r.w*b.width,r.h*b.height,0,0,c.width,c.height);}finally{b.close();}
 }
 return c;
}
export async function readRegions(item,template,reader,signal){
 validateTemplate(template);
 const started=performance.now(),result={fields:{number:"",title:"",revision:"",revisionDate:""},quality:{},method:"พื้นที่ที่กำหนด",region:{name:"แม่แบบ "+template.name,...Object.values(template.regions)[0]},previews:{}};
 let boxes=[],ratio;
 if(item.doc.type==="pdf"){const p=await item.doc.pdf.getPage(item.page),v=p.getViewport({scale:1});ratio=v.width/v.height;boxes=pdfBoxes((await p.getTextContent()).items,v);p.cleanup();}
 else{const b=await createImageBitmap(item.doc.file);ratio=b.width/b.height;b.close();}
 check(signal);if(Math.abs(ratio/template.ratio-1)>.08)throw Error("สัดส่วนหน้าไม่ตรงแม่แบบ · กำหนดกรอบแยกสำหรับหน้านี้");
 const tableBoxes=[];
 for(const [field,original] of Object.entries(template.regions)){
  if(template.regions.revisionTable&&(field==="revision"||field==="revisionDate"))continue;
  const r=field==="revisionTable"?original:searchRegion(original,template.table&&(field==="revision"||field==="revisionDate"));
  check(signal);reader.progress("อ่านกรอบ "+fields[field]);
  let selected=boxes.filter(b=>inRegion(b,r));
  const image=await regionImage(item,r,signal);
  try{
   if(field==="revisionTable"){
    let table=readRevisionGrid(selected.map(b=>({...b,x:(b.x-r.x)/r.w,y:(b.y-r.y)/r.h,w:b.w/r.w,h:b.h/r.h})),template.revisionSplit);
    const readings=[];const candidates=table?[table]:[];
    for(const raw of [false,true]){const words=await reader.ocr(image,signal,false,raw);readings.push(words);const found=readRevisionGrid(words,template.revisionSplit);if(found)candidates.push(found);}
    const thaiWords=await reader.ocr(image,signal,"thai",false);readings.push(thaiWords);const thaiTable=readRevisionGrid(thaiWords,template.revisionSplit);if(thaiTable)candidates.push(thaiTable);
    const reduced=document.createElement('canvas');reduced.width=Math.round(image.width*.6);reduced.height=Math.round(image.height*.6);reduced.getContext('2d').drawImage(image,0,0,reduced.width,reduced.height);
    try{for(const language of [false,'thai']){const words=await reader.ocr(reduced,signal,language,false);readings.push(words);const found=readRevisionGrid(words,template.revisionSplit);if(found)candidates.push(found);}}finally{reduced.width=reduced.height=0;}
    const split=template.revisionSplit||.18;
    for(const [left,right] of [[readings[0],readings[1]],[readings[1],readings[0]],[readings[0],thaiWords],[readings[1],thaiWords]]){const found=readRevisionGrid([...left.filter(b=>b.x+b.w/2<split),...right.filter(b=>b.x+b.w/2>=split)],split);if(found)candidates.push(found);}

    candidates.sort((a,b)=>b.rank-a.rank);table=candidates[0]||null;
    if(table&&candidates.some(c=>c.rank===table.rank&&c.revision!==table.revision))table=null;
    const uncertain=table&&readings.some(words=>{
     const rows=[];for(const b of words){let row=rows.find(r=>Math.abs(r.y-b.y)<Math.max(.005,b.h*.7));if(!row){row={y:b.y,words:[]};rows.push(row);}row.words.push(b);}
     return rows.some(row=>{const text=row.words.map(b=>b.text).join(' ');return /\b\d{4}\b/.test(text)&&/\b\d{1,2}\b/.test(text)&&!readRevisionGrid(row.words,split)&&!candidates.some(c=>c.entries.some(e=>Math.abs(e.rowY-row.y)<.04));});
    });
    if(uncertain)table=null;
    result.diagnostics={revisionTable:readings,unresolvedRows:!!uncertain};

    if(!table&&!template.tableRetry){
     const pad=Math.min(.018,r.h*.25),y=Math.max(0,r.y-pad),bottom=Math.min(1,r.y+r.h+pad);
     const retry=await readRegions(item,{...template,tableRetry:true,regions:{revisionTable:{x:r.x,y,w:r.w,h:bottom-y}}},reader,signal);
     if(retry.fields.revisionDate&&retry.fields.revision){Object.assign(result.fields,{revision:retry.fields.revision,revisionDate:retry.fields.revisionDate});Object.assign(result.previews,retry.previews);Object.assign(result.quality,retry.quality);result.revisionHistory=retry.revisionHistory;result.diagnostics=retry.diagnostics;continue;}
    }
    if(table){result.fields.revision=table.revision;result.fields.revisionDate=table.revisionDate;result.revisionHistory=table.entries;
     const ctx=image.getContext('2d');ctx.strokeStyle='#22c55e';ctx.lineWidth=3;ctx.strokeRect(1,Math.max(0,table.rowY*image.height-4),image.width-2,table.rowH*image.height+8);
     result.quality.revision=result.quality.revisionDate='วันที่ล่าสุดและ Revision จากแถวเดียวกัน · ตรวจแถวสีเขียว';
    }else{result.fields.revision='';result.fields.revisionDate='';result.quality.revision=result.quality.revisionDate='มีแถวที่อ่านหรือจับคู่ไม่สำเร็จ · กรุณาตรวจตารางก่อนยืนยัน';}
    result.previews.revision=result.previews.revisionDate=result.previews.revisionTable=image.toDataURL();continue;
   }
   // Preserve the image used for recognition before drawing the user's original boundary.
   if(field==="number"){
    let visual=await reader.ocr(image,signal,true),codes=drawingCodes(visual);
    const pdfCodes=drawingCodes(selected);
    if(!codes.length){visual=await reader.ocr(image,signal,true,true);codes=drawingCodes(visual);}
    if(!codes.length){visual=await reader.ocr(image,signal,false,true);codes=drawingCodes(visual);}
    if(!codes.length&&!pdfCodes.length)result.quality.number='อ่านเลขแบบไม่ชัด · ข้อความดิบ: '+visual.map(b=>b.text).join(' ').slice(0,100);
    if(codes.length===1){selected=visual;result.quality.number=pdfCodes.length===1&&pdfCodes[0]===codes[0]?"PDF และ OCR ตรงกัน · ตรวจยืนยัน":"อ่านซ้ำจากภาพในกรอบเผื่อ · ตรวจยืนยัน";}
    else if(codes.length>1){selected=[];result.quality.number="พบเลขแบบหลายค่า: "+codes.join(" / ")+" · กรุณากรอกยืนยัน";}
   }
   result.previews[field]=image.toDataURL();
   if(field!=="number"&&(!selected.length||selected.some(b=>/[\uFFFD\u0000-\u0008]/.test(b.text)))){
    const words=await reader.ocr(image,signal,field==="number");
    selected=words.map(b=>({...b,x:r.x+b.x*r.w,y:r.y+b.y*r.h,w:b.w*r.w,h:b.h*r.h}));
   }
   if(field==="revision"){
    const initial=cleanField(field,groupLines(selected).map(b=>b.text).join(" "));
    if(!initial.found||Number(initial.value)===0){
     let best=initial.found?initial:null,bestWords=selected;
     for(const raw of [false,true]){
      const words=await reader.ocr(image,signal,true,raw);
      const candidate=cleanField(field,groupLines(words).map(b=>b.text).join(" "));
      if(candidate.found&&(!best||Number(candidate.value)>Number(best.value))){best=candidate;bestWords=words.map(b=>({...b,x:r.x+b.x*r.w,y:r.y+b.y*r.h,w:b.w*r.w,h:b.h*r.h}));}
     }
     if(best)selected=bestWords;
    }
   }
   if(field==="revisionDate"&&!cleanField(field,groupLines(selected).map(b=>b.text).join(" ")).value){
    // A nonempty PDF text layer may still contain unusable font mappings.
    for(const raw of [false,true]){
     const words=await reader.ocr(image,signal,false,raw);
     if(cleanField(field,groupLines(words).map(b=>b.text).join(" ")).value){selected=words.map(b=>({...b,x:r.x+b.x*r.w,y:r.y+b.y*r.h,w:b.w*r.w,h:b.h*r.h}));break;}
    }
   }
   if(template.table&&(field==="revision"||field==="revisionDate")){tableBoxes.push(...selected);}
   let value=groupLines(selected).map(b=>b.text).join(" ").trim();
   const labels={number:/^(?:DRAWING\s*NO\.?|DWG\s*NO\.?|เลขที่แบบ|หมายเลขแบบ)\s*[:：]?\s*/i,title:/^(?:DRAWING\s*TITLE|ชื่อแบบ)\s*[:：]?\s*/i,revision:/^(?:REVISION|REV\.?|ครั้งที่แก้ไข)\s*[:：]?\s*/i,revisionDate:/^(?:REV(?:ISION)?\.?\s*DATE|DATE|วันที่แก้ไข|วันที่)\s*[:：]?\s*/i};value=value.replace(labels[field],"");
   if(field==="number"){const codes=drawingCodes(selected);value=codes.length===1?codes[0]:"";}
   const cleaned=cleanField(field,value);value=cleaned.value;if(cleaned.note)result.quality[field]=cleaned.note;
   result.fields[field]=value;result.quality[field] ||= "อ่านในกรอบเผื่อรอบพื้นที่ที่เลือก · ตรวจยืนยัน";
  }finally{image.width=image.height=0;}
 }
 if(!template.regions.revisionTable&&template.table&&template.regions.revision&&template.regions.revisionDate){
  const a=template.regions.revision,b=template.regions.revisionDate;
  const y=Math.min(.995,Math.max(a.y+a.h,b.y+b.h)+.005);
  const table=revisionTable([...tableBoxes,{text:"NO. DATE DESCRIPTION",x:Math.min(a.x,b.x),y,w:Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x),h:Math.max(.01,Math.max(a.h,b.h)/10)}]);
  if(table){result.revisionHistory=table.entries;
   const paired=table.entries.some(e=>Number(e.revision)===Number(result.fields.revision)&&e.revisionDate===result.fields.revisionDate);
   if(!paired&&result.fields.revision&&result.fields.revisionDate){result.quality.revision += " · เลขสูงสุดและวันที่ล่าสุดไม่อยู่แถวเดียวกัน กรุณาตรวจยืนยัน";result.quality.revisionDate += " · เลือกแยกจากเลขครั้งที่แก้ไข";}
  }
 }
 if(!result.fields.revision&&!template.regions.revisionTable){result.fields.revision="0";result.quality.revision="ไม่พบครั้งที่แก้ไข · ใช้ค่าเริ่มต้น 0 ตรวจยืนยัน";}
 result.previewUrl=result.previews.number||Object.values(result.previews)[0];result.elapsedMs=Math.round(performance.now()-started);return result;
}


export function validateTemplate(t){
 if(!t||!Number.isFinite(t.ratio)||t.ratio<=0||!Object.keys(t.regions||{}).length)throw Error("กำหนดกรอบอย่างน้อยหนึ่งช่อง");
 for(const [key,r] of Object.entries(t.regions)){if(!fields[key]||![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.x<0||r.y<0||r.w<.002||r.h<.002||r.x+r.w>1.001||r.y+r.h>1.001)throw Error("กรอบไม่ถูกต้อง · ลากกรอบใหม่");}
 if(t.table&&!t.regions.revisionTable){const a=t.regions.revision,b=t.regions.revisionDate;if(!a||!b)throw Error("โหมดตารางต้องกำหนดทั้งคอลัมน์ครั้งที่และวันที่");if(Math.abs(a.y-b.y)>.03||Math.abs(a.h-b.h)>.04)throw Error("กรอบคอลัมน์ครั้งที่และวันที่ต้องครอบช่วงแถวเดียวกัน");}
}

export function cleanField(field,raw){
 let value=raw.replace(/[๐-๙]/g,c=>String(c.charCodeAt(0)-3664)).replace(/\s+/g,' ').trim();
 if(field==='revisionDate'){
  const months=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const full=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  // Normalize spacing/punctuation only; never guess another month from a similar glyph.
  for(let i=0;i<months.length;i++){
   value=value.replaceAll(full[i],months[i]);
   const letters=months[i].replaceAll('.','').split('');
   const pattern=letters.join('[\\s.]*')+'[\\s.]*';
   value=value.replace(new RegExp('(?<=\\d\\s*)'+pattern+'(?=\\s*\\d)','g'),months[i]);
  }
  value=value.replace(/(\d)([ก-๙])/g,'$1 $2').replace(/([ก-๙.])(\d)/g,'$1 $2');
  const matches=[...value.matchAll(/(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}\s+[A-Za-zก-๙.]{2,12}\s+\d{2,4})/g)].map(m=>m[0]);
  const valid=matches.map(date=>revisionTable([{text:'0 '+date,x:.1,y:.1,w:.5,h:.02},{text:'NO. DATE DESCRIPTION',x:.1,y:.2,w:.6,h:.02}])).filter(Boolean).sort((a,b)=>b.rank-a.rank);
  return valid.length?{value:valid[0].revisionDate,note:'เลือกวันที่ล่าสุดจากกรอบ · ตรวจยืนยัน'}:{value:'',note:'ไม่พบวันที่ที่ถูกต้อง · ตรวจภาพแล้วกรอกยืนยัน'};
 }
 if(field==='revision'){
  const numbers=value.replace(/\b(?:REVISION|REV|NO)\b\.?|ครั้งที่แก้ไข/gi,' ').replace(/[|:：]/g,' ').trim();
  if(/^(?:\d{1,3})(?:\s+\d{1,3})*$/.test(numbers))return {value:String(Math.max(...numbers.split(/\s+/).map(Number))),found:true,note:'เลือกครั้งที่แก้ไขสูงสุดจากกรอบ · ตรวจยืนยัน'};
 }
 if(field==='revision'&&!/^(?:R(?:EV)?\.?\s*)?[A-Z]?\d{1,3}$|^[A-Z]$/i.test(value))return {value:'0',note:'ไม่พบครั้งที่แก้ไข · ใช้ค่าเริ่มต้น 0 ตรวจยืนยัน'};
 return {value,note:value!==raw?'จัดช่องว่างและเลขไทย · ตรวจยืนยัน':''};
}

export function readRevisionGrid(boxes,split=.18){
 const rows=[];
 for(const b of [...boxes].sort((a,b)=>a.y-b.y||a.x-b.x)){let row=rows.find(r=>Math.abs((r.y+r.h/2)-(b.y+b.h/2))<Math.max(.005,Math.max(r.h,b.h)*.65));if(!row){row={y:b.y,h:b.h,boxes:[]};rows.push(row);}row.boxes.push(b);}
 const entries=[];
 for(const row of rows){
  const left=row.boxes.filter(b=>b.x+b.w/2<split),right=row.boxes.filter(b=>b.x+b.w/2>=split);
  let rev=cleanField('revision',groupLines(left).map(b=>b.text).join(' '));
  let date=cleanField('revisionDate',groupLines(right).map(b=>b.text).join(' '));
  // OCR may merge a complete table row into one box, or put the day left of the divider.
  // Only accept an explicit revision followed by a complete date on this same row.
  const text=row.boxes.sort((a,b)=>a.x-b.x).map(b=>b.text).join(' ').replace(/[๐-๙]/g,c=>String(c.charCodeAt(0)-3664)).trim();
  const paired=text.match(/^(?:REV\.?\s*)?(\d{1,3})\s+(\d{1,4}[\s/.-].*)$/i);
  if(paired){const rowDate=cleanField('revisionDate',paired[2]);if(rowDate.value){rev={value:String(Number(paired[1])),found:true};date=rowDate;}}

  if(!rev.found||!date.value)continue;
  const parsed=revisionTable([{text:rev.value+' '+date.value,x:.1,y:.1,w:.7,h:.02},{text:'NO. DATE DESCRIPTION',x:.1,y:.2,w:.8,h:.02}]);
  if(parsed)entries.push({...parsed,rowY:row.y,rowH:row.h});
 }
 entries.sort((a,b)=>b.rank-a.rank);
 if(!entries.length||(entries[1]?.rank===entries[0].rank&&entries[1].revision!==entries[0].revision))return null;
 return {...entries[0],entries};
}
