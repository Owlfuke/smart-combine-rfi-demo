
import {fields,regionImage,readRegions,validateTemplate} from "./regions.mjs";
import {TitleBlockReader} from "./title-block-reader.mjs";
const storageKey="smart-combine-region-templates-v1";
export async function editRegions(items,initial,parentSignal){
 const controller=new AbortController(),signal=controller.signal;const parentAbort=()=>controller.abort();parentSignal.addEventListener("abort",parentAbort,{once:true});if(parentSignal.aborted)controller.abort();
 const dialog=document.createElement("dialog");dialog.className="region-editor";
 dialog.innerHTML='<h2>กำหนดพื้นที่อ่านแบบ</h2><div class="region-controls"><select class="page" aria-label="หน้าต้นแบบ"></select><select class="field" aria-label="ช่องข้อมูล"></select><button class="clear">ลบกรอบช่องนี้</button><button class="zoomout">−</button><button class="zoomin">＋</button><button class="fit">พอดี</button></div><p class="hint">ลากครอบเฉพาะค่า · ลากในกรอบเพื่อย้าย / มุมขวาล่างเพื่อปรับขนาด · ล้อเมาส์ซูมยึดตำแหน่งเคอร์เซอร์ · เมาส์กลาง/ขวาค้างเพื่อเลื่อน</p><div class="region-body"><div class="region-scroll"><canvas></canvas></div><aside><label>ชื่อแม่แบบ<input class="name" value="Title Block ขวา"></label><label><input class="table" type="checkbox"> Revision เป็นตาราง: ครอบคอลัมน์เลขและวันที่ให้สูงเท่ากัน</label><label>เส้นแบ่งคอลัมน์เลข Revision (% ของตาราง)<input class="split" type="range" min="5" max="50" value="18"></label><select class="saved" aria-label="แม่แบบที่บันทึก"></select><button class="load">โหลดแม่แบบ</button><button class="save">บันทึกแม่แบบ</button><button class="trial">ทดลองอ่านหน้านี้</button><div class="results" role="status"></div></aside></div><div class="dialog-actions"><button class="cancel">ยกเลิก</button><button class="apply primary">ใช้กับหน้าที่เลือก</button></div>';
 document.body.append(dialog);const q=s=>dialog.querySelector(s),canvas=q("canvas"),scroll=q(".region-scroll");
 const reader=new TitleBlockReader(t=>{q(".results").textContent=t;});
 let template=structuredClone(initial||{name:"Title Block ขวา",regions:{},table:false,ratio:1}),source=null,zoom=1,offsetX=0,offsetY=0,drag=null,working=false;
 for(const [key,title] of Object.entries(fields))q(".field").add(new Option(title,key));
 items.forEach((item,i)=>q(".page").add(new Option(item.doc.file.name+" · หน้า "+item.page,String(i))));
 let saved=[];try{saved=JSON.parse(localStorage.getItem(storageKey)||"[]");if(!Array.isArray(saved))saved=[];}catch{}
 function savedList(){q(".saved").replaceChildren();saved.forEach((t,i)=>q(".saved").add(new Option(t.name,String(i))));}
 function sync(){q(".name").value=template.name;q(".table").checked=template.table;q(".split").value=(template.revisionSplit||.18)*100;}
 scroll.style.overflow="hidden";scroll.style.position="relative";canvas.style.position="absolute";canvas.style.maxWidth="none";
 const colors={number:"#ef4444",revision:"#f59e0b",revisionDate:"#38bdf8",title:"#22c55e",revisionTable:"#a78bfa"};
 function draw(){
  if(!source)return;canvas.width=source.width;canvas.height=source.height;canvas.style.width=source.width*zoom+"px";canvas.style.height=source.height*zoom+"px";
  canvas.style.left=offsetX+"px";canvas.style.top=offsetY+"px";
  const x=canvas.getContext("2d");x.drawImage(source,0,0);
  for(const [key,r] of Object.entries(template.regions)){if(key==="revisionTable"){x.strokeStyle="#38bdf8";x.beginPath();const split=(r.x+r.w*(template.revisionSplit||.18))*canvas.width;x.moveTo(split,r.y*canvas.height);x.lineTo(split,(r.y+r.h)*canvas.height);x.stroke();}x.strokeStyle=colors[key];x.lineWidth=2;x.strokeRect(r.x*canvas.width,r.y*canvas.height,r.w*canvas.width,r.h*canvas.height);x.fillStyle=colors[key];x.font="14px sans-serif";x.fillText(fields[key],r.x*canvas.width+3,r.y*canvas.height+16);x.fillRect((r.x+r.w)*canvas.width-5,(r.y+r.h)*canvas.height-5,10,10);}
 }
 q(".split").addEventListener("input",()=>{template.revisionSplit=+q(".split").value/100;draw();});
 function fit(){if(!source)return;zoom=Math.min(1,(scroll.clientWidth-20)/source.width,(scroll.clientHeight-20)/source.height);offsetX=(scroll.clientWidth-source.width*zoom)/2;offsetY=(scroll.clientHeight-source.height*zoom)/2;draw();}
 function zoomAt(next,x,y){if(!source)return;next=Math.max(.1,Math.min(5,next));const ratio=next/zoom;offsetX=x-(x-offsetX)*ratio;offsetY=y-(y-offsetY)*ratio;zoom=next;draw();}
 async function loadPage(){working=true;q(".apply").disabled=true;try{source=await regionImage(items[+q(".page").value],{x:0,y:0,w:1,h:1},signal,1200);if(!Object.keys(template.regions).length)template.ratio=source.width/source.height;fit();}catch(e){q(".results").textContent=e.message;}finally{working=false;q(".apply").disabled=false;}}
 q(".page").addEventListener("change",loadPage);q(".fit").addEventListener("click",fit);q(".zoomin").addEventListener("click",()=>{zoomAt(zoom*1.3,scroll.clientWidth/2,scroll.clientHeight/2);});q(".zoomout").addEventListener("click",()=>{zoomAt(zoom/1.3,scroll.clientWidth/2,scroll.clientHeight/2);});

 scroll.addEventListener("wheel",e=>{
  if(!source)return;e.preventDefault();if(drag)return;
  const rect=scroll.getBoundingClientRect();
  const px=e.clientX-rect.left-scroll.clientLeft,py=e.clientY-rect.top-scroll.clientTop;
  const unit=e.deltaMode===1?16:e.deltaMode===2?scroll.clientHeight:1;
  const next=Math.max(.1,Math.min(5,zoom*Math.exp(-Math.max(-500,Math.min(500,e.deltaY*unit))*.0015)));
  zoomAt(next,px,py);
 },{passive:false});

 const point=e=>{const b=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))};};
 canvas.addEventListener("auxclick",e=>{if(e.button===1)e.preventDefault();});
 canvas.addEventListener("mousedown",e=>{if(e.button===1)e.preventDefault();});
 canvas.addEventListener("contextmenu",e=>e.preventDefault());
 canvas.addEventListener("pointerdown",e=>{
  if(working)return;e.preventDefault();const p=point(e),r=template.regions[q(".field").value];
  const mode=(e.button===1||e.button===2)?"pan":r&&Math.abs(p.x-r.x-r.w)<.02&&Math.abs(p.y-r.y-r.h)<.02?"resize":r&&p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h?"move":"new";
  drag={p,r:r?{...r}:null,mode,x:e.clientX,y:e.clientY,left:offsetX,top:offsetY};canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener("pointermove",e=>{
  if(!drag)return;const p=point(e),a=drag.p,r=drag.r;let next;
  if(drag.mode==="pan"){offsetX=drag.left+e.clientX-drag.x;offsetY=drag.top+e.clientY-drag.y;draw();return;}
  if(drag.mode==="move")next={...r,x:Math.max(0,Math.min(1-r.w,r.x+p.x-a.x)),y:Math.max(0,Math.min(1-r.h,r.y+p.y-a.y))};
  else if(drag.mode==="resize")next={...r,w:Math.max(.003,p.x-r.x),h:Math.max(.003,p.y-r.y)};
  else next={x:Math.min(a.x,p.x),y:Math.min(a.y,p.y),w:Math.abs(p.x-a.x),h:Math.abs(p.y-a.y)};
  template.regions[q(".field").value]=next;draw();
 });
 canvas.addEventListener("pointerup",()=>{drag=null;});canvas.addEventListener("pointercancel",()=>{drag=null;});
 q(".clear").addEventListener("click",()=>{delete template.regions[q(".field").value];draw();});
 q(".load").addEventListener("click",()=>{if(saved[+q(".saved").value]){template=structuredClone(saved[+q(".saved").value]);sync();draw();}});
 function capture(){template.name=q(".name").value.trim()||"แม่แบบ";template.table=q(".table").checked;template.revisionSplit=+q(".split").value/100;return template;}
 q(".save").addEventListener("click",()=>{capture();if(!Object.keys(template.regions).length)return;q(".results").textContent="";try{saved=saved.filter(t=>t.name!==template.name);saved.push(structuredClone(template));localStorage.setItem(storageKey,JSON.stringify(saved));savedList();q(".results").textContent="บันทึกแม่แบบแล้ว";}catch(e){q(".results").textContent=e.message;}});
 q(".trial").addEventListener("click",async()=>{if(working)return;working=true;q(".apply").disabled=true;try{const result=await readRegions(items[+q(".page").value],capture(),reader,signal);q(".results").replaceChildren();for(const key of Object.keys(template.regions)){const p=document.createElement("p");p.textContent=fields[key]+": "+(result.fields[key]||"อ่านไม่พบ");const img=document.createElement("img");img.src=result.previews[key];q(".results").append(p,img);}}catch(e){q(".results").textContent=e.message;}finally{working=false;q(".apply").disabled=false;}});
 savedList();sync();dialog.showModal();void loadPage();
 return new Promise(resolve=>{
  function done(value){reader.stop();source=null;signal.removeEventListener("abort",abort);parentSignal.removeEventListener("abort",parentAbort);controller.abort();dialog.close();dialog.remove();resolve(value);}
  const abort=()=>done(null);signal.addEventListener("abort",abort,{once:true});
  q(".cancel").addEventListener("click",()=>done(null));dialog.addEventListener("cancel",e=>{e.preventDefault();done(null);});
  q(".apply").addEventListener("click",()=>{capture();try{validateTemplate(template);}catch(e){q(".results").textContent=e.message;return;}if(!Object.values(template.regions).some(r=>r.w>.002&&r.h>.002)){q(".results").textContent="ลากกรอบอย่างน้อยหนึ่งช่อง";return;}done(structuredClone(template));});
 });
}

