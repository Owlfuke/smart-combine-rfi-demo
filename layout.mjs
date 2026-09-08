
const key="smart-combine-layout-v1";
const parts=["menus","left","right","tools","status"];
let state={};try{state=JSON.parse(localStorage.getItem(key)||"{}");}catch{}
if(!state||typeof state!=="object")state={};
let focus=false;
function update(){
 for(const part of parts){
   const hidden=focus||!!state[part];document.body.classList.toggle("hide-"+part,hidden);
   for(const button of document.querySelectorAll('[data-layout="'+part+'"]')){button.setAttribute("aria-expanded",String(!hidden));if(button.dataset.panel){const label=part==="left"?"รายการแบบ":"ตั้งค่าแผ่น";button.textContent=hidden?label:(part==="left"?"‹":"›");button.title=(hidden?"เปิด":"พับ")+label;button.setAttribute("aria-label",button.title);}}
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

