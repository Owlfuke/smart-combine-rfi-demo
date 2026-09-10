import {inverse,map} from './model.mjs';

export function keyPlanBounds(layer){
 const full={x:0,y:0,w:layer.width,h:layer.height};
 let {top,side}=layer.gridBands||{};
 const valid=b=>b&&['x','y','w','h'].every(k=>Number.isFinite(b[k]))&&b.w>0&&b.h>0;
 if(!valid(top)||!valid(side))return {...full,usesGrid:false};
 if(top.h>top.w*2&&side.w>side.h*2)[top,side]=[side,top];
 // Union of both head bands includes the plan between their projected extents.
 const pad=Math.max(4,Math.min(layer.width,layer.height)*.005);
 const x=Math.max(0,Math.min(top.x,side.x)-pad),y=Math.max(0,Math.min(top.y,side.y)-pad);
 const right=Math.min(layer.width,Math.max(top.x+top.w,side.x+side.w)+pad);
 const bottom=Math.min(layer.height,Math.max(top.y+top.h,side.y+side.h)+pad);
 return right>x&&bottom>y?{x,y,w:right-x,h:bottom-y,usesGrid:true}:{...full,usesGrid:false};
}

// Crop in the grid sheet's coordinates, then project the world-space Cloud into it.
export function renderKeyPlan(engine,item){
 const layers=engine.p.layers,selected=layers.find(l=>l.id===item.sheetId);
 const usable=l=>l&&engine.cache.get(l.assetId)?.source;
 const l=[selected,layers.find(l=>l.id===engine.p.baseId)].find(l=>usable(l)&&keyPlanBounds(l).usesGrid)||selected;
 const source=usable(l);if(!source)return null;
 const bounds=keyPlanBounds(l),{x,y,w,h}=bounds;
 if(!Number.isFinite(w+h)||w<=0||h<=0)return null;
 const inv=inverse(l.transform),r=item.rect;
 const points=[[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]].map(([x,y])=>map(inv,{x,y}));
 const s=Math.min(600/w,420/h),c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w*s));c.height=Math.max(1,Math.ceil(h*s));const ctx=c.getContext('2d');
 ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);
 ctx.drawImage(source,x,y,w,h,0,0,w*s,h*s);
 ctx.save();ctx.beginPath();points.forEach((p,i)=>ctx[i?'lineTo':'moveTo']((p.x-x)*s,(p.y-y)*s));ctx.closePath();
 ctx.strokeStyle='#e00000';ctx.lineWidth=2;ctx.stroke();ctx.clip();ctx.fillStyle='rgba(255,0,0,.18)';ctx.fillRect(0,0,c.width,c.height);
 ctx.lineWidth=1.5;ctx.beginPath();for(let a=-c.height;a<c.width+c.height;a+=7){ctx.moveTo(a,0);ctx.lineTo(a+c.height,c.height);}ctx.stroke();ctx.restore();
 item.keyPlanWarning=bounds.usesGrid?'':'Key Plan ใช้ภาพเต็มแผ่น กรุณากำหนดพื้นที่กริดด้านบนและด้านซ้าย';
 return c.toDataURL('image/png');
}
