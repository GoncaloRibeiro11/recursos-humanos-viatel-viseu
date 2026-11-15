import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {anniversaryEvents,lisbonDate} from '../lib/anniversary-events.mjs';
const require=createRequire(import.meta.url);
const {createTelegramService,cronAuthorized}=require('../lib/rh-telegram.cjs');
const {renderImage}=require('../lib/anniversary-image.cjs');
const at=new Date('2026-11-15T12:00:00Z');
const env={SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',TELEGRAM_BOT_TOKEN:'test-only',CRON_SECRET:'test-only-long-cron-secret'};
const staff=()=>[{id:'one',name:'Teste Gonçalves',entrada:'2024-11-15',nascimento:'1990-11-15',photo:''}];
function fixture(){
  const state={config:{id:1,enabled:true,chat_id:'123',chat_label:'Teste'},deliveries:new Map(),persons:staff(),photos:[],updates:[],requests:[],role:'admin',bot:'viatelviseubot',sendError:null,receiptError:false};
  const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  const fetcher=async(address,options={})=>{
    const url=new URL(address),method=options.method || 'GET';
    state.requests.push({path:url.pathname,query:url.search,method});
    if(url.pathname==='/auth/v1/user') return response({id:'11111111-1111-4111-8111-111111111111'});
    if(url.hostname==='api.telegram.org'){
      const action=url.pathname.split('/').at(-1);
      if(action==='getMe') return response({ok:true,result:{username:state.bot}});
      if(action==='getUpdates') return response({ok:true,result:state.updates});
      if(action==='sendPhoto'){
        state.photos.push({caption:options.body.get('caption'),chat:options.body.get('chat_id'),image:await options.body.get('photo').arrayBuffer()});
        if(state.sendError==='timeout') throw new Error('test timeout');
        if(state.sendError) return response({ok:false,error_code:403},403);
        return response({ok:true,result:{message_id:state.photos.length}});
      }
      throw new Error('Unexpected Telegram action');
    }
    const value=options.body?JSON.parse(options.body):null;
    if(url.pathname.endsWith('/user_profiles')) return response([{role:state.role}]);
    if(url.pathname.endsWith('/rh_telegram_config')){
      if(method==='PATCH'){
        const hash=url.searchParams.get('pair_hash');
        if(hash && hash!=='eq.'+state.config.pair_hash) return response([]);
        Object.assign(state.config,value);return response([state.config]);
      }
      return response([state.config]);
    }
    if(url.pathname.endsWith('/rh_persons')){
      const offset=Number(url.searchParams.get('offset')) || 0;return response(state.persons.slice(offset,offset+500));
    }
    if(url.pathname.endsWith('/rh_telegram_deliveries')) return response([...state.deliveries.values()]);
    if(url.pathname.endsWith('/rpc/rh_claim_telegram_delivery')){
      const old=state.deliveries.get(value.p_key);
      if(!state.config.enabled || state.config.chat_id!==value.p_chat || (old && (old.status!=='failed' || old.attempts>=3))) return response(null);
      const entry={...value,lease:randomUUID(),status:'preparing',attempts:(old?.attempts || 0)+1};state.deliveries.set(value.p_key,entry);return response(entry.lease);
    }
    if(url.pathname.endsWith('/rpc/rh_finish_telegram_delivery')){
      const entry=state.deliveries.get(value.p_key);
      if(state.receiptError && value.p_status==='sent') return response({code:'PGRST205'},503);
      if(!entry || entry.lease!==value.p_lease) return response(false);
      Object.assign(entry,{status:value.p_status,message_id:value.p_message});return response(true);
    }
    throw new Error('Unexpected test request '+url.pathname);
  };
  const service=createTelegramService({env,fetcher,now:()=>at,renderImage:async()=>Buffer.from('test-png')});
  return {state,service};
}

test('aniversarios usam o dia de Lisboa, excluem inativos e nao antecipam imagens',()=>{
  assert.equal(lisbonDate(new Date('2026-07-01T23:30:00Z')),'2026-07-02');
  assert.equal(lisbonDate(new Date('2026-11-15T23:30:00Z')),'2026-11-15');
  const people=[...staff(),{id:'future',entrada:'2027-11-15',nascimento:'1990-11-15'},{id:'left',ativo:false,entrada:'2020-11-15'},{id:'same-day',entrada:'2020-11-15',saida:'2026-11-15'},{id:'tomorrow',nascimento:'1990-11-16'},{id:'new',entrada:'2026-11-15'}];
  const before=JSON.stringify(people),events=anniversaryEvents(people,'2026-11-15');
  assert.deepEqual(events.map(event=>[event.person.id,event.kind,event.years]),[['one','birthday',36],['one','work',2]]);
  assert.equal(JSON.stringify(people),before);
  assert.equal(anniversaryEvents([{id:'leap',nascimento:'2000-02-29'}],'2026-03-01').length,1);
  assert.equal(anniversaryEvents([{id:'leap',nascimento:'2000-02-29'}],'2028-02-29').length,1);
  assert.equal(anniversaryEvents([{id:'bad',nascimento:'2000-02-31'}],'2026-03-03').length,0);
});
test('cron e gestao de Telegram exigem credenciais e administrador',async()=>{
  assert.equal(cronAuthorized({headers:{}},env),false);
  assert.equal(cronAuthorized({headers:{authorization:'Bearer '+env.CRON_SECRET}},env),true);
  assert.equal(cronAuthorized({headers:{authorization:'Bearer '}},{}),false);
  const {state,service}=fixture();
  await assert.rejects(service.admin({headers:{}}),error=>error.status===401);assert.equal(state.requests.length,0);
  state.role='gestor';await assert.rejects(service.admin({headers:{authorization:'Bearer test'}}),error=>error.status===403);
  assert.equal(state.photos.length,0);
});
test('ligacao valida bot, codigo de uso unico, prazo e conversa privada',async()=>{
  const {state,service}=fixture(),admin='11111111-1111-4111-8111-111111111111';
  state.bot='wrongbot';await assert.rejects(service.action('pair',admin),error=>error.code==='BOT_MISMATCH');
  state.bot='viatelviseubot';const pair=await service.action('pair',admin),code=new URL(pair.pairUrl).searchParams.get('start');
  assert.notEqual(state.config.pair_hash,code);assert.equal(code.length,32);
  const message={text:'/start '+code,date:Math.floor(+at/1000),chat:{id:789,type:'group'},from:{id:789,first_name:'Gonçalo'}};
  state.updates=[{message}];await assert.rejects(service.action('verify',admin),error=>error.status===409);
  message.chat.type='private';await service.action('verify',admin);
  assert.equal(state.config.chat_id,'789');assert.equal(state.config.enabled,true);assert.equal(state.config.pair_hash,null);
  await assert.rejects(service.action('verify',admin),error=>error.status===409);
  const status=await service.status();assert.equal(status.destination,'Gonçalo');assert.equal('chat_id' in status,false);
  assert.doesNotMatch(JSON.stringify(status),/test-only|pair_hash/);
});
test('execucoes concorrentes e repetidas enviam cada aniversario uma vez',async()=>{
  const {state,service}=fixture();
  const results=await Promise.all([service.run(),service.run()]);
  assert.equal(results.reduce((sum,result)=>sum+result.sent,0),2);assert.equal(state.photos.length,2);
  assert.ok(state.photos.every(photo=>photo.chat==='123' && photo.image.byteLength>0));
  assert.ok(state.photos.some(photo=>photo.caption.includes('Aniversário de vida')));
  assert.ok(state.photos.some(photo=>photo.caption.includes('Aniversário de empresa')));
  await service.run();assert.equal(state.photos.length,2);
  assert.ok(state.requests.filter(request=>request.path.endsWith('/rh_persons')).every(request=>!request.query.includes('telefone') && !request.query.includes('agv')));
});
test('timeout apos envio e falha de recibo nao provocam repeticao automatica',async()=>{
  for(const scenario of ['timeout','receipt']){
    const {state,service}=fixture();state.persons=[staff()[0]];
    if(scenario==='timeout') state.sendError='timeout';else state.receiptError=true;
    const result=await service.run();assert.equal(result.uncertain,2);
    assert.ok([...state.deliveries.values()].every(entry=>entry.status==='uncertain'));
    state.sendError=null;state.receiptError=false;
    await service.run();assert.equal(state.photos.length,2);
  }
});
test('recusas explicitas podem ser tentadas novamente e pausa impede envios',async()=>{
  const {state,service}=fixture();state.sendError='forbidden';
  assert.equal((await service.run()).failed,2);state.sendError=null;
  assert.equal((await service.run()).sent,2);
  await service.action('pause');assert.equal((await service.run()).disabled,true);
  assert.equal(state.photos.length,4);
});
test('cartao gerado no servidor e PNG real, legivel, sem acesso a URLs de fotos',async()=>{
  const bytes=await renderImage({person:{name:'Teste Gonçalves',photo:'https://127.0.0.1/private'},years:5});
  assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.ok(bytes.length>50000);
  const {loadImage,createCanvas}=require('@napi-rs/canvas');
  const image=await loadImage(bytes);assert.equal(image.width,1080);assert.equal(image.height,1080);
  const canvas=createCanvas(1080,1080),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const center=ctx.getImageData(400,400,1,1).data;assert.ok(center[2]>center[0],'blue portrait circle is present');
  const white=ctx.getImageData(100,600,1,1).data;assert.ok(white[0]>240 && white[1]>240 && white[2]>240);
});
