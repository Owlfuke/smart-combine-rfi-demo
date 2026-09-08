export function revisionFamily(layers,id){
  const ids=new Set([id]);let changed=true;
  while(changed){changed=false;for(const l of layers){if(l.versionOf&&(ids.has(l.id)||ids.has(l.versionOf))){for(const key of [l.id,l.versionOf])if(!ids.has(key)){ids.add(key);changed=true;}}}}
  return layers.filter(l=>ids.has(l.id)).sort((a,b)=>(b.importedAt||0)-(a.importedAt||0));
}
export function showRevisionHistory(layers,id,cache){
  const family=revisionFamily(layers,id);if(!family.length)return;
  const dialog=document.createElement('dialog');dialog.className='revision-history-dialog';dialog.setAttribute('aria-label','ประวัติ Revision');
  const heading=document.createElement('h2');heading.textContent='ประวัติ Revision';
  const note=document.createElement('p');note.className='hint';note.textContent='แสดงเวอร์ชันที่เชื่อมโยงและยังอยู่ในโครงการ · เลือกดูภาพได้โดยไม่เปลี่ยนแผ่นที่ใช้งาน';
  const picker=document.createElement('select');picker.setAttribute('aria-label','เลือกเวอร์ชันย้อนหลัง');
  for(const l of family){const option=document.createElement('option');option.value=l.id;option.textContent=(l.number||'ไม่ระบุเลขแบบ')+' · Rev '+(l.revision??'—')+' · '+(l.revisionDate||'ไม่ระบุวันที่');picker.append(option);}picker.value=id;
  const info=document.createElement('div'),canvas=document.createElement('canvas');canvas.className='revision-history-preview';
  const close=document.createElement('button');close.textContent='ปิด';close.addEventListener('click',()=>dialog.close());
  const render=()=>{
    const l=family.find(item=>item.id===picker.value);info.replaceChildren();
    for(const [label,value] of [['ชื่อแบบ',l.drawingTitle||l.name],['เลขที่แบบ',l.number],['Revision',l.revision],['วันที่แก้ไข',l.revisionDate],['นำเข้าเมื่อ',l.importedAt?new Date(l.importedAt).toLocaleString('th-TH'):'ไม่มีข้อมูลเวลาในแผ่นเดิม'],['ไฟล์ต้นฉบับ',l.originalName],['หน้า',l.page],['สถานะ',layers.some(next=>next.versionOf===l.id)?'มีเวอร์ชันที่นำเข้าต่อจากแผ่นนี้':'ยังไม่มีเวอร์ชันที่เชื่อมต่อจากแผ่นนี้']]){
      const line=document.createElement('p');line.textContent=label+': '+(value===0?'0':value||'—');info.append(line);
    }
    const source=cache.get(l.assetId)?.source;
    canvas.hidden=!source;
    if(source){const scale=Math.min(1,1200/source.width,800/source.height);canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);}
    else{const missing=document.createElement('p');missing.textContent='ภาพตัวอย่างยังไม่พร้อม';info.append(missing);}
  };
  picker.addEventListener('change',render);dialog.append(heading,note,picker,info,canvas,close);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});render();dialog.showModal();picker.focus();
}
