import {drawMeasures} from './measurements.mjs';
// Render only the requested screen region from cached drawing assets, independent of display DPR.
export function renderRfiCrop(engine,region,{showDimensions=true}={}){
 const p=engine.p,d=2400/Math.max(region.w,region.h),c=document.createElement('canvas');c.width=Math.max(1,Math.round(region.w*d));c.height=Math.max(1,Math.round(region.h*d));const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';
 const compare=engine.comparisonMode&&engine.comparisonMode!=='normal'&&p.selectedId!==p.baseId&&p.layers.some(l=>l.id===p.baseId)&&p.layers.some(l=>l.id===p.selectedId);
 const layers=[...p.layers].reverse();layers.sort((a,b)=>a.id===p.baseId?-1:b.id===p.baseId?1:0);
 for(const l of layers){if(compare?l.id!==p.baseId&&l.id!==p.selectedId:!l.visible)continue;const image=compare?(engine.comparisonMode==='swipe'?engine.cache.get(l.assetId)?.source:engine.image({...l,colorMode:'tint',color:l.id===p.baseId?'#ef4444':'#2563eb'})):engine.image(l);if(!image)continue;x.save();if(compare&&engine.comparisonMode==='swipe'){const split=(engine.width*(engine.comparisonSplit??.5)-region.x)*d;x.beginPath();x.rect(l.id===p.baseId?0:split,0,l.id===p.baseId?split:c.width-split,c.height);x.clip();}const cam=p.camera;x.setTransform(d*cam.zoom,0,0,d*cam.zoom,d*(cam.x-region.x),d*(cam.y-region.y));const t=l.transform;x.transform(t.a,t.b,t.c,t.d,t.e,t.f);x.globalAlpha=compare?1:l.opacity;x.globalCompositeOperation=compare?(engine.comparisonMode==='swipe'?'source-over':'multiply'):l.blend;x.drawImage(image,0,0);x.restore();}
 if(showDimensions)drawMeasures(engine,x,region,d);
 return {canvas:c,scale:d};
}
