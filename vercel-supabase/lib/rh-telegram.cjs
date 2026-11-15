const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const BOT_USERNAME='viatelviseubot';
const DEFAULT_URL='https://vfmncuejbfcwrzrqzqnr.supabase.co';
const DEFAULT_ANON='sb_publishable_QJM8W5vPsJOICxqw_FEUXA_suAywMLM';
const fail=(message,status=503,code='UNAVAILABLE')=>Object.assign(new Error(message),{status,code});
const hash=value=>createHash('sha256').update(value).digest('hex');
function send(res,status,payload){
  res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(payload));
}
async function body(req){
  if(req.body && typeof req.body==='object'){
    if(Buffer.byteLength(JSON.stringify(req.body))>2048) throw fail('Pedido demasiado grande.',413);
    return req.body;
  }
  let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>2048) throw fail('Pedido demasiado grande.',413);}
  try{return text?JSON.parse(text):{};}catch{throw fail('Pedido inválido.',400);}
}
function cronAuthorized(req,env){
  const secret=env.CRON_SECRET || '',actual=String(req.headers.authorization || '');
  const expected='Bearer '+secret;
  return secret.length>=16 && Buffer.byteLength(actual)===Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
function createTelegramService({env=process.env,fetcher=fetch,now=()=>new Date(),renderImage}={}){
  const url=(env.SUPABASE_URL || DEFAULT_URL).replace(/\/$/,''),serviceKey=env.SUPABASE_SERVICE_ROLE_KEY || '';
  const anon=env.SUPABASE_ANON_KEY || DEFAULT_ANON,token=(env.TELEGRAM_BOT_TOKEN || '').trim();
  async function db(route,{method='GET',value,prefer}={}){
    if(!serviceKey) throw fail('A chave de servidor do Supabase não está configurada.');
    let response;try{response=await fetcher(url+'/rest/v1/'+route,{method,signal:AbortSignal.timeout(15000),headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(value===undefined?{}:{body:JSON.stringify(value)})});}
    catch{throw fail('Não foi possível contactar o servidor RH.');}
    let data;try{data=await response.json();}catch{data=null;}
    if(!response.ok) throw fail(['PGRST205','42P01','PGRST202'].includes(data?.code)?'Falta instalar a configuração Telegram no Supabase.':'Não foi possível guardar a configuração Telegram.',503,data?.code || 'DB_ERROR');
    return data;
  }
  async function admin(req){
    const bearer=String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
    if(!bearer) throw fail('Inicia sessão no RH.',401);
    let response;try{response=await fetcher(url+'/auth/v1/user',{headers:{apikey:anon,Authorization:'Bearer '+bearer},signal:AbortSignal.timeout(10000)});}catch{throw fail('Não foi possível validar a sessão.');}
    if(!response.ok) throw fail('Sessão inválida.',401);
    const user=await response.json();if(!user?.id) throw fail('Sessão inválida.',401);
    const profiles=await db('user_profiles?user_id=eq.'+encodeURIComponent(user.id)+'&select=role');
    if(!profiles?.some(profile=>profile.role==='admin')) throw fail('Apenas o administrador pode gerir o Telegram.',403);
    return user.id;
  }
  async function telegram(method,value,photo=false){
    if(!token) throw fail('Falta TELEGRAM_BOT_TOKEN no Vercel.');
    let response,data;
    try{
      response=await fetcher(`https://api.telegram.org/bot${token}/${method}`,{
        method:'POST',signal:AbortSignal.timeout(30000),body:photo?value:JSON.stringify(value || {}),
        ...(photo?{}:{headers:{'Content-Type':'application/json'}})
      });
      data=await response.json();
    }catch{throw Object.assign(fail('O Telegram não confirmou o pedido. Verifica a conversa antes de repetir.',503,'TELEGRAM_UNCERTAIN'),{uncertain:true});}
    if(!response.ok || data?.ok!==true){
      const code=Number(data?.error_code) || response.status;
      if(data?.ok!==false) throw Object.assign(fail('O Telegram não confirmou o pedido.',503,'TELEGRAM_UNCERTAIN'),{uncertain:true});
      throw fail(code===401?'A chave do bot Telegram é inválida.':code===409?'O bot está a ser usado por outra ligação.':'O Telegram recusou o pedido. Confirma que carregaste em Iniciar no bot.',503,'TELEGRAM_'+code);
    }
    return data.result;
  }
  async function identity(){
    const bot=await telegram('getMe');
    if(String(bot?.username || '').toLowerCase()!==BOT_USERNAME) throw fail('A chave configurada não pertence ao @'+BOT_USERNAME+'.',409,'BOT_MISMATCH');
    return bot;
  }
  const config=async()=>{
    const rows=await db('rh_telegram_config?id=eq.1&select=*');
    if(!rows?.[0]) throw fail('Falta instalar a configuração Telegram no Supabase.');
    return rows[0];
  };
  const patch=value=>db('rh_telegram_config?id=eq.1',{method:'PATCH',value:{...value,updated_at:now().toISOString()}});
  async function status(){
    let settings;
    try{settings=await config();}catch(error){return {botUsername:BOT_USERNAME,tokenConfigured:!!token,cronConfigured:(env.CRON_SECRET || '').length>=16,storageReady:false,connected:false,enabled:false,error:error.message};}
    const deliveries=await db('rh_telegram_deliveries?select=status&event_date=gte.'+new Date(+now()-7*86400000).toISOString().slice(0,10));
    return {botUsername:BOT_USERNAME,tokenConfigured:!!token,cronConfigured:(env.CRON_SECRET || '').length>=16,storageReady:true,connected:!!settings.chat_id,enabled:settings.enabled,
      destination:settings.chat_label || '',lastRun:settings.last_run_at,lastError:settings.last_error,
      unconfirmed:deliveries.filter(item=>['sending','uncertain'].includes(item.status)).length};
  }
  async function pair(adminId){
    await identity();
    const code=randomBytes(24).toString('base64url');
    await patch({pair_hash:hash(code),pair_admin:adminId,pair_expires:new Date(+now()+10*60000).toISOString()});
    return {pairUrl:`https://t.me/${BOT_USERNAME}?start=${code}`,expiresIn:600};
  }
  async function verify(adminId){
    await identity();
    const settings=await config();
    if(settings.pair_admin!==adminId || !settings.pair_hash || +new Date(settings.pair_expires)<=+now()) throw fail('A ligação expirou. Volta a carregar em Ligar Telegram.',409);
    const updates=await telegram('getUpdates',{limit:100,timeout:0,allowed_updates:['message']});
    const message=updates.map(update=>update.message).find(message=>{
      const code=String(message?.text || '').match(/^\/start(?:@viatelviseubot)? ([a-zA-Z0-9_-]{32})$/)?.[1];
      return code && hash(code)===settings.pair_hash && message.chat?.type==='private' && message.from?.id===message.chat?.id && message.date*1000>+new Date(settings.pair_expires)-10*60000-5000;
    });
    if(!message) throw fail('Abre a ligação ao bot, carrega em Iniciar e volta a confirmar aqui.',409);
    const label=[message.from.first_name,message.from.last_name].filter(Boolean).join(' ').slice(0,120) || 'Conversa privada';
    const rows=await db('rh_telegram_config?id=eq.1&pair_hash=eq.'+settings.pair_hash+'&pair_admin=eq.'+encodeURIComponent(adminId),{
      method:'PATCH',prefer:'return=representation',value:{chat_id:String(message.chat.id),chat_label:label,enabled:true,configured_by:adminId,pair_hash:null,pair_admin:null,pair_expires:null,last_error:null,updated_at:now().toISOString()}
    });
    if(!rows?.length) throw fail('A ligação foi alterada entretanto. Volta a tentar.',409);
    return {connected:true,destination:label,enabled:true};
  }
  async function photo(chatId,info,caption){
    const render=renderImage || require('./anniversary-image.cjs').renderImage;
    const png=await render(info);
    if(!Buffer.isBuffer(png) || !png.length || png.length>10*1024*1024) throw fail('Não foi possível gerar o cartão.');
    const form=new FormData();form.set('chat_id',chatId);form.set('caption',caption.slice(0,1000));form.set('photo',new Blob([png],{type:'image/png'}),'parabens.png');
    const result=await telegram('sendPhoto',form,true);
    if(!Number.isInteger(result?.message_id)) throw Object.assign(fail('O Telegram não confirmou a imagem.',503,'TELEGRAM_UNCERTAIN'),{uncertain:true});
    return result.message_id;
  }
  async function run(){
    const {anniversaryEvents,lisbonDate,eventCaption}=await import('./anniversary-events.mjs');
    const date=lisbonDate(now()),settings=await config();
    if(!settings.enabled || !settings.chat_id) return {date,sent:0,skipped:0,disabled:true};
    await identity();
    const persons=[];
    for(let offset=0;;offset+=500){
      const rows=await db('rh_persons?ativo=eq.true&select=id,name,entrada,nascimento,saida,photo:data->>photo,photoMirror:data->photoMirror&order=id&limit=500&offset='+offset);
      persons.push(...rows);if(rows.length<500) break;
    }
    const events=anniversaryEvents(persons,date),result={date,eligible:events.length,sent:0,skipped:0,failed:0,uncertain:0};
    for(const event of events){
      const key=hash(JSON.stringify([settings.chat_id,event.person.id,event.kind,date]));
      const lease=await db('rpc/rh_claim_telegram_delivery',{method:'POST',value:{p_key:key,p_person:event.person.id,p_date:date,p_kind:event.kind,p_chat:settings.chat_id}});
      if(!lease){result.skipped++;continue;}
      const finish=(state,message=null,error=null)=>db('rpc/rh_finish_telegram_delivery',{method:'POST',value:{p_key:key,p_lease:lease,p_status:state,p_message:message,p_error:error}});
      let sending=false,accepted=false;
      try{
        const render=renderImage || require('./anniversary-image.cjs').renderImage;
        const png=await render(event);
        if(!Buffer.isBuffer(png) || !png.length || png.length>10*1024*1024) throw fail('Não foi possível gerar o cartão.');
        if(!await finish('sending')){result.skipped++;continue;}
        sending=true;
        const form=new FormData();form.set('chat_id',settings.chat_id);form.set('caption',eventCaption(event).slice(0,1000));form.set('photo',new Blob([png],{type:'image/png'}),'parabens.png');
        const delivered=await telegram('sendPhoto',form,true);
        if(!Number.isInteger(delivered?.message_id)) throw Object.assign(fail('Sem confirmação.',503,'TELEGRAM_UNCERTAIN'),{uncertain:true});
        accepted=true;
        if(!await finish('sent',delivered.message_id)) throw Object.assign(fail('Sem recibo.',503,'DB_RECEIPT'),{uncertain:true});
        result.sent++;
      }catch(error){
        const uncertain=accepted || (sending && (error.uncertain || error.code==='DB_ERROR' || error.code==='UNAVAILABLE'));
        const state=uncertain?'uncertain':'failed';result[state]++;
        try{await finish(state,null,error.code || 'IMAGE_ERROR');}catch{result.uncertain+=uncertain?0:1;}
      }
    }
    await patch({last_run_at:now().toISOString(),last_error:result.uncertain?'Há envios sem confirmação. Verifica a conversa Telegram antes de repetir.':result.failed?'Alguns cartões não foram enviados. Podes voltar a enviar os aniversários de hoje.':null});
    return result;
  }
  async function action(name,adminId){
    if(name==='pair') return pair(adminId);
    if(name==='verify') return verify(adminId);
    if(name==='pause'){await patch({enabled:false,pair_hash:null,pair_admin:null,pair_expires:null});return {enabled:false};}
    if(name==='resume'){await identity();const current=await config();if(!current.chat_id) throw fail('Liga primeiro a tua conversa ao bot.',409);await patch({enabled:true});return {enabled:true};}
    if(name==='test'){
      await identity();const current=await config();if(!current.chat_id) throw fail('Liga primeiro a tua conversa ao bot.',409);
      await photo(current.chat_id,{person:{name:'RH Viatel Viseu'},years:1,imageSubtitle:'Ligação ao Telegram ativa',imageMessage:'Os aniversários de vida e de empresa vão chegar aqui com a imagem.'},'Teste da ligação RH Viatel Viseu.');
      return {sent:true};
    }
    if(name==='send-today') return run();
    throw fail('Ação inválida.',400);
  }
  return {admin,status,action,run};
}
module.exports={createTelegramService,cronAuthorized,send,body};
