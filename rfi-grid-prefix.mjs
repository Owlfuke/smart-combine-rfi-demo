// Only a new entry in an empty field receives a prefix; existing OCR stays intact.
export function bindGridPrefix(input,onChange){
 let pending=false;
 input.addEventListener('beforeinput',event=>{
  if(!event.isComposing)pending=input.value===''&&event.inputType?.startsWith('insert');
 });
 input.addEventListener('compositionstart',()=>{pending=input.value==='';});
 const update=()=>{
  if(pending&&input.value){
   if(!/^GL\./i.test(input.value)){
    const start=input.selectionStart,end=input.selectionEnd,direction=input.selectionDirection;
    input.value='GL.'+input.value;
    input.setSelectionRange(start+3,end+3,direction);
   }
   pending=false;
  }
  onChange();
 };
 input.addEventListener('input',event=>{if(!event.isComposing)update();});
 input.addEventListener('compositionend',update);
}
