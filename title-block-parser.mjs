// Geometry-aware suggestions, never an assertion that a title block was read correctly.
const patterns={
 number:/^(?:(?:DRAWING|DRWAING|DRAIWNG)\s*(?:NO\.?|NUMBER|#)|DWG\.?\s*(?:NO\.?|NUMBER|#)|DRG\.?\s*(?:NO\.?|NUMBER|#)|SHEET\s*(?:NO\.?|NUMBER)|เลขที่แบบ|แบบเลขที่|หมายเลขแบบ|รหัสแบบ|DRAWING\s*CODE|SHEET\s*(?:ID|NUMBER))\s*[:：-]?\s*/i,
 revision:/^(?:REVISION(?:\s*(?:NO\.?|NUMBER))?|REV\.?(?:\s*(?:NO\.?|NUMBER))?|ครั้งที่แก้ไข|แก้ไขครั้งที่|ฉบับแก้ไข|การแก้ไข|REVISION\s*INDEX)\s*[:：-]?\s*/i,
 title:/^(?:(?:DRAWING|DRWAING|DRAIWNG)\s*(?:TITLE|NAME)|SHEET\s*(?:TITLE|NAME)|TITLE|ชื่อแบบ|ชื่อแผ่นแบบ|แบบชื่อ|DRAWING\s*DESCRIPTION)\s*[:：-]?\s*/i
};
const reserved=/^(?:PROJECT|CLIENT|OWNER|SCALE|DATE|DRAWN|CHECKED|APPROVED|DESIGNED|DESCRIPTION|REVISION|(?:DRAWING|DRWAING|DRAIWNG)\s*NO|SHEET\s*NO|โครงการ|เจ้าของ|มาตราส่วน|วันที่|ผู้เขียน|ผู้ตรวจ)/i;
const clean=s=>s.normalize("NFC").replace(/[–—−]/g,"-").replace(/-{2,}/g,"-").replace(/\s+/g," ").replace(/([ก-๙])\s+(?=[ก-๙])/g,"$1").trim();
function valid(field,s){
 if(!s||s.length>180||reserved.test(s)||Object.values(patterns).some(re=>re.test(s)))return false;
 if(field==="number")return !/[ก-๙]{4}/.test(s)&&s.trim().split(/\s+/).length<=3&&s.length<=60&&/\d/.test(s)&&/[A-Zก-๙]/i.test(s)&&/^[A-Z0-9ก-๙._/ -]+$/i.test(s);
 if(field==="revision")return /^[A-Z0-9ก-๙][A-Z0-9ก-๙.-]{0,11}$/i.test(s);
 return s.length>=3&&!/^[\d\s./:-]+$/.test(s);
}
function inlineValue(field,s){
 let value=s;
 // A single PDF text item can contain several title-block cells.
 const next=/\b(?:REVISION|REV\.|DRAWING\s+(?:TITLE|NO)|DWG\s+NO|SCALE|DATE)\b/i.exec(value);
 if(next&&next.index>0)value=value.slice(0,next.index);
 value=clean(value).replace(/^[：:\s]+|[|;]+$/g,"").trim();
 return valid(field,value)?value:"";
}
export function groupLines(boxes){
 const rows=[];
 for(const b of boxes.filter(b=>clean(b.text)).sort((a,b)=>a.y-b.y||a.x-b.x)){
   const row=rows.find(r=>Math.abs(r.y-b.y)<Math.max(.003,Math.min(r.h,b.h)*.55));
   if(row){row.items.push(b);row.h=Math.max(row.h,b.h);}else rows.push({y:b.y,h:b.h,items:[b]});
 }
 const lines=[];
 for(const row of rows){
   let current;
   for(const b of row.items.sort((a,b)=>a.x-b.x)){
     if(current&&b.x-(current.x+current.w)<Math.max(.012,row.h*1.6)){
       current.text=clean(current.text+" "+b.text);current.w=Math.max(current.x+current.w,b.x+b.w)-current.x;current.h=Math.max(current.h,b.h);
     }else{current={...b,text:clean(b.text)};lines.push(current);}
   }
 }
 return lines;
}
function parseRegion(lines){
 const fields={number:"",title:"",revision:""},quality={},evidence=[];
 for(const field of ["number","title","revision"]){
   const labels=lines.filter(b=>patterns[field].test(b.text));
   let best;
   for(const label of labels){
     const match=label.text.match(patterns[field]),rest=inlineValue(field,label.text.slice(match[0].length));
     if(rest){const pick={value:rest,score:1,boxes:[label]};if(!best||pick.score>best.score)best=pick;continue;}
     const candidates=lines.filter(b=>b!==label&&valid(field,b.text)).map(b=>{
       const same=Math.abs(b.y-label.y)<Math.max(label.h,b.h)*.7;
       const right=same&&b.x>=label.x+label.w-.005&&b.x-label.x-label.w<.22;
       const below=b.y>=label.y+label.h*.6&&b.y-label.y<Math.max(.065,label.h*5)&&b.x>=label.x-.025&&b.x<label.x+Math.max(label.w,.35);
       if(!right&&!below)return null;
       const distance=right?b.x-label.x-label.w:b.y-label.y+Math.abs(b.x-label.x)*.5;
       return {value:clean(b.text),score:.85-distance,boxes:[label,b],b};
     }).filter(Boolean).sort((a,b)=>b.score-a.score);
     if(candidates[0]&&(!best||candidates[0].score>best.score))best=candidates[0];
   }
   if(best&&field==="title"&&best.b){
   let last=best.b;
   for(let count=0;count<2;count++){
     const next=lines.filter(b=>b!==last&&b.y>last.y+last.h*.6&&Math.abs(b.x-last.x)<.035).sort((a,b)=>a.y-b.y)[0];
     if(!next||next.y-last.y>Math.max(.04,last.h*2.2)||!valid("title",next.text)||valid("number",next.text)||valid("revision",next.text))break;
     best.value=clean(best.value+" "+next.text);best.boxes.push(next);last=next;
   }
 }
 if(best){fields[field]=best.value;quality[field]=best.score>=.8?"อ่านจากป้ายกำกับ":"ตรวจเทียบภาพ";evidence.push(...best.boxes);}
 }
 return {fields,quality,evidence,score:(fields.number?4:0)+(fields.title?4:0)+(fields.revision?1:0)};
}
export function locateTitleBlock(boxes){
 const lines=groupLines(boxes);
 const regions=[
  {name:"มุมขวาล่าง",x:.48,y:.48,w:.52,h:.52},
  {name:"แถบขวา",x:.7,y:0,w:.3,h:1},
  {name:"แถบล่าง",x:0,y:.7,w:1,h:.3},
  {name:"มุมซ้ายล่าง",x:0,y:.5,w:.55,h:.5},
  {name:"มุมขวาบน",x:.5,y:0,w:.5,h:.5},
  {name:"ทั้งหน้า",x:0,y:0,w:1,h:1}
 ];
 let best={fields:{number:"",title:"",revision:""},quality:{},score:-1,region:regions[0],evidence:[]};
 for(const region of regions){
   const subset=lines.filter(b=>b.x>=region.x-.01&&b.y>=region.y-.01&&b.x<=region.x+region.w&&b.y<=region.y+region.h);
   const r=parseRegion(subset),score=r.score-(region.name==="ทั้งหน้า"?.5:0);
   if(score>best.score)best={...r,score,region};
 }
 // A missing/garbled label must not hide a clear, unique sheet code at the bottom right.
 if(!best.fields.number){
   const codes=lines.filter(b=>b.x>=.7&&b.y>=.65&&/^[A-Z]{1,6}(?:\s*-\s*[A-Z0-9]{1,10}){1,4}$/i.test(b.text)&&/\d/.test(b.text));
   const unique=[...new Set(codes.map(b=>b.text.replace(/\s*-\s*/g,"-")))];
   if(unique.length===1){best.fields.number=unique[0];best.quality.number="รหัสมุมขวาล่าง · ไม่พบป้ายกำกับ ต้องตรวจยืนยัน";best.evidence.push(...codes);best.score+=4;}
 }
 const table=revisionTable(boxes);
 const hasRevisionGrid=lines.some(b=>/DESCRIPTION|รายละเอียด/i.test(b.text))&&lines.some(b=>/DATE|วันที่/i.test(b.text))&&lines.some(b=>/REVISION|R\s+E\s+V|การแก้ไข|^(?:NO|N0|ม\s*0)\.?/i.test(b.text));
 if(hasRevisionGrid&&!table){best.fields.revision="";best.quality.revision="อ่านแถวตารางไม่ครบ · กรุณากรอกเอง";}
 if(table){best.evidence.push(...table.evidence);best.fields.revision=table.revision;best.fields.revisionDate=table.revisionDate;best.revisionHistory=table.entries;best.quality.revision="ตารางแก้ไข · ตรวจลำดับและวันที่ก่อนยืนยัน";}
 else {best.fields.revisionDate="";const dateLabel=lines.find(b=>/^(?:REV(?:ISION)?\.?\s*DATE|วันที่แก้ไข|วันที่ปรับปรุง)\s*[:：]?/i.test(b.text));if(dateLabel){const candidates=[dateLabel,...lines.filter(b=>b.y>=dateLabel.y&&b.y-dateLabel.y<.06&&Math.abs(b.x-dateLabel.x)<.16)];for(const b of candidates){const date=b.text.match(datePattern);if(date){best.fields.revisionDate=date[0];best.evidence.push(dateLabel,b);break;}}}}
 if(best.evidence.length){
   const left=Math.max(0,Math.min(...best.evidence.map(b=>b.x))-.025);
   const top=Math.max(0,Math.min(...best.evidence.map(b=>b.y))-.03);
   const right=Math.min(1,Math.max(...best.evidence.map(b=>b.x+b.w))+.03);
   const bottom=Math.min(1,Math.max(...best.evidence.map(b=>b.y+b.h))+.04);
   best.region={name:best.region.name,x:left,y:top,w:Math.max(.15,right-left),h:Math.max(.1,bottom-top)};
 }
 delete best.evidence;return best;
}
export function pdfBoxes(items,viewport){
 const v=viewport.transform;
 const point=(x,y)=>({x:(v[0]*x+v[2]*y+v[4])/viewport.width,y:(v[1]*x+v[3]*y+v[5])/viewport.height});
 return items.filter(i=>i.str?.trim()&&i.transform).map(i=>{
   const [a,b,,,x,y]=i.transform,angle=Math.atan2(b,a),w=i.width||1,h=i.height||Math.hypot(a,b)||1;
   const p=[point(x,y),point(x+w*Math.cos(angle),y+w*Math.sin(angle)),point(x-h*Math.sin(angle),y+h*Math.cos(angle)),point(x+w*Math.cos(angle)-h*Math.sin(angle),y+w*Math.sin(angle)+h*Math.cos(angle))];
   const left=Math.min(...p.map(q=>q.x)),top=Math.min(...p.map(q=>q.y));
   return {text:i.str,x:left,y:top,w:Math.max(...p.map(q=>q.x))-left,h:Math.max(...p.map(q=>q.y))-top};
 });
}
export function displayName(meta){
 return [meta.number.trim(),meta.title.trim(),meta.revision.trim()?"Rev "+meta.revision.trim():""].filter(Boolean).join(" — ");
}

const datePattern=/\b(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-zก-๙.]{2,12}\s+\d{2,4})\b/u;
function dateRank(value){
 const months=["มค","กพ","มีค","เมย","พค","มิย","กค","สค","กย","ตค","พย","ธค"];
 const eng=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
 const v=value.toLowerCase().replace(/(\d)\.(?=\d)/g,"$1/").replace(/\./g,"");
 let m=v.match(/^(\d{1,2})\s+([^\s]+)\s+(\d{2,4})$/),d,month,y;
 if(m){d=+m[1];month=months.indexOf(m[2])+1||eng.indexOf(m[2].slice(0,3))+1;y=+m[3];}
 else {m=v.match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})$/);if(!m)return 0;[d,month,y]=m[1].length===4?[+m[3],+m[2],+m[1]]:[+m[1],+m[2],+m[3]];}
 if(y>2400)y-=543;if(y<100)y+=2000;
 const date=new Date(Date.UTC(y,month-1,d));
 return month>=1&&month<=12&&d>=1&&date.getUTCFullYear()===y&&date.getUTCMonth()===month-1&&date.getUTCDate()===d?y*10000+month*100+d:0;
}
export function revisionTable(boxes){
 const lines=groupLines(boxes),anchor=lines.find(b=>/^(?:R\s*E\s*V\s*I\s*S\s*I\s*O\s*N|REVISIONS|ประวัติการแก้ไข|รายการแก้ไข|การแก้ไข)\s*[:：]?$/i.test(b.text));
 const tableAnchor=anchor||lines.find(b=>/^(?:NO|N0|ม\s*0)\.?\s*DATE\s*DESCRIPTION/i.test(b.text))||lines.find(b=>/^(?:NO|N0|ม\s*0)\.?(?:\s*DATE)?$/i.test(b.text)&&lines.some(q=>Math.abs(q.y-b.y)<.02&&/DATE/i.test(q.text))&&lines.some(q=>Math.abs(q.y-b.y)<.02&&/DESCRIPTION/i.test(q.text)));
 if(!tableAnchor)return null;
 const near=lines.filter(b=>Math.abs(b.y-tableAnchor.y)<Math.max(.35,tableAnchor.h*15)&&b.x>=tableAnchor.x-.15&&b.x<tableAnchor.x+Math.max(tableAnchor.w,.65));
 if(!near.some(b=>/DATE|วันที่/i.test(b.text))||!near.some(b=>/DESCRIPTION|รายละเอียด/i.test(b.text)))return null;
 const rows=[];
 for(const b of near){let row=rows.find(r=>Math.abs(r.y-b.y)<Math.max(.004,b.h*.65));if(!row){row={y:b.y,items:[]};rows.push(row);}row.items.push(b);}
 const entries=[];
 for(const row of rows){
   const text=row.items.sort((a,b)=>a.x-b.x).map(b=>b.text).join(" ");
   const match=text.match(datePattern);if(!match)continue;
   const prefix=text.slice(0,match.index).trim().match(/^(?:REV\.?\s*)?([A-Z]?\d{1,3}|[A-Z])\s*$/i);
   if(!prefix)continue;
   const rank=dateRank(match[0]);if(!rank)continue;
   entries.push({revision:prefix[1],revisionDate:match[0],rank,description:text.slice(match.index+match[0].length).trim()});
 }
 entries.sort((a,b)=>b.rank-a.rank);
 if(entries.length>1&&entries[0].rank===entries[1].rank&&entries[0].revision!==entries[1].revision)return null;
 return entries.length?{...entries[0],entries,evidence:near}:null;
}
