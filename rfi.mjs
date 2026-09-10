import {captureReferencePlan,appendReferencePlan} from './rfi-reference-plan.mjs';
import {renderKeyPlan} from './rfi-keyplan.mjs';
import {captureState,imageState} from './rfi-image-state.mjs';
import {installRegister} from './rfi-register.mjs';
import {renderRfiCrop} from "./rfi-render.mjs";
import {readGridFrame} from "./grid-auto.mjs";
import {frameWithGrid} from "./grid-frame.mjs";
import {gridBounds} from "./grids.mjs";
export function rfiReferences(p,mode){
 const compare=mode&&mode!=='normal'&&p.selectedId!==p.baseId&&p.layers.some(l=>l.id===p.baseId)&&p.layers.some(l=>l.id===p.selectedId);
 return p.layers.filter(l=>compare?(l.id===p.baseId||l.id===p.selectedId):(l.visible&&l.opacity>0)).map(l=>({id:l.id,name:l.name,number:l.number,revision:l.revision,color:compare&&mode==='overlay'?(l.id===p.baseId?'#ef4444':'#2563eb'):(!compare&&l.colorMode==='tint'?l.color:null),opacity:compare?1:l.opacity}));
}
export function cloud(ctx,r){
 ctx.save();ctx.strokeStyle='#dc2626';ctx.lineWidth=2.5;ctx.beginPath();
 const corners=[[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h],[r.x,r.y]];
 ctx.moveTo(...corners[0]);
 for(let i=0;i<4;i++){const [x,y]=corners[i],[ex,ey]=corners[i+1],dx=ex-x,dy=ey-y,n=Math.max(1,Math.ceil(Math.hypot(dx,dy)/18));for(let k=0;k<n;k++){const ax=x+dx*k/n,ay=y+dy*k/n,bx=x+dx*(k+1)/n,by=y+dy*(k+1)/n;ctx.quadraticCurveTo((ax+bx)/2+dy/n*.5,(ay+by)/2-dx/n*.5,bx,by);}}
 ctx.closePath();ctx.stroke();ctx.restore();
}
export function installRfi({engine,getProject,mutate,schedule,toast,navigate}){
 const $=id=>document.getElementById(id),canvas=engine.canvas;let armed=false,drag=null,current=null,editing=null;
 const panel=$('rfi-panel');
 const imageWarning=document.createElement('p');imageWarning.id='rfi-image-state';imageWarning.setAttribute('role','status');imageWarning.style.color='#fbbf24';
 const updateImage=document.createElement('button');updateImage.textContent='อัปเดตภาพจากแบบปัจจุบัน';updateImage.id='rfi-update-image';$('rfi-preview').after(imageWarning,updateImage);
 const checkImage=()=>{const item=chosen();imageWarning.hidden=!item;updateImage.hidden=!item;if(!item)return;const state=imageState(getProject(),item,engine);imageWarning.textContent=state==='stale'?'แบบหรือการแสดงผลเปลี่ยนหลังแนบภาพ กรุณาตรวจและอัปเดตภาพก่อนส่ง':state==='unknown'?'ภาพเดิมยังไม่มีข้อมูลตรวจความเปลี่ยนแปลง กรุณาตรวจหรืออัปเดตภาพ':'ภาพตรงกับสถานะที่บันทึกไว้';};
 updateImage.onclick=async()=>{const item=chosen();if(!item)return;if(getProject()?.calibration)return toast('จบ Calibrate ก่อนอัปเดตภาพ',true);if(navigate&&!navigate(item))return;const r=screenRect(item.rect);if(r.x<0||r.y<0||r.x+r.w>engine.width||r.y+r.h>engine.height)return toast('ซูมออกให้เห็น Cloud ครบก่อนอัปเดต',true);updateImage.disabled=true;try{await commitCloud(r,item,item.showDimensions!==false);}finally{updateImage.disabled=false;checkImage();}};

 const dimensionLabel=document.createElement('label');dimensionLabel.className='rfi-dimension-toggle';const dimensionToggle=document.createElement('input');dimensionToggle.type='checkbox';dimensionToggle.id='rfi-dimensions';dimensionToggle.disabled=true;dimensionLabel.append(dimensionToggle,document.createTextNode(' แสดง Dimension / ลูกศรใน RFI'));dimensionLabel.title='อัปเดตภาพจากแผ่นที่แสดงอยู่ในปัจจุบัน';$('rfi-preview').before(dimensionLabel);
 dimensionToggle.onchange=async()=>{const item=chosen(),p=getProject();if(!item)return;const enabled=dimensionToggle.checked;if(item.sheetId!==p.selectedId||p.calibration){dimensionToggle.checked=item.showDimensions!==false;toast('เลือกแผ่นของ RFI นี้ และจบ Calibrate ก่อนอัปเดตภาพ',true);return;}const r=screenRect(item.rect);if(r.x<0||r.y<0||r.x+r.w>engine.width||r.y+r.h>engine.height){dimensionToggle.checked=item.showDimensions!==false;toast('ซูมออกให้เห็น Cloud ครบก่อนอัปเดตภาพ',true);return;}dimensionToggle.disabled=true;try{await commitCloud(r,item,enabled);}finally{dimensionToggle.disabled=false;dimensionToggle.checked=item.showDimensions!==false;}};

 const registerDock=installRegister({getProject,mutate,toast,open:item=>{if(navigate&&!navigate(item))return;refresh();show(item);selectedCloud=item.id;$('rfi-list').value=item.id;engine.render();}});
 let selectedCloud=null;
 engine.selectCloud=q=>{selectedCloud=null;const p=getProject();for(const item of [...(p?.rfis||[])].reverse()){if(item.sheetId!==p.selectedId)continue;const b=screenRect(item.rect),pad=12;const inside=q.x>=b.x-pad&&q.x<=b.x+b.w+pad&&q.y>=b.y-pad&&q.y<=b.y+b.h+pad;const edge=Math.min(Math.abs(q.x-b.x),Math.abs(q.x-b.x-b.w),Math.abs(q.y-b.y),Math.abs(q.y-b.y-b.h));if(inside&&edge<=pad){selectedCloud=item.id;current=item.id;return true;}}return false;};
 canvas.addEventListener('dblclick',()=>{const item=chosen();if(selectedCloud&&item?.id===selectedCloud){show(item);$('rfi-resize').click();}});
 engine.clearCloudSelection=()=>{selectedCloud=null;};
 engine.deleteSelectedCloud=()=>{const item=chosen();if(!selectedCloud||item?.id!==selectedCloud||item.sheetId!==getProject()?.selectedId)return false;$('rfi-delete').click();selectedCloud=null;return true;};
 const stop=()=>{armed=false;drag=null;editing=null;$('rfi-resize-actions').hidden=true;$('rfi-cloud').setAttribute('aria-pressed','false');engine.cursor();engine.render();};
 engine.tools?.register('cloud',()=>{selectedCloud=null;const id=drag?.id;stop();if(id!==undefined&&canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);});
 $('rfi-cloud').onclick=()=>{const p=getProject();if(!p?.layers.length||p.calibration)return;const next=!armed;engine.tools?.activate('cloud');p.panMode=false;armed=next;$('rfi-cloud').setAttribute('aria-pressed',String(armed));canvas.style.cursor=armed?'crosshair':'default';};
 function enlargePreview(){const item=chosen();if(!item?.image)return;const dialog=document.createElement('dialog');dialog.className='rfi-image-dialog';dialog.setAttribute('aria-label','ตรวจภาพ RFI และหัวกริด');const heading=document.createElement('h2');heading.textContent='ภาพ RFI · ตรวจหัวกริด';const img=document.createElement('img');img.src=item.image;img.alt='ภาพเดียวกับที่แนบใน PDF';const close=document.createElement('button');close.textContent='ปิด';close.onclick=()=>dialog.close();dialog.append(heading,img,close);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();}
 $('rfi-preview').onclick=enlargePreview;
 $('rfi-preview').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();enlargePreview();}};
 $('rfi-close').onclick=()=>panel.hidden=true;
 function chosen(){return (getProject()?.rfis||[]).find(r=>r.id===current);}
 function show(item){dimensionToggle.disabled=false;dimensionToggle.checked=item.showDimensions!==false;stop();current=item.id;panel.hidden=false;$('rfi-preview').src=item.image;$('rfi-preview').hidden=false;$('rfi-grid-warning').textContent=item.gridImageWarning||'';$('rfi-grid-warning').hidden=!item.gridImageWarning;$('rfi-sheet').textContent=item.sheetName;$('rfi-question').value=item.question||'';$('rfi-grid').value=item.gridLine||'';const legend=$('rfi-legend');legend.replaceChildren();for(const ref of item.references||[]){const row=document.createElement('p'),swatch=document.createElement('span');swatch.textContent='■ ';swatch.style.color=/^#[0-9a-f]{6}$/i.test(ref.color||'')?ref.color:'#94a3b8';row.append(swatch,document.createTextNode(ref.name+(ref.color?'':' (สีต้นฉบับ)')));legend.append(row);}if(!item.references)legend.textContent='รายการเดิมไม่มีข้อมูล Layer ณ เวลาครอป';$('rfi-download').disabled=false;$('rfi-delete').disabled=false;checkImage();}
 $('rfi-list').onchange=()=>{const item=(getProject().rfis||[]).find(r=>r.id===$('rfi-list').value);if(item)show(item);};
 $('rfi-open').onclick=()=>{const opening=panel.hidden;refresh();panel.hidden=!opening;if(opening){const item=chosen()||(getProject()?.rfis||[])[0];if(item){show(item);$('rfi-list').value=item.id;}}};
 engine.refreshRfi=()=>refresh();
 function refresh(){checkImage();registerDock.refresh();const items=getProject()?.rfis||[];const picker=$('rfi-list');picker.replaceChildren();for(const [index,item] of items.entries())picker.add(new Option('วง '+(index+1)+' · '+item.sheetName+' · '+new Date(item.createdAt).toLocaleString('th-TH'),item.id));if(!items.some(r=>r.id===current)){current=null;$('rfi-preview').removeAttribute('src');$('rfi-preview').hidden=true;$('rfi-grid-warning').hidden=true;$('rfi-question').value='';$('rfi-grid').value='';$('rfi-legend').replaceChildren();$('rfi-sheet').textContent='วาด Revision Cloud เพื่อสร้าง RFI';$('rfi-download').disabled=true;$('rfi-delete').disabled=true;}else {picker.value=current;$('rfi-delete').disabled=false;}}
 $('rfi-delete').onclick=async()=>{const item=chosen();if(!item)return;try{await mutate('ลบวงเมฆและรายการ RFI แล้ว · Undo คืนได้',()=>{const p=getProject();p.rfis=(p.rfis||[]).filter(r=>r.id!==item.id);});refresh();const next=(getProject()?.rfis||[])[0];if(next){show(next);$('rfi-list').value=next.id;}}catch(e){toast(e.message,true);}};
 $('rfi-grid').oninput=()=>{const item=chosen();if(item){item.gridLine=$('rfi-grid').value;schedule();}};
 $('rfi-grid').addEventListener('blur',()=>registerDock.refresh());$('rfi-question').addEventListener('blur',()=>registerDock.refresh());
 $('rfi-question').oninput=()=>{const item=chosen();if(item){item.question=$('rfi-question').value;schedule();}};
 $('rfi-download').onclick=async()=>{const item=chosen();if(!item)return;if(!item.referencePlan){toast('กรุณากดอัปเดตภาพจากแบบปัจจุบัน เพื่อแนบแปลนอ้างอิงพร้อม Cloud',true);return;}checkImage();if(imageState(getProject(),item,engine)!=='current'&&!window.confirm('ภาพแนบอาจไม่ตรงกับแบบปัจจุบัน ต้องการส่ง PDF โดยใช้ภาพเดิมหรือไม่?'))return;if(!item.gridLine?.trim()){toast('กรุณาระบุขอบเขต Grid line เช่น Gl.A-B/1-2',true);$('rfi-grid').focus();return;}if(item.gridImageWarning&&!item.gridImageSource){toast('ยังแนบภาพหัวกริดไม่สำเร็จ: '+item.gridImageWarning,true);return;}const button=$('rfi-download');button.disabled=true;try{await exportRfi(item);}catch(e){toast(e.message,true);}finally{button.disabled=false;}};

 function screenRect(r){const c=getProject().camera;return {x:r.x*c.zoom+c.x,y:r.y*c.zoom+c.y,w:r.w*c.zoom,h:r.h*c.zoom};}
 $('rfi-resize').onclick=()=>{const item=chosen(),p=getProject();if(!item||p.calibration)return;if(item.sheetId!==p.selectedId){toast('เลือกแผ่นของวงนี้ในรายการแบบก่อน',true);return;}engine.tools?.activate("cloud-resize");p.panMode=false;stop();editing={id:item.id,project:p,rect:{...item.rect}};$('rfi-resize-actions').hidden=false;toast('ลากมุมสีน้ำเงิน แล้วกดบันทึกขนาด · ภาพจะอัปเดตตาม Layer ที่แสดงตอนนี้');engine.render();};
 $('rfi-resize-cancel').onclick=()=>stop();
 $('rfi-resize-save').onclick=async()=>{if(!editing)return;const target=chosen();if(!target||editing.project!==getProject()||target.id!==editing.id)return stop();const r=screenRect(editing.rect);if(r.x<0||r.y<0||r.x+r.w>engine.width||r.y+r.h>engine.height){toast('ซูมออกให้เห็นกรอบครบก่อนบันทึก',true);return;}await commitCloud(r,target);stop();};
 const pos=e=>{const q=engine.screen(e);return {x:Math.max(0,Math.min(engine.width,q.x)),y:Math.max(0,Math.min(engine.height,q.y))};};
 const rect=()=>({x:Math.min(drag.a.x,drag.b.x),y:Math.min(drag.a.y,drag.b.y),w:Math.abs(drag.a.x-drag.b.x),h:Math.abs(drag.a.y-drag.b.y)});
 canvas.addEventListener('pointerdown',e=>{if(e.button!==0||getProject()?.calibration)return;if(editing){if(editing.project!==getProject()||chosen()?.sheetId!==getProject().selectedId){stop();return;}const r=screenRect(editing.rect),q=pos(e),corners=[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}],index=corners.findIndex(c=>Math.hypot(q.x-c.x,q.y-c.y)<14);e.preventDefault();e.stopImmediatePropagation();if(index<0)return;drag={id:e.pointerId,a:corners[(index+2)%4],b:corners[index],project:getProject(),resize:true};canvas.setPointerCapture(e.pointerId);return;}if(!armed)return;e.preventDefault();e.stopImmediatePropagation();drag={id:e.pointerId,a:pos(e),b:pos(e),project:getProject()};canvas.setPointerCapture(e.pointerId);},true);
 canvas.addEventListener('pointermove',e=>{if(!drag)return;e.preventDefault();e.stopImmediatePropagation();drag.b=pos(e);engine.render();},true);
 canvas.addEventListener('pointerup',async e=>{if(!drag||e.pointerId!==drag.id)return;e.preventDefault();e.stopImmediatePropagation();const r=rect(),p=getProject(),valid=drag.project===p;if(drag.resize){drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(valid&&editing&&r.w>=15&&r.h>=15)editing.rect={...engine.world(r),w:r.w/p.camera.zoom,h:r.h/p.camera.zoom};engine.render();return;}drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);stop();if(!valid||r.w<15||r.h<15)return;
 await commitCloud(r);},true);
 engine.createRfiFromRect=r=>commitCloud(r);
 async function commitCloud(r,target=null,dimensionOverride){const p=getProject();
 try{engine.draw();const pad=12,x=Math.max(0,r.x-pad),y=Math.max(0,r.y-pad),w=Math.min(engine.width,r.x+r.w+pad)-x,h=Math.min(engine.height,r.y+r.h+pad)-y;const rendered=renderRfiCrop(engine,{x,y,w,h},{showDimensions:dimensionOverride??target?.showDimensions??true}),crop=rendered.canvas,d=rendered.scale;const ctx=crop.getContext('2d');ctx.scale(d,d);cloud(ctx,{x:r.x-x,y:r.y-y,w:r.w,h:r.h});const l=p.layers.find(l=>l.id===p.selectedId);const world=engine.world(r);const item={id:crypto.randomUUID(),createdAt:Date.now(),sheetId:l?.id,sheetName:l?.name||'',references:rfiReferences(p,engine.comparisonMode),showDimensions:dimensionOverride??target?.showDimensions??true,gridLine:'',gridImageWarning:'',question:'',image:crop.toDataURL('image/png'),rect:{...world,w:r.w/p.camera.zoom,h:r.h/p.camera.zoom}};item.referencePlan=captureReferencePlan(engine,item,cloud);item.keyPlan=renderKeyPlan(engine,item);if(item.keyPlanWarning)toast(item.keyPlanWarning);item.captureState=captureState(p,item,engine);item.imageUpdatedAt=Date.now();const gridLayer=p.layers.find(v=>v.id===p.baseId&&v.gridBands?.top&&v.gridBands?.side)||(l?.gridBands?.top&&l?.gridBands?.side?l:(p.layers.filter(v=>v.gridBands?.top&&v.gridBands?.side).length===1?p.layers.find(v=>v.gridBands?.top&&v.gridBands?.side):null));if(gridLayer){try{const framed=frameWithGrid(crop,gridLayer,engine.cache.get(gridLayer.assetId)?.source,{...engine.world({x,y}),w:w/p.camera.zoom,h:h/p.camera.zoom});item.image=framed.toDataURL('image/png');item.gridImageSource=gridLayer.name;toast("กำลังอ่านชื่อหัวกริดเฉพาะช่วง Cloud…");try{item.gridLine=dimensionOverride!==undefined?(target?.gridLine||""):(await readGridFrame(framed)||"");if(!item.gridLine)item.gridImageWarning="แนบภาพกริดแล้ว แต่อ่านชื่อกริดไม่ครบ กรุณาตรวจชื่อจากภาพ";}catch{item.gridImageWarning="แนบภาพกริดแล้ว แต่ OCR ไม่สำเร็จ กรุณาตรวจชื่อจากภาพ";}}catch(e){item.gridImageWarning="สร้าง Cloud แล้ว แต่ยังไม่แนบแถบกริด: "+e.message;}}if(target){Object.assign(item,{id:target.id,createdAt:target.createdAt,question:target.question,...(dimensionOverride!==undefined?{gridLine:target.gridLine}: {})});}const reference=p.layers.find(l=>l.id===p.baseId&&l.gridLines?.length)||l;
const suggested=dimensionOverride===undefined&&!gridLayer&&reference?.gridLines?.length?gridBounds(reference,item.rect):null;
if(suggested){item.gridLine=suggested;item.gridSource=reference.name;}else if(dimensionOverride===undefined&&!gridLayer&&reference?.gridLines?.length){item.gridLine='';item.gridSource=reference.name;toast('กริดไม่คร่อม Cloud หรือแนวเส้นไม่ขนาน กรุณาตรวจขอบเขตกริด',true);}
if(getProject()!==p)return;await mutate(target?'ปรับขนาดเมฆแล้ว':'',()=>{if(target)Object.assign(target,item);else (p.rfis??=[]).push(item);});refresh();$('rfi-list').value=item.id;show(item);}catch(e){toast(e.message,true);}}

 canvas.addEventListener('wheel',e=>{if(drag){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,passive:false});
 canvas.addEventListener('pointercancel',()=>stop());window.addEventListener('blur',stop);window.addEventListener('keydown',e=>{if(e.key==='Escape')stop();});
 engine.drawMarkup=()=>{const p=getProject();if(!p)return;if(p.calibration)return;const ctx=engine.ctx;ctx.save();ctx.setTransform(engine.dpr,0,0,engine.dpr,0,0);for(const item of p.rfis||[]){if(item.sheetId!==p.selectedId||item.id===editing?.id)continue;const r=item.rect,c=p.camera;if(item.id===selectedCloud){ctx.strokeStyle="#f59e0b";ctx.lineWidth=2;ctx.strokeRect(r.x*c.zoom+c.x-4,r.y*c.zoom+c.y-4,r.w*c.zoom+8,r.h*c.zoom+8);}cloud(ctx,{x:r.x*c.zoom+c.x,y:r.y*c.zoom+c.y,w:r.w*c.zoom,h:r.h*c.zoom});}if(editing&&editing.project===p){const box=drag?.resize?rect():screenRect(editing.rect);cloud(ctx,box);ctx.fillStyle='#38bdf8';for(const [x,y] of [[box.x,box.y],[box.x+box.w,box.y],[box.x+box.w,box.y+box.h],[box.x,box.y+box.h]])ctx.fillRect(x-5,y-5,10,10);}else if(drag)cloud(ctx,rect());ctx.restore();};
}
export async function exportRfi(item){
 await document.fonts.ready;
 const {jsPDF}=window.jspdf||{};if(!jsPDF)throw Error('ไม่พบ jsPDF ในโปรแกรม');
 const pdf=new jsPDF({unit:'mm',format:'a4'}),width=1440,height=2160;
 let c,ctx,y,separators=[];
 const font='24px Tahoma, sans-serif';
 function page(){separators=[];c=document.createElement('canvas');c.width=width*2;c.height=height*2;ctx=c.getContext('2d');ctx.scale(2,2);ctx.fillStyle='white';ctx.fillRect(0,0,width,height);ctx.fillStyle='#000';ctx.font=font;}
 function flush(){pdf.addImage(c.toDataURL('image/png'),'PNG',15,10,180,270);pdf.setDrawColor(0);pdf.setLineWidth(.45);pdf.rect(5,5,200,287);for(const v of separators)pdf.line(5,10+v*.125,205,10+v*.125);}
 function rule(v){separators.push(v);ctx.save();ctx.strokeStyle='#000';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,v);ctx.lineTo(width,v);ctx.stroke();ctx.restore();}
 function wrap(text,maxWidth){const rows=[];for(const raw of String(text||'').split('\n')){let row='';for(const ch of raw){if(ctx.measureText(row+ch).width>maxWidth){rows.push(row);row='';}row+=ch;}rows.push(row);}return rows;}
 function lines(text,maxWidth=width){for(const row of wrap(text,maxWidth)){if(y>2140){flush();pdf.addPage();page();y=50;}ctx.fillText(row,0,y);y+=34;}}
 page();ctx.font='bold 25px Arial';ctx.fillText('REQUEST FOR INFORMATION (RFI) - RITTA PROJECT',0,40);ctx.font=font;y=92;
 lines('วันที่: '+new Date().toLocaleDateString('th-TH'),1000);lines('แผ่นแบบอ้างอิง / Layer:',1000);
 for(const ref of item.references||[{name:item.sheetName}]){ctx.fillStyle=/^#[0-9a-f]{6}$/i.test(ref.color||'')?ref.color:'#94a3b8';ctx.fillRect(0,y-20,22,22);ctx.fillStyle='#000';lines('     '+ref.name,1000);}
 if(item.keyPlan){const key=new Image();key.src=item.keyPlan;await key.decode();const s=Math.min(300/key.width,210/key.height);ctx.drawImage(key,1130+(300-key.width*s)/2,10,key.width*s,key.height*s);ctx.save();ctx.font='20px Arial';ctx.textAlign='center';ctx.fillText('KEY PLAN',1280,245);ctx.restore();}
 else{ctx.save();ctx.font='20px Tahoma';ctx.fillText('ยังไม่มี Key Plan',1130,70);ctx.fillText('กรุณาอัปเดตภาพ RFI',1130,102);ctx.restore();}
 const img=new Image();img.src=item.image;await img.decode();
 // Overflowing reference lists continue before the fixed drawing / response layout.
 if(y>420){flush();pdf.addPage();page();y=40;}
 const top=Math.max(275,y+24),bottom=1330,ratio=Math.min(width/img.width,Math.max(1,bottom-top)/img.height);
 ctx.drawImage(img,(width-img.width*ratio)/2,top,img.width*ratio,img.height*ratio);rule(1360);y=1404;
 const question=[...wrap('ขอบเขต Grid line: '+(item.gridLine||''),width),...(item.gridSource?wrap('อ้างอิงกริด: '+item.gridSource,width):[]),...wrap('คำถาม / รายละเอียด:',width),...wrap(item.question||'—',width)];
 const answer=wrap(item.answer||'',width);
 function section(rows,start,end,title){y=start;for(const row of rows){if(y>end){flush();pdf.addPage();page();y=50;lines(title); }ctx.fillText(row,0,y);y+=34;}}
 section(question,1404,1670,'คำถาม / รายละเอียด (ต่อ)');
 const divider=Math.max(1710,y+15);if(divider>1750){flush();pdf.addPage();page();y=50;}else{rule(1710);y=1754;}
 ctx.font=font;lines('คำตอบ');section(answer,y,1990,'คำตอบ (ต่อ)');rule(2030);y=2074;lines('ผู้อนุมัติ: ____________________________________');lines('วันที่อนุมัติ: _________________________________');
 flush();if(item.referencePlan)await appendReferencePlan(pdf,item.referencePlan);pdf.save('RFI-'+new Date(item.createdAt).toISOString().replace(/[:.]/g,'-')+'.pdf');
}
