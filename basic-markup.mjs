import {inverse,map} from './model.mjs';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const point=(layer,camera,value,region={x:0,y:0},density=1)=>{
 const world=map(layer.transform,value);
 return {x:(world.x*camera.zoom+camera.x-region.x)*density,y:(world.y*camera.zoom+camera.y-region.y)*density};
};
const quad=(layer,camera,item,region,density)=>{
 const left=Math.min(item.a.x,item.b.x),right=Math.max(item.a.x,item.b.x),top=Math.min(item.a.y,item.b.y),bottom=Math.max(item.a.y,item.b.y);
 return [{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}].map(value=>point(layer,camera,value,region,density));
};
const polygonPath=(ctx,points)=>{
 ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(let index=1;index<points.length;index++)ctx.lineTo(points[index].x,points[index].y);ctx.closePath();
};
const fillShape=(ctx,item,path)=>{
 if(!(item.fillOpacity>0))return;ctx.save();ctx.globalAlpha*=clamp(item.fillOpacity,0,1);ctx.fillStyle=item.fill||'#facc15';path();ctx.fill();ctx.restore();
};
function ellipseGeometry(layer,camera,item,region,density){
 const center={x:(item.a.x+item.b.x)/2,y:(item.a.y+item.b.y)/2},rx=Math.abs(item.b.x-item.a.x)/2,ry=Math.abs(item.b.y-item.a.y)/2;
 const c=point(layer,camera,center,region,density),px=point(layer,camera,{x:center.x+rx,y:center.y},region,density),py=point(layer,camera,{x:center.x,y:center.y+ry},region,density);
 return {c,rx:Math.hypot(px.x-c.x,px.y-c.y),ry:Math.hypot(py.x-c.x,py.y-c.y),angle:Math.atan2(px.y-c.y,px.x-c.x)};
}
function drawArrow(ctx,a,b,size){
 const angle=Math.atan2(b.y-a.y,b.x-a.x);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-size*Math.cos(angle-.48),b.y-size*Math.sin(angle-.48));ctx.lineTo(b.x-size*Math.cos(angle+.48),b.y-size*Math.sin(angle+.48));ctx.closePath();ctx.fill();
}
export function drawMarkupItem(ctx,layer,camera,item,region={x:0,y:0},density=1){
 if(!item?.a||!item?.b)return;const a=point(layer,camera,item.a,region,density),b=point(layer,camera,item.b,region,density),width=clamp(Number(item.width)||2,1,20)*density;
 ctx.save();ctx.globalAlpha=clamp(item.opacity??1,0.05,1);ctx.strokeStyle=ctx.fillStyle=item.stroke||'#ef4444';ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';
 if(item.kind==='line'){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
 else if(item.kind==='arrow')drawArrow(ctx,a,b,Math.max(10*density,width*4));
 else if(item.kind==='rect'||item.kind==='hatch'){
  const points=quad(layer,camera,item,region,density),path=()=>polygonPath(ctx,points);fillShape(ctx,item,path);
  if(item.kind==='hatch'){
   ctx.save();path();ctx.clip();const xs=points.map(v=>v.x),ys=points.map(v=>v.y),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys),height=bottom-top,spacing=clamp(Number(item.spacing)||12,5,80)*density;
   ctx.lineWidth=Math.max(1,width*.7);for(let x=left-height;x<right+height;x+=spacing){ctx.beginPath();ctx.moveTo(x,bottom);ctx.lineTo(x+height,top);ctx.stroke();if(item.pattern==='cross'){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x+height,bottom);ctx.stroke();}}ctx.restore();
  }
  path();ctx.stroke();
 }else if(item.kind==='ellipse'){
  const e=ellipseGeometry(layer,camera,item,region,density),path=()=>{ctx.beginPath();ctx.ellipse(e.c.x,e.c.y,e.rx,e.ry,e.angle,0,Math.PI*2);};fillShape(ctx,item,path);path();ctx.stroke();
 }else if(item.kind==='text'){
  const size=clamp(Number(item.fontSize)||18,8,96)*density,text=String(item.text||'');ctx.font=size+'px Tahoma, sans-serif';ctx.textBaseline='top';
  if(item.fillOpacity>0){const metrics=ctx.measureText(text);ctx.save();ctx.globalAlpha*=clamp(item.fillOpacity,0,1);ctx.fillStyle=item.fill||'#fef08a';ctx.fillRect(a.x-4*density,a.y-3*density,metrics.width+8*density,size*1.35);ctx.restore();}
  ctx.fillStyle=item.stroke||'#ef4444';ctx.fillText(text,a.x,a.y);
 }ctx.restore();
}
export function drawBasicMarkups(engine,ctx,region={x:0,y:0},density=1,{allLayers=true}={}){
 const project=engine.p;if(!project)return;const layers=allLayers?project.layers.filter(layer=>layer.visible):project.layers.filter(layer=>layer.id===project.selectedId&&layer.visible);
 for(const layer of layers)for(const item of layer.markups||[])drawMarkupItem(ctx,layer,project.camera,item,region,density);
}
const segmentDistance=(q,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((q.x-a.x)*dx+(q.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(q.x-a.x-t*dx,q.y-a.y-t*dy);};
const inPolygon=(q,points)=>{let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>q.y)!==(b.y>q.y)&&q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y||1e-9)+a.x)inside=!inside;}return inside;};
export function hitMarkup(layer,camera,item,q){
 const a=point(layer,camera,item.a),b=point(layer,camera,item.b),tolerance=Math.max(9,(Number(item.width)||2)+6);
 if(item.kind==='line'||item.kind==='arrow')return segmentDistance(q,a,b)<=tolerance;
 if(item.kind==='rect'||item.kind==='hatch'){const points=quad(layer,camera,item,{x:0,y:0},1);if(inPolygon(q,points))return true;return points.some((value,index)=>segmentDistance(q,value,points[(index+1)%points.length])<=tolerance);}
 if(item.kind==='ellipse'){const e=ellipseGeometry(layer,camera,item,{x:0,y:0},1),cos=Math.cos(-e.angle),sin=Math.sin(-e.angle),dx=q.x-e.c.x,dy=q.y-e.c.y,x=dx*cos-dy*sin,y=dx*sin+dy*cos,n=Math.hypot(x/(e.rx||1),y/(e.ry||1));return n<=1.08;}
 if(item.kind==='text'){const size=clamp(Number(item.fontSize)||18,8,96),width=Math.max(size,String(item.text||'').length*size*.62);return q.x>=a.x-8&&q.x<=a.x+width+8&&q.y>=a.y-8&&q.y<=a.y+size*1.5;}
 return false;
}
export function installBasicMarkup({engine,getProject,mutate,toast}){
 const cloudButton=document.getElementById('rfi-cloud'),button=document.createElement('button');button.id='markup-tools';button.textContent='Markup';button.setAttribute('aria-expanded','false');cloudButton.before(button);
 const panel=document.createElement('div');panel.id='markup-panel';panel.className='markup-panel';panel.hidden=true;panel.innerHTML='<div class="markup-tool-buttons" role="toolbar" aria-label="ชนิด Markup"><button data-markup="line">╱ เส้น</button><button data-markup="arrow">↗ ลูกศร</button><button data-markup="rect">□ สี่เหลี่ยม</button><button data-markup="ellipse">○ วงรี</button><button data-markup="hatch">▧ Hatch</button><button data-markup="text">T ข้อความ</button></div><label>สีเส้น <input class="markup-stroke" type="color" value="#ef4444"></label><label>ความหนา <select class="markup-width"><option>1</option><option selected>2</option><option>4</option><option>6</option><option>10</option></select></label><label>สีพื้น <input class="markup-fill" type="color" value="#facc15"></label><label>พื้นทึบ <input class="markup-fill-opacity" type="range" min="0" max="100" value="20"><output>20%</output></label><label>Hatch <select class="markup-pattern"><option value="diagonal">เฉียง</option><option value="cross">ตารางไขว้</option></select></label><label>ข้อความ <input class="markup-text" maxlength="200" placeholder="กรอกก่อนวางข้อความ"></label><label>ขนาด <select class="markup-font-size"><option>14</option><option selected>18</option><option>24</option><option>32</option><option>48</option></select></label><button class="markup-delete danger">ลบที่เลือก</button><button class="markup-close">ปิด</button>';
 document.getElementById('canvas-viewport').append(panel);
 const canvas=engine.canvas,selectedLayer=()=>{const project=getProject();return project?.layers.find(layer=>layer.id===project.selectedId);};
 const controls={stroke:panel.querySelector('.markup-stroke'),width:panel.querySelector('.markup-width'),fill:panel.querySelector('.markup-fill'),fillOpacity:panel.querySelector('.markup-fill-opacity'),pattern:panel.querySelector('.markup-pattern'),text:panel.querySelector('.markup-text'),fontSize:panel.querySelector('.markup-font-size')};
 let mode=null,drag=null,selectedId=null,edit=null;
 const localPoint=(layer,screen)=>map(inverse(layer.transform),engine.world(screen));
 const chosen=()=>selectedLayer()?.markups?.find(item=>item.id===selectedId)||null;
 const style=()=>({stroke:controls.stroke.value,width:Number(controls.width.value),fill:controls.fill.value,fillOpacity:Number(controls.fillOpacity.value)/100,opacity:1,pattern:controls.pattern.value,spacing:12,text:controls.text.value.trim(),fontSize:Number(controls.fontSize.value)});
 const syncControls=item=>{if(!item)return;controls.stroke.value=item.stroke||'#ef4444';controls.width.value=String(item.width||2);controls.fill.value=item.fill||'#facc15';controls.fillOpacity.value=String(Math.round((item.fillOpacity??.2)*100));controls.fillOpacity.nextElementSibling.value=controls.fillOpacity.value+'%';controls.pattern.value=item.pattern||'diagonal';controls.text.value=item.text||'';controls.fontSize.value=String(item.fontSize||18);};
 const close=()=>{mode=null;drag=null;edit=null;engine.markupMode=null;panel.hidden=true;button.setAttribute('aria-expanded','false');for(const item of panel.querySelectorAll('[data-markup]'))item.setAttribute('aria-pressed','false');engine.cursor();engine.render();window.dispatchEvent(new Event('drawing-tool-change'));};
 engine.tools?.register('markup',close);
 button.onclick=()=>{if(!panel.hidden){if(engine.tools?.active==='markup')engine.tools.reset();else close();return;}panel.hidden=false;button.setAttribute('aria-expanded','true');syncControls(chosen());};
 panel.querySelector('.markup-close').onclick=()=>{if(engine.tools?.active==='markup')engine.tools.reset();else close();};
 for(const tool of panel.querySelectorAll('[data-markup]'))tool.onclick=()=>{
  const layer=selectedLayer(),project=getProject(),next=tool.dataset.markup;if(mode===next&&engine.tools?.active==='markup'){engine.tools.reset();return;}
  if(!layer||!layer.visible||layer.locked||project.calibration){toast('เลือกแผ่นที่แสดงและปลดล็อกก่อน',true);return;}if(next==='text'&&!controls.text.value.trim()){toast('กรอกข้อความก่อนเลือกเครื่องมือข้อความ',true);controls.text.focus();return;}
  engine.tools?.activate('markup');mode=next;engine.markupMode=next;project.panMode=false;panel.hidden=false;button.setAttribute('aria-expanded','true');for(const item of panel.querySelectorAll('[data-markup]'))item.setAttribute('aria-pressed',String(item===tool));engine.cursor();window.dispatchEvent(new Event('drawing-tool-change'));toast(next==='text'?'คลิกตำแหน่งวางข้อความ':'ลากจากจุดแรกไปจุดที่สอง');
 };
 controls.fillOpacity.oninput=()=>controls.fillOpacity.nextElementSibling.value=controls.fillOpacity.value+'%';
 const updateSelected=async()=>{const item=chosen(),layer=selectedLayer();if(!item||!layer||layer.locked||getProject()?.calibration)return;const next=style();try{await mutate('ปรับรูปแบบ Markup แล้ว',()=>Object.assign(item,next));engine.render();}catch(error){toast(error.message,true);}};
 for(const control of Object.values(controls))control.addEventListener('change',updateSelected);
 const handles=item=>item.kind==='text'?[point(selectedLayer(),getProject().camera,item.a)]:[point(selectedLayer(),getProject().camera,item.a),point(selectedLayer(),getProject().camera,item.b)];
 engine.clearMarkupSelection=()=>{selectedId=null;edit=null;engine.render();};
 engine.selectMarkup=q=>{const layer=selectedLayer();selectedId=null;if(layer?.visible)for(const item of [...(layer.markups||[])].reverse())if(hitMarkup(layer,getProject().camera,item,q)){selectedId=item.id;syncControls(item);panel.hidden=false;button.setAttribute('aria-expanded','true');break;}engine.render();return !!selectedId;};
 engine.deleteSelectedMarkup=()=>{const layer=selectedLayer(),item=chosen();if(!layer||!item||layer.locked||getProject()?.calibration)return false;const id=item.id;selectedId=null;mutate('ลบ Markup แล้ว',()=>layer.markups=layer.markups.filter(value=>value.id!==id)).catch(error=>toast(error.message,true));return true;};
 panel.querySelector('.markup-delete').onclick=()=>{if(!engine.deleteSelectedMarkup())toast('เลือก Markup ก่อนลบ',true);};
 canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0||getProject()?.calibration||getProject()?.panMode)return;
  const layer=selectedLayer(),q=engine.screen(event);
  if(mode&&engine.tools?.active==='markup'){
   if(!layer||!layer.visible||layer.locked)return;eager(event);const start=localPoint(layer,q);drag={id:event.pointerId,project:getProject(),layer,item:{id:crypto.randomUUID(),kind:mode,a:start,b:start,...style()}};canvas.setPointerCapture(event.pointerId);engine.render();return;
  }
  if(engine.tools?.active!=='measure'||engine.measureMode!=='select'||!chosen()||!layer)return;
  const item=chosen(),points=handles(item),index=points.findIndex(value=>Math.hypot(q.x-value.x,q.y-value.y)<=12);if(index<0&&!hitMarkup(layer,getProject().camera,item,q))return;
  eager(event);edit={id:event.pointerId,project:getProject(),layer,itemId:item.id,key:index===0?'a':index===1?'b':'move',start:q,end:q};canvas.setPointerCapture(event.pointerId);engine.render();
 },true);
 canvas.addEventListener('pointermove',event=>{if(drag){eager(event);drag.item.b=localPoint(drag.layer,engine.screen(event));engine.render();}else if(edit){eager(event);edit.end=engine.screen(event);engine.render();}},true);
 canvas.addEventListener('pointerup',async event=>{
  if(drag&&event.pointerId===drag.id){eager(event);const current=drag;drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(current.project!==getProject()||current.layer!==selectedLayer()||current.layer.locked)return;current.item.b=localPoint(current.layer,engine.screen(event));const a=point(current.layer,getProject().camera,current.item.a),b=point(current.layer,getProject().camera,current.item.b);if(current.item.kind!=='text'&&Math.hypot(b.x-a.x,b.y-a.y)<8)return engine.render();try{await mutate('เพิ่ม Markup แล้ว',()=>{(current.layer.markups??=[]).push(current.item);selectedId=current.item.id;});syncControls(current.item);}catch(error){toast(error.message,true);}engine.render();return;}
  if(edit&&event.pointerId===edit.id){eager(event);const current=edit;edit=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(current.project!==getProject()||current.layer!==selectedLayer()||current.layer.locked)return;const item=chosen();if(!item||item.id!==current.itemId||Math.hypot(current.end.x-current.start.x,current.end.y-current.start.y)<2)return engine.render();try{await mutate(current.key==='move'?'ย้าย Markup แล้ว':'ปรับขนาด Markup แล้ว',()=>{if(current.key==='move'){const from=localPoint(current.layer,current.start),to=localPoint(current.layer,current.end),dx=to.x-from.x,dy=to.y-from.y;item.a={x:item.a.x+dx,y:item.a.y+dy};item.b={x:item.b.x+dx,y:item.b.y+dy};}else item[current.key]=localPoint(current.layer,current.end);});}catch(error){toast(error.message,true);}engine.render();}
 },true);
 canvas.addEventListener('pointercancel',()=>{drag=null;edit=null;engine.render();});
 function eager(event){event.preventDefault();event.stopImmediatePropagation();}
 const prior=engine.drawMarkup;engine.drawMarkup=()=>{prior?.();if(getProject()?.calibration)return;const ctx=engine.ctx;ctx.save();ctx.setTransform(engine.dpr,0,0,engine.dpr,0,0);drawBasicMarkups(engine,ctx);if(drag)drawMarkupItem(ctx,drag.layer,getProject().camera,drag.item);let active=chosen();if(active&&selectedLayer()?.visible){if(edit){active=structuredClone(active);if(edit.key==='move'){const from=localPoint(edit.layer,edit.start),to=localPoint(edit.layer,edit.end),dx=to.x-from.x,dy=to.y-from.y;active.a={x:active.a.x+dx,y:active.a.y+dy};active.b={x:active.b.x+dx,y:active.b.y+dy};}else active[edit.key]=localPoint(edit.layer,edit.end);drawMarkupItem(ctx,edit.layer,getProject().camera,{...active,opacity:.45});}ctx.fillStyle='#f59e0b';for(const value of active.kind==='text'?[active.a]:[active.a,active.b]){const q=point(selectedLayer(),getProject().camera,value);ctx.fillRect(q.x-5,q.y-5,10,10);}}ctx.restore();};
}
