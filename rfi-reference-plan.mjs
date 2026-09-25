import {renderOverlay} from './overlay-export.mjs';
import {inverse,map} from './model.mjs';
import {cloud,PLAN_PDF_CLOUD_STROKE,PLAN_PDF_CLOUD_SHAPE} from './rfi-cloud.mjs';

export function sourceLayerState(project){
 return JSON.stringify(project.layers.map(layer=>({
  id:layer.id,assetId:layer.assetId,name:layer.name,width:layer.width,height:layer.height,transform:layer.transform
 })));
}

// Keep the captured combined drawing unchanged. The cloud and question are
// rendered at export time so an edited question never requires a new snapshot.
export function captureReferencePlan(engine,item){
 const canvas=renderOverlay(engine);
 try{
  item.referencePlanBounds=canvas.overlayBounds;
  item.referencePlanScale=canvas.overlayScale;
  item.referencePlanFormat=2;
  return canvas.toDataURL('image/png');
 }finally{canvas.width=canvas.height=0;}
}

function cloudBox(rect,transform,scale){
 const points=[[rect.x,rect.y],[rect.x+rect.w,rect.y],[rect.x+rect.w,rect.y+rect.h],[rect.x,rect.y+rect.h]]
  .map(([x,y])=>map(transform,{x,y}));
 const xs=points.map(p=>p.x*scale),ys=points.map(p=>p.y*scale);
 return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
}

function questionLines(ctx,text,maxWidth,maxLines){
 const result=[];
 outer: for(const paragraph of (String(text||'').trim()||'—').split(/\r?\n/)){
  let row='';
  for(const ch of paragraph){
   if(row&&ctx.measureText(row+ch).width>maxWidth){result.push(row);row='';if(result.length>maxLines)break outer;}
   row+=ch;
  }
  result.push(row);
  if(result.length>maxLines)break;
 }
 if(result.length>maxLines){
  result.length=maxLines;
  let last=result[maxLines-1];
  while(last&&ctx.measureText(last+'…').width>maxWidth)last=last.slice(0,-1);
  result[maxLines-1]=last+'…';
 }
 return result;
}

export function drawQuestionCallout(ctx,box,question,{outset=0}={}){
 const width=ctx.canvas.width,height=ctx.canvas.height;
 const font=Math.max(6,Math.min(30,Math.max(11,width*.009),box.w*.12,box.h*.22));
 const pad=Math.max(2,Math.ceil(font*.45)),gap=font*.6;
 ctx.save();ctx.font=font+'px Tahoma, sans-serif';ctx.textBaseline='top';
 const x=Math.max(1,Math.min(width-2,box.x+pad));
 const boxWidth=Math.max(1,Math.min(box.w-pad*2,width*.36,width-x-1));
 const textWidth=Math.max(1,boxWidth-pad*2);
 const lineHeight=font*1.25,maxLines=Math.max(1,Math.min(12,Math.floor(height*.32/lineHeight)));
 let lines=questionLines(ctx,question,textWidth,maxLines);
 let boxHeight=lines.length*lineHeight+pad*2;
 const below=box.y+box.h+outset+gap;
 let y;
 if(below+boxHeight<=height-1)y=below;
 else{
  const fit=Math.max(1,Math.floor((box.h-gap-pad*2)/lineHeight));
  lines=questionLines(ctx,question,textWidth,Math.min(maxLines,fit));
  boxHeight=lines.length*lineHeight+pad*2;
  y=Math.max(1,Math.min(height-boxHeight-1,box.y+box.h-outset-gap-boxHeight));
 }
 ctx.fillStyle='rgba(255,255,255,.96)';ctx.fillRect(x,y,boxWidth,boxHeight);
 ctx.fillStyle='#dc2626';
 lines.forEach((line,i)=>ctx.fillText(line,x+pad,y+pad+i*lineHeight));
 ctx.restore();
 return {x,y,w:boxWidth,h:boxHeight};
}

