import {layer,identity} from './model.mjs';

// Measurements are in source-image coordinates. Replacing that source invalidates
// them; aligning an unchanged source does not change its physical scale.
export function replaceQuickSheet(project,side,data){
 if(project.kind!=='quick'||!['base','compare'].includes(side))throw Error('พื้นที่นำเข้าไม่ถูกต้อง');
 const old=project.layers.find(l=>l.quickSide===side);
 if(old?.locked||project.calibration)throw Error('ปลดล็อกและจบ Calibrate ก่อนเปลี่ยนไฟล์');
 const next=layer({...data,...(old?{id:old.id}:{}),quickSide:side,
  name:side==='base'?'แบบตั้งต้น':'แบบเปรียบเทียบ',
  color:side==='base'?'#000000':'#dc2626',colorMode:side==='base'?'original':'tint',
  measurements:[],measureScale:null,gridLines:[],gridBands:null});
 project.layers=project.layers.filter(l=>l.quickSide!==side).concat(next)
  .sort((a,b)=>(a.quickSide==='compare'?0:1)-(b.quickSide==='compare'?0:1));
 for(const current of project.layers){
  current.alignment=null;current.check=null;
  if(side==='base')current.transform=identity();
 }
 // Keep historical RFI attachments and IDs. Require review before reusing bounds.
 if(old)for(const rfi of project.rfis||[]){
  rfi.reviewRequired='แผ่นอ้างอิงถูกเปลี่ยน กรุณาตรวจตำแหน่ง Cloud และอัปเดตภาพก่อนส่ง';
 }
 project.baseId=project.layers.find(l=>l.quickSide==='base')?.id||null;
 project.selectedId=next.id;project.filter='ALL';project.calibration=null;
 return next;
}

export function updateQuickMetadata(sheet,key,value){
 if(!['drawingTitle','number','revision','revisionDate'].includes(key))throw Error('ช่องข้อมูลไม่ถูกต้อง');
 if(sheet.locked)throw Error('ปลดล็อกแผ่นก่อนแก้ไขข้อมูล');
 sheet[key]=String(value).trim().slice(0,key==='drawingTitle'?200:100);
 sheet.name=[sheet.number,sheet.drawingTitle].filter(Boolean).join(' — ')||
  (sheet.quickSide==='base'?'แบบตั้งต้น':'แบบเปรียบเทียบ');
 if(sheet.revision)sheet.name+=' — Rev '+sheet.revision;
}

export function markAlignmentChanged(project,sheetId){
 for(const item of project.rfis||[])if(item.sheetId===sheetId){
  item.reviewRequired='ปรับ Calibrate แล้ว กรุณาตรวจตำแหน่ง Cloud และอัปเดตภาพก่อนส่ง';
 }
}
