import {map,similarity,identity} from "./model.mjs";
export class Engine {
  constructor(canvas,guide,{change,status,error}){
    Object.assign(this,{canvas,guide,change,status,error});this.ctx=canvas.getContext("2d");this.gctx=guide.getContext("2d");
    this.cache=new Map();this.width=1;this.height=1;this.dpr=1;this.pointer=null;this.drag=null;this.frame=0;this.p=null;
    const on=(type,fn,options)=>canvas.addEventListener(type,event=>{try{fn(event);}catch(e){error(e);}},options);
    on("contextmenu",e=>e.preventDefault());on("mousedown",e=>{if(e.button===1)e.preventDefault();});on("auxclick",e=>{if(e.button===1)e.preventDefault();});
    on("pointerenter",e=>this.track(e));on("pointerleave",()=>{this.pointer=null;this.drawGuide();});
    on("pointerdown",e=>{
      if(!this.p||this.drag)return;this.track(e);
      if(e.button===1||e.button===2||(e.button===0&&this.p.panMode&&!this.p.calibration)){
        e.preventDefault();this.drag={id:e.pointerId,...this.screen(e)};canvas.setPointerCapture(e.pointerId);this.cursor();this.drawGuide();
      }else if(e.button===0&&this.p.calibration)this.pick(this.world(this.screen(e)));
    });
    on("pointermove",e=>{
      this.track(e);if(!this.drag||this.drag.id!==e.pointerId)return;
      const q=this.screen(e);this.p.camera.x+=q.x-this.drag.x;this.p.camera.y+=q.y-this.drag.y;
      Object.assign(this.drag,q);this.render();
    });
    const stop=e=>{if(this.drag?.id!==e.pointerId)return;this.drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);this.cursor();this.drawGuide();this.change(false);};
    ["pointerup","pointercancel","lostpointercapture"].forEach(name=>on(name,stop));
    on("wheel",e=>{e.preventDefault();if(!this.p)return;this.track(e);const unit=e.deltaMode===1?16:e.deltaMode===2?this.height:1;this.zoom(Math.exp(-Math.max(-300,Math.min(300,e.deltaY*unit))*0.0015),this.screen(e));},{passive:false});
    window.addEventListener("blur",()=>{this.pointer=null;this.drag=null;this.cursor();this.drawGuide();});
    new ResizeObserver(()=>this.resize()).observe(canvas.parentElement);window.addEventListener("resize",()=>this.resize());this.resize();
  }
  async load(p,blobs){
    const fresh=new Map();
    try{
      for(const l of p.layers){
        if(this.cache.has(l.assetId)){fresh.set(l.assetId,this.cache.get(l.assetId));continue;}
        const blob=blobs.get(l.assetId);if(!blob)throw Error("ไม่พบภาพที่บันทึก: "+l.name);
        const bitmap=await createImageBitmap(blob);
        try{
          if(bitmap.width*bitmap.height>24000000)throw Error("ภาพใหญ่เกินขีดจำกัด");
          const c=document.createElement("canvas");c.width=bitmap.width;c.height=bitmap.height;c.getContext("2d").drawImage(bitmap,0,0);
          fresh.set(l.assetId,{source:c,tint:null,color:null});
          if(l.legacyDimensions){l.width=c.width;l.height=c.height;delete l.legacyDimensions;}
        }finally{bitmap.close();}
      }
    }catch(e){for(const [id,v] of fresh)if(!this.cache.has(id))v.source.width=v.source.height=0;throw e;}
    for(const [id,v] of this.cache)if(!fresh.has(id)){v.source.width=v.source.height=0;if(v.tint)v.tint.width=v.tint.height=0;}
    this.cache=fresh;this.p=p;this.cursor();this.render();
  }
  screen(e){const r=this.canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*this.width/r.width,y:(e.clientY-r.top)*this.height/r.height};}
  world(q){const c=this.p.camera;return {x:(q.x-c.x)/c.zoom,y:(q.y-c.y)/c.zoom};}
  track(e){this.pointer={clientX:e.clientX,clientY:e.clientY};this.scheduleGuide();}
  scheduleGuide(){
    if(this.guideFrame)return;
    this.guideFrame=requestAnimationFrame(()=>{this.guideFrame=0;try{this.drawGuide();}catch(e){this.error(e);}});
  }
  cursor(){this.canvas.style.cursor=this.drag?"grabbing":this.p?.calibration&&this.stage()!=="review"?"none":this.p?.panMode?"grab":"default";}
  resize(){
    const r=this.canvas.parentElement.getBoundingClientRect();
    if(r.width<2||r.height<2)return;
    const w=r.width,h=r.height;
    if(this.p){const dx=(w-this.width)/2,dy=(h-this.height)/2;this.p.camera.x+=dx;this.p.camera.y+=dy;
      if(this.p.calibration){this.p.calibration.previousCamera.x+=dx;this.p.calibration.previousCamera.y+=dy;}
      this.p.viewSize={width:w,height:h};
    }
    this.width=w;this.height=h;this.dpr=Math.min(devicePixelRatio||1,2);
    for(const c of [this.canvas,this.guide]){c.width=Math.round(w*this.dpr);c.height=Math.round(h*this.dpr);}
    if(this.pendingFit){this.pendingFit=false;this.fit();}else this.render();
  }
  fit(){
    if(!this.p)return;
    const bounds=this.canvas.parentElement.getBoundingClientRect();
    if(bounds.width<2||bounds.height<2){this.pendingFit=true;return;}
    this.pendingFit=false;
    const p=this.p,cal=p.calibration;let layers=p.layers.filter(l=>l.visible),points=[];
    if(cal&&this.stage()!=="review")layers=[p.layers.find(l=>l.id===(this.stage()==="base"?p.baseId:cal.layerId))].filter(Boolean);
    for(const l of layers){
      let t=l.transform;
      if(cal&&this.stage()!=="review")t=identity();
      if(cal&&this.stage()==="review"&&cal.mode==="align"&&l.id===cal.layerId)t=this.result().matrix;
      points.push(...[{x:0,y:0},{x:l.width,y:0},{x:l.width,y:l.height},{x:0,y:l.height}].map(q=>map(t,q)));
    }
    if(!points.length){p.camera={x:0,y:0,zoom:1};this.render();return;}
    const x=Math.min(...points.map(q=>q.x)),y=Math.min(...points.map(q=>q.y));
    const w=Math.max(...points.map(q=>q.x))-x,h=Math.max(...points.map(q=>q.y))-y;
    const z=Math.max(.0001,Math.min(100,(this.width-64)/w,(this.height-64)/h));
    p.camera={zoom:z,x:(this.width-w*z)/2-x*z,y:(this.height-h*z)/2-y*z};this.render();this.change(false);
  }
  zoom(factor,q={x:this.width/2,y:this.height/2}){
    const world=this.world(q),c=this.p.camera;c.zoom=Math.max(.0001,Math.min(100,c.zoom*factor));
    c.x=q.x-world.x*c.zoom;c.y=q.y-world.y*c.zoom;this.render();this.change(false);
  }
  stage(){const c=this.p?.calibration;if(!c)return null;const n=c.mode==="align"?2:1;return c.p.length<n?"base":c.q.length<n?"overlay":"review";}
  begin(mode){
    const p=this.p,l=p.layers.find(l=>l.id===p.selectedId),base=p.layers.find(l=>l.id===p.baseId);
    if(!l||!base||l===base)throw Error("เลือกแผ่นซ้อนที่ต้องการจับคู่ก่อน");
    if(l.locked)throw Error("ปลดล็อกแผ่นซ้อนก่อนจับคู่");
    if(!l.visible||!base.visible)throw Error("เปิดการแสดงแผ่นฐานและแผ่นซ้อนก่อน");
    if(mode==="check"&&!l.alignment)throw Error("จับคู่กริดสองจุดก่อนตรวจจุดที่สาม");
    p.calibration={mode,layerId:l.id,p:[],q:[],previousCamera:{...p.camera}};
    this.cursor();this.fit();this.change(true);
  }
  cancel(){if(!this.p.calibration)return;this.p.camera=this.p.calibration.previousCamera;this.p.calibration=null;this.cursor();this.render();this.change(true);}
  back(){
    const c=this.p.calibration;if(!c)return;const old=this.stage();
    if(c.q.length)c.q.pop();else c.p.pop();
    if(this.stage()!==old)this.fit();this.render();this.change(true);
  }
  pick(point){
    const c=this.p.calibration;if(!c||this.stage()==="review")return;
    const isBase=this.stage()==="base",l=this.p.layers.find(l=>l.id===(isBase?this.p.baseId:c.layerId));
    if(point.x<0||point.y<0||point.x>l.width||point.y>l.height)throw Error("กรุณาคลิกภายในแผ่นแบบ");
    const list=isBase?c.p:c.q;
    if(list.length&&Math.hypot(point.x-list[0].x,point.y-list[0].y)<1)throw Error("จุดซ้ำหรือใกล้กันเกินไป กรุณาเลือกใหม่");
    if(c.mode==="check"){
      const align=this.p.layers.find(l=>l.id===c.layerId).alignment;
      if((isBase?align.p:align.q).some(q=>Math.hypot(q.x-point.x,q.y-point.y)<10))throw Error("เลือกจุดตรวจอิสระที่ต่างจากจุดจับคู่เดิม");
    }
    const old=this.stage();list.push(point);
    try{if(this.stage()==="review"&&c.mode==="align")this.result();}catch(e){list.pop();throw e;}
    if(old!==this.stage())this.fit();this.render();this.change(true);
  }
  result(){
    const c=this.p.calibration;if(!c||this.stage()!=="review")return null;
    if(c.mode==="align")return similarity(...c.p,...c.q);
    const l=this.p.layers.find(l=>l.id===c.layerId),mapped=map(l.transform,c.q[0]);
    const errorPx=Math.hypot(mapped.x-c.p[0].x,mapped.y-c.p[0].y);
    return {errorPx,relative:errorPx/Math.hypot(l.alignment.p[1].x-l.alignment.p[0].x,l.alignment.p[1].y-l.alignment.p[0].y)*100};
  }
  apply(){
    const c=this.p.calibration,l=this.p.layers.find(l=>l.id===c.layerId),r=this.result();
    if(!r)return;
    if(c.mode==="align"){l.transform=r.matrix;l.alignment={p:c.p,q:c.q,baseId:this.p.baseId};l.check=null;this.p.showMarkers=false;}
    else l.check={p:c.p[0],q:c.q[0],...r};
    this.p.calibration=null;this.cursor();this.fit();
  }
  image(l){
    const item=this.cache.get(l.assetId);if(!item)return null;
    if(l.colorMode==="original")return item.source;
    if(!item.tint||item.color!==l.color){
      const c=document.createElement("canvas");c.width=l.width;c.height=l.height;
      const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(item.source,0,0);
      const pixels=x.getImageData(0,0,c.width,c.height),d=pixels.data;
      const color=l.color.match(/\w\w/g).map(v=>parseInt(v,16));
      for(let i=0;i<d.length;i+=4){d[i+3]=Math.round(d[i+3]*(1-(.2126*d[i]+.7152*d[i+1]+.0722*d[i+2])/255));d[i]=color[0];d[i+1]=color[1];d[i+2]=color[2];}
      x.putImageData(pixels,0,0);if(item.tint)item.tint.width=item.tint.height=0;item.tint=c;item.color=l.color;
    }
    return item.tint;
  }
  render(){
    if(this.frame)return;
    this.frame=requestAnimationFrame(()=>{this.frame=0;try{this.draw();this.drawMarkup?.();this.drawGuide();}catch(e){this.error(e);}});
  }
  draw(){
    const x=this.ctx;x.setTransform(1,0,0,1,0,0);x.clearRect(0,0,this.canvas.width,this.canvas.height);
    if(!this.p?.layers.length)return;
    x.fillStyle="#fff";x.fillRect(0,0,this.canvas.width,this.canvas.height);
    const p=this.p,cal=p.calibration,stage=this.stage(),cam=p.camera;
    let layers=[...p.layers].reverse(); // Top row is frontmost; base is always drawn first.
    layers.sort((a,b)=>a.id===p.baseId?-1:b.id===p.baseId?1:0);
    if(cal&&stage!=="review")layers=layers.filter(l=>l.id===(stage==="base"?p.baseId:cal.layerId));
    if(cal&&stage==="review")layers=layers.filter(l=>l.id===p.baseId||l.id===cal.layerId);
    const comparison=!cal&&this.comparisonMode!=='normal'&&this.comparisonMode&&p.selectedId!==p.baseId&&p.layers.some(l=>l.id===p.selectedId)&&p.layers.some(l=>l.id===p.baseId);
    if(comparison)layers=layers.filter(l=>l.id===p.baseId||l.id===p.selectedId);
    for(const l of layers){
      if(!cal&&!comparison&&!l.visible)continue;
      const raw=!!cal&&stage!=="review";
      const image=comparison?(this.comparisonMode==='swipe'?this.cache.get(l.assetId)?.source:this.image({...l,colorMode:'tint',color:l.id===p.baseId?'#ef4444':'#2563eb'})):raw?this.cache.get(l.assetId)?.source:this.image(l);if(!image)continue;
      x.save();
      if(comparison&&this.comparisonMode==='swipe'){const split=this.canvas.width*(this.comparisonSplit??.5);x.beginPath();x.rect(l.id===p.baseId?0:split,0,l.id===p.baseId?split:this.canvas.width-split,this.canvas.height);x.clip();}
      x.setTransform(this.dpr*cam.zoom,0,0,this.dpr*cam.zoom,this.dpr*cam.x,this.dpr*cam.y);
      const t=raw?identity():cal&&stage==="review"&&cal.mode==="align"&&l.id===cal.layerId?this.result().matrix:l.transform;
      x.transform(t.a,t.b,t.c,t.d,t.e,t.f);
      if(comparison){x.globalAlpha=1;x.globalCompositeOperation=this.comparisonMode==="swipe"?"source-over":"multiply";}else if(!raw){x.globalAlpha=l.opacity;x.globalCompositeOperation=l.blend;}
      x.drawImage(image,0,0);x.restore();
    }
    if(comparison&&this.comparisonMode==='swipe'){x.save();x.strokeStyle='#38bdf8';x.lineWidth=2*this.dpr;x.beginPath();const split=this.canvas.width*(this.comparisonSplit??.5);x.moveTo(split,0);x.lineTo(split,this.canvas.height);x.stroke();x.restore();}
    if(cal&&stage!=="review"){
      const points=stage==="base"?cal.p:cal.q;
      points.forEach((q,i)=>this.marker(q,stage==="base"?"#ef4444":"#2563eb",(stage==="base"?"P":"Q")+(cal.mode==="check"?3:i+1)));
    }else if(p.showMarkers&&!cal){
      const l=p.layers.find(l=>l.id===p.selectedId);
      if(l?.alignment){l.alignment.p.forEach((q,i)=>this.marker(q,"#ef4444","P"+(i+1)));l.alignment.q.forEach((q,i)=>this.marker(map(l.transform,q),"#2563eb","Q"+(i+1),22));}
      if(l?.check){this.marker(l.check.p,"#ef4444","P3");this.marker(map(l.transform,l.check.q),"#2563eb","Q3",22);}
    }
  }
  marker(q,color,label,offset=-12){
    const x=this.ctx,c=this.p.camera,px=q.x*c.zoom+c.x,py=q.y*c.zoom+c.y;
    x.save();x.setTransform(this.dpr,0,0,this.dpr,0,0);x.strokeStyle=color;x.lineWidth=2;x.beginPath();x.arc(px,py,6,0,7);x.moveTo(px-12,py);x.lineTo(px+12,py);x.moveTo(px,py-12);x.lineTo(px,py+12);x.stroke();
    x.font="bold 12px system-ui";x.lineWidth=3;x.strokeStyle="white";x.strokeText(label,px+14,py+offset);x.fillStyle=color;x.fillText(label,px+14,py+offset);x.restore();
  }
  drawGuide(){
    if(this.guideFrame){cancelAnimationFrame(this.guideFrame);this.guideFrame=0;}
    const x=this.gctx;x.setTransform(1,0,0,1,0,0);x.clearRect(0,0,this.guide.width,this.guide.height);
    if(!this.p?.calibration||this.stage()==="review"||!this.pointer||this.drag)return;
    const q=this.screen(this.pointer);if(q.x<0||q.y<0||q.x>this.width||q.y>this.height)return;
    x.save();x.setTransform(this.dpr,0,0,this.dpr,0,0);x.beginPath();
    x.moveTo(0,q.y);x.lineTo(q.x-5,q.y);x.moveTo(q.x+5,q.y);x.lineTo(this.width,q.y);
    x.moveTo(q.x,0);x.lineTo(q.x,q.y-5);x.moveTo(q.x,q.y+5);x.lineTo(q.x,this.height);x.rect(q.x-5,q.y-5,10,10);
    x.lineWidth=3;x.strokeStyle="rgba(255,255,255,.8)";x.stroke();x.lineWidth=1;x.strokeStyle=this.stage()==="base"?"#ef4444":"#2563eb";x.stroke();
    // Native-pixel magnifier around the pointer, kept away from the picking point.
    const l=this.p.layers.find(l=>l.id===(this.stage()==="base"?this.p.baseId:this.p.calibration.layerId));
    const src=this.cache.get(l?.assetId)?.source,world=this.world(q);
    if(src&&world.x>=0&&world.y>=0&&world.x<=src.width&&world.y<=src.height){
      const size=128,mx=q.x>this.width-size-32&&q.y<size+32?16:this.width-size-16,my=16;
      x.fillStyle="white";x.fillRect(mx,my,size,size);x.save();x.beginPath();x.rect(mx,my,size,size);x.clip();
      x.imageSmoothingEnabled=false;x.drawImage(src,world.x-16,world.y-16,32,32,mx,my,size,size);x.restore();
      x.strokeRect(mx,my,size,size);x.beginPath();x.moveTo(mx+size/2-12,my+size/2);x.lineTo(mx+size/2+12,my+size/2);x.moveTo(mx+size/2,my+size/2-12);x.lineTo(mx+size/2,my+size/2+12);x.stroke();
      x.fillStyle="#0b0f19";x.font="11px system-ui";x.fillText("ขยายจุดเล็ง 4×",mx,my+size+16);
    }
    x.restore();
  }
}
