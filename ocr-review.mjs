// These are review signals, not calibrated probabilities of OCR correctness.
export const OCR_FIELDS = {number:'เลขแบบ',title:'ชื่อแบบ',revision:'Revision',revisionDate:'วันที่แก้ไข'};
const normalize = value => String(value || '').normalize('NFC').replace(/[–—−]/g,'-').replace(/\s+/g,' ').trim();
export const sameReading = (a,b) => normalize(a).toLocaleUpperCase() === normalize(b).toLocaleUpperCase();

export function overlapsWord(a,b) {
 const sameLine = Math.abs(a.y+a.h/2-b.y-b.h/2) < Math.max(a.h,b.h)*.6;
 const overlap = Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
 return sameLine && overlap > Math.min(a.w,b.w)*.2;
}

export function assessTitle(value,source,words=[],passes=[],pdfTitle='') {
 const content = normalize(value);
 const candidates = [...new Map([...passes,...(pdfTitle?[{value:pdfTitle,source:'ข้อความ PDF'}]:[])].filter(p=>p.value).map(p=>[normalize(p.value),p])).values()];
 const issues = [];
 const flagged = [];
 for(const word of words) {
  if(!normalize(word.text) || !content.includes(normalize(word.text)))continue;
  const alternatives = passes.flatMap(pass=>pass.words || []).filter(other=>overlapsWord(word,other));
  const confirmed = alternatives.some(other=>sameReading(word.text,other.text)&&other!==word&&other.confidence>=60);
  if(Number.isFinite(word.confidence)&&word.confidence<65&&!confirmed) {
   flagged.push({text:word.text,reason:'OCR อ่านคำนี้ไม่ชัด',box:{x:word.x,y:word.y,w:word.w,h:word.h}});
  }
 }
 if(!content)issues.push('อ่านชื่อแบบไม่ได้');
 if(flagged.length)issues.push('มีคำที่อ่านไม่ชัด · เทียบคำที่ไฮไลต์กับภาพ');
 const pdfDisagrees = pdfTitle && !sameReading(pdfTitle,content);
 if(pdfDisagrees)issues.push('ข้อความใน PDF กับข้อความจากภาพไม่ตรงกัน');
 const numericTokens = text => normalize(text).match(/[+-]?\d+(?:\.\d+)?|[A-Za-z]+\d+[A-Za-z\d-]*/g) || [];
 const chosenNumbers = numericTokens(content).join('|');
 if(candidates.some(p=>numericTokens(p.value).join('|')!==chosenNumbers)) {
  issues.push('รหัสหรือตัวเลขจากแต่ละรอบอ่านไม่ตรงกัน · ตรวจเครื่องหมายและทศนิยม');
  for(const word of words.filter(word=>/\d/.test(word.text)&&content.includes(normalize(word.text)))) {
   if(flagged.some(f=>f.text===word.text))continue;
   flagged.push({text:word.text,reason:'ตรวจรหัส เครื่องหมาย และตัวเลขกับภาพ',box:{x:word.x,y:word.y,w:word.w,h:word.h}});
  }
 }
 if(candidates.length>1&&!issues.length)issues.push('ผลอ่านแต่ละรอบต่างกัน · เทียบภาพและค่าที่เลือก');
 if(!issues.length && !passes.some(p=>sameReading(p.value,content)))issues.push('ยังไม่มีผลอ่านอีกแหล่งที่ตรงกัน');
 const matched = !issues.length && (pdfTitle&&sameReading(pdfTitle,content) || candidates.length===1&&passes.length>1);
 return {value,source,status:!content?'missing':matched?'matched':'check',issues,flagged,candidates:candidates.map(({source,value})=>({source,value}))};
}

export function reviewField(meta,key) {
 const stored = meta.review?.[key];
 if(stored && sameReading(stored.value,meta[key]))return stored;
 if(stored)return {value:meta[key],source:'แก้ไขโดยผู้ใช้',status:'edited',issues:['ตรวจเทียบค่าที่แก้กับภาพก่อนยืนยัน'],flagged:[],candidates:stored.candidates || []};
 const value=meta[key] || '',note=meta.quality?.[key] || '';
 return {value,source:note || meta.method || 'ไม่ระบุแหล่งอ่าน',status:'check',issues:[!value?'อ่านไม่พบ · กรอกเองได้':'ยังไม่ได้ตรวจเทียบภาพ'],flagged:[],candidates:[]};
}

export function fieldsToReview(meta) {
 if(meta.confirmed)return [];
 return Object.keys(OCR_FIELDS).filter(key=>reviewField(meta,key).status!=='matched');
}

export function completeReview(result) {
 const review={...result.review};
 for(const key of Object.keys(OCR_FIELDS)) {
  if(review[key])continue;
  const value=result.fields[key] || '',source=result.quality?.[key] || result.method || 'ไม่ระบุแหล่งอ่าน';
  const matched=/PDF และ OCR ตรงกัน/.test(source);
  review[key]={value,source,status:!value?'missing':matched?'matched':'check',issues:matched?[]:[!value?'อ่านไม่พบ · กรอกเองได้':/ใช้ค่าเริ่มต้น/.test(source)?'ใช้ค่าเริ่มต้น · ต้องตรวจภาพ':'ตรวจเทียบภาพก่อนยืนยัน'],flagged:[],candidates:[]};
 }
 return {...result,review};
}
