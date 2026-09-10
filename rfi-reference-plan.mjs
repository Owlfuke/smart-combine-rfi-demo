import {renderOverlay} from './overlay-export.mjs';

// Snapshot at capture time, never reconstruct an old attachment from today's layers.
export function captureReferencePlan(engine,item,drawCloud){
 const canvas=renderOverlay(engine);
 try{
  const ctx=canvas.getContext('2d'),b=canvas.overlayBounds,s=canvas.overlayScale,r=item.rect;
  const box={x:(r.x-b.x)*s,y:(r.y-b.y)*s,w:r.w*s,h:r.h*s};
  drawCloud(ctx,box);
  const font=Math.max(12,Math.min(32,canvas.width*.009)),pad=font*.4;
  const lines=['บริเวณที่สอบถาม','ตามเอกสาร RFI'];ctx.font=font+'px Tahoma, sans-serif';
  const width=Math.max(...lines.map(t=>ctx.measureText(t).width))+pad*2,height=font*2.6;
  const right=box.x+box.w+font;
  const x=Math.max(0,Math.min(canvas.width-width,right+width<=canvas.width?right:box.x-width-font));
  const y=Math.max(0,Math.min(canvas.height-height,box.y));
  ctx.fillStyle='rgba(255,255,255,.92)';ctx.fillRect(x,y,width,height);ctx.fillStyle='#dc2626';ctx.textBaseline='top';
  lines.forEach((line,i)=>ctx.fillText(line,x+pad,y+pad+i*font*1.2));
  return canvas.toDataURL('image/png');
 }finally{canvas.width=canvas.height=0;}
}

export async function appendReferencePlan(pdf,data){
 const img=new Image();img.src=data;await img.decode();
 const landscape=img.width>=img.height;
 pdf.addPage('a3',landscape?'landscape':'portrait');
 const w=landscape?420:297,h=landscape?297:420;
 const s=Math.min((w-20)/img.width,(h-20)/img.height);
 pdf.addImage(data,'PNG',(w-img.width*s)/2,(h-img.height*s)/2,img.width*s,img.height*s);
}
