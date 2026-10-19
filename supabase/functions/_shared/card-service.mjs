// Runtime-neutral request handlers. All privileged credentials stay in the Edge runtime.
const ADMIN_KEY_HASH = '72e292a1a73fe389ea0ee2ffb6828c0efd52a45860152365a1a817cc762c68ed';
const RARITIES = new Set(['Common', 'Rare', 'Epic', 'Legendary']);
const ACTIONS = new Set(['list','list-codes','create-card','update-card','add-variant','update-variant','set-variant-enabled','reorder','trash-card','trash-variant','restore-card','restore-variant','delete-card','delete-variant','create-code','update-code','disable-code','enable-code']);
const PUBLIC_ERRORS = new Set(['CODE_EXPIRED','CODE_DISABLED','CODE_EXHAUSTED','CODE_USED','CODE_NOT_FOUND','V1_REQUIRED','VARIANT_UNAVAILABLE','INVALID_CODE','CARD_NOT_FOUND','VARIANT_NOT_FOUND','V1_PROTECTED','SOURCE_REQUIRED','STALE_ORDER','INVALID_ORDER','ID_CONFIRMATION_REQUIRED','STALE_PARENT']);
class InputError extends Error {}
function check(condition, message) { if (!condition) throw new InputError(message); }
function cors(req) {
  const origin = req.headers.get('origin');
  if (origin && origin !== 'https://yuslime.github.io' && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return null;
  return { 'Access-Control-Allow-Origin': origin || 'https://yuslime.github.io', 'Access-Control-Allow-Headers':'content-type,x-admin-key,apikey,authorization', 'Access-Control-Allow-Methods':'POST,OPTIONS', Vary:'Origin' };
}
function response(req, body, status = 200) { return new Response(status === 204 ? null : JSON.stringify(body), { status, headers:{...cors(req), 'Content-Type':'application/json','Cache-Control':'no-store'} }); }
function preflight(req) { if (!cors(req)) return response(req,{error:'Origin is not allowed'},403); if (req.method === 'OPTIONS') return response(req,null,204); if (req.method !== 'POST') return response(req,{error:'Method not allowed'},405); return null; }
async function sha256(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join(''); }
function sameHash(a,b) { if (a.length !== b.length) return false; let difference=0; for(let i=0;i<a.length;i++) difference |= a.charCodeAt(i)^b.charCodeAt(i); return difference===0; }
async function readPayload(req) {
  const length = Number(req.headers.get('content-length') || 0);
  check(length <= 64 * 1024 * 1024,'Request is too large');
  if (req.headers.get('content-type')?.includes('multipart/form-data')) {
    const form = await req.formData();
    return {payload:Object.fromEntries([...form.entries()].filter(([,v])=>typeof v==='string')),form};
  }
  const payload = await req.json().catch(()=>{throw new InputError('Invalid JSON');});
  check(payload && typeof payload==='object' && !Array.isArray(payload),'Invalid request');
  return {payload,form:null};
}
function jsonField(value, fallback) { if (typeof value !== 'string') return value ?? fallback; try{return JSON.parse(value);}catch{throw new InputError('Invalid structured field');} }
function bool(value) { check(value===true||value===false||value==='true'||value==='false','Invalid enabled flag');return value===true||value==='true'; }
function stats(payload) {
  check(typeof payload.id==='string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.id) && payload.id.length<=80,'Invalid CARD ID');
  check(typeof payload.name==='string' && payload.name.trim().length>0 && payload.name.length<=80,'NAME is required (80 characters maximum)');
  for(const name of ['cost','attack','defense']) { check(payload[name]!=='' && payload[name]!==null && payload[name]!==undefined && typeof payload[name]!=='boolean','Stats must be integers from 0 to 99'); const n=Number(payload[name]);check(Number.isInteger(n)&&n>=0&&n<=99,'Stats must be integers from 0 to 99');payload[name]=n; }
  check(RARITIES.has(payload.rarity),'Invalid rarity');payload.name=payload.name.trim();
}
async function validateImage(file, rendered) {
  check(file instanceof File && file.size>0,'Source and rendered images are required');
  check(file.size<=(rendered?5:8)*1024*1024,'Image exceeds size limit');
  check((rendered?['image/png']:['image/png','image/jpeg','image/webp']).includes(file.type),'Unsupported image type');
  const bytes=new Uint8Array(await file.slice(0,32).arrayBuffer());
  const isPng=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  const isJpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const isWebp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  check(file.type==='image/png'?isPng:file.type==='image/jpeg'?isJpeg:isWebp,'Image content does not match its type');
  if(rendered) {
    check(bytes.length>=24,'Invalid PNG');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const width=view.getUint32(16),height=view.getUint32(20);
    check((width===512&&height===682)||(width===1086&&height===1448),'Rendered card must be 512 × 682 or 1086 × 1448 PNG');
  }
}
function safeError(req,error) {
  if(error instanceof InputError) return response(req,{error:error.message},400);
  const message=error?.message || '';
  const known=[...PUBLIC_ERRORS].find(code=>message.includes(code));
  if(known) return response(req,{error:known,code:known},400);
  if(error?.code==='23505') return response(req,{error:'CARD ID or code already exists',code:'DUPLICATE'},409);
  return response(req,{error:'操作を完了できませんでした。内容を保持したまま再試行してください。',code:'INTERNAL_ERROR'},500);
}
function randomCode() { return [...crypto.getRandomValues(new Uint8Array(16))].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase(); }
function codeText(code) { const value=String(code || '').trim().toUpperCase();check(/^[A-Z0-9_-]{1,80}$/.test(value),'Invalid code');return value; }
export function createAdminHandler({store,adminKeyHash=ADMIN_KEY_HASH}) {
  return async req => {
    const early=preflight(req);if(early)return early;
    const provided=req.headers.get('x-admin-key') || '';
    if(!provided || !sameHash(await sha256(provided),adminKeyHash)) return response(req,{error:'Invalid admin key'},401);
    const uploaded=[];let mutationAttempted=false;
    try {
      const {payload:p,form}=await readPayload(req);
      const action=p.action;check(ACTIONS.has(action),'Unknown action');delete p.action;
      // Opening the manager also retries durable cleanup from interrupted prior work.
      if(action==='list'||action==='list-codes'){
        const result=action==='list'?{cards:await store.listCards()}:{codes:await store.listCodes()};
        let cleanupPending=false;try{await store.drainCleanup();}catch{cleanupPending=true;}
        return response(req,{ok:true,...result,...(cleanupPending?{cleanup_pending:true}:{})});
      }
      if(action.endsWith('-card') && action!=='create-card')p.card_internal_id=p.card_internal_id||p.internal_id;
      if(action.endsWith('-variant') || action==='set-variant-enabled')p.variant_internal_id=p.variant_internal_id||p.internal_id;
      if(action==='add-variant')p.card_internal_id=p.card_internal_id||p.internal_id;
      if(['update-code','disable-code','enable-code'].includes(action))p.code_internal_id=p.code_internal_id||p.internal_id;
      delete p.internal_id;
      if(action==='create-card'||action==='update-card')stats(p);
      if(action==='update-card'){
        const card=await store.getCard(p.card_internal_id);check(card,'Card was not found');
        if(card.id!==p.id){const confirmation=jsonField(p.confirm_id_change,null);check(confirmation?.from===card.id&&confirmation?.to===p.id,'CARD ID change requires old → new confirmation');}
        if(p.card_number!==undefined){p.card_number=Number(p.card_number);check(Number.isInteger(p.card_number)&&p.card_number>=1,'Invalid CARD NUMBER');}
      }
      if(['trash-variant','delete-variant'].includes(action)){const variant=await store.getVariant(p.variant_internal_id);check(variant,'Variant was not found');check(variant.variant_number!==1,'V1 cannot be independently trashed or deleted');}
      if(p.enabled!==undefined)p.enabled=bool(p.enabled);
      if(action==='set-variant-enabled')p.enabled=bool(p.enabled);
      const upload=async(file,kind,rendered)=>{
        await validateImage(file,rendered);
        const ext=file.type==='image/jpeg'?'jpg':file.type==='image/webp'?'webp':'png';
        const path=`variants/${crypto.randomUUID()}/${kind}.${ext}`;
        // Register orphan cleanup before uploading so interrupted workers leave a durable receipt.
        await store.queueCleanup([path], {notBefore:new Date(Date.now()+15*60*1000).toISOString()});
        await store.upload(path,file);uploaded.push(path);return path;
      };
      if(['create-card','add-variant'].includes(action)|| (action==='update-variant' && (form?.get('file')||form?.get('source_file')))) {
        if(action!=='create-card'){
          p.rendered_parent=jsonField(p.rendered_parent,null);
          check(p.rendered_parent && typeof p.rendered_parent==='object' && !Array.isArray(p.rendered_parent),'画像生成時の親カード情報が必要です。画面を再読み込みしてください');
        }
        const source=form?.get('source_file'),rendered=form?.get('file');
        await validateImage(source,false);await validateImage(rendered,true);
        p.source_image_path=await upload(source,'source',false);p.rendered_image_path=await upload(rendered,'rendered',true);
      }
      if(action==='update-card'){
        const files=jsonField(p.rendered_files,{});check(files && typeof files==='object'&&!Array.isArray(files),'Invalid rendered files');
        p.rendered_variants=[];
        for(const [variant_internal_id,field]of Object.entries(files))p.rendered_variants.push({variant_internal_id,rendered_image_path:await upload(form?.get(field),'rendered',true)});
        delete p.rendered_files;
      }
      let rpcAction=action;
      if(action==='reorder'){rpcAction='reorder-cards';p.card_internal_ids=jsonField(p.card_internal_ids||p.internal_ids||p.order,[]);check(Array.isArray(p.card_internal_ids),'Invalid card order');}
      if(action==='set-variant-enabled')rpcAction='update-variant';
      if(action==='create-code'){
        rpcAction='create-codes';check(['shared','one_time'].includes(p.code_type),'Invalid code type');
        const quantity=p.code_type==='one_time'?Number(p.quantity??1):1;check(Number.isInteger(quantity)&&quantity>=1&&quantity<=1000,'Quantity must be 1–1000');
        const grants=jsonField(p.variant_internal_ids,[]);check(Array.isArray(grants)&&grants.length>0&&grants.length<=100,'Choose 1–100 variants');
        const maximum=p.max_uses===''||p.max_uses==null?null:Number(p.max_uses);check(maximum===null||Number.isInteger(maximum)&&maximum>0,'Invalid maximum uses');
        const expires=p.expires_at||null;check(expires===null||Number.isFinite(Date.parse(expires)),'Invalid expiry');
        p.codes=Array.from({length:quantity},()=>({code:p.code_type==='shared'&&p.code?codeText(p.code):randomCode(),code_type:p.code_type,variant_internal_ids:[...new Set(grants)],expires_at:expires,max_uses:p.code_type==='one_time'?1:maximum}));
      }
      if(['enable-code','disable-code','update-code'].includes(action)){
        rpcAction='update-code';
        if(action==='enable-code'||action==='disable-code')p.enabled=action==='enable-code';
        if(p.enabled){const code=await store.getCode(p.code_internal_id);check(code && !(code.code_type==='one_time'&&code.use_count>0),'Used one-time codes cannot be re-enabled');}
        if(p.max_uses!==undefined){p.max_uses=p.max_uses===''||p.max_uses==null?null:Number(p.max_uses);check(p.max_uses===null||Number.isInteger(p.max_uses)&&p.max_uses>0,'Invalid maximum uses');}
        if(p.expires_at!==undefined){p.expires_at=p.expires_at||null;check(p.expires_at===null||Number.isFinite(Date.parse(p.expires_at)),'Invalid expiry');}
      }
      mutationAttempted=true;
      const result=await store.mutate(rpcAction,p);
      // SQL owns the durable cleanup queue. Cleanup failures must not turn a committed edit into a reported failure.
      let cleanupPending=false;try{await store.drainCleanup();}catch{cleanupPending=true;}
      return response(req,{ok:true,...result,...(cleanupPending?{cleanup_pending:true}:{})});
    }catch(error){
      // An interrupted RPC response may conceal a committed transaction. Retain its new artwork;
      // the pre-registered queue checks references after the uncertainty window before deletion.
      if(uploaded.length && (!mutationAttempted || error.databaseRejected===true)){
        try{await store.remove(uploaded);}catch{ /* Durable orphan receipts were written before upload. */ }
      }
      return safeError(req,error);
    }
  };
}
export function createRedeemHandler({store}) {
  return async req=>{
    const early=preflight(req);if(early)return early;
    try{
      const {payload:p}=await readPayload(req);check(p.action==='inspect'||p.action==='redeem','Unknown action');
      const code=codeText(p.code);
      const owned=p.owned_variant_ids??[];check(Array.isArray(owned)&&owned.length<=10000&&owned.every(id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)),'Invalid owned variants');
      const result=p.action==='inspect'?await store.inspectCode(code):await store.redeemCode(code,owned);
      // Explicit public allowlist: no admin data, storage source images, secrets or redemption history.
      return response(req,{ok:true,code_internal_id:result.code_internal_id,code_type:result.code_type,status:result.status,grants:(result.grants||[]).map(v=>({variant_internal_id:v.variant_internal_id||v.internal_id,card_internal_id:v.card_internal_id,variant_number:v.variant_number,variant_name:v.variant_name,card_number:v.card_number,name:v.name,rendered_image_path:v.rendered_image_path}))});
    }catch(error){return safeError(req,error);}
  };
}
