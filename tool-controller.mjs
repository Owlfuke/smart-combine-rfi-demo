export class ToolController {
 constructor(){this.tools=new Map();this.active=null;this.context=null;}
 register(name,cancel){this.tools.set(name,cancel);}
 reset(){this.active=null;for(const cancel of this.tools.values())cancel();if(typeof window!=="undefined")window.dispatchEvent(new Event("drawing-tool-change"));}
 activate(name){this.reset();this.active=name;}
 sync(context){if(this.context!==context){this.context=context;this.reset();}}
}
export function installToolController(engine,getProject){
 const controller=new ToolController();engine.tools=controller;
 controller.register('camera',()=>{const id=engine.drag?.id;engine.drag=null;if(id!==undefined&&engine.canvas.hasPointerCapture(id))engine.canvas.releasePointerCapture(id);});
 window.addEventListener('keydown',e=>{
 if(!['Escape','Delete'].includes(e.key))return;if(e.target.closest?.('[role=menu]'))return;
 if(e.target.closest?.('input,textarea,select,[contenteditable],[role="textbox"]')||document.querySelector('dialog[open]')){e.stopImmediatePropagation();return;}
 if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();controller.reset();if(getProject()?.calibration)engine.cancel();engine.cursor();engine.render();}
 },true);
 return controller;
}
