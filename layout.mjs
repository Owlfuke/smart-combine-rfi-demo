
const key="smart-combine-layout-v1";
const parts=["menus","left","right","tools","status"];
let state={};try{state=JSON.parse(localStorage.getItem(key)||"{}");}catch{}
if(!state||typeof state!=="object")state={};
let focus=false;
const leftWidthKey="smart-combine-left-width-v1",workspace=document.getElementById("workspace"),leftPanel=document.getElementById("register-panel"),leftResizer=document.createElement("div");
leftResizer.id="left-panel-resizer";leftResizer.className="left-panel-resizer";leftResizer.tabIndex=0;leftResizer.setAttribute("role","separator");leftResizer.setAttribute("aria-orientation","vertical");leftResizer.setAttribute("aria-label","ปรับความกว้างแถบรายการแบบ");leftResizer.title="ลากเพื่อปรับความกว้าง · ดับเบิลคลิกเพื่อคืนค่า";leftPanel.append(leftResizer);
let preferredLeftWidth=null,dragWidth=null,resizeFrame=0;
try{const saved=localStorage.getItem(leftWidthKey),value=saved===null?NaN:Number(saved);if(Number.isFinite(value))preferredLeftWidth=value;}catch{}
function leftLimits(){
 const available=workspace.clientWidth||window.innerWidth,min=Math.min(300,Math.max(220,available-320)),reserve=document.body.classList.contains("quick-mode")?620:360;
 return {min,max:Math.max(min,Math.min(760,available-reserve))};
}
function syncLeftAria(width=leftPanel.getBoundingClientRect().width){const {min,max}=leftLimits();leftResizer.setAttribute("aria-valuemin",String(Math.round(min)));leftResizer.setAttribute("aria-valuemax",String(Math.round(max)));leftResizer.setAttribute("aria-valuenow",String(Math.round(width)));}
function setLeftWidth(value,remember=false){
 const {min,max}=leftLimits(),width=Math.max(min,Math.min(max,Number(value)||min));workspace.style.setProperty("--left-panel-width",width+"px");syncLeftAria(width);
 if(remember){preferredLeftWidth=width;try{localStorage.setItem(leftWidthKey,String(Math.round(width)));}catch{}}
 return width;
}
function refreshLeftWidth(){if(preferredLeftWidth===null){workspace.style.removeProperty("--left-panel-width");requestAnimationFrame(()=>syncLeftAria());}else setLeftWidth(preferredLeftWidth);}
function resetLeftWidth(){preferredLeftWidth=null;workspace.style.removeProperty("--left-panel-width");try{localStorage.removeItem(leftWidthKey);}catch{}requestAnimationFrame(()=>syncLeftAria());}
function queueLeftWidth(value){dragWidth=value;if(resizeFrame)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;setLeftWidth(dragWidth);});}
function finishLeftResize(event){
 if(dragWidth===null)return;if(resizeFrame){cancelAnimationFrame(resizeFrame);resizeFrame=0;}const width=setLeftWidth(dragWidth,true);dragWidth=null;document.body.classList.remove("resizing-left-panel");leftResizer.releasePointerCapture?.(event.pointerId);syncLeftAria(width);
}
leftResizer.addEventListener("pointerdown",event=>{if(event.button!==0)return;event.preventDefault();dragWidth=leftPanel.getBoundingClientRect().width;leftResizer.setPointerCapture(event.pointerId);document.body.classList.add("resizing-left-panel");});
leftResizer.addEventListener("pointermove",event=>{if(dragWidth===null)return;queueLeftWidth(event.clientX-workspace.getBoundingClientRect().left);});
leftResizer.addEventListener("pointerup",finishLeftResize);leftResizer.addEventListener("pointercancel",finishLeftResize);
leftResizer.addEventListener("dblclick",event=>{event.preventDefault();resetLeftWidth();});
leftResizer.addEventListener("keydown",event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const {min,max}=leftLimits(),current=leftPanel.getBoundingClientRect().width,step=event.shiftKey?48:16;setLeftWidth(event.key==="Home"?min:event.key==="End"?max:current+(event.key==="ArrowRight"?step:-step),true);});
window.addEventListener("resize",refreshLeftWidth);new MutationObserver(refreshLeftWidth).observe(document.body,{attributes:true,attributeFilter:["class"]});
function update(){
 for(const part of parts){
   const hidden=focus||!!state[part];document.body.classList.toggle("hide-"+part,hidden);
   for(const button of document.querySelectorAll('[data-layout="'+part+'"]')){button.setAttribute("aria-expanded",String(!hidden));if(button.closest("#view-menu")){button.setAttribute("role","menuitemcheckbox");button.setAttribute("aria-checked",String(!hidden));}if(button.dataset.panel){const label=part==="left"?"รายการแบบ":"ตั้งค่าแผ่น";button.textContent=hidden?label:(part==="left"?"‹":"›");button.title=(hidden?"เปิด":"พับ")+label;button.setAttribute("aria-label",button.title);}}
 }
 document.body.classList.toggle("canvas-focus",focus);
 document.getElementById("layout-focus").textContent=focus?"คืนหน้าจอเดิม":"พื้นที่ทำงานเต็ม";
 document.getElementById("layout-focus").setAttribute("aria-pressed",String(focus));
 try{localStorage.setItem(key,JSON.stringify(state));}catch{}
}
for(const button of document.querySelectorAll("[data-layout]"))button.addEventListener("click",()=>{state[button.dataset.layout]=!state[button.dataset.layout];update();});
document.getElementById("layout-focus").addEventListener("click",()=>{focus=!focus;update();});
document.getElementById("layout-reset").addEventListener("click",()=>{focus=false;state={};resetLeftWidth();update();});
window.addEventListener("keydown",event=>{if(event.key==="Escape"&&focus&&!document.querySelector("dialog[open]")){focus=false;update();}});
update();
refreshLeftWidth();


const viewButton=document.getElementById('view-menu-button'),viewMenu=document.getElementById('view-menu');
for(const b of viewMenu.querySelectorAll('button:not([data-layout])'))b.setAttribute('role','menuitem');
const menuItems=()=>[...viewMenu.querySelectorAll('button:not(:disabled)')];
function closeView(returnFocus=false){viewMenu.hidden=true;viewButton.setAttribute('aria-expanded','false');if(returnFocus)viewButton.focus();}
function openView(last=false){viewMenu.hidden=false;viewButton.setAttribute('aria-expanded','true');const items=menuItems();(last?items.at(-1):items[0])?.focus();}
viewButton.addEventListener('click',()=>viewMenu.hidden?openView():closeView(true));
viewButton.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();openView(e.key==='ArrowUp');}});
viewMenu.addEventListener('click',e=>{if(e.target.closest('button'))closeView(true);});
viewMenu.addEventListener('keydown',e=>{const items=menuItems(),i=items.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeView(true);}if(e.key==='Tab')closeView();});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#layout-controls'))closeView();});
document.addEventListener('focusin',e=>{if(!e.target.closest('#layout-controls'))closeView();});
