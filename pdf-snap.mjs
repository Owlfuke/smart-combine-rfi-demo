import {identity,multiply,map} from './model.mjs';
const matrix=a=>({a:a[0],b:a[1],c:a[2],d:a[3],e:a[4],f:a[5]});
export async function pdfSnapPoints(blob,layer){
 const lib=await import('./vendor/pdfjs/build/pdf.mjs');lib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/build/pdf.worker.mjs',import.meta.url).href;
 const task=lib.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false});
 try{const doc=await task.promise,page=await doc.getPage(layer.page||1),view=page.getViewport({scale:1}),ops=await page.getOperatorList(),points=[],stack=[];let t=identity();
 const viewport=matrix(view.transform),scale={a:layer.width/view.width,b:0,c:0,d:layer.height/view.height,e:0,f:0};
 const add=(x,y)=>{if(points.length>=200000)throw Error('เวกเตอร์มากเกินขีดจำกัด 200,000 จุด');const p=map(multiply(scale,multiply(viewport,t)),{x,y});if(Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<=layer.width&&p.y<=layer.height)points.push(p);};
 for(let n=0;n<ops.fnArray.length;n++){const op=ops.fnArray[n],a=ops.argsArray[n];if(op===lib.OPS.save)stack.push({...t});else if(op===lib.OPS.restore)t=stack.pop()||identity();else if(op===lib.OPS.transform)t=multiply(t,matrix(a));else if(op===lib.OPS.paintFormXObjectBegin){stack.push({...t});if(a[0])t=multiply(t,matrix(a[0]));}else if(op===lib.OPS.paintFormXObjectEnd)t=stack.pop()||identity();else if(op===lib.OPS.constructPath){const path=a[1]?.[0];if(!path||!ArrayBuffer.isView(path)&&!Array.isArray(path))continue;for(let i=0;i<path.length;){const code=path[i++];if(code===0||code===1){add(path[i],path[i+1]);i+=2;}else if(code===2){add(path[i+4],path[i+5]);i+=6;}else if(code===3){add(path[i+2],path[i+3]);i+=4;}else if(code!==4)break;}}}
 const seen=new Set();return points.filter(p=>{const key=Math.round(p.x*100)+','+Math.round(p.y*100);if(seen.has(key))return false;seen.add(key);return true;});
 }finally{await task.destroy();}
}
export function nearestSnap(points,layer,camera,q,radius=10){
 const t=layer.transform,z=camera.zoom,a=t.a*z,b=t.b*z,c=t.c*z,d=t.d*z,e=t.e*z+camera.x,f=t.f*z+camera.y;
 let distance=radius*radius,bestX=0,bestY=0,found=false;
 for(const p of points){const x=a*p.x+c*p.y+e,y=b*p.x+d*p.y+f,dx=x-q.x,dy=y-q.y,squared=dx*dx+dy*dy;
 if(squared<distance){distance=squared;bestX=x;bestY=y;found=true;}}
 return found?{x:bestX,y:bestY}:null;
}
