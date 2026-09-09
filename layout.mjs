
const key="smart-combine-layout-v1";
const parts=["menus","left","right","tools","status"];
let state={};try{state=JSON.parse(localStorage.getItem(key)||"{}");}catch{}
if(!state||typeof state!=="object")state={};
let focus=false;
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
document.getElementById("layout-reset").addEventListener("click",()=>{focus=false;state={};update();});
window.addEventListener("keydown",event=>{if(event.key==="Escape"&&focus&&!document.querySelector("dialog[open]")){focus=false;update();}});
update();


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
