import {typeOfFile,loadPdf,pdfCanvas,hash} from './importer.mjs';
import {LIMITS} from './model.mjs';
export async function readQuickFile(file,password){
 const controller=new AbortController(),signal=controller.signal;
 const dialog=document.createElement('dialog');dialog.className='quick-import';
 dialog.innerHTML='<h2>QUICK COMBINE · เลือกหน้าเดียว</h2><p class="quick-status" role="status">กำลังเปิดไฟล์…</p><label>หน้าที่ต้องการ<input type="number" min="1" value="1"></label><button class="preview">แสดงตัวอย่างหน้า</button><div class="quick-preview"></div><button class="accept">ใช้หน้านี้</button><button class="cancel">ยกเลิก</button>';
 document.body.append(dialog);dialog.showModal();
 let pdf,canvas,bitmap,cancelled=false,finish;
 const choice=new Promise(resolve=>finish=resolve);const cancel=()=>{cancelled=true;controller.abort();finish(false);};
 dialog.querySelector('.cancel').onclick=cancel;dialog.addEventListener('cancel',e=>{e.preventDefault();cancel();});
 const accept=dialog.querySelector('.accept'),preview=dialog.querySelector('.preview'),input=dialog.querySelector('input'),status=dialog.querySelector('.quick-status');accept.disabled=preview.disabled=true;
 try{
  const type=await typeOfFile(file);let page=1;
  if(type==='pdf'){
   pdf=await loadPdf(file,signal,password);input.max=pdf.numPages;status.textContent=file.name+' · '+pdf.numPages+' หน้า';
   const number=()=>{const n=Number(input.value);if(!Number.isInteger(n)||n<1||n>pdf.numPages)throw Error('กรุณาระบุหน้าระหว่าง 1–'+pdf.numPages);return n;};
   input.oninput=()=>{dialog.querySelector('.quick-preview').replaceChildren();status.textContent=file.name+' · เลือกหน้า '+input.value+' จาก '+pdf.numPages;};
   preview.disabled=false;preview.onclick=async()=>{preview.disabled=accept.disabled=input.disabled=true;try{const n=number(),c=await pdfCanvas(pdf,n,true,signal);if(cancelled){c.width=c.height=0;return;}dialog.querySelector('.quick-preview').replaceChildren(c);status.textContent='ตัวอย่างหน้า '+n;}catch(e){if(!cancelled)status.textContent=e.message;}finally{if(!cancelled)preview.disabled=accept.disabled=input.disabled=false;}};
   accept.disabled=false;accept.onclick=()=>{try{page=number();finish(true);}catch(e){status.textContent=e.message;}};
  }else{input.parentElement.hidden=preview.hidden=true;status.textContent=file.name;accept.textContent='ใช้รูปนี้';accept.disabled=false;accept.onclick=()=>finish(true);}
  if(!await choice||cancelled)return null;
  accept.disabled=preview.disabled=input.disabled=true;status.textContent='กำลังเตรียมแผ่นแบบ…';
  if(pdf)canvas=await pdfCanvas(pdf,page,false,signal);
  else{bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>LIMITS.imagePixels||Math.max(bitmap.width,bitmap.height)>16384)throw Error('ภาพใหญ่เกินขนาดที่รองรับ');canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);}
  if(cancelled)return null;
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('สร้างภาพไม่สำเร็จ')),'image/png'));
  const fingerprint=await hash(file);if(cancelled)return null;
  const sourceId=crypto.randomUUID(),assetId=crypto.randomUUID();
  return {data:{sourceId,assetId,fingerprint,sourceName:file.name,originalName:file.name,page,pageCount:pdf?.numPages||1,width:canvas.width,height:canvas.height,drawingTitle:'',number:'',revision:'',revisionDate:''},assets:new Map([[sourceId,file],[assetId,blob]])};
 }catch(e){if(!cancelled)throw e;return null;}
 finally{controller.abort();await pdf?.loadingTask.destroy().catch(()=>{});bitmap?.close();if(canvas)canvas.width=canvas.height=0;dialog.close();dialog.remove();}
}

