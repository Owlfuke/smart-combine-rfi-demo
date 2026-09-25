import {map} from './model.mjs';
import {drawMarkupItem} from './basic-markup.mjs';
import {drawMeasures} from './measurements.mjs';
import {cloud} from './rfi-cloud.mjs';

export function overlayBounds(layers){
 const points=layers.flatMap(layer=>[[0,0],[layer.width,0],[0,layer.height],[layer.width,layer.height]].map(([x,y])=>map(layer.transform,{x,y})));
 if(!points.length)throw Error('เปิดแสดงแผ่นแบบก่อนส่งออก');
 const x=Math.min(...points.map(point=>point.x)),y=Math.min(...points.map(point=>point.y)),w=Math.max(...points.map(point=>point.x))-x,h=Math.max(...points.map(point=>point.y))-y;
 if(!Number.isFinite(w+h)||w<=0||h<=0)throw Error('ขอบเขตแบบไม่ถูกต้อง');
 return {x,y,w,h};
}

export function renderOverlay(engine,{includeAnnotations=false}={}){
 const layers=[...engine.p.layers].reverse().filter(layer=>layer.visible&&layer.opacity>0);
 layers.sort((a,b)=>a.id===engine.p.baseId?-1:b.id===engine.p.baseId?1:0);
 const bounds=overlayBounds(layers),scale=Math.min(1,5000/Math.max(bounds.w,bounds.h),Math.sqrt(16000000/(bounds.w*bounds.h))),canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.ceil(bounds.w*scale));canvas.height=Math.max(1,Math.ceil(bounds.h*scale));
 const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
 for(const layer of layers){
  const image=engine.image(layer);if(!image)throw Error('ไม่พบภาพ '+layer.name);
  ctx.save();ctx.setTransform(scale,0,0,scale,-bounds.x*scale,-bounds.y*scale);const transform=layer.transform;ctx.transform(transform.a,transform.b,transform.c,transform.d,transform.e,transform.f);ctx.globalAlpha=layer.opacity;ctx.globalCompositeOperation=layer.blend;ctx.drawImage(image,0,0);ctx.restore();
 }
 const camera={zoom:scale,x:-bounds.x*scale,y:-bounds.y*scale};
 for(const layer of layers)for(const item of layer.markups||[])drawMarkupItem(ctx,layer,camera,item);
 if(includeAnnotations){
  const selected=layers.find(layer=>layer.id===engine.p.selectedId);
  if(selected)drawMeasures({p:{...engine.p,camera}},ctx);
  if(selected)for(const item of engine.p.rfis||[]){
   if(item.sheetId!==selected.id||!item.rect)continue;
   const {x,y,w,h}=item.rect;
   if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)continue;
   cloud(ctx,{x:(x-bounds.x)*scale,y:(y-bounds.y)*scale,w:w*scale,h:h*scale});
  }
 }
 canvas.overlayBounds=bounds;canvas.overlayScale=scale;return canvas;
}

export function installOverlayExport({engine,getProject,toast}){
 const button=document.createElement('button');button.textContent='Export แปลน PDF';button.id='export-overlay';document.getElementById('rfi-cloud').before(button);
 button.title='เต็มแปลนพร้อม Markup, Dimension และ Cloud ของแผ่นที่เลือก · ย่อพอดี A3 ไม่ใช่มาตราส่วนพิมพ์จริง';
 button.onclick=async()=>{
  if(!getProject()||getProject().calibration)return toast('จบ Calibrate ก่อนส่งออกแปลน',true);
  if(engine.comparisonMode&&engine.comparisonMode!=='normal')return toast('เลือกแสดงทุกแผ่นในเครื่องมือเสริมก่อนส่งออกแปลน',true);
  button.disabled=true;const label=button.textContent;button.textContent='กำลังส่งออก…';let canvas;
  try{
   await new Promise(requestAnimationFrame);canvas=renderOverlay(engine,{includeAnnotations:true});
   const {jsPDF}=window.jspdf||{};if(!jsPDF)throw Error('ไม่พบเครื่องมือ PDF');
   const pdf=new jsPDF({orientation:canvas.width>=canvas.height?'landscape':'portrait',unit:'mm',format:'a3'}),width=pdf.internal.pageSize.getWidth(),height=pdf.internal.pageSize.getHeight(),scale=Math.min((width-20)/canvas.width,(height-20)/canvas.height);
   pdf.addImage(canvas.toDataURL('image/png'),'PNG',(width-canvas.width*scale)/2,(height-canvas.height*scale)/2,canvas.width*scale,canvas.height*scale);pdf.save('Overlay-'+new Date().toISOString().slice(0,10)+'.pdf');toast('ส่งออกแปลน A3 แล้ว · ย่อพอดีกระดาษ ไม่ใช่มาตราส่วนจริง');
  }catch(error){toast(error.message,true);}
  finally{if(canvas)canvas.width=canvas.height=0;button.disabled=false;button.textContent=label;}
 };
}
