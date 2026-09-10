export function captureState(p,item,engine={}){
 const mode=engine.comparisonMode||'normal',compare=mode!=='normal'&&item.sheetId!==p.baseId;
 const layers=p.layers.filter(l=>compare?(l.id===p.baseId||l.id===item.sheetId):l.visible&&l.opacity>0);
 return JSON.stringify({base:p.baseId,mode,split:mode==='swipe'?engine.comparisonSplit:null,rect:item.rect,layers:layers.map(l=>({id:l.id,asset:l.assetId,source:l.sourceId,page:l.page,name:l.name,revision:l.revision,transform:l.transform,opacity:l.opacity,blend:l.blend,color:l.color,colorMode:l.colorMode,gridBands:l.gridBands,gridLines:l.gridLines})),measurements:item.showDimensions!==false?p.layers.find(l=>l.id===item.sheetId)?.measurements:null,scale:item.showDimensions!==false?p.layers.find(l=>l.id===item.sheetId)?.measureScale:null});
}
export function imageState(p,item,engine){if(!item?.captureState)return 'unknown';return item.captureState===captureState(p,item,engine)?'current':'stale';}
