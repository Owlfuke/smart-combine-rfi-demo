import {TitleBlockReader} from './title-block-reader.mjs';
export function gridRange(words){
 const names=[...new Set(words.map(w=>w.text.trim().toUpperCase()).filter(s=>/^[A-Z](?:[0-9](?:\.\d+)?)?$/.test(s)||/^\d{1,2}(?:\.\d+)?$/.test(s)))];
 const letters=names.filter(s=>/^[A-Z]/.test(s)).sort((a,b)=>a.localeCompare(b,'en',{numeric:true})),numbers=names.filter(s=>/^\d/.test(s)).sort((a,b)=>Number(a)-Number(b));
 const range=a=>a.length?a.length===1?a[0]:a[0]+'-'+a.at(-1):null;
 return {letters:range(letters),numbers:range(numbers)};
}
export async function readGridFrame(frame){
 const reader=new TitleBlockReader(()=>{}),signal=new AbortController().signal;
 try{const results=[];for(const canvas of [frame.topStrip,frame.sideStrip]){let words=await reader.ocr(canvas,signal,true,true);if(words.length<2)words=await reader.ocr(canvas,signal,true,false);let found=gridRange(words);if(!found.letters&&!found.numbers){const small=document.createElement('canvas');small.width=Math.max(1,Math.round(canvas.width*.35));small.height=Math.max(1,Math.round(canvas.height*.35));small.getContext('2d').drawImage(canvas,0,0,small.width,small.height);words=await reader.ocr(small,signal,true,false);found=gridRange(words);}const isolated=await readHeads(canvas,results.length===0,reader,signal);if(isolated.length)found=gridRange(isolated);results.push(found);}
 const letters=results.find(r=>r.letters)?.letters,numbers=results.find(r=>r.numbers)?.numbers;
 return letters&&numbers?'Gl.'+letters+'/'+numbers:null;
 }finally{reader.stop();}
}


async function readHeads(canvas,top,reader,signal){
 const ctx=canvas.getContext('2d'),{data}=ctx.getImageData(0,0,canvas.width,canvas.height),w=canvas.width,h=canvas.height,limit=top?w:h,cross=top?h:w;
 const dark=(x,y)=>{const i=(y*w+x)*4;return data[i+3]>100&&data[i]+data[i+1]+data[i+2]<600;};
 const runs=[];let start=-1;
 for(let i=0;i<=limit;i++){let ink=0;if(i<limit)for(let j=0;j<cross;j++)if(top?dark(i,j):dark(j,i))ink++;if(ink>2){if(start<0)start=i;}else if(start>=0){if(i-start>8)runs.push([start,i]);start=-1;}}
 const worker=await reader.getWorker(signal);await worker.setParameters({tessedit_pageseg_mode:'8',tessedit_char_whitelist:top?'0123456789':'ABCDEFGHIJKLMNOPQRSTUVWXYZ'});const words=[];
 for(const [a,b] of runs){let first=cross;for(let i=a;i<b;i++)for(let j=0;j<cross;j++)if(top?dark(i,j):dark(j,i)){first=Math.min(first,j);break;}const diameter=b-a,pad=diameter*.24;const c=document.createElement('canvas');c.width=c.height=Math.max(1,Math.round(diameter-2*pad));c.getContext('2d').drawImage(canvas,top?a+pad:first+pad,top?first+pad:a+pad,diameter-2*pad,diameter-2*pad,0,0,c.width,c.height);const padded=document.createElement('canvas');padded.width=c.width+40;padded.height=c.height+40;const px=padded.getContext('2d');px.fillStyle='white';px.fillRect(0,0,padded.width,padded.height);px.drawImage(c,20,20);await worker.setParameters({tessedit_pageseg_mode:'8'});let result=await worker.recognize(padded),text=result.data.text.trim();if(!text){await worker.setParameters({tessedit_pageseg_mode:'10'});result=await worker.recognize(padded);text=result.data.text.trim();}if(text)words.push({text});}return words;
}

