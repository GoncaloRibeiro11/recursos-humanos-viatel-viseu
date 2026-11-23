const {randomBytes,createHash,randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const {renderFleetPdf,appendFleetPhotos,asset}=require('./fleet-pdf.cjs');
const {loadFleetPhotos}=require('./fleet-photos.cjs');
const DEFAULT_URL='https://vfmncuejbfcwrzrqzqnr.supabase.co';
const DEFAULT_ANON='sb_publishable_QJM8W5vPsJOICxqw_FEUXA_suAywMLM';
const PUBLIC_PAGE='https://recursos-humanos-viatel-viseu-supab.vercel.app/auto-viatura.html';
const fail=(message,status=503)=>Object.assign(new Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const idValid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || '');
async function body(req,max=3200000){
  if(req.body){const value=typeof req.body==='string'?JSON.parse(req.body):req.body;if(Buffer.byteLength(JSON.stringify(value))>max)throw fail('Pedido demasiado grande.',413);return value;}
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>max)throw fail('Pedido demasiado grande.',413);}try{return JSON.parse(raw);}catch{throw fail('Pedido inválido.',400);}
}
function reply(res,status,value,type='application/json; charset=utf-8'){
  res.statusCode=status;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.end(Buffer.isBuffer(value)?value:JSON.stringify(value));
}
async function imageData(uri,signature=false){
  const match=String(uri || '').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if(!match || (signature && match[1]!=='png'))throw fail('Imagem inválida.',400);
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length || bytes.length>(signature?130000:2000000))throw fail('A imagem é demasiado grande.',413);
  const expected=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?bytes[0]===255 && bytes[1]===216:bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
  if(!expected)throw fail('Formato da imagem inválido.',400);
  let dimensions;try{dimensions=require('image-size').imageSize(bytes);}catch{throw fail('Cabeçalho da imagem inválido.',400);}
  if(dimensions.width<1 || dimensions.height<1 || dimensions.width>(signature?1200:4096) || dimensions.height>(signature?500:4096))throw fail('Dimensões da imagem inválidas.',400);
  const {loadImage,createCanvas}=require('@napi-rs/canvas');let source;
  try{source=await loadImage(bytes);}catch{throw fail('Não foi possível ler a imagem.',400);}
  if(source.width<1 || source.height<1 || source.width>(signature?1200:4096) || source.height>(signature?500:4096))throw fail('Dimensões da imagem inválidas.',400);
  const canvas=createCanvas(source.width,source.height),ctx=canvas.getContext('2d');ctx.drawImage(source,0,0);
  if(signature){
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let ink=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>40 && Math.min(pixels[i],pixels[i+1],pixels[i+2])<200)ink++;
    if(ink<30)throw fail('Desenha a tua assinatura antes de confirmar.',400);
    return canvas.toDataURL('image/png');
  }
  return canvas.toBuffer('image/jpeg');
}
async function safePatch(input){
  const {INSPECTION_GROUPS}=await import('../src/rh-fleet-model.mjs');
  if(!input || Array.isArray(input) || typeof input!=='object')throw fail('Dados inválidos.',400);
  const output={};
  for(const [key,max] of [['at',40],['expected_return',40],['odometer',8],['fuel',20],['place',120],['notes',2000],['damage_notes',3000]])if(Object.hasOwn(input,key)){
    if(!['string','number'].includes(typeof input[key]) || String(input[key]).length>max)throw fail('Campo inválido: '+key,400);output[key]=input[key];
  }
  if(input.inspection){output.inspection={};for(const group of INSPECTION_GROUPS)for(const item of group.items){const value=input.inspection[item.key] || '';if(!['','Bom','Suf','Mau','NA',...(group.page===0?['NE']:[])].includes(value))throw fail('Estado de inspeção inválido.',400);output.inspection[item.key]=value;}}
  if(input.damage_markers){if(!Array.isArray(input.damage_markers) || input.damage_markers.length>100)throw fail('Danos inválidos.',400);output.damage_markers=input.damage_markers.map(mark=>{if(!['R','A','P'].includes(mark.type) || !Number.isFinite(mark.x) || !Number.isFinite(mark.y) || mark.x<50 || mark.x>537 || mark.y<260 || mark.y>622)throw fail('Dano inválido.',400);return {x:mark.x,y:mark.y,type:mark.type};});}
  if(input.driver_fields){output.driver_fields={from:{},to:{}};for(const role of ['from','to'])for(const key of ['name','number','phone','bi','nif','license']){if(key==='name' && !Object.hasOwn(input.driver_fields[role] || {},key))continue;const value=input.driver_fields[role]?.[key] || '';if(typeof value!=='string' || value.length>(key==='name'?120:80) || (key==='name' && /[\u0000-\u001f]/.test(value)))throw fail('Dados do condutor inválidos.',400);output.driver_fields[role][key]=key==='name'?value.trim():value;}}
  if(Object.hasOwn(input,'checked')){if(typeof input.checked!=='boolean')throw fail('Confirmação inválida.',400);output.checked=input.checked;}
  return output;
}
function createFleetShares({env=process.env,fetcher=fetch,now=()=>new Date(),render=renderFleetPdf}={}){
  const base=(env.SUPABASE_URL || DEFAULT_URL).replace(/\/$/,''),anon=env.SUPABASE_ANON_KEY || DEFAULT_ANON,secret=env.SUPABASE_SERVICE_ROLE_KEY;
  async function request(route,options={},bearer){
    const key=bearer?anon:secret;if(!key)throw fail('O serviço de ligações ainda não está configurado.');
    try{return await fetcher(base+route,{...options,headers:{apikey:key,Authorization:bearer || 'Bearer '+secret,...options.headers},signal:AbortSignal.timeout(20000)});}catch{throw fail('Não foi possível contactar o servidor.');}
  }
  async function rpc(name,value,bearer){
    const response=await request('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)},bearer);
    let data;try{data=await response.json();}catch{}
    if(!response.ok){if(['P0001','40001'].includes(data?.code))throw fail(data.message,409);if(['PGRST202','42P01'].includes(data?.code))throw fail('Falta atualizar a configuração da Frota no servidor.');throw fail('Não foi possível concluir o pedido.');}
    return Array.isArray(data)?data[0]:data;
  }
  async function signatureErrors(data,payload){
    const {validateSignatureRequest}=await import('../src/rh-fleet-model.mjs');
    const photos=Array.isArray(payload?.photos)?payload.photos.filter(name=>typeof name==='string' && /\.(jpe?g|png|webp)$/i.test(name)):[];
    return validateSignatureRequest(data,photos.length);
  }
  async function admin(req){
    const bearer=String(req.headers.authorization || '');if(!/^Bearer \S+$/.test(bearer))throw fail('Inicia sessão no RH.',401);
    const user=await request('/auth/v1/user',{},bearer);if(!user.ok)throw fail('Sessão inválida.',401);
    const identity=await user.json();if(!identity.id)throw fail('Sessão inválida.',401);
    const response=await request('/rest/v1/user_profiles?user_id=eq.'+encodeURIComponent(identity.id)+'&select=role',{},bearer);
    if(!response.ok || !(await response.json()).some(p=>p.role==='admin'))throw fail('Apenas o administrador pode gerir ligações.',403);
    return bearer;
  }
  async function manage(req,value){
    const bearer=await admin(req);
    if(value.action==='pending-deletions')return rpc('rh_fleet_pending_deletions',{},bearer);
    if(!idValid(value.id))throw fail('Auto inválido.',400);
    if(value.action==='delete' || value.action==='cleanup-deleted'){
      if(!secret)throw fail('O serviço de eliminação de anexos ainda não está configurado.');
      let deleted;
      if(value.action==='delete'){
        if(!Number.isInteger(value.version) || value.version<1 || typeof value.number!=='string' || value.number.length>30 || value.test!==true)throw fail('Confirma o número do auto e a eliminação do teste.',400);
        deleted=await rpc('rh_fleet_delete_handover',{p_id:value.id,p_version:value.version,p_number:value.number,p_test:true},bearer);
      }else deleted=await rpc('rh_fleet_deleted_info',{p_id:value.id},bearer);
      if(!deleted || deleted.id!==value.id || deleted.entity!=='handover')throw fail('Eliminação não confirmada pelo servidor.');
      try{await cleanupDeletedFiles(value.id);return {deleted:true,number:deleted.number,filesPending:false};}
      catch{return {deleted:true,number:deleted.number,filesPending:true};}
    }
    if(value.action==='status')return rpc('rh_fleet_share_status',{p_id:value.id},bearer);
    if(value.action==='revoke')return {revoked:await rpc('rh_fleet_revoke_shares',{p_id:value.id},bearer)};
    if(value.action!=='create' || !['editor','from','to','both'].includes(value.purpose))throw fail('Pedido inválido.',400);
    const shared=value.shared===true || value.purpose==='both';
    const prepared=await rpc('rh_fleet_prepare_share',{p_id:value.id},bearer);
    if(prepared.handover.status!=='draft')throw fail('Só podes partilhar autos em rascunho.',409);
    if(value.purpose!=='editor'){
      const errors=await signatureErrors(prepared.handover.data,prepared.payload);
      if(errors.length)throw fail('Falta completar o pedido de assinatura:\n'+errors.join('\n'),400);
    }
    const token=randomBytes(32).toString('base64url');
    const expires=new Date(+now()+(shared?30*24:24)*3600000).toISOString();
    const link=shared?await rpc('rh_fleet_create_shared_share',{p_id:value.id,p_editable:value.purpose==='editor',p_hash:hash(token),p_expires:expires},bearer):await rpc('rh_fleet_create_share',{p_id:value.id,p_purpose:value.purpose,p_hash:hash(token),p_expires:expires},bearer);
    const status=await rpc('rh_fleet_share_status',{p_id:value.id},bearer);
    return {id:link.id,purpose:link.purpose,expires_at:link.expires_at,url:PUBLIC_PAGE+'#'+token,handover:status.handover};
  }
  const access=async token=>{
    if(!/^[A-Za-z0-9_-]{43}$/.test(token || ''))throw fail('Ligação inválida ou incompleta.',400);
    return rpc('rh_fleet_read_share',{p_hash:hash(token)});
  };
  async function cleanupDeletedFiles(id){
    const names=[];
    async function list(prefix,depth=0){
      if(depth>8)throw fail('Pasta de anexos inválida.');
      for(let offset=0;;offset+=100){
        const response=await request('/storage/v1/object/list/rh-fleet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefix,limit:100,offset,sortBy:{column:'name',order:'asc'}})});
        if(!response.ok)throw fail('Não foi possível consultar os anexos.');
        const rows=await response.json();if(!Array.isArray(rows))throw fail('Resposta de anexos inválida.');
        for(const row of rows){
          if(typeof row.name!=='string' || !row.name || /[\\/\u0000]/.test(row.name) || ['.','..'].includes(row.name))throw fail('Nome de anexo inválido.');
          const name=prefix+'/'+row.name;
          if(row.id===null && row.metadata===null)await list(name,depth+1);else names.push(name);
          if(names.length>10000)throw fail('Demasiados anexos.');
        }
        if(rows.length<100)break;
      }
    }
    await list(id);
    for(let offset=0;offset<names.length;offset+=100){
      const response=await request('/storage/v1/object/rh-fleet',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:names.slice(offset,offset+100)})});
      if(!response.ok)throw fail('Não foi possível eliminar todos os anexos.');
    }
    if(await rpc('rh_fleet_mark_deleted_files',{p_id:id})!==true)throw fail('A limpeza dos anexos não foi confirmada.');
  }
  async function files(handoverId){
    const response=await request('/storage/v1/object/list/rh-fleet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefix:handoverId,limit:100,sortBy:{column:'created_at',order:'asc'}})});
    if(!response.ok)throw fail('Não foi possível consultar as fotografias.');
    return (await response.json()).filter(file=>/\.(jpg|jpeg|png|webp)$/i.test(file.name) && !file.name.includes('/')).map(file=>({name:file.name}));
  }
  async function remote(value){
    const current=await access(value.token);
    if(value.action==='read')return current;
    if(current.shared_signing){
      if(value.action==='sign'){
        if(!['open','complete'].includes(current.status) || current.purpose!=='both')throw fail('Esta ligação ainda não permite assinar.',403);
        if(!['from','to'].includes(value.role))throw fail('Seleciona o campo da tua assinatura.',400);
        return rpc('rh_fleet_remote_shared_sign',{p_hash:hash(value.token),p_role:value.role,p_name:value.name,p_signature:await imageData(value.signature,true),p_content_hash:value.content_hash,p_accept:value.accept===true});
      }
      if(value.action==='submit' && current.purpose==='both'){
        if(!Number.isInteger(value.version))throw fail('Dados inválidos.',400);
        return rpc('rh_fleet_submit_shared',{p_hash:hash(value.token),p_version:value.version,p_patch:await safePatch(value.data)});
      }
      if(value.action==='reconfirm')throw fail('Cada pessoa deve confirmar a sua própria assinatura nesta ligação.',403);
      if(!['open','complete'].includes(current.status))throw fail('Este auto já está fechado.',409);
      if(current.purpose==='both' && ['save','submit','upload'].includes(value.action))throw fail('O conteúdo já está preparado para assinaturas e não pode ser alterado por esta ligação.',403);
    }
    if(value.action==='reconfirm'){
      if(!['from','to'].includes(current.purpose) || !['open','signed'].includes(current.status))throw fail('Esta ligação não permite confirmar assinaturas.',403);
      if(!idValid(value.previous_receipt_id) || typeof value.name!=='string' || value.name.length<2 || value.name.length>120 || value.accept!==true)throw fail('Confirma o nome e a aceitação desta versão do auto.',400);
      return rpc('rh_fleet_remote_reconfirm',{p_hash:hash(value.token),p_previous:value.previous_receipt_id,p_name:value.name,p_content_hash:value.content_hash,p_accept:true});
    }
    if(current.status!=='open' && !(current.shared_signing && current.status==='complete')){
      if(value.action==='submit' && current.status==='submitted')return current;
      if(value.action==='sign' && current.status==='signed')return rpc('rh_fleet_remote_sign',{p_hash:hash(value.token),p_name:value.name,p_signature:await imageData(value.signature,true),p_content_hash:value.content_hash,p_accept:value.accept===true});
      throw fail('Esta ligação já foi utilizada.',409);
    }
    const h=current.handover,tokenHash=hash(value.token);
    if(value.action==='save' || value.action==='submit'){
      if(current.purpose!=='editor')throw fail('Esta ligação permite apenas assinar.',403);
      if(!Number.isInteger(value.version) || !value.data || typeof value.data!=='object')throw fail('Dados inválidos.',400);
      const patch=await safePatch(value.data);
      if(value.action==='submit'){
        const data={...h.data,...patch};
        const errors=await signatureErrors(data,current.payload);if(errors.length)throw fail(errors.join('\n'),400);
      }
      if(current.shared_signing && value.action==='submit')return rpc('rh_fleet_submit_shared',{p_hash:tokenHash,p_version:value.version,p_patch:patch});
      return rpc('rh_fleet_remote_save',{p_hash:tokenHash,p_version:value.version,p_patch:patch,p_submit:value.action==='submit'});
    }
    if(value.action==='sign'){
      if(!['from','to'].includes(current.purpose))throw fail('Esta ligação não permite assinar.',403);
      return rpc('rh_fleet_remote_sign',{p_hash:tokenHash,p_name:value.name,p_signature:await imageData(value.signature,true),p_content_hash:value.content_hash,p_accept:value.accept===true});
    }
    if(value.action==='diagram')return {binary:await fs.readFile(asset('modri-94-01-page2.png')),type:'image/png'};
    if(value.action==='pdf'){
      const snapshot={...current.payload,operation:{...current.payload.operation,signatures:{}},captured_at:current.signing_at || h.data.at};
      const handover={id:h.id,number:current.number,status:'draft',snapshot};
      const photos=await loadFleetPhotos(request,h.id,current.payload.photos || []);
      return {binary:await appendFleetPhotos(await render(handover),handover,photos),type:'application/pdf'};
    }
    if(value.action==='files')return {files:await files(h.id)};
    if(value.action==='file'){
      if(!/^[A-Za-z0-9._-]{1,180}$/.test(value.name || '') || !(await files(h.id)).some(f=>f.name===value.name))throw fail('Fotografia indisponível.',404);
      const response=await request('/storage/v1/object/authenticated/rh-fleet/'+encodeURIComponent(h.id+'/'+value.name));if(!response.ok)throw fail('Fotografia indisponível.',404);
      return {binary:Buffer.from(await response.arrayBuffer()),type:response.headers.get('content-type') || 'image/jpeg'};
    }
    if(value.action==='upload'){
      if(current.purpose!=='editor')throw fail('Só a ligação de preenchimento permite anexar fotografias.',403);
      if((await files(h.id)).length>=20)throw fail('O limite é de 20 fotografias por auto.',400);
      const bytes=await imageData(value.image);const name=randomUUID()+'.jpg';
      const response=await request('/storage/v1/object/rh-fleet/'+encodeURIComponent(h.id+'/'+name),{method:'POST',headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store'},body:bytes});
      if(!response.ok)throw fail('Não foi possível guardar a fotografia. Tenta novamente.');return {uploaded:true,name};
    }
    throw fail('Pedido inválido.',400);
  }
  return {manage,remote};
}
module.exports={createFleetShares,body,reply,imageData,hash,safePatch};
