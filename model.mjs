export const LIMITS = Object.freeze({fileBytes:100*1024*1024,pages:300,layers:24,pixels:64000000,pagePixels:12000000,imagePixels:24000000,history:20});
export const BLENDS = ["source-over","multiply","screen","overlay","darken","lighten","color-dodge","color-burn","hard-light","soft-light","difference","exclusion","luminosity","hue","saturation","color"];
export const identity = () => ({a:1,b:0,c:0,d:1,e:0,f:0});
export const clone = value => structuredClone(value);
export function map(t,p) {return {x:t.a*p.x+t.c*p.y+t.e,y:t.b*p.x+t.d*p.y+t.f};}
export function inverse(t) {
  const det=t.a*t.d-t.b*t.c;
  if (!Number.isFinite(det)||Math.abs(det)<1e-14) throw Error("สเกลเล็กเกินไป ไม่สามารถแปลงพิกัดกลับ");
  return {a:t.d/det,b:-t.b/det,c:-t.c/det,d:t.a/det,e:(t.c*t.f-t.d*t.e)/det,f:(t.b*t.e-t.a*t.f)/det};
}
export function multiply(t,u) {
  return {a:t.a*u.a+t.c*u.b,b:t.b*u.a+t.d*u.b,c:t.a*u.c+t.c*u.d,d:t.b*u.c+t.d*u.d,e:t.a*u.e+t.c*u.f+t.e,f:t.b*u.e+t.d*u.f+t.f};
}
export function similarity(p1,p2,q1,q2) {
  const dp=Math.hypot(p2.x-p1.x,p2.y-p1.y),dq=Math.hypot(q2.x-q1.x,q2.y-q1.y);
  if(dp<1||dq<1)throw Error("จุดคู่เดียวกันต้องห่างกันอย่างน้อย 1 พิกเซล");
  const scale=dp/dq,angle=Math.atan2(p2.y-p1.y,p2.x-p1.x)-Math.atan2(q2.y-q1.y,q2.x-q1.x);
  if(!Number.isFinite(scale)||scale<0.0001||scale>10000)throw Error("สเกลอยู่นอกช่วงที่รองรับ กรุณาตรวจคู่จุด");
  const a=scale*Math.cos(angle),b=scale*Math.sin(angle);
  return {matrix:{a,b,c:-b,d:a,e:p1.x-a*q1.x+b*q1.y,f:p1.y-b*q1.x-a*q1.y},scale,angle,warning:scale<0.1||scale>10?"อัตราส่วนสเกลต่างกันมากกว่า 10 เท่า กรุณาตรวจสอบคู่กริด":dp<30||dq<30?"จุดอยู่ใกล้กัน เลือกกริดที่ห่างกันจะช่วยลดความคลาดเคลื่อน":""};
}
export function layer(data) {
  return {id:crypto.randomUUID(),visible:true,locked:false,opacity:1,blend:"multiply",colorMode:"tint",color:"#22c55e",transform:identity(),alignment:null,check:null,number:"",revision:"",discipline:"AR",page:1,pageCount:1,...data};
}
export function project(name) {
  return {id:crypto.randomUUID(),version:2,name,layers:[],baseId:null,selectedId:null,filter:"ALL",camera:{x:0,y:0,zoom:1},viewSize:{width:0,height:0},showMarkers:false,panMode:false,calibration:null,form:{},history:[],future:[],revision:0,savedAt:0};
}
export function content(p) {
  const {history,future,revision,savedAt,id,version,...rest}=p; return clone(rest);
}
export function checkpoint(p) {p.history.push(content(p));if(p.history.length>LIMITS.history)p.history.shift();p.future=[];}
export function undo(p,redo=false) {
  const from=redo?p.future:p.history,to=redo?p.history:p.future;
  if(!from.length)return false;const next=from.pop();to.push(content(p));
  Object.assign(p,next);return true;
}
export function referenced(p) {
  const ids=new Set();
  for(const item of [p,...p.history,...p.future])for(const l of item.layers){ids.add(l.assetId);if(l.sourceId)ids.add(l.sourceId);}
  return ids;
}
export function rebase(p,id) {
  const target=p.layers.find(l=>l.id===id);if(!target)throw Error("ไม่พบแผ่นฐาน");
  if(p.layers.some(l=>l.locked))throw Error("กรุณาปลดล็อก Layers ก่อนเปลี่ยนฐาน เพราะพิกัดทุกแผ่นจะเปลี่ยน");
  const t=inverse(target.transform);
  for(const l of p.layers){l.transform=multiply(t,l.transform);l.alignment=null;l.check=null;}
  p.baseId=id;target.visible=true;p.calibration=null;
}
export function validate(p) {
  if(!p||p.version!==2||!Array.isArray(p.layers)||p.layers.length>LIMITS.layers||!Array.isArray(p.history)||!Array.isArray(p.future))throw Error("รูปแบบงานที่บันทึกไม่ถูกต้อง");
  const ids=new Set();
  for(const l of p.layers){
    if(ids.has(l.id)||!l.assetId||!Number.isFinite(l.width)||!Number.isFinite(l.height)||l.width<=0||l.height<=0)throw Error("ข้อมูลแผ่นแบบไม่ถูกต้อง");
    ids.add(l.id);
    if(!l.transform||!["a","b","c","d","e","f"].every(key=>Number.isFinite(l.transform[key])))throw Error("พิกัดแผ่นแบบไม่ถูกต้อง");
  }
  if(p.baseId&&!ids.has(p.baseId))throw Error("ไม่พบแผ่นฐานของงาน");
  if(!p.camera||!Object.values(p.camera).every(Number.isFinite)||p.camera.zoom<=0)throw Error("มุมมองของงานไม่ถูกต้อง");
  return p;
}
