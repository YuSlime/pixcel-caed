/* PIXEL CARD STUDIO: self-contained client-side editor. No external services. */
'use strict';
(() => {
const W=1086,H=1448, VERSION=1;
const $=id=>document.getElementById(id);
const canvas=$('cardCanvas'),screen=canvas.getContext('2d',{alpha:true});
const makeId=()=>`l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
const clone=data=>JSON.parse(JSON.stringify(data));
const int=(v,fallback=0)=>Number.isFinite(+v)?+v:fallback;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const asset=n=>`assets/${n}.png`;
const imageCache=new Map();
const digitGlyphCache=new WeakMap();
const FONT_CONFIG={
 pixelmplus12:{label:'PixelMplus12 Bold',family:'PCS PixelMplus12 Loaded',localNames:['PixelMplus12 Bold','PixelMplus12-Bold','PixelMplus12']},
 pixelifySansBold:{label:'Pixelify Sans Bold',family:'PCS Pixelify Sans Loaded',localNames:['Pixelify Sans Bold','Pixelify Sans']}
};
const registeredFonts=new Map();
const USER_FONT_KEY=/^userfont-[a-z0-9-]{1,70}$/;
const MAX_USER_FONTS=16,MAX_FONT_DATA=60_000_000;
function isFontStyle(key){return !!FONT_CONFIG[key]||USER_FONT_KEY.test(String(key||''))}
function fontInfo(key,assets=project?.fontAssets){
 if(FONT_CONFIG[key])return FONT_CONFIG[key];
 if(USER_FONT_KEY.test(String(key||''))&&assets?.[key])return {label:assets[key].name||'登録フォント',family:`PCS User ${key}`,localNames:[]};
 return null;
}
function fontWeight(l){return Math.round(clamp(int(l.fontWeight,800),100,900)/100)*100}

const unavailableFonts=new Set();
const safeFontData=/^data:(?:font\/(?:ttf|otf|woff|woff2)|application\/(?:x-font-(?:ttf|otf|woff|woff2)|font-(?:sfnt|woff|woff2)|octet-stream));base64,[A-Za-z0-9+/]+={0,2}$/;
let project,selectedId=null,drag=null,autosaveTimer=null,toastTimer=null,previewScale=null;
let undoStack=[],redoStack=[],isRestoring=false,db=null,userTemplates={};
const continuousEdits=new Set();
function defaults(){
 return {version:VERSION,width:W,height:H,title:'サンドスライム',digitTheme:null,fontAssets:{},layers:[
  {id:'background',role:'background',name:'背景色',type:'color',color:'#d8a364',x:0,y:0,w:W,h:H,visible:true,locked:true,opacity:1},
  {id:'art',role:'art',name:'イラスト（ここを差し替え）',type:'image',src:asset('demo-art'),fit:'cover',scale:1,x:0,y:0,w:W,h:H,visible:true,locked:false,opacity:1},
  {id:'plateback',role:'plateback',name:'プレートの暗い下地',type:'color',color:'#171b1e',x:23,y:1276,w:1040,h:130,visible:true,locked:true,opacity:.83},
  {id:'nameplate',role:'nameplate',name:'カード名プレート',type:'image',src:asset('nameplate-crop'),x:19,y:1270,w:1048,h:140,visible:true,locked:false,opacity:1},
  {id:'orb',role:'orb',name:'コストアイコン',type:'image',src:asset('cost-orb-crop'),x:14,y:16,w:210,h:210,visible:true,locked:false,opacity:1},
  {id:'sword',role:'sword',name:'攻撃アイコン',type:'image',src:asset('sword-crop'),x:55,y:1265,w:124,h:121,visible:true,locked:false,opacity:1},
  {id:'heart',role:'heart',name:'体力アイコン',type:'image',src:asset('heart-crop'),x:838,y:1277,w:105,h:99,visible:true,locked:false,opacity:1},
  {id:'frame',role:'frame',name:'グレーの外枠',type:'image',src:asset('frame-reference'),x:0,y:0,w:W,h:H,visible:true,locked:true,opacity:1},
  {id:'name',role:'name',name:'キャラ名',type:'text',text:'サンドスライム',x:296,y:1280,w:512,h:105,fontSize:58,fontWeight:800,color:'#ffffff',stroke:'#2d2c27',strokeWidth:5,align:'center',visible:true,locked:false,opacity:1},
  {id:'cost',role:'cost',name:'コスト数値',type:'text',text:'3',x:68,y:60,w:117,h:155,fontSize:129,fontStyle:'reference',digitSpacing:0,fontWeight:900,color:'#ffffff',stroke:'#174381',strokeWidth:6,align:'center',visible:true,locked:false,opacity:1},
  {id:'attack',role:'attack',name:'攻撃力数値',type:'text',text:'2',x:174,y:1284,w:91,h:91,fontSize:88,fontStyle:'sprite',digitSpacing:0,fontWeight:900,color:'#ffffff',stroke:'#262b30',strokeWidth:5,align:'center',visible:true,locked:false,opacity:1},
  {id:'health',role:'health',name:'体力数値',type:'text',text:'5',x:941,y:1284,w:91,h:91,fontSize:88,fontStyle:'sprite',digitSpacing:0,fontWeight:900,color:'#ffffff',stroke:'#262b30',strokeWidth:5,align:'center',visible:true,locked:false,opacity:1}
 ]};
}
const current=()=>project.layers.find(l=>l.id===selectedId);
function showToast(msg){let t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2900)}
function cacheImage(src){
 if(!src||typeof src!=='string')return Promise.resolve(null);
 if(imageCache.has(src))return imageCache.get(src);
 const promise=new Promise(resolve=>{const im=new Image();im.onload=()=>{render();resolve(im)};im.onerror=()=>{console.warn('画像を読み込めません:',src.slice(0,70));resolve(null)};im.src=src});
 imageCache.set(src,promise);return promise;
}
function preload(){for(const l of project.layers)if(l.type==='image')cacheImage(l.src);if(project?.digitTheme?.sheetSrc)cacheImage(project.digitTheme.sheetSrc)}
const loaded=new Map();
function ensureImage(src){
 if(loaded.has(src))return loaded.get(src);
 if(!src)return null;
 let im=new Image(); im.onload=()=>{loaded.set(src,im);render();};im.onerror=()=>{loaded.set(src,null);render();};
 loaded.set(src,undefined);im.src=src;return null;
}
function digitThemeEnabled(){return !!(project&&project.digitTheme&&typeof project.digitTheme.sheetSrc==='string'&&project.digitTheme.sheetSrc.startsWith('data:image/'))}
function defaultDigitAsset(char){return asset(`digit-${char}`)}
// Every row has its own 5 unevenly-spaced glyphs. 5 equal slices can cut
// through a digit (the supplied silver 0 crosses the nominal x=250 boundary).
function sampleBgColor(data,w,h){
 const points=[[1,1],[Math.max(1,w-2),1],[1,Math.max(1,h-2)],[Math.max(1,w-2),Math.max(1,h-2)],[Math.floor(w/2),1],[1,Math.floor(h/2)],[Math.max(1,w-2),Math.floor(h/2)]];
 const colors=[0,1,2,3].map(channel=>points.map(([x,y])=>data[(y*w+x)*4+channel]).sort((a,b)=>a-b));
 return colors.map(xs=>xs[Math.floor(xs.length/2)]);
}
function chooseDigitSeparator(projection,center,searchRadius){
 const lower=Math.max(2,Math.floor(center-searchRadius));
 const upper=Math.min(projection.length-2,Math.ceil(center+searchRadius));
 // Choose a genuinely empty column/row closest to the expected separator.
 // If none exists, choose the sparsest available separator as a fallback.
 let best=clamp(Math.round(center),lower,upper),bestCount=Infinity,bestDistance=Infinity;
 for(let i=lower;i<=upper;i++){
  const count=projection[i],distance=Math.abs(i-center);
  if(count<bestCount||(count===bestCount&&distance<bestDistance)){
   best=i;bestCount=count;bestDistance=distance;
  }
 }
 return best;
}
// Detect each digit's actual ink bounds rather than slicing the sheet into
// equal 20% columns. The uploaded digits are deliberately unevenly spaced;
// the first silver '0', for example, extends beyond the 1/5 mark.
function findDigitRanges(columnDensity,width,count){
 const threshold=Math.max(2,Math.floor(Math.max(...columnDensity)*0.008));
 const minimumWidth=Math.max(8,Math.floor(width/(count*12)));
 const runs=[];
 let start=-1;
 for(let x=0;x<=width;x++){
  const filled=x<width&&columnDensity[x]>=threshold;
  if(filled&&start<0)start=x;
  if(!filled&&start>=0){
   const end=x-1;
   if(end-start+1>=minimumWidth)runs.push([start,end]);
   start=-1;
  }
 }
 // Never guess which run belongs to which numeral. Use the older guarded
 // separator search only for sheets without exactly five clear regions.
 return runs.length===count?runs:null;
}
function buildDigitGlyphs(sheet,cols=5,rows=2){
 const w=sheet.naturalWidth,h=sheet.naturalHeight;
 if(w<cols*8||h<rows*8)return null;
 const source=document.createElement('canvas');source.width=w;source.height=h;
 const ctx=source.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(sheet,0,0);
 const pixels=ctx.getImageData(0,0,w,h),data=pixels.data;
 const bg=sampleBgColor(data,w,h);
 // The sample sheets are either genuine transparent PNGs or dark opaque
 // sheets. Treat only the opaque, dark border as removable background.
 const opaqueDark=bg[3]>240&&Math.max(bg[0],bg[1],bg[2])<55;
 const mask=new Uint8Array(w*h),rowDensity=new Uint32Array(h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const index=y*w+x,p=index*4,a=data[p+3];
  const difference=Math.max(Math.abs(data[p]-bg[0]),Math.abs(data[p+1]-bg[1]),Math.abs(data[p+2]-bg[2]));
  let foreground=a>16;
  if(opaqueDark){
   // Leave dark character outlines intact; anti-aliased black background
   // becomes transparent instead of a rectangular black panel.
   const coverage=clamp((difference-9)/23,0,1);
   data[p+3]=Math.round(a*coverage);
   foreground=a>16&&difference>25;
  }
  if(foreground){mask[index]=1;rowDensity[y]++}
 }
 const rowCuts=[0];
 for(let r=1;r<rows;r++){
  const center=h*r/rows;
  rowCuts.push(chooseDigitSeparator(rowDensity,center,h/(rows*3)));
 }
 rowCuts.push(h);
 const results=[];
 for(let r=0;r<rows;r++){
  const y0=rowCuts[r],y1=rowCuts[r+1],columnDensity=new Uint32Array(w);
  for(let y=y0;y<y1;y++)for(let x=0;x<w;x++)columnDensity[x]+=mask[y*w+x];
  const detected=findDigitRanges(columnDensity,w,cols);
  const xCuts=[0];
  if(!detected){
   for(let c=1;c<cols;c++)xCuts.push(chooseDigitSeparator(columnDensity,w*c/cols,w/(cols*2.5)));
  }
  xCuts.push(w);
  for(let c=0;c<cols;c++){
   // When we have exactly five distinct silhouettes, each crop is defined by
   // its own silhouette. This never slices through a neighbour's strokes.
   const x0=detected?(c===0?0:Math.floor((detected[c-1][1]+detected[c][0])/2)):xCuts[c];
   const x1=detected?(c===cols-1?w:Math.floor((detected[c][1]+detected[c+1][0])/2)+1):xCuts[c+1];
   let minX=w,minY=h,maxX=-1,maxY=-1;
   for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    if(!mask[y*w+x])continue;
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);
    minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   }
   // Keep two pixels around the actual drawing, but never copy a neighbor.
   if(maxX<minX){minX=x0;maxX=x1-1;minY=y0;maxY=y1-1}
   const pad=2,left=Math.max(x0,minX-pad),top=Math.max(y0,minY-pad),
     right=Math.min(x1,maxX+1+pad),bottom=Math.min(y1,maxY+1+pad);
   const cropped=document.createElement('canvas');
   cropped.width=Math.max(1,right-left);cropped.height=Math.max(1,bottom-top);
   const rgba=new ImageData(cropped.width,cropped.height);
   for(let yy=0;yy<cropped.height;yy++){
    const src=((top+yy)*w+left)*4,dst=(yy*cropped.width)*4;
    rgba.data.set(data.subarray(src,src+cropped.width*4),dst);
   }
   cropped.getContext('2d').putImageData(rgba,0,0);
   results.push(cropped);
  }
 }
 return results;
}
function extractTrimmedGlyphFromSheet(img,index,cols=5,rows=2){
 let cache=digitGlyphCache.get(img);
 if(!cache||cache.cols!==cols||cache.rows!==rows){
  cache={cols,rows,glyphs:buildDigitGlyphs(img,cols,rows)};
  digitGlyphCache.set(img,cache);
 }
 return cache.glyphs?.[index]||null;
}
function getDigitImage(char){
 if(!/^[0-9]$/.test(char))return null;
 if(digitThemeEnabled()){
  const sheet=ensureImage(project.digitTheme.sheetSrc);
  if(!sheet||!(sheet.naturalWidth>0))return null;
  return extractTrimmedGlyphFromSheet(sheet,Number(char),int(project.digitTheme.cols,5),int(project.digitTheme.rows,2));
 }
 return ensureImage(defaultDigitAsset(char));
}
function digitSourcesForLayer(layer){
 if(layer.fontStyle==='reference'&&String(layer.text)==='3')return [asset('cost-reference-3')];
 const chars=[...String(layer.text||'')].filter(c=>/^[0-9]$/.test(c));
 if(!chars.length)return [];
 if(digitThemeEnabled())return [project.digitTheme.sheetSrc];
 return chars.map(c=>defaultDigitAsset(c));
}
function selectedFontKey(){const l=current();return l?.type==='text'&&isFontStyle(l.fontStyle)?l.fontStyle:null}
function updateFontOptions(){
 const select=$('fontStyle');if(!select)return;
 const selected=current()?.fontStyle||'normal';
 [...select.options].filter(o=>o.dataset.userFont==='yes').forEach(o=>o.remove());
 for(const [key,data] of Object.entries(project.fontAssets||{})){
  if(!USER_FONT_KEY.test(key))continue;
  const opt=new Option('登録: '+String(data.name||'フォント'),key);
  opt.dataset.userFont='yes';select.add(opt);
 }
 if([...select.options].some(o=>o.value===selected))select.value=selected;
 $('removeFontBtn').hidden=!USER_FONT_KEY.test(selected);
}
function updateFontStatus(){
 const key=selectedFontKey(),controls=$('customFontControls');if(!controls)return;
 controls.hidden=!key;
 const status=$('fontLoadStatus');
 if(!key)return
 const assetEntry=project.fontAssets?.[key],state=registeredFonts.get(key),info=fontInfo(key);
 if(state?.status==='loaded')status.textContent=assetEntry?`使用中: ${assetEntry.name}（JSONに保存されます）`:`使用中: PCにインストールされた ${info?.label}`;
 else status.textContent=`${info?.label||'このフォント'} はまだ読み込まれていません。フォントファイルを選択してください。`;
}
function fontFamilyForStyle(style){
 const info=fontInfo(style);if(!info)return '"Yu Gothic","Hiragino Kaku Gothic ProN","Meiryo",sans-serif';
 return registeredFonts.get(style)?.status==='loaded'?`"${info.family}","Meiryo",sans-serif`:'"Yu Gothic","Meiryo",sans-serif';
}
async function registerCustomFont(key,asset){
 const cfg=fontInfo(key,asset?{[key]:asset}:undefined);if(!cfg)throw new Error('フォントの種類が認識できません');
 const id=asset?.data||'__local__';
 if(registeredFonts.get(key)?.id===id&&registeredFonts.get(key)?.status==='loaded')return;
 if(!window.FontFace||!document.fonts){unavailableFonts.add(key);return}
 if(!asset&&USER_FONT_KEY.test(key))return;
 const source=asset?`url("${asset.data}")`:cfg.localNames.map(name=>`local("${name}")`).join(', ');
 // Variable fonts can honor intermediate weights. Static files are loaded at
 // their native weight; browsers may synthesize intermediate weights.
 const variable=asset?.variable===true||(!asset&&key==='pixelifySansBold');
 const declaredWeight=variable?'100 900':(asset?.nativeWeight||700).toString();
 const face=new FontFace(cfg.family,source,{weight:declaredWeight,style:'normal'});
 try{await face.load()}
 catch(err){
  if(asset)throw new Error(`${cfg.label} を読み込めませんでした。ファイル形式を確認してください`);
  const old=registeredFonts.get(key);if(old?.face)document.fonts.delete(old.face);
  registeredFonts.delete(key);unavailableFonts.add(key);return;
 }
 const old=registeredFonts.get(key);if(old?.face)document.fonts.delete(old.face);
 document.fonts.add(face);registeredFonts.set(key,{id,face,status:'loaded'});unavailableFonts.delete(key);
}
async function syncCustomFonts(p){
 const sources=p.fontAssets||{};
 const required=[...Object.keys(FONT_CONFIG),...Object.keys(sources).filter(k=>USER_FONT_KEY.test(k))];
 for(const key of [...registeredFonts.keys()])if(!required.includes(key)){
  const old=registeredFonts.get(key);if(old?.face)document.fonts.delete(old.face);registeredFonts.delete(key);
 }
 await Promise.all(required.map(key=>registerCustomFont(key,sources[key])));
 if(project){render();if(current()?.type==='text')updateFontOptions();updateFontStatus()}
}
async function ensureSelectedFonts(){
 await syncCustomFonts(project);
 const missing=new Set(project.layers.filter(l=>l.visible&&l.type==='text'&&isFontStyle(l.fontStyle)&&String(l.text||'')).map(l=>l.fontStyle));
 for(const key of missing)if(registeredFonts.get(key)?.status!=='loaded')throw new Error(`${fontInfo(key)?.label||'登録フォント'} が未登録です。文字レイヤーからフォントを読み込んでください`);
 if(document.fonts)await document.fonts.ready;
}
async function readFontFile(file){
 if(!file||file.size===0||file.size>8*1024*1024)throw new Error('フォントは8MB以下のファイルを選択してください');
 if(!/\.(?:ttf|otf|woff2?)$/i.test(file.name))throw new Error('TTF / OTF / WOFF / WOFF2を指定してください');
 const header=new Uint8Array(await file.slice(0,4).arrayBuffer());
 const tag=String.fromCharCode(...header);
 const sfnt=header.length===4&&header[0]===0&&header[1]===1&&header[2]===0&&header[3]===0;
 if(!(sfnt||['OTTO','wOFF','wOF2','true'].includes(tag)))throw new Error('フォントファイルの内容を確認してください');
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{
  const raw=String(reader.result||'');const content=raw.slice(raw.indexOf(',')+1);
  const mime=tag==='wOFF'?'font/woff':tag==='wOF2'?'font/woff2':tag==='OTTO'?'font/otf':'font/ttf';
  const bold=/bold|black|heavy/i.test(file.name);
  const variable=/variable|\[wght\]|vf[.\-_]/i.test(file.name);
  resolve({name:file.name,data:`data:${mime};base64,${content}`,nativeWeight:bold?700:400,variable});
 };reader.onerror=()=>reject(new Error('フォントを読み込めませんでした'));reader.readAsDataURL(file)});
}
async function importFontFile(file){
 const key=selectedFontKey();if(!key)return;
 try{const asset=await readFontFile(file);await registerCustomFont(key,asset);
  change(()=>{project.fontAssets={...project.fontAssets,[key]:asset}},true);
  showToast(`${fontInfo(key)?.label||'登録フォント'} のフォントを登録しました`);
 }catch(err){showToast('フォントの登録失敗: '+err.message)}
}
async function addUserFontFiles(files){
 let ok=0;let rejected=[];
 for(const file of files){
  try{
   const currentAssets=project.fontAssets||{};
   if(Object.keys(currentAssets).filter(k=>USER_FONT_KEY.test(k)).length>=MAX_USER_FONTS)throw new Error(`追加フォントは最大${MAX_USER_FONTS}種類です`);
   const asset=await readFontFile(file);
   if(Object.values(currentAssets).reduce((n,item)=>n+(item.data?.length||0),0)+asset.data.length>MAX_FONT_DATA)throw new Error('保存できるフォントの合計サイズを超えました');
   const key='userfont-'+makeId().slice(2);
   await registerCustomFont(key,asset);
   change(()=>{project.fontAssets={...project.fontAssets,[key]:asset};const l=current();if(l?.type==='text')l.fontStyle=key},true);
   ok++;
  }catch(err){rejected.push(`${file.name}: ${err.message}`)}
 }
 if(rejected.length)showToast('フォントの追加失敗: '+rejected.join(' / ').slice(0,200));
 else if(ok)showToast(`${ok}種類のフォントを追加しました`);
 updateFontOptions();fillInspector();
}
function removeUserFont(){
 const key=selectedFontKey();if(!USER_FONT_KEY.test(key))return;
 const label=project.fontAssets?.[key]?.name||'登録フォント';
 if(!confirm(`${label} を削除しますか？ このフォントを使う文字は標準に戻ります。`))return;
 change(()=>{for(const l of project.layers)if(l.fontStyle===key)l.fontStyle='normal';delete project.fontAssets[key]},true);
 void syncCustomFonts(project).catch(err=>showToast(err.message));showToast('フォントを削除しました');
}
async function waitForImages(){
 let sources=[...new Set(project.layers.filter(l=>l.visible).flatMap(l=>l.type==='image'?[l.src]:l.type==='text'&&['sprite','reference'].includes(l.fontStyle)?digitSourcesForLayer(l):[]))];
 await Promise.all(sources.map(s=>new Promise(resolve=>{let existing=loaded.get(s);if(existing!==undefined){resolve();return}const im=new Image();im.onload=()=>{loaded.set(s,im);resolve()};im.onerror=()=>{loaded.set(s,null);resolve()};im.src=s})));
 if(sources.some(s=>loaded.get(s)===null))throw new Error('画像の一部を読み込めません。レイヤーの画像を確認してください');
}
function cropBox(l,img){
 const c=l.crop||{};let left=clamp(int(c.left),0,90),right=clamp(int(c.right),0,90),top=clamp(int(c.top),0,90),bottom=clamp(int(c.bottom),0,90);
 if(left+right>=99)right=98-left;if(top+bottom>=99)bottom=98-top;
 return [img.naturalWidth*left/100,img.naturalHeight*top/100,img.naturalWidth*(100-left-right)/100,img.naturalHeight*(100-top-bottom)/100];
}
const PIXEL_FONT={
 '0':['01110','11011','11011','11011','11011','11011','01110'],
 '1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['11110','00011','00011','01110','11000','11000','11111'],
 '3':['11110','00011','00011','01110','00011','00011','11110'],
 '4':['11011','11011','11011','11111','00011','00011','00011'],
 '5':['11111','11000','11000','11110','00011','00011','11110'],
 '6':['01111','11000','11000','11110','11011','11011','01110'],
 '7':['11111','00011','00110','00110','01100','01100','01100'],
 '8':['01110','11011','11011','01110','11011','11011','01110'],
 '9':['01110','11011','11011','01111','00011','00011','11110'],
 '-':['00000','00000','00000','11111','00000','00000','00000'],
 '+':['00000','00100','00100','11111','00100','00100','00000']
};
function drawPixelText(ctx,l){
 const text=String(l.text||'');if(!text||![...text].every(c=>PIXEL_FONT[c]))return false;
 const height=clamp(int(l.fontSize,70),8,600),totalUnits=text.length*6-1;
 const cell=Math.min(height/7,Math.max(1,int(l.w,100))/(totalUnits));
 const tw=totalUnits*cell,th=7*cell,left=int(l.x)+(l.align==='left'?0:l.align==='right'?int(l.w)-tw:(int(l.w)-tw)/2),top=int(l.y)+(int(l.h)-th)/2;
 const stroke=clamp(int(l.strokeWidth,0),0,30),px=Math.max(1,Math.round(cell));
 const cells=[];[...text].forEach((ch,i)=>PIXEL_FONT[ch].forEach((row,j)=>[...row].forEach((v,k)=>{if(v==='1')cells.push([left+(i*6+k)*cell,top+j*cell])})));
 if(stroke){ctx.fillStyle=l.stroke||'#202632';for(const [x,y] of cells)ctx.fillRect(x-stroke/2,y-stroke/2,cell+stroke,cell+stroke)}
 ctx.fillStyle=l.color||'#fff';for(const [x,y] of cells)ctx.fillRect(x,y,cell+.1,cell+.1);
 return true;
}
function drawArt(ctx,l,img){
 const [sx,sy,w,h]=cropBox(l,img);if(!w||!h)return;
 const fit=l.fit||'cover',sc=clamp(int(l.scale,1),.05,10),targetW=int(l.w,W),targetH=int(l.h,H);
 ctx.save();ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip();
 if(fit==='stretch'){ctx.drawImage(img,sx,sy,w,h,(W-targetW*sc)/2+int(l.x), (H-targetH*sc)/2+int(l.y),targetW*sc,targetH*sc)}
 else{const base=(fit==='contain'?Math.min:Math.max)(targetW/w,targetH/h)*sc;
 const dw=w*base,dh=h*base;ctx.drawImage(img,sx,sy,w,h,(W-dw)/2+int(l.x),(H-dh)/2+int(l.y),dw,dh)}
 ctx.restore();
}
function drawSpriteText(ctx,l){
 const chars=[...String(l.text||'')];if(!chars.length||!chars.every(c=>/^[0-9]$/.test(c)))return false;
 const images=chars.map(c=>getDigitImage(c));if(images.some(im=>!im||!((im.naturalWidth||im.width)>0)))return false;
 const h=Math.min(clamp(int(l.fontSize,90),8,600),Math.max(1,int(l.h,100)));
 const spacing=clamp(int(l.digitSpacing,0),-40,100);
 const widths=images.map(im=>h*(im.naturalWidth||im.width)/(im.naturalHeight||im.height));
 const raw=widths.reduce((a,b)=>a+b,0)+spacing*(chars.length-1);
 const factor=Math.min(1,Math.max(1,int(l.w,100))/Math.max(1,raw));
 const total=raw*factor,drawHeight=h*factor,step=spacing*factor;
 let x=int(l.x)+(l.align==='left'?0:l.align==='right'?int(l.w)-total:(int(l.w)-total)/2);
 const y=int(l.y)+(int(l.h)-drawHeight)/2;
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 images.forEach((im,i)=>{const w=widths[i]*factor;ctx.drawImage(im,x,y,w,drawHeight);x+=w+step});
 return true;
}
function drawReferenceCostText(ctx,l){
 if(String(l.text)!=='3')return drawSpriteText(ctx,l);
 const img=ensureImage(asset('cost-reference-3'));if(!img||!img.naturalWidth)return false;
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 ctx.drawImage(img,int(l.x),int(l.y),Math.max(1,int(l.w,117)),Math.max(1,int(l.h,155)));return true;
}
function renderTo(ctx,scale=1,selection=false){
 ctx.save();ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,W,H);
 for(const l of project.layers){
  if(!l.visible)continue;
  ctx.save();ctx.globalAlpha=clamp(int(l.opacity,1),0,1);
  if(l.type==='color'){ctx.fillStyle=l.color||'#000';ctx.fillRect(int(l.x),int(l.y),int(l.w,W),int(l.h,H))}
  if(l.type==='image'){
   let img=ensureImage(l.src);if(img&&img.naturalWidth){
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    if(l.role==='art')drawArt(ctx,l,img);
    else{const [sx,sy,sw,sh]=cropBox(l,img);ctx.drawImage(img,sx,sy,sw,sh,int(l.x),int(l.y),Math.max(1,int(l.w,W)),Math.max(1,int(l.h,H)))}
   }
  }
  if(l.type==='text' && !(l.fontStyle==='sprite' && drawSpriteText(ctx,l)) && !(l.fontStyle==='reference' && drawReferenceCostText(ctx,l)) && !(l.fontStyle==='pixel' && drawPixelText(ctx,l))){
   ctx.font=`${fontWeight(l)} ${clamp(int(l.fontSize,64),8,600)}px ${fontFamilyForStyle(l.fontStyle)}`;
   ctx.textAlign=['center','left','right'].includes(l.align)?l.align:'center';ctx.textBaseline='middle';
   ctx.lineJoin='round';ctx.miterLimit=2;
   const x=int(l.x)+(l.align==='left'?0:l.align==='right'?int(l.w):int(l.w)/2),y=int(l.y)+int(l.h)/2;
   if(int(l.strokeWidth)>0){ctx.lineWidth=clamp(int(l.strokeWidth),0,30);ctx.strokeStyle=l.stroke||'#212936';ctx.strokeText(l.text||'',x,y,Math.max(1,int(l.w,W)))}
   ctx.fillStyle=l.color||'#fff';ctx.fillText(l.text||'',x,y,Math.max(1,int(l.w,W)));
  }
  ctx.restore();
 }
 if(selection){const l=current();if(l&&l.visible&&!l.locked){
  let x=int(l.x),y=int(l.y),w=int(l.w,W),h=int(l.h,H);
  if(l.role==='art'){x=0;y=0;w=W;h=H}
  ctx.strokeStyle='#9bccff';ctx.lineWidth=2;ctx.setLineDash([10,7]);ctx.strokeRect(x+1,y+1,w-2,h-2);ctx.setLineDash([]);
 }}ctx.restore();
}
function render(){if(!project)return;renderTo(screen,1,false);renderDigitPreview()}
function renderDigitPreview(){
 const preview=$('digitPreview');if(!preview)return;
 const ctx=preview.getContext('2d');ctx.clearRect(0,0,preview.width,preview.height);
 for(let i=0;i<10;i++){
  const digit=getDigitImage(String(i));if(!digit)continue;
  const w=digit.naturalWidth||digit.width,h=digit.naturalHeight||digit.height;
  if(!w||!h)continue;
  const col=i%5,row=Math.floor(i/5),slotW=preview.width/5,slotH=preview.height/2;
  const scale=Math.min((slotW-26)/w,(slotH-26)/h);
  const dw=w*scale,dh=h*scale;
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(digit,col*slotW+(slotW-dw)/2,row*slotH+(slotH-dh)/2,dw,dh);
 }
}
function beginContinuousEdit(id){if(continuousEdits.has(id))return;continuousEdits.add(id);remember()}
function finishContinuousEdit(id){continuousEdits.delete(id)}
function remember(){if(isRestoring||!project)return;const snap=JSON.stringify(project);if(undoStack.at(-1)!==snap){undoStack.push(snap);if(undoStack.length>15)undoStack.shift()}redoStack=[];updateHistoryBtns()}
function updateHistoryBtns(){$('undoBtn').disabled=!undoStack.length;$('redoBtn').disabled=!redoStack.length}
function change(fn,refreshUI=false){remember();fn();changed(refreshUI)}
function changed(refreshUI=false){render();if(refreshUI){fillFields();drawLayerList();fillInspector()}saveSoon()}
function undo(){continuousEdits.clear();if(!undoStack.length)return;redoStack.push(JSON.stringify(project));project=JSON.parse(undoStack.pop());selectedId=project.layers.some(l=>l.id===selectedId)?selectedId:project.layers.find(l=>l.role==='art')?.id;changed(true);void syncCustomFonts(project).catch(err=>showToast(err.message));updateHistoryBtns()}
function redo(){continuousEdits.clear();if(!redoStack.length)return;undoStack.push(JSON.stringify(project));project=JSON.parse(redoStack.pop());selectedId=project.layers.some(l=>l.id===selectedId)?selectedId:project.layers.find(l=>l.role==='art')?.id;changed(true);void syncCustomFonts(project).catch(err=>showToast(err.message));updateHistoryBtns()}
function updateDigitThemeUI(){
 const status=$('digitThemeStatus');
 if(!status)return;
 if(digitThemeEnabled())status.textContent=`現在の数字テーマ: ${project.digitTheme.name||'カスタム'}（2行×5列）`;
 else status.textContent='現在の数字テーマ: 標準（付属の0〜9画像）';
}
function fillFields(){
 const roles=Object.fromEntries(project.layers.filter(l=>l.role).map(l=>[l.role,l]));
 for(const [id,key] of [['nameInput','name'],['costInput','cost'],['atkInput','attack'],['hpInput','health']])$(id).value=roles[key]?.text||'';
 const art=roles.art;
 if(art){for(const side of ['Left','Top','Right','Bottom'])$('crop'+side).value=int(art.crop?.[side.toLowerCase()],0);$('artScale').value=Math.round(clamp(int(art.scale,1)*100,20,350));$('artScaleOut').textContent=`${$('artScale').value}%`;
 $('artX').value=Math.round(int(art.x));$('artY').value=Math.round(int(art.y));for(const b of document.querySelectorAll('[data-fit]'))b.classList.toggle('active',b.dataset.fit===art.fit)}
 updateDigitThemeUI();
}
function iconFor(l){if(l.type==='text')return 'T';if(l.type==='color')return '▦';return '▧'}
function drawLayerList(){
 let host=$('layerList');host.replaceChildren();$('layerCount').textContent=`${project.layers.length} レイヤー`;
 [...project.layers].reverse().forEach(l=>{
  const row=document.createElement('div');row.className='layer-item'+(selectedId===l.id?' selected':'');row.dataset.id=l.id;
  const thumb=document.createElement('span');thumb.className='layer-thumb';
  if(l.type==='image'){let img=document.createElement('img');img.src=l.src;img.alt='';thumb.append(img)}else if(l.type==='color'){thumb.style.background=l.color;thumb.textContent=''}else thumb.textContent='T';
  const title=document.createElement('span');title.className='layer-title';const strong=document.createElement('strong');strong.textContent=l.name;const small=document.createElement('small');small.textContent=l.type==='text'?'文字':l.type==='color'?'背景色':'PNG / 画像';title.append(strong,small);
  const vis=document.createElement('button');vis.type='button';vis.className='layer-toggle'+(!l.visible?' off':'');vis.title=l.visible?'非表示にする':'表示する';vis.textContent=l.visible?'◉':'○';vis.addEventListener('click',ev=>{ev.stopPropagation();change(()=>{l.visible=!l.visible},true)});
  const lock=document.createElement('button');lock.type='button';lock.className='layer-toggle'+(!l.locked?' off':'');lock.title=l.locked?'ロックを解除':'ロックする';lock.textContent=l.locked?'▣':'▢';lock.addEventListener('click',ev=>{ev.stopPropagation();change(()=>{l.locked=!l.locked},true)});
  row.append(thumb,title,vis,lock);row.addEventListener('click',()=>{selectedId=l.id;drawLayerList();fillInspector();$('selectedHint').textContent=`選択中: ${l.name}（${l.locked?'ロック解除で移動可能':'カード上でドラッグして移動可能'}）`});host.append(row);
 });
}
function fillInspector(){
 const l=current();$('inspectorEmpty').hidden=!!l;$('inspectorBody').hidden=!l;$('layerKind').textContent=!l?'未選択':l.type==='text'?'文字':l.type==='color'?'背景':'画像';if(!l)return;
 for(const [id,key] of [['layerName','name'],['layerX','x'],['layerY','y'],['layerW','w'],['layerH','h']])$(id).value=l[key]??'';
 $('layerOpacity').value=Math.round(clamp(int(l.opacity,1),0,1)*100);$('layerOpacityOut').textContent=$('layerOpacity').value+'%';
 $('textControls').hidden=l.type!=='text';$('imageControls').hidden=l.type!=='image';$('digitSpacingControl').hidden=l.type!=='text'||!['sprite','reference'].includes(l.fontStyle);if(l.type==='text')updateFontOptions();updateFontStatus();
 if(l.type==='text'){$('fontWeight').value=fontWeight(l);$('fontWeightOut').textContent=fontWeight(l);}
 if(l.type==='text')for(const [id,key] of [['layerText','text'],['fontSize','fontSize'],['fontColor','color'],['textAlign','align'],['strokeWidth','strokeWidth'],['strokeColor','stroke'],['fontStyle','fontStyle'],['digitSpacing','digitSpacing']])$(id).value=l[key]??'';
}
function setProperty(k,val){const l=current();if(!l)return;change(()=>{l[k]=val;if(k==='text'&&l.role==='name')project.title=val},false);if(k==='text'&&['name','cost','attack','health'].includes(l.role))fillFields();if(k==='opacity')$('layerOpacityOut').textContent=Math.round(val*100)+'%';if(['x','y','w','h'].includes(k))render()}
function selection(id){selectedId=id;drawLayerList();fillInspector()}
function setArt(file){readImageFile(file).then(({url})=>{
  let art=project.layers.find(l=>l.role==='art');if(!art){art={id:makeId(),role:'art',name:'メインイラスト',type:'image',src:url,fit:'cover',scale:1,x:0,y:0,w:W,h:H,opacity:1,visible:true,locked:false};change(()=>project.layers.splice(1,0,art),true)}
  else change(()=>{art.src=url;art.scale=1;art.x=0;art.y=0;art.fit='cover';art.name=file.name;art.visible=true;art.crop={left:0,top:0,right:0,bottom:0}},true);
  selection(art.id);showToast('イラストを差し替えました');
 }).catch(err=>showToast(err.message))}
function readImageFile(file){
 return new Promise((resolve,reject)=>{
  if(!file||!/^image\/(png|jpeg|webp|gif)$/.test(file.type))return reject(new Error('PNG / JPG / WEBP / GIF を指定してください'));
  if(file.size>22*1024*1024)return reject(new Error('画像サイズは22MB以下にしてください'));
  let fr=new FileReader();fr.onerror=()=>reject(new Error('画像を読み込めませんでした'));
  fr.onload=()=>{const im=new Image();im.onerror=()=>reject(new Error('画像が破損しています'));im.onload=()=>{if(im.naturalWidth*im.naturalHeight>40_000_000)return reject(new Error('画像の縦横が大きすぎます（4000万画素以下）'));resolve({url:fr.result,w:im.naturalWidth,h:im.naturalHeight})};im.src=fr.result};fr.readAsDataURL(file)
 })
}
function addImage(file,replace=false){readImageFile(file).then(({url,w,h})=>{
  if(replace){let l=current();if(!l||l.type!=='image')return;change(()=>{l.src=url;if(!['art','frame'].includes(l.role))l.name=file.name},true);showToast('レイヤーの画像を更新しました');return}
  let big=(w===W&&h===H),ratio=Math.min(1,Math.min(540/w,670/h));const nw=big?W:Math.max(1,Math.round(w*ratio)),nh=big?H:Math.max(1,Math.round(h*ratio));
  const l={id:makeId(),name:file.name,type:'image',src:url,x:big?0:Math.round((W-nw)/2),y:big?0:Math.round((H-nh)/2),w:nw,h:nh,visible:true,locked:false,opacity:1};
  change(()=>project.layers.push(l),true);selection(l.id);hideModal();showToast('新しい画像レイヤーを追加しました')
 }).catch(err=>showToast(err.message))}
function applySpriteStyleToStatLayers(){
 for(const role of ['cost','attack','health']){const layer=project.layers.find(l=>l.role===role);if(layer)layer.fontStyle='sprite'}
}
function setDigitTheme(file){readImageFile(file).then(({url})=>{
  const name=String(file.name||'digit-theme').replace(/\.[^.]+$/,'').slice(0,60)||'digit-theme';
  change(()=>{project.digitTheme={name,sheetSrc:url,cols:5,rows:2};applySpriteStyleToStatLayers()},true);
  showToast('数字画像テーマを読み込みました');
 }).catch(err=>showToast(err.message))}
function clearDigitTheme(){change(()=>{project.digitTheme=null},true);showToast('数字画像テーマを標準に戻しました')}
function addText(){const l={id:makeId(),name:'追加した文字',type:'text',text:'テキスト',x:178,y:680,w:730,h:100,fontSize:70,fontWeight:800,color:'#ffffff',stroke:'#26313b',strokeWidth:4,align:'center',visible:true,locked:false,opacity:1};change(()=>project.layers.push(l),true);selection(l.id);hideModal()}
function addColor(){const l={id:makeId(),name:'追加背景',type:'color',color:'#233b58',x:0,y:0,w:W,h:H,visible:true,locked:false,opacity:1};change(()=>project.layers.unshift(l),true);selection(l.id);hideModal()}
function hideModal(){$('addModal').hidden=true}
function imagePosition(ev){const r=canvas.getBoundingClientRect();return{x:(ev.clientX-r.left)*W/r.width,y:(ev.clientY-r.top)*H/r.height}}
function attachDragging(){
 let wrap=$('artDropZone');wrap.addEventListener('pointerdown',ev=>{
  if(ev.button!==0)return;let l=current();if(!l||!l.visible||l.locked)return;
  ev.preventDefault();wrap.setPointerCapture(ev.pointerId);let pos=imagePosition(ev);drag={id:l.id,pointer:ev.pointerId,x:pos.x,y:pos.y,oldX:int(l.x),oldY:int(l.y),started:false};wrap.classList.add('dragging')
 });
 wrap.addEventListener('pointermove',ev=>{if(!drag||ev.pointerId!==drag.pointer)return;const l=current();if(!l||l.id!==drag.id)return;
  let pos=imagePosition(ev),dx=pos.x-drag.x,dy=pos.y-drag.y;
  if(!drag.started&&Math.hypot(dx,dy)>2){remember();drag.started=true}
  if(drag.started){l.x=Math.round(drag.oldX+dx);l.y=Math.round(drag.oldY+dy);render();$('layerX').value=l.x;$('layerY').value=l.y;if(l.role==='art'){$('artX').value=l.x;$('artY').value=l.y}}
 });
 const finish=()=>{if(drag?.started)saveSoon();drag=null;wrap.classList.remove('dragging')};wrap.addEventListener('pointerup',finish);wrap.addEventListener('pointercancel',finish);
 const zone=$('canvasViewport');zone.addEventListener('dragover',ev=>{if(ev.dataTransfer?.types?.includes('Files')){ev.preventDefault();wrap.classList.add('dragover')}});zone.addEventListener('dragleave',()=>wrap.classList.remove('dragover'));zone.addEventListener('drop',ev=>{ev.preventDefault();wrap.classList.remove('dragover');const f=[...ev.dataTransfer.files].find(f=>f.type.startsWith('image/'));if(f)setArt(f)})
}
function wireInputs(){
 $('addFontsBtn').addEventListener('click',()=>$('addFontsInput').click());
 $('addFontsInput').addEventListener('change',ev=>{if(ev.target.files?.length)void addUserFontFiles([...ev.target.files]);ev.target.value=''});
 $('removeFontBtn').addEventListener('click',removeUserFont);
 $('fontWeight').addEventListener('input',ev=>{const l=current();if(!l||l.type!=='text')return;beginContinuousEdit('fontWeight');l.fontWeight=fontWeight({fontWeight:ev.target.value});$('fontWeightOut').textContent=l.fontWeight;render();saveSoon()});
 $('fontWeight').addEventListener('change',()=>finishContinuousEdit('fontWeight'));$('fontWeight').addEventListener('blur',()=>finishContinuousEdit('fontWeight'));
 $('importFontBtn').addEventListener('click',()=>$('fontFileInput').click());
 $('fontFileInput').addEventListener('change',ev=>{if(ev.target.files[0])importFontFile(ev.target.files[0]);ev.target.value=''});
 $('artInput').addEventListener('change',ev=>{if(ev.target.files[0])setArt(ev.target.files[0]);ev.target.value=''});$('digitThemeInput').addEventListener('change',ev=>{if(ev.target.files[0])setDigitTheme(ev.target.files[0]);ev.target.value=''});$('clearDigitThemeBtn').addEventListener('click',clearDigitTheme);$('applyDigitThemeBtn').addEventListener('click',()=>{change(()=>applySpriteStyleToStatLayers(),true);showToast('数値レイヤーへ画像数字スタイルを適用しました')});
 for(const [id,role] of [['nameInput','name'],['costInput','cost'],['atkInput','attack'],['hpInput','health']])$(id).addEventListener('input',ev=>{
  let l=project.layers.find(l=>l.role===role);if(!l)return;change(()=>{l.text=ev.target.value;if(role==='name')project.title=ev.target.value});if(current()?.id===l.id)fillInspector();
 });
 for(const b of document.querySelectorAll('[data-fit]'))b.addEventListener('click',()=>{const l=project.layers.find(l=>l.role==='art');if(!l)return;change(()=>{l.fit=b.dataset.fit},true)});
 $('resetCropBtn').addEventListener('click',()=>{const l=project.layers.find(l=>l.role==='art');if(l)change(()=>l.crop={left:0,top:0,right:0,bottom:0},true)});
 for(const side of ['Left','Top','Right','Bottom'])$('crop'+side).addEventListener('change',ev=>{const l=project.layers.find(l=>l.role==='art');if(!l)return;const k=side.toLowerCase();change(()=>{l.crop={...l.crop,[k]:clamp(int(ev.target.value),0,90)}},true)});
 $('resetArtBtn').addEventListener('click',()=>{let l=project.layers.find(l=>l.role==='art');if(l)change(()=>{l.scale=1;l.x=0;l.y=0;l.fit='cover'},true)});
 $('artScale').addEventListener('change',()=>finishContinuousEdit('artScale'));$('artScale').addEventListener('blur',()=>finishContinuousEdit('artScale'));
 $('artScale').addEventListener('input',ev=>{let l=project.layers.find(l=>l.role==='art');if(!l)return;beginContinuousEdit('artScale');l.scale=+ev.target.value/100;$('artScaleOut').textContent=ev.target.value+'%';render();saveSoon()});
 for(const [id,key] of [['artX','x'],['artY','y']])$(id).addEventListener('change',ev=>{let l=project.layers.find(l=>l.role==='art');if(l)change(()=>{l[key]=int(ev.target.value)},true)});
 for(const [id,key] of [['layerName','name'],['layerX','x'],['layerY','y'],['layerW','w'],['layerH','h'],['layerText','text'],['fontSize','fontSize'],['fontColor','color'],['textAlign','align'],['strokeWidth','strokeWidth'],['strokeColor','stroke'],['fontStyle','fontStyle'],['digitSpacing','digitSpacing']])$(id).addEventListener('change',ev=>{
  let l=current();if(!l)return;let value=['x','y','w','h','fontSize','strokeWidth','digitSpacing'].includes(key)?int(ev.target.value):ev.target.value;
  if((key==='w'||key==='h')&&l.type==='image'&&$('preserveRatio').checked){let ratio=l.w/l.h;change(()=>{l[key]=Math.max(1,value);l[key==='w'?'h':'w']=Math.max(1,Math.round(key==='w'?value/ratio:value*ratio))},true)}else{setProperty(key,value);drawLayerList();if(key==='fontStyle')fillInspector()}
 });
 $('layerOpacity').addEventListener('change',()=>finishContinuousEdit('layerOpacity'));$('layerOpacity').addEventListener('blur',()=>finishContinuousEdit('layerOpacity'));
 $('layerOpacity').addEventListener('input',ev=>{let l=current();if(!l)return;beginContinuousEdit('layerOpacity');l.opacity=+ev.target.value/100;$('layerOpacityOut').textContent=ev.target.value+'%';render();saveSoon()});
 $('replaceImageBtn').addEventListener('click',()=>$('replaceInput').click());$('replaceInput').addEventListener('change',ev=>{let f=ev.target.files[0];if(f)addImage(f,true);ev.target.value=''});
 $('addLayerBtn').addEventListener('click',()=>$('addModal').hidden=false);$('modalClose').addEventListener('click',hideModal);$('addModal').addEventListener('click',ev=>{if(ev.target===$('addModal'))hideModal()});
 $('addImageBtn').addEventListener('click',()=>$('addImageInput').click());$('addImageInput').addEventListener('change',ev=>{if(ev.target.files[0])addImage(ev.target.files[0]);ev.target.value=''});$('addTextBtn').addEventListener('click',addText);$('addColorBtn').addEventListener('click',addColor);
 $('moveUpBtn').addEventListener('click',()=>moveLayer(1));$('moveDownBtn').addEventListener('click',()=>moveLayer(-1));
 $('duplicateBtn').addEventListener('click',()=>{const l=current();if(!l)return;const copy=clone(l);copy.id=makeId();copy.name+=' コピー';copy.x+=12;copy.y+=12;change(()=>project.layers.splice(project.layers.indexOf(l)+1,0,copy),true);selection(copy.id)});
 $('deleteBtn').addEventListener('click',()=>{const l=current();if(!l)return;change(()=>project.layers.splice(project.layers.indexOf(l),1),true);selection(project.layers.find(i=>i.role==='art')?.id||project.layers.at(-1)?.id||null)});
 $('exportBtn').addEventListener('click',exportPng);$('saveJsonBtn').addEventListener('click',exportProject);$('loadJsonBtn').addEventListener('click',()=>$('projectInput').click());$('projectInput').addEventListener('change',ev=>{if(ev.target.files[0])importProject(ev.target.files[0]);ev.target.value=''});
 $('undoBtn').addEventListener('click',undo);$('redoBtn').addEventListener('click',redo);
 $('newBtn').addEventListener('click',()=>{if(confirm('新しいカードを作成しますか？ 編集途中でも保存済みのプロジェクトファイルは残ります。'))resetTo(false)});
 $('resetBtn').addEventListener('click',()=>{if(confirm('初期のサンドスライムの見本に戻しますか？'))resetTo(true)});
 $('blankBtn').addEventListener('click',()=>{if(!confirm('白紙テンプレートに切り替えますか？'))return;change(()=>{const art=project.layers.find(l=>l.role==='art');project.layers=[{id:makeId(),name:'白紙背景',role:'background',type:'color',color:'#1d2634',x:0,y:0,w:W,h:H,visible:true,locked:true,opacity:1}];if(art){let copy=clone(art);copy.visible=false;project.layers.push(copy)}},true);selection(project.layers.at(-1)?.id)});
 $('saveTemplateBtn').addEventListener('click',saveTemplate);$('templateSelect').addEventListener('change',ev=>applyTemplate(ev.target.value));
 $('referenceToggle').addEventListener('change',ev=>{let p=$('referencePanel');p.hidden=!ev.target.checked;sizeCard()});
 $('zoomIn').addEventListener('click',()=>{previewScale=clamp((previewScale||canvas.getBoundingClientRect().width/W)*1.13,.12,1);sizeCard()});
 $('zoomOut').addEventListener('click',()=>{previewScale=clamp((previewScale||canvas.getBoundingClientRect().width/W)/1.13,.12,1);sizeCard()});$('zoomAuto').addEventListener('click',()=>{previewScale=null;sizeCard()});
 document.addEventListener('keydown',ev=>{
  if(ev.target.closest('input,textarea,select'))return;
  if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='z'){ev.preventDefault();ev.shiftKey?redo():undo();return}
  if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='y'){ev.preventDefault();redo();return}
  if(ev.key==='Escape'){hideModal();return}
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(ev.key)){const l=current();if(!l||l.locked)return;ev.preventDefault();const step=ev.shiftKey?10:1;let key=ev.key==='ArrowUp'||ev.key==='ArrowDown'?'y':'x';let delta=(ev.key==='ArrowUp'||ev.key==='ArrowLeft'?-1:1)*step;change(()=>l[key]+=delta,true)}
 });
 window.addEventListener('resize',sizeCard);
}
function moveLayer(dir){const l=current();if(!l)return;let i=project.layers.indexOf(l),j=i+dir;if(j<0||j>=project.layers.length)return;change(()=>{[project.layers[i],project.layers[j]]=[project.layers[j],project.layers[i]]},true)}
function sizeCard(){const viewport=$('canvasViewport');const width=viewport.clientWidth-($('referencePanel').hidden?36:Math.min(310,viewport.clientWidth*.38)+20)-36;const height=Math.max(260,viewport.clientHeight-46);const auto=Math.min(1,Math.max(.12,Math.min(width/W,height/H)));const s=previewScale||auto;const wrap=$('artDropZone');wrap.style.width=Math.round(W*s)+'px';$('previewZoom').textContent=previewScale?Math.round(s*100)+'%':'自動';}
function fileName(){return (project.title||'pixel-card').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,60)||'pixel-card'}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
async function exportPng(){
 $('exportBtn').disabled=true;$('saveStatus').textContent='画像を生成しています...';
 try{await ensureSelectedFonts();await waitForImages();const out=document.createElement('canvas');const multiplier=+$('exportScale').value===2?2:1;out.width=W*multiplier;out.height=H*multiplier;renderTo(out.getContext('2d'),multiplier,false);
  const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNGの作成に失敗しました');download(blob,fileName()+'.png');showToast(`${out.width} × ${out.height} px のPNGを保存しました`)
 }catch(err){showToast('画像を書き出せませんでした: '+err.message)}finally{$('exportBtn').disabled=false;$('saveStatus').textContent=db?'この端末に自動保存':'JSON保存をご利用ください'}
}
function exportProject(){const blob=new Blob([JSON.stringify({format:'pixel-card-studio',version:VERSION,project},null,2)],{type:'application/json'});download(blob,fileName()+'.cardproj.json');showToast('編集データをJSONで保存しました')}
function sanitizeProject(p){if(!p||p.width!==W||p.height!==H||!Array.isArray(p.layers)||p.layers.length>150)throw new Error('対応していないプロジェクト形式です');
 if(p.version!==undefined&&p.version!==VERSION)throw new Error('この編集データは異なるバージョン用です（対応: v1）');
 const allowed=['image','color','text'];const fields=['id','role','name','type','src','x','y','w','h','visible','locked','opacity','fit','scale','color','text','fontSize','fontWeight','fontStyle','digitSpacing','crop','stroke','strokeWidth','align'];
 let ls=p.layers.map(raw=>{if(!allowed.includes(raw.type))throw new Error('対応していないレイヤー形式です');const l={};for(const key of fields)if(raw[key]!==undefined)l[key]=raw[key];
  if(l.type==='image'&&!(typeof l.src==='string'&&(l.src.startsWith('assets/')||/^data:image\/(png|jpeg|webp|gif);base64,/.test(l.src))))throw new Error('画像の保存形式が正しくありません');
  l.id=typeof l.id==='string'?l.id:makeId();l.name=String(l.name||'レイヤー').slice(0,80);if(l.type==='text'){l.text=String(l.text??'').slice(0,200);l.fontWeight=fontWeight(l)}l.x=clamp(int(l.x),-10000,10000);l.y=clamp(int(l.y),-10000,10000);l.w=clamp(int(l.w,100),1,10000);l.h=clamp(int(l.h,100),1,10000);l.opacity=clamp(int(l.opacity,1),0,1);return l});
 let digitTheme=null;
 if(p.digitTheme!==undefined&&p.digitTheme!==null){
  if(!(typeof p.digitTheme.sheetSrc==='string'&&/^data:image\/(png|jpeg|webp|gif);base64,/.test(p.digitTheme.sheetSrc)))throw new Error('数字テーマ画像の保存形式が正しくありません');
  digitTheme={name:String(p.digitTheme.name||'カスタム数字').slice(0,60),sheetSrc:p.digitTheme.sheetSrc,cols:5,rows:2};
 }
 let fontAssets={};
 if(p.fontAssets!==undefined){
  if(!p.fontAssets||typeof p.fontAssets!=='object'||Array.isArray(p.fontAssets))throw new Error('フォント保存形式が正しくありません');
  const userKeys=Object.keys(p.fontAssets).filter(k=>USER_FONT_KEY.test(k));
  if(userKeys.length>MAX_USER_FONTS)throw new Error('登録フォントが多すぎます');
  for(const key of [...Object.keys(FONT_CONFIG),...userKeys])if(p.fontAssets[key]!==undefined){
   const entry=p.fontAssets[key];
   if(!entry||typeof entry.data!=='string'||entry.data.length>12_000_000||!safeFontData.test(entry.data))throw new Error('フォント保存形式が正しくありません');
   fontAssets[key]={name:String(entry.name||'font').slice(0,120),data:entry.data,nativeWeight:clamp(int(entry.nativeWeight,700),100,900),variable:entry.variable===true};
  }
 }
 if(Object.values(fontAssets).reduce((n,item)=>n+item.data.length,0)>MAX_FONT_DATA)throw new Error('保存されたフォントの合計サイズが大きすぎます');
 for(const l of ls)if(l.type==='text'&&USER_FONT_KEY.test(l.fontStyle)&&!fontAssets[l.fontStyle])throw new Error('文字レイヤーが参照するフォントが見つかりません');
 if(new Set(ls.map(l=>l.id)).size!==ls.length)throw new Error('レイヤーIDが重複しています');return{version:VERSION,width:W,height:H,title:String(p.title||'CARD').slice(0,60),digitTheme,fontAssets,layers:ls};
}
async function importProject(file){try{if(file.size>75*1024*1024)throw new Error('ファイルが大きすぎます');const obj=JSON.parse(await file.text());if(obj&&obj.project&&obj.version!==undefined&&obj.version!==VERSION)throw new Error('この編集データは異なるバージョン用です（対応: v1）');if(obj&&obj.format&&obj.format!=='pixel-card-studio')throw new Error('他のアプリの保存データです');const p=sanitizeProject(obj.project||obj);await syncCustomFonts(p);remember();project=p;selection(project.layers.find(l=>l.role==='art')?.id||project.layers.at(-1)?.id);changed(true);showToast('編集データを読み込みました')}catch(err){void syncCustomFonts(project).catch(()=>{});showToast('読み込みに失敗: '+err.message)}}
function resetTo(reference){remember();project=defaults();void syncCustomFonts(project).catch(err=>showToast(err.message));if(!reference){const art=project.layers.find(l=>l.role==='art');art.src='';art.name='イラストを追加してください';art.visible=false;project.title='新しいカード';project.layers.find(l=>l.role==='name').text='カード名'}selectedId='art';changed(true)}
async function openDB(){return new Promise(resolve=>{try{if(!window.indexedDB)return resolve(null);const req=indexedDB.open('pixel-card-studio',2);req.onupgradeneeded=()=>{let d=req.result;if(!d.objectStoreNames.contains('data'))d.createObjectStore('data')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null);req.onblocked=()=>resolve(null)}catch(err){console.warn('自動保存は使用できません:',err);resolve(null)}})}
function readDB(key){return new Promise(resolve=>{if(!db)return resolve(null);try{let t=db.transaction('data','readonly'),r=t.objectStore('data').get(key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>resolve(null)}catch{resolve(null)}})}
function writeDB(key,val){return new Promise(resolve=>{if(!db)return resolve(false);try{let t=db.transaction('data','readwrite');t.objectStore('data').put(val,key);t.oncomplete=()=>resolve(true);t.onerror=()=>resolve(false)}catch{resolve(false)}})}
function saveSoon(){if(!project||isRestoring)return;$('saveStatus').textContent='保存中...';clearTimeout(autosaveTimer);autosaveTimer=setTimeout(async()=>{$('saveStatus').textContent=await writeDB('active',project)?'この端末に自動保存':'JSON保存をご利用ください'},650)}
function updateTemplateOptions(){const sel=$('templateSelect'),v=sel.value;sel.replaceChildren();let first=new Option('サンドスライム / グレー枠','default');sel.append(first);for(const name of Object.keys(userTemplates))sel.append(new Option(name,`saved:${name}`));sel.value=[...sel.options].some(i=>i.value===v)?v:'default'}
async function saveTemplate(){let name=prompt('登録するテンプレート名を入力してください','新しいテンプレート');if(!name)return;name=name.trim().slice(0,40);if(!name)return;userTemplates[name]=clone(project);await writeDB('templates',userTemplates);updateTemplateOptions();$('templateSelect').value=`saved:${name}`;showToast('テンプレートを登録しました')}
function applyTemplate(v){const original=clone(project),tmpl=v==='default'?defaults():clone(userTemplates[v.slice(6)]);if(!tmpl)return;
 change(()=>{project=tmpl;for(const role of ['art','name','cost','attack','health']){let prev=original.layers.find(l=>l.role===role),next=project.layers.find(l=>l.role===role);if(!prev||!next)continue;if(role==='art'){for(const key of ['src','name','fit','scale','x','y','w','h','crop','opacity','visible','locked'])if(prev[key]!==undefined)next[key]=clone(prev[key])}else{next.text=prev.text;if(role==='name'){if(isFontStyle(prev.fontStyle))next.fontStyle=prev.fontStyle;next.fontWeight=fontWeight(prev)}}}project.title=original.title;if(original.fontAssets)project.fontAssets=clone(original.fontAssets);void syncCustomFonts(project).catch(err=>showToast(err.message));if(original.digitTheme){project.digitTheme=clone(original.digitTheme);for(const role of ['cost','attack','health']){const l=project.layers.find(l=>l.role===role);if(l)l.fontStyle='sprite'}}},true);
 selectedId=project.layers.find(l=>l.role==='art')?.id||project.layers.at(-1)?.id;selection(selectedId);fillFields();showToast('テンプレートを切り替えました')
}
// Used by the same-origin card manager iframe. The admin key never enters the studio.
window.PixelCardStudioBridgeExport=async function(){
 await ensureSelectedFonts();await waitForImages();
 const out=document.createElement('canvas');out.width=W;out.height=H;
 renderTo(out.getContext('2d'),1,false);
 const rendered=await new Promise(resolve=>out.toBlob(resolve,'image/png'));
 if(!rendered)throw new Error('完成PNGの作成に失敗しました');
 if(rendered.size>16*1024*1024)throw new Error('完成PNGが16MBを超えています');
 const art=project.layers.find(layer=>layer.role==='art');
 let source=rendered;
 if(art&&art.visible&&art.src){
  try{const response=await fetch(art.src);if(response.ok){const blob=await response.blob();if(blob.type.startsWith('image/')&&blob.size<=8*1024*1024)source=blob;}}catch(err){console.warn('元画像が読み込めません:',err)}
 }
 return {rendered,source,width:W,height:H,title:project.title,
  name:project.layers.find(l=>l.role==='name')?.text||'',
  cost:project.layers.find(l=>l.role==='cost')?.text||'',
  attack:project.layers.find(l=>l.role==='attack')?.text||'',
  defense:project.layers.find(l=>l.role==='health')?.text||''};
};
async function init(){project=defaults();db=await openDB();let restored=await readDB('active');isRestoring=true;if(restored){try{project=sanitizeProject(restored)}catch(err){console.warn('以前のデータの読み込みに失敗:',err)}}userTemplates=await readDB('templates')||{};selectedId=project.layers.find(l=>l.role==='art')?.id||'art';isRestoring=false;try{await syncCustomFonts(project)}catch(err){console.warn('フォントの復元に失敗:',err);showToast('フォントの復元失敗: 再度フォントを読み込んでください')}wireInputs();attachDragging();preload();fillFields();drawLayerList();fillInspector();updateHistoryBtns();updateTemplateOptions();render();requestAnimationFrame(sizeCard);$('saveStatus').textContent=db?'この端末に自動保存':'JSON保存をご利用ください'}
init().catch(err=>{console.error(err);$('saveStatus').textContent='初期化エラー';showToast('エディターの起動に失敗しました')});
})();