function drawCombinedAnnotations(canvas,{rect,bounds,scale,question}){
 const ctx=canvas.getContext('2d');
 const box={x:(rect.x-bounds.x)*scale,y:(rect.y-bounds.y)*scale,w:rect.w*scale,h:rect.h*scale};
 const outset=PLAN_PDF_CLOUD_SHAPE.step*PLAN_PDF_CLOUD_SHAPE.bulge*.5+PLAN_PDF_CLOUD_STROKE/2;
 cloud(ctx,box,PLAN_PDF_CLOUD_STROKE,PLAN_PDF_CLOUD_SHAPE);drawQuestionCallout(ctx,box,question,{outset});
}

export function renderOriginalLayer(engine,layer,item){
 const source=engine.cache.get(layer.assetId)?.source;
 if(!source)throw Error('ไม่พบภาพต้นฉบับของ Layer: '+layer.name);
 const width=layer.width||source.width,height=layer.height||source.height;
 if(!width||!height)throw Error('ขนาดภาพต้นฉบับไม่ถูกต้อง: '+layer.name);
 const scale=Math.min(1,5000/Math.max(width,height),Math.sqrt(16000000/(width*height)));
 const canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.ceil(width*scale));canvas.height=Math.max(1,Math.ceil(height*scale));
 const ctx=canvas.getContext('2d');
 ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.drawImage(source,0,0,canvas.width,canvas.height);
 const back=inverse(layer.transform),box=cloudBox(item.rect,back,scale);
 const margin=PLAN_PDF_CLOUD_SHAPE.step*PLAN_PDF_CLOUD_SHAPE.bulge*.5+PLAN_PDF_CLOUD_STROKE/2;
 if(box.x<margin-1||box.y<margin-1||box.x+box.w>canvas.width-margin+1||box.y+box.h>canvas.height-margin+1){
  canvas.width=canvas.height=0;
  throw Error('Cloud ไม่อยู่ภายในแปลนต้นฉบับทั้งวง: '+layer.name+' · ตรวจการจัดแนว Layer ก่อนส่งออก');
 }
 ctx.save();
 ctx.setTransform(scale*back.a,scale*back.b,scale*back.c,scale*back.d,scale*back.e,scale*back.f);
 const backScale=Math.sqrt(Math.abs(back.a*back.d-back.b*back.c));
 cloud(ctx,item.rect,PLAN_PDF_CLOUD_STROKE/(scale*backScale),{...PLAN_PDF_CLOUD_SHAPE,step:PLAN_PDF_CLOUD_SHAPE.step/(scale*backScale)});
 ctx.restore();
 drawQuestionCallout(ctx,box,item.question,{outset:margin});
 return canvas;
}

export async function appendReferencePlan(pdf,data,{rect,bounds,scale,question,caption}={}){
 const isCanvas=typeof data!=='string';
 let img=data;
 if(!isCanvas){img=new Image();img.src=data;await img.decode();}
 const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
 try{
  canvas.getContext('2d').drawImage(img,0,0);
  if(rect&&bounds&&scale)drawCombinedAnnotations(canvas,{rect,bounds,scale,question});
  const landscape=canvas.width>=canvas.height;
  pdf.addPage('a3',landscape?'landscape':'portrait');
  const w=landscape?420:297,h=landscape?297:420;
  const top=caption?17:10,bottom=10,s=Math.min((w-20)/canvas.width,(h-top-bottom)/canvas.height);
  if(caption){
   const title=document.createElement('canvas');title.width=2400;title.height=76;
   const t=title.getContext('2d');t.fillStyle='#111827';t.font='bold 34px Tahoma, sans-serif';t.fillText(caption,0,44);
   pdf.addImage(title,'PNG',10,4,w-20,12);title.width=title.height=0;
  }
  pdf.addImage(canvas,'PNG',(w-canvas.width*s)/2,top+(h-top-bottom-canvas.height*s)/2,canvas.width*s,canvas.height*s);
 }finally{canvas.width=canvas.height=0;}
}
