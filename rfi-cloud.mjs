// The RFI form shrinks a high-resolution crop more than the full-plan pages.
export const RFI_PDF_CLOUD_STROKE=6;
export const PLAN_PDF_CLOUD_STROKE=3;
export const PLAN_PDF_CLOUD_SHAPE=Object.freeze({step:18,bulge:.5});
export const RFI_PDF_CLOUD_IMAGE_VERSION=4;

// Small crops are enlarged on A4, so use more scallops along their short edge.
export function rfiPdfCloudShape(rect){
 return {step:Math.min(18,Math.max(4,Math.min(rect.w,rect.h)/8)),bulge:.5};
}

export function cloud(ctx,r,lineWidth=2.5,{step=18,bulge=.5}={}){
 ctx.save();ctx.strokeStyle='#dc2626';ctx.lineWidth=lineWidth;ctx.beginPath();
 const corners=[[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h],[r.x,r.y]];
 ctx.moveTo(...corners[0]);
 for(let i=0;i<4;i++){const [x,y]=corners[i],[ex,ey]=corners[i+1],dx=ex-x,dy=ey-y,n=Math.max(1,Math.ceil(Math.hypot(dx,dy)/step));for(let k=0;k<n;k++){const ax=x+dx*k/n,ay=y+dy*k/n,bx=x+dx*(k+1)/n,by=y+dy*(k+1)/n;ctx.quadraticCurveTo((ax+bx)/2+dy/n*bulge,(ay+by)/2-dx/n*bulge,bx,by);}}
 ctx.closePath();ctx.stroke();ctx.restore();
}
