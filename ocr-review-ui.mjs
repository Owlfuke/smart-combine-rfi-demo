import {reviewField,fieldsToReview,OCR_FIELDS} from './ocr-review.mjs';

const statusLabels={matched:'ผลอ่านตรงกัน',check:'ต้องตรวจ',missing:'อ่านไม่พบ',edited:'แก้ไขแล้ว · ตรวจอีกครั้ง'};

export function renderFieldReview(container,meta,key) {
 const review=reviewField(meta,key);
 container.replaceChildren();container.dataset.status=review.status;
 const badge=document.createElement('strong');badge.className='ocr-field-badge';badge.textContent=statusLabels[review.status];container.append(badge);
 const source=document.createElement('small');source.textContent='แหล่งอ่าน: '+review.source;container.append(source);
 for(const issue of review.issues || []){const note=document.createElement('small');note.textContent=issue;container.append(note);}
 if(review.flagged?.length){
  const line=document.createElement('p');line.className='ocr-uncertain-words';line.append('คำที่ต้องตรวจ: ');
  for(const word of review.flagged){const mark=document.createElement('mark');mark.textContent=word.text;mark.title=word.reason;line.append(mark,' ');}container.append(line);
 }
 if(review.candidates?.length>1){
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='เทียบผลอ่านแต่ละรอบ';details.append(summary);
  for(const candidate of review.candidates){const line=document.createElement('p');line.textContent=candidate.source+': '+candidate.value;details.append(line);}container.append(details);
 }
}

export function reviewSummary(meta) {
 const keys=fieldsToReview(meta);
 return keys.length?'ต้องตรวจ: '+keys.map(key=>OCR_FIELDS[key]).join(' · '):'ผลอ่านตรงกัน · ตรวจภาพก่อนยืนยัน';
}

export function openOcrImage(imageUrl,review,label) {
 const dialog=document.createElement('dialog');dialog.className='ocr-image-dialog';dialog.setAttribute('aria-label','ตรวจภาพ '+label);
 const heading=document.createElement('h2');heading.textContent='ตรวจภาพ · '+label;
 const help=document.createElement('p');help.textContent='กรอบสีส้มคือคำที่ OCR อ่านไม่ชัด · ตรวจเครื่องหมายและตัวเลขกับภาพจริง';
 const stage=document.createElement('div');stage.className='ocr-image-stage';const img=document.createElement('img');img.src=imageUrl;img.alt=label+' · ภาพต้นฉบับที่ใช้ OCR';stage.append(img);
 for(const word of review.flagged || []){
  const box=word.box;if(!box||![box.x,box.y,box.w,box.h].every(Number.isFinite))continue;
  const span=document.createElement('span');span.className='ocr-word-box';span.title=word.text+' · '+word.reason;
  Object.assign(span.style,{left:box.x*100+'%',top:box.y*100+'%',width:box.w*100+'%',height:box.h*100+'%'});stage.append(span);
 }
 const close=document.createElement('button');close.textContent='ปิด';close.onclick=()=>dialog.close();dialog.append(heading,help,stage,close);
 dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
