import {TitleBlockReader} from './title-block-reader.mjs';

const alpha=/^[A-Z]{1,2}(?:\d+(?:\.\d+)?)?$/;
const numeric=/^\d{1,2}(?:\.\d+)?$/;
export function gridRange(words){
 const names=[...new Set(words.map(w=>w.text.trim().toUpperCase()))];
 const range=a=>a.length?(a.length===1?a[0]:a[0]+'-'+a.at(-1)):null;
 return {letters:range(names.filter(s=>alpha.test(s)).sort((a,b)=>a.localeCompare(b,'en',{numeric:true}))),numbers:range(names.filter(s=>numeric.test(s)).sort((a,b)=>Number(a)-Number(b)))};
}

// Closed white interiors identify actual grid bubbles, excluding dimension text and leaders.
export function findGridHeads(canvas){
 const w=canvas.width,h=canvas.height,{data}=canvas.getContext('2d').getImageData(0,0,w,h);
 const seen=new Uint8Array(w*h),queue=new Int32Array(w*h),heads=[];
 const white=i=>data[i*4+3]<80||Math.min(data[i*4],data[i*4+1],data[i*4+2])>235;
 for(let seed=0;seed<w*h;seed++){
  if(seen[seed]||!white(seed))continue;
  let read=0,write=1,minX=w,minY=h,maxX=0,maxY=0,border=false;queue[0]=seed;seen[seed]=1;
  while(read<write){const i=queue[read++],x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);if(x===0||y===0||x===w-1||y===h-1)border=true;
   for(const n of [x>0?i-1:-1,x<w-1?i+1:-1,y>0?i-w:-1,y<h-1?i+w:-1])if(n>=0&&!seen[n]&&white(n)){seen[n]=1;queue[write++]=n;}
  }
  const bw=maxX-minX+1,bh=maxY-minY+1,fill=write/(bw*bh);
  if(border||bw<12||bh<12||bw/bh<.7||bw/bh>1.45||fill<.35||fill>.84)continue;
  // A bubble narrows at both extremes; rectangular grid cells do not.
  let outer=0;for(let j=0;j<write;j++){const x=(queue[j]%w-minX+.5)/bw,y=(Math.floor(queue[j]/w)-minY+.5)/bh;if((x-.5)**2+(y-.5)**2>.28)outer++;}
  if(outer/write>.035)continue;
  heads.push({x:minX,y:minY,w:bw,h:bh});
 }
 // Letter holes are much smaller than the enclosing bubble.
 const largest=Math.max(0,...heads.map(b=>Math.min(b.w,b.h)));
 return heads.filter(b=>Math.min(b.w,b.h)>=largest*.55);
}

export async function readHead(canvas,box,worker,top){
 const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,128,128);
 // Mask the outline while keeping suffixes near the sides of the head.
 x.save();x.beginPath();x.ellipse(64,64,47,47,0,0,Math.PI*2);x.clip();x.drawImage(canvas,box.x,box.y,box.w,box.h,16,16,96,96);x.restore();
 const allowed=top?'0123456789.':'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.';
 const readings=[];
 for(const mode of ['7','8']){await worker.setParameters({tessedit_pageseg_mode:mode,tessedit_char_whitelist:allowed});const result=await worker.recognize(c);const text=result.data.text.replace(/\s/g,'');if((top?numeric:alpha).test(text.toUpperCase()))readings.push({text,confidence:result.data.confidence});}
 if(!readings.length)return null;
 if(readings.length===2&&readings[0].text.toUpperCase()===readings[1].text.toUpperCase()&&Math.max(...readings.map(r=>r.confidence))>=55)return readings[0].text;
 readings.sort((a,b)=>b.confidence-a.confidence);
 return readings[0].confidence>=70?readings[0].text:null;
}

export async function readGridFrame(frame){
 const reader=new TitleBlockReader(()=>{}),signal=new AbortController().signal;
 try{
  const worker=await reader.getWorker(signal),ranges=[];
  for(const [display,top,region] of [[frame.topStrip,true,frame.ocrTop],[frame.sideStrip,false,frame.ocrSide]]){
   const canvas=region?.canvas||display;
   if(!canvas)return null;
   const heads=findGridHeads(canvas).filter(b=>!region||((top?b.x+b.w/2:b.y+b.h/2)>=region.lo&&(top?b.x+b.w/2:b.y+b.h/2)<=region.hi)).sort((a,b)=>top?a.x-b.x:a.y-b.y);
   if(!heads.length)return null;
   const readings=[];for(const head of heads)readings.push(await readHead(canvas,head,worker,top));
   // Never silently shrink the range when an endpoint could not be read.
   if(!readings[0]||!readings.at(-1))return null;
   const compare=top?(a,b)=>Number(a)-Number(b):(a,b)=>a.toUpperCase().localeCompare(b.toUpperCase(),'en',{numeric:true});
   const valid=readings.filter(Boolean);let direction=0;
   for(let i=1;i<valid.length;i++){const d=Math.sign(compare(valid[i],valid[i-1]));if(!d||(direction&&d!==direction))return null;direction=d;}
   const ends=[readings[0],readings.at(-1)].sort(compare);ranges.push(ends[0]===ends[1]?ends[0]:ends.join('-'));
  }
  return 'Gl.'+ranges[1]+'/'+ranges[0];
 }finally{reader.stop();}
}


