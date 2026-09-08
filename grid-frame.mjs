import {inverse,map} from './model.mjs';
// Reorient the captured composite into the grid sheet's coordinate system.
export function frameWithGrid(crop,layer,source,world){
 let bands=layer?.gridBands;if(bands?.top&&bands?.side&&bands.top.h>bands.top.w*2&&bands.side.w>bands.side.h*2)bands={top:bands.side,side:bands.top};if(!bands?.top||!bands?.side||!source)return crop;
 const inv=inverse(layer.transform),points=[{x:world.x,y:world.y},{x:world.x+world.w,y:world.y},{x:world.x,y:world.y+world.h},{x:world.x+world.w,y:world.y+world.h}].map(p=>map(inv,p));
 const sx=Math.min(...points.map(p=>p.x)),sy=Math.min(...points.map(p=>p.y)),sw=Math.max(...points.map(p=>p.x))-sx,sh=Math.max(...points.map(p=>p.y))-sy;
 const top=trimBand(source,bands.top,sx,sw,true),left=trimBand(source,bands.side,sy,sh,false);

 const density=Math.min(crop.width/world.w*Math.sqrt(Math.abs(layer.transform.a*layer.transform.d-layer.transform.b*layer.transform.c)),4000/Math.max(sw+left.w,sh+top.h));
 const cw=Math.max(1,Math.ceil(sw*density)),ch=Math.max(1,Math.ceil(sh*density)),lw=Math.max(1,Math.ceil(left.w*density)),lh=Math.max(1,Math.ceil(top.h*density)),gap=18;
 const out=document.createElement('canvas');out.width=lw+gap+cw;out.height=lh+gap+ch;const c=out.getContext('2d');c.fillStyle='white';c.fillRect(0,0,out.width,out.height);
 const strip=(x,y,w,h,band)=>{const s=document.createElement('canvas'),factor=Math.min(3,2200/Math.max(w,h));s.width=Math.max(1,Math.ceil(w*factor));s.height=Math.max(1,Math.ceil(h*factor));const ctx=s.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,s.width,s.height);const a=Math.max(x,band.x,0),b=Math.max(y,band.y,0),right=Math.min(x+w,band.x+band.w,source.width),bottom=Math.min(y+h,band.y+band.h,source.height);if(right>a&&bottom>b)ctx.drawImage(source,a,b,right-a,bottom-b,(a-x)*s.width/w,(b-y)*s.height/h,(right-a)*s.width/w,(bottom-b)*s.height/h);return s;};
 out.topStrip=strip(sx,top.y,sw,top.h,top);out.sideStrip=strip(left.x,sy,left.w,sh,left);
 c.drawImage(out.topStrip,lw+gap,0,cw,lh);c.drawImage(out.sideStrip,0,lh+gap,lw,ch);
 c.save();c.beginPath();c.rect(lw+gap,lh+gap,cw,ch);c.clip();
 const origin=map(inv,{x:world.x,y:world.y}),px=world.w/crop.width,py=world.h/crop.height;
 c.setTransform(density*inv.a*px,density*inv.b*px,density*inv.c*py,density*inv.d*py,lw+gap+(origin.x-sx)*density,lh+gap+(origin.y-sy)*density);c.drawImage(crop,0,0);c.restore();
 return out;
}

// Trim blank margins only across the band, preserving projection positions along it.
function trimBand(source,band,start,length,top){
 const area=top?{x:Math.max(start,band.x),y:band.y,w:Math.min(start+length,band.x+band.w)-Math.max(start,band.x),h:band.h}:{x:band.x,y:Math.max(start,band.y),w:band.w,h:Math.min(start+length,band.y+band.h)-Math.max(start,band.y)};
 if(area.w<=0||area.h<=0)throw Error('ช่วง Cloud ไม่ตัดแถบกริดที่บันทึกไว้ กรุณาตรวจแผ่นอ้างอิงกริด');
 const c=document.createElement('canvas'),factor=Math.min(1,1400/Math.max(area.w,area.h));c.width=Math.max(1,Math.ceil(area.w*factor));c.height=Math.max(1,Math.ceil(area.h*factor));const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(source,area.x,area.y,area.w,area.h,0,0,c.width,c.height);const data=ctx.getImageData(0,0,c.width,c.height).data;let lo=Infinity,hi=-1;
 for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(data[i]+data[i+1]+data[i+2]<660){const v=top?y:x;lo=Math.min(lo,v);hi=Math.max(hi,v);}}
 if(hi<0)throw Error('ไม่พบภาพหัวกริดในช่วงฉาย Cloud · กรุณาตรวจแถบและแผ่นอ้างอิง');
 const unit=top?area.h/c.height:area.w/c.width,pad=4*unit,offset=Math.max(0,lo*unit-pad),extent=Math.min(top?area.h:area.w,(hi+1)*unit+pad)-offset;
 return top?{...band,y:area.y+offset,h:extent}:{...band,x:area.x+offset,w:extent};
}
