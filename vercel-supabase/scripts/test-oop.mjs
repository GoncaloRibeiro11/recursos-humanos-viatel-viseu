import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {newContact,setEndStage,validateContact,periodDates,bucketTrend,priorities,officialMetrics,ratio} from '../src/oop-model.mjs';
import {OopJournal} from '../src/oop-journal.mjs';
import {analysisLink,analysisEntry,validateAnalysisEntry} from '../src/oop-access.mjs';
const require=createRequire(import.meta.url),{assertSafePreview}=require('../lib/preview-env.cjs');
const storage=()=>{const items=new Map();return {get length(){return items.size},key:i=>[...items.keys()][i],getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};};
const complete=()=>({...newContact('a','2026-11-17T10:00:00Z'),product:'both',outcome:'both',stages:Array.from({length:7},(_,i)=>({stage:i+1,status:i===5?'no_objections':'good',note:''}))});

test('ligacoes por CE nao transportam credenciais e nunca substituem a conta autenticada',()=>{
 const link=analysisLink('https://rh.example/mapa-recursos-humanos.html?token=nao-copiar&access_token=privado#password','ce/1?nome=teste');
 const url=new URL(link);assert.equal(url.origin,'https://rh.example');assert.equal(url.searchParams.get('ce'),'ce/1?nome=teste');assert.deepEqual([...url.searchParams.keys()],['view','ce']);assert.equal(url.hash,'');
 assert.deepEqual(analysisEntry(link),{team:'ce/1?nome=teste'});assert.equal(analysisEntry('https://rh.example/?ce=ce1'),null);
 const teams=[{id:'ce1'},{id:'ce2'}];assert.equal(validateAnalysisEntry({team:'ce1'},{role:'gestor',person_id:'ce1'},teams),'ce1');
 for(const profile of [null,{role:'gestor',person_id:'ce2'},{role:'gestor',person_id:null},{role:'vendedor',person_id:'ce1'}])assert.throws(()=>validateAnalysisEntry({team:'ce1'},profile,teams),/outra equipa/);
 assert.equal(validateAnalysisEntry({team:'ce2'},{role:'admin'},teams),'ce2');assert.throws(()=>validateAnalysisEntry({team:'apagado'},{role:'admin'},teams),/disponível/);
 assert.throws(()=>analysisLink('javascript:alert(1)','ce1'),/Endereço/);assert.throws(()=>analysisLink('https://user:pass@rh.example/','ce1'),/Endereço/);assert.throws(()=>analysisLink('https://rh.example/','\nce1'),/Equipa/);
});
test('etapa onde termina nao significa dificuldade; posteriores nao alcancadas',()=>{
 const c=setEndStage({...complete(),outcome:'refusal',reason:'no_reason'},3);
 assert.deepEqual(validateContact(c),[]);assert.equal(c.stages[2].status,'good');assert.equal(c.stages[3].status,'not_reached');
 assert.equal(setEndStage(c,null).stages[3].status,'');
 assert.ok(validateContact({...c,stages:c.stages.map((s,i)=>i===3?{...s,status:'difficulty',note:'Ignorou a necessidade apurada'}:s)}).length);
});
test('objeções, comportamentos e diagnostico precisam de factos sem justificacoes inventadas',()=>{
 const c=complete();assert.deepEqual(validateContact(c),[]);
 assert.ok(validateContact({...c,objection:'Fidelização em curso',response:'Não respondeu'}).length);
 assert.ok(validateContact({...c,outcome:'refusal',reason:'price_value',fact:'está caro'}).length);
 assert.deepEqual(validateContact({...c,outcome:'refusal',reason:'no_reason',fact:''}),[]);
 assert.ok(validateContact({...c,diagnosis:{...c.diagnosis,need:'known'}}).length);
 assert.ok(validateContact({...c,stages:c.stages.map((s,i)=>i===4?{...s,status:'difficulty',note:''}:s)}).length);
 assert.ok(validateContact({...c,outcome:'followup',followup_action:'Rever proposta',followup_at:c.occurred_at}).length);
 assert.deepEqual(validateContact({...c,effective:false,reason:'no_answer'}),[]);
});
test('anulacoes oficiais so classificam a partir de quatro TVs na mesma coorte',()=>{
 assert.equal(officialMetrics(null).available,false);assert.equal(officialMetrics({available:true,gross_tv:4,cancelled_tv:1}).available,false);
 for(let n=0;n<4;n++){const d=officialMetrics({available:true,cohort:'novembro',gross_tv:n,cancelled_tv:n?1:0});assert.equal(d.eligible,false);assert.equal(d.cancellationRate,null);}
 assert.equal(officialMetrics({available:true,cohort:'novembro',gross_tv:4,cancelled_tv:1}).cancellationRate,25);
 assert.equal(officialMetrics({available:true,cohort:'novembro',gross_tv:4,cancelled_tv:5}).available,false);assert.equal(ratio(0,0),null);
});
test('evolucao e prioridades excluem nao observadas, nao alcancadas e sem objecoes',()=>{
 assert.deepEqual(periodDates('week','2026-11-18'),{from:'2026-11-16',to:'2026-11-18'});
 assert.deepEqual(periodDates('month','2026-11-18'),{from:'2026-11-01',to:'2026-11-18'});
 assert.equal(bucketTrend([{date:'2026-11-16',effective:3},{date:'2026-11-18',effective:2}],'week')[0].effective,5);
 const p=priorities([{stage:6,good:0,difficulty:1,omitted:1,no_objections:40,not_reached:60,unobserved:12}])[0];assert.equal(p.assessed,2);assert.equal(p.issues,2);
});
test('fila sobrevive recarregamento e falhas; pedido e autor mantidos no reenvio',async()=>{
 const s=storage(),calls=[];const first=new OopJournal({storage:s,userId:'u',projectId:'p',rpc:async(n,a)=>{calls.push(a);throw new Error('offline');}});
 const id=first.enqueue('contact',{p_id:'c',p_version:0,p_data:{fact:'x'}});await first.flush();first.stop();assert.equal(s.length,1);
 const second=new OopJournal({storage:s,userId:'u',projectId:'p',rpc:async(n,a)=>calls.push(a)});assert.equal(second.items.size,1);await second.flush();second.stop();
 assert.equal(calls[0].p_request_id,id);assert.equal(calls[1].p_request_id,id);assert.equal(calls[1].p_actor_id,'u');assert.equal(s.length,0);
});
test('fila isolada por conta e projeto; conflitos nunca descartados automaticamente',async()=>{
 const s=storage(),a=new OopJournal({storage:s,userId:'a',projectId:'p',rpc:async()=>{throw new Error('Conflito de versão');}});a.enqueue('action',{p_data:{}});await a.flush();a.stop();
 const b=new OopJournal({storage:s,userId:'b',projectId:'p',rpc:async()=>assert.fail('Outra conta nao envia os rascunhos')});assert.equal(b.items.size,0);await b.flush();b.stop();
 const c=new OopJournal({storage:s,userId:'a',projectId:'other',rpc:async()=>{}});assert.equal(c.items.size,0);c.stop();assert.equal(s.length,1);
});
test('quota de armazenamento nao perde o pedido em memoria; parada trava envios',async()=>{
 const s=storage();s.setItem=()=>{throw new Error('Quota');};let calls=0;const j=new OopJournal({storage:s,userId:'a',projectId:'p',rpc:async()=>calls++});j.enqueue('void',{p_id:'x'});assert.equal(j.durable,false);assert.equal(j.items.size,1);await j.flush();assert.equal(calls,1);j.stop();await j.flush();assert.equal(calls,1);
});
test('confirmacao perdida repete a mesma chave; separadores usam exclusao mutua',async()=>{
 const s=storage();let chain=Promise.resolve(),calls=0;const locks={request:(key,fn)=>{chain=chain.then(fn);return chain;}};
 const options={storage:s,userId:'a',projectId:'p',locks,rpc:async()=>{calls++;await new Promise(r=>setTimeout(r,10));}};
 const a=new OopJournal(options);a.enqueue('contact',{});const b=new OopJournal(options);await Promise.all([a.flush(),b.flush()]);a.stop();b.stop();assert.equal(calls,1);
});
test('preview recusa defaults de producao e desativa notificacoes externas',()=>{
 assert.doesNotThrow(()=>assertSafePreview({VERCEL_ENV:'production'}));
 for(const env of [{},{SUPABASE_URL:'https://vfmncuejbfcwrzrqzqnr.supabase.co',SUPABASE_ANON_KEY:'public'},{SUPABASE_URL:'https://other.supabase.co/rest/v1/',SUPABASE_ANON_KEY:'public'}])assert.throws(()=>assertSafePreview({VERCEL_ENV:'preview',...env}),/Preview isolada/);
 const safe={VERCEL_ENV:'preview',SUPABASE_URL:'https://other.supabase.co',SUPABASE_ANON_KEY:'public'};assert.doesNotThrow(()=>assertSafePreview(safe));assert.throws(()=>assertSafePreview(safe,{notifications:true}),/desativadas/);
});
test('todas as APIs de servidor bloqueiam Preview sem base isolada antes de fazer rede',async()=>{
 const keys=['VERCEL_ENV','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','CRON_SECRET'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]])),oldFetch=globalThis.fetch;let network=0;
 try{
  process.env.VERCEL_ENV='preview';delete process.env.SUPABASE_URL;delete process.env.SUPABASE_ANON_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='dummy-test-only';process.env.CRON_SECRET='dummy-test-only-not-a-real-secret';globalThis.fetch=async()=>{network++;throw new Error('Network must not be reached');};
  for(const name of ['config','create-user','fleet-auto','fleet-share','fleet-remote','telegram-rh','telegram-anniversaries']){
   const handler=require('../api/'+name+'.js'),res={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v},end(value){this.value=value}};
   await handler({method:['config','telegram-anniversaries'].includes(name)?'GET':'POST',headers:{authorization:'Bearer '+process.env.CRON_SECRET},body:{}},res);assert.equal(res.statusCode,503,name);assert.match(String(res.value),/Preview|desativadas/);
  }
  assert.equal(network,0);
 }finally{globalThis.fetch=oldFetch;for(const key of keys)if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}
});