export function installQuickUI({getProject,enter,importSide,captureSide,pasteSide,edit}){
 const nav=document.querySelector('.workspace-navigation'),button=document.createElement('button');button.id='quick-combine-open';button.textContent='⚡ QUICK COMBINE';button.onclick=enter;nav.append(button);
 const left=document.createElement('div');left.id='quick-left';left.hidden=true;document.getElementById('drawing-drop-zone').before(left);
 const right=document.createElement('aside');right.id='quick-right';right.className='panel';right.hidden=true;document.getElementById('workspace').append(right);
 const lists={};
 for(const [side,container,title] of [['base',left,'แบบตั้งต้น'],['compare',right,'แบบเปรียบเทียบ']]){
  const heading=document.createElement('h2');heading.textContent=title;const upload=document.createElement('button');upload.textContent='＋ เลือก PDF 1 หน้า / รูป 1 รูป';upload.className='quick-upload';upload.id='quick-upload-'+side;
  const actions=document.createElement('div');actions.className='quick-import-actions';
  const capture=document.createElement('button');capture.type='button';capture.id='quick-capture-'+side;capture.textContent='▣ Capture Screen';capture.title='Edge จะให้เลือกหน้าจอ หน้าต่าง หรือแท็บทุกครั้ง';
  const paste=document.createElement('button');paste.type='button';paste.id='quick-paste-'+side;paste.textContent='⎘ วาง Screenshot';paste.title='วางภาพจาก Snipping Tool แล้ว Crop ก่อนนำเข้า';
  const file=document.createElement('input');file.type='file';file.accept='.pdf,.png,.jpg,.jpeg';file.hidden=true;file.id='quick-file-'+side;
  upload.onclick=()=>file.click();capture.onclick=()=>captureSide?.(side);paste.onclick=()=>pasteSide?.(side);file.onchange=()=>{const f=file.files[0];file.value='';if(f)importSide(side,[f]);};upload.ondragover=e=>e.preventDefault();upload.ondrop=e=>{e.preventDefault();importSide(side,[...e.dataTransfer.files]);};
  actions.append(upload,capture,paste);
  const list=document.createElement('div');list.className='quick-card-list';list.dataset.quickSide=side;lists[side]=list;container.append(heading,actions,file,list);
 }
 const fold=document.createElement('button');fold.textContent='พับ / เปิดแบบเปรียบเทียบ';fold.id='quick-fold-right';right.prepend(fold);fold.onclick=()=>document.body.classList.toggle('quick-right-folded');
 // Match the space occupied by navigation above the left sheet panel.
 const alignPanels=()=>{
  if(left.hidden||right.hidden||document.body.classList.contains('hide-left'))return;
  const offset=left.getBoundingClientRect().top-document.getElementById('workspace').getBoundingClientRect().top;
  right.style.setProperty('--quick-header-space',Math.max(0,offset)+'px');
 };
 new ResizeObserver(alignPanels).observe(nav);
 window.addEventListener('resize',alignPanels);
 return ()=>{
  const p=getProject(),active=p?.kind==='quick';document.body.classList.toggle('quick-mode',active);left.hidden=right.hidden=!active;button.setAttribute('aria-pressed',String(active));
  if(!active)return;document.body.classList.remove('register-view');document.getElementById('register-page').hidden=true;document.querySelectorAll('[data-workspace-view]').forEach(b=>b.setAttribute('aria-pressed','false'));
  alignPanels();
  for(const l of p.layers){const row=document.querySelector('[data-quick-side] [data-id="'+l.id+'"]');if(!row)continue;const side=l.quickSide||'base'; 
   const source=document.createElement('p');source.className='hint quick-source';source.textContent=l.sourceName+' · หน้า '+l.page;row.append(source);
   const form=document.createElement('div');form.className='quick-fields';form.onclick=e=>e.stopPropagation();form.onkeydown=e=>e.stopPropagation();
   for(const [key,label] of [['drawingTitle','ชื่อแบบ'],['number','เลขที่แบบ'],['revision','Revision'],['revisionDate','วันที่แก้ไข']]){const lab=document.createElement('label');lab.textContent=label;const input=document.createElement('input');input.value=l[key]||'';input.maxLength=key==='drawingTitle'?200:100;input.setAttribute('aria-label',label+' '+side);input.disabled=l.locked||!!p.calibration;input.onchange=()=>edit(l,key,input.value);lab.append(input);form.append(lab);}row.append(form);
  }
 };
}
