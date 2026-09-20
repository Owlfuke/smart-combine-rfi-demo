import {hash} from './importer.mjs';
import {LIMITS} from './model.mjs';

const MAX_CAPTURE_BYTES=Math.min(LIMITS.fileBytes,50*1024*1024);
const ACCEPTED_IMAGE_TYPES=new Set(['image/png','image/jpeg','image/webp']);
const uuid=()=>globalThis.crypto?.randomUUID?.()||`capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function canvasBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('สร้างภาพ Snapshot ไม่สำเร็จ')),'image/png'));}
function validateCanvas(canvas){
 const width=Number(canvas?.width||0),height=Number(canvas?.height||0);
 if(!width||!height)throw Error('ไม่พบภาพสำหรับ Crop');
 if(width*height>LIMITS.imagePixels)throw Error(`ภาพมีขนาดเกิน ${Math.round(LIMITS.imagePixels/1e6)} ล้านพิกเซล กรุณาจับเฉพาะหน้าต่างหรือพื้นที่ที่เล็กลง`);
}
function validateImageBlob(blob){
 if(!blob||!ACCEPTED_IMAGE_TYPES.has(String(blob.type).toLowerCase()))throw Error('Clipboard ต้องมีภาพ PNG, JPG หรือ WEBP');
 if(!blob.size||blob.size>MAX_CAPTURE_BYTES)throw Error(`ภาพต้องมีขนาดไม่เกิน ${Math.round(MAX_CAPTURE_BYTES/1024/1024)} MB`);
}
async function canvasFromBlob(blob){
 validateImageBlob(blob);const bitmap=await createImageBitmap(blob);
 try{
  if(bitmap.width*bitmap.height>LIMITS.imagePixels)throw Error(`ภาพมีขนาดเกิน ${Math.round(LIMITS.imagePixels/1e6)} ล้านพิกเซล`);
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d',{alpha:false}).drawImage(bitmap,0,0);return canvas;
 }finally{bitmap.close?.();}
}
export function cropCanvas(source,rect){
 validateCanvas(source);
 const x=Math.max(0,Math.min(source.width-1,Math.round(rect?.x||0))),y=Math.max(0,Math.min(source.height-1,Math.round(rect?.y||0)));
 const width=Math.max(1,Math.min(source.width-x,Math.round(rect?.width||source.width))),height=Math.max(1,Math.min(source.height-y,Math.round(rect?.height||source.height)));
 const output=document.createElement('canvas');output.width=width;output.height=height;output.getContext('2d',{alpha:false}).drawImage(source,x,y,width,height,0,0,width,height);return output;
}
export async function quickImageResult(canvas,sourceName='Snapshot'){
 validateCanvas(canvas);const blob=await canvasBlob(canvas),assetId=uuid(),safeName=String(sourceName||'Snapshot').trim().slice(0,180)||'Snapshot';
 return {data:{sourceId:assetId,assetId,fingerprint:await hash(blob),sourceName:safeName,originalName:safeName,page:1,pageCount:1,width:canvas.width,height:canvas.height,drawingTitle:'',number:'',revision:'',revisionDate:''},assets:new Map([[assetId,blob]])};
}
const normalizedRect=(start,end)=>({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)});
function makeDialog(className,title){const dialog=document.createElement('dialog');dialog.className=className;dialog.setAttribute('aria-label',title);document.body.append(dialog);return dialog;}

export function chooseCrop(source,title='Crop ภาพก่อนนำเข้า'){
 validateCanvas(source);const dialog=makeDialog('quick-crop-dialog',title);
 const heading=document.createElement('h2');heading.textContent=title;
 const help=document.createElement('p');help.className='quick-crop-help';help.textContent='ลากกรอบครอบบริเวณที่ต้องการนำเข้า ส่วนที่อยู่นอกกรอบจะไม่ถูกบันทึก';
 const stage=document.createElement('div');stage.className='quick-crop-stage';const canvas=document.createElement('canvas');canvas.tabIndex=0;canvas.setAttribute('aria-label','พื้นที่เลือก Crop');stage.append(canvas);
 const status=document.createElement('div');status.className='quick-crop-status';const actions=document.createElement('div');actions.className='quick-crop-actions';
 const full=document.createElement('button');full.type='button';full.textContent='เลือกเต็มภาพ';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='ยกเลิก';const accept=document.createElement('button');accept.type='button';accept.className='primary';accept.textContent='ใช้พื้นที่นี้';actions.append(full,cancel,accept);dialog.append(heading,help,stage,status,actions);
 const maxWidth=Math.max(320,window.innerWidth-64),maxHeight=Math.max(220,window.innerHeight-190),scale=Math.min(1,maxWidth/source.width,maxHeight/source.height);
 canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));const ctx=canvas.getContext('2d');let selection={x:0,y:0,width:canvas.width,height:canvas.height},dragStart=null,settled=false;
 const draw=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);ctx.save();ctx.fillStyle='rgba(2,8,20,.58)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.clearRect(selection.x,selection.y,selection.width,selection.height);ctx.drawImage(source,selection.x/scale,selection.y/scale,selection.width/scale,selection.height/scale,selection.x,selection.y,selection.width,selection.height);ctx.strokeStyle='#ffb900';ctx.lineWidth=2;ctx.setLineDash([7,5]);ctx.strokeRect(selection.x+1,selection.y+1,Math.max(0,selection.width-2),Math.max(0,selection.height-2));ctx.restore();status.textContent=`${Math.round(selection.width/scale).toLocaleString()} × ${Math.round(selection.height/scale).toLocaleString()} px`;};
 const point=event=>{const bounds=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width,(event.clientX-bounds.left)*canvas.width/bounds.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-bounds.top)*canvas.height/bounds.height))};};
 const cleanup=()=>{dialog.close?.();dialog.remove();};draw();dialog.showModal();canvas.focus();
 return new Promise(resolve=>{
  const finish=value=>{if(settled)return;settled=true;cleanup();resolve(value);};
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;dragStart=point(event);selection={x:dragStart.x,y:dragStart.y,width:0,height:0};canvas.setPointerCapture(event.pointerId);draw();});
  canvas.addEventListener('pointermove',event=>{if(!dragStart)return;selection=normalizedRect(dragStart,point(event));draw();});
  canvas.addEventListener('pointerup',event=>{if(!dragStart)return;selection=normalizedRect(dragStart,point(event));dragStart=null;if(selection.width<6||selection.height<6)selection={x:0,y:0,width:canvas.width,height:canvas.height};draw();});
  full.addEventListener('click',()=>{selection={x:0,y:0,width:canvas.width,height:canvas.height};draw();});cancel.addEventListener('click',()=>finish(null));
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);},{once:true});
  accept.addEventListener('click',()=>finish(cropCanvas(source,{x:selection.x/scale,y:selection.y/scale,width:selection.width/scale,height:selection.height/scale})));
 });
}

async function frameFromStream(stream){
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('รอภาพจากหน้าจอนานเกินไป')),15000);video.onloadedmetadata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(Error('อ่านภาพจากหน้าจอไม่สำเร็จ'));};});
  await video.play();if(typeof video.requestVideoFrameCallback==='function')await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();},timer=setTimeout(finish,2500);video.requestVideoFrameCallback(finish);});
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;validateCanvas(canvas);canvas.getContext('2d',{alpha:false}).drawImage(video,0,0);return canvas;
 }finally{video.pause();video.srcObject=null;video.remove();}
}
export async function captureDisplayFrame(mediaDevices=navigator.mediaDevices,readFrame=frameFromStream){
 if(!mediaDevices?.getDisplayMedia)throw Error('Edge รุ่นนี้ไม่รองรับ Capture Screen');let stream;
 try{stream=await mediaDevices.getDisplayMedia({video:{frameRate:{ideal:1,max:5}},audio:false,selfBrowserSurface:'exclude',surfaceSwitching:'exclude'});return await readFrame(stream);}
 catch(error){if(error?.name==='NotAllowedError'||error?.name==='AbortError')return null;throw error;}
 finally{for(const track of stream?.getTracks?.()||[])track.stop();}
}
const captureName=prefix=>`${prefix} · ${new Date().toLocaleString('th-TH',{dateStyle:'short',timeStyle:'medium'})}.png`;
export async function captureQuickScreen(options={}){
 const source=await captureDisplayFrame(options.mediaDevices,options.readFrame);if(!source)return null;
 try{const cropped=await chooseCrop(source,'Crop ภาพจากหน้าจอ');if(!cropped)return null;try{return await quickImageResult(cropped,captureName('Capture Screen'));}finally{cropped.width=cropped.height=0;}}
 finally{source.width=source.height=0;}
}
export function pasteQuickScreenshot(){
 const dialog=makeDialog('quick-paste-dialog','วาง Screenshot'),heading=document.createElement('h2'),help=document.createElement('p'),zone=document.createElement('div'),status=document.createElement('p'),cancel=document.createElement('button');
 heading.textContent='วาง Screenshot';help.textContent='คัดลอกภาพจาก Snipping Tool หรือโปรแกรมอื่น แล้วกด Ctrl+V ในกรอบนี้';zone.className='quick-paste-zone';zone.tabIndex=0;zone.textContent='คลิกที่นี่ แล้วกด Ctrl+V';status.className='quick-paste-status';cancel.type='button';cancel.textContent='ยกเลิก';dialog.append(heading,help,zone,status,cancel);
 return new Promise(resolve=>{
  let settled=false,busy=false;const finish=value=>{if(settled)return;settled=true;dialog.removeEventListener('paste',onPaste,true);dialog.close?.();dialog.remove();resolve(value);};
  const onPaste=async event=>{if(busy)return;const item=[...(event.clipboardData?.items||[])].find(entry=>entry.kind==='file'&&entry.type.startsWith('image/'));if(!item){status.textContent='ไม่พบภาพใน Clipboard กรุณาคัดลอกภาพแล้วลองอีกครั้ง';return;}event.preventDefault();busy=true;zone.textContent='กำลังอ่านภาพ…';let source,cropped;
   try{source=await canvasFromBlob(item.getAsFile());dialog.close();dialog.hidden=true;cropped=await chooseCrop(source,'Crop Screenshot จาก Clipboard');if(!cropped)return finish(null);finish(await quickImageResult(cropped,captureName('Clipboard Screenshot')));}
   catch(error){busy=false;dialog.hidden=false;if(!dialog.open)dialog.showModal();zone.textContent='คลิกที่นี่ แล้วกด Ctrl+V';status.textContent=error?.message||'อ่านภาพจาก Clipboard ไม่สำเร็จ';zone.focus();}
   finally{if(source)source.width=source.height=0;if(cropped)cropped.width=cropped.height=0;}
  };
  dialog.addEventListener('paste',onPaste,true);cancel.addEventListener('click',()=>finish(null));dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);},{once:true});dialog.showModal();zone.focus();
 });
}
