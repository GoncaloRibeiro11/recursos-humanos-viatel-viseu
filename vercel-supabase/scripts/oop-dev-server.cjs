const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const createDb=require('./oop-test-db.cjs');
const root=path.resolve(__dirname,'../public');
async function createPreview({seed=true}={}){
 const t=await createDb();
 if(seed){
  for(let i=0;i<24;i++){
   const person=i<10?'a':i<17?'b':'c',ce=person==='c'?'ce2':'ce1',at=t.shift(-1-i%8)+'T'+String(10+i%7).padStart(2,'0')+':00:00Z';
   let data=t.contact({person_ref:person,occurred_at:at});
   if(i%4===0)data={...data,outcome:'followup',followup_at:t.shift(i%3)+'T15:00:00Z',followup_action:'Retomar a proposta com o decisor presente.'};
   else if(i%3!==0){
    const ending=person==='b'?7:i%2?5:3;data={...data,outcome:'refusal',end_stage:ending,reason:i%2?'price_value':'no_reason',fact:i%2?'O cliente indicou que não reconheceu benefício adicional face ao serviço que já usa.':''};
    data.stages=data.stages.map(s=>s.stage>ending?{...s,status:'not_reached'}:s.stage===5?{...s,status:'difficulty',note:'Descreveu características sem as relacionar com a necessidade apurada.'}:s);
   }
   await t.save(ce,i+1,data);
  }
 }
 const fixture=async user=>{const stateRows=(await t.run(user,()=>t.db.query('select * from rh_persons order by id'))).rows;return `
  state={persons:${JSON.stringify(stateRows.map(p=>({id:p.id,name:p.name,role:p.role_code,chefeId:p.chefe_id,ativo:p.ativo,entrada:p.entrada,color:'#2a9dc8',photo:''})))},vacations:[],records:{}};
  currentProfile={role:${JSON.stringify(user==='admin'?'admin':'gestor')},person_id:${JSON.stringify(user==='admin'?null:user)},display_name:${JSON.stringify(user==='admin'?'Coordenação de teste':'Gestor '+user)}};
  currentUserId=${JSON.stringify(t.users[user])};supabaseProjectId='oop-local-test';supabaseReady=true;teamHistoryEnabled=false;bolsaOutcomeDismissed=true;
  const previewRpc=async(name,args={})=>{const r=await fetch('/__oop/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:${JSON.stringify(user)},name,args})});return r.json();};
  supabaseClient={rpc:previewRpc,auth:{getUser:async()=>({data:{user:{id:currentUserId}}}),getSession:async()=>({data:{session:{access_token:'local-demo'}}}),signOut:async()=>({error:null})},from(table){const q={table,user:${JSON.stringify(user)}},chain={select(){return chain},order(){return chain},range(a,b){return fetch('/__oop/rows',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...q,a,b})}).then(r=>r.json())}};return chain;}};
  document.body.classList.add('authenticated');document.body.classList.toggle('is-admin',currentProfile.role==='admin');document.getElementById('authOverlay').classList.remove('open');setAuthUi(true);
  document.body.insertAdjacentHTML('afterbegin','<aside class="oop-local-banner" style="padding:9px 16px;background:#fff4d8;color:#503a0c;font:12px system-ui;display:flex;gap:15px;flex-wrap:wrap"><strong>AMBIENTE LOCAL · DADOS FICTÍCIOS · SEM LIGAÇÃO À PRODUÇÃO</strong><a href="/oop-demo.html?as=admin">Coordenação</a><a href="/oop-demo.html?as=ce1">CE Norte</a><a href="/oop-demo.html?as=ce2">CE Centro</a><a href="/oop-demo.html?as=ce3">CE Sul</a></aside>');
  window.oopHrBefore=JSON.stringify(state);switchTab('oop');`;};
 const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
   if(req.method==='POST' && ['/__oop/rpc','/__oop/rows'].includes(u.pathname)){
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>40000)throw new Error('Pedido demasiado grande.');}const body=JSON.parse(raw);
    if(!Object.hasOwn(t.users,body.user))throw new Error('Perfil de teste inválido.');let result;
    if(u.pathname==='/__oop/rpc'){
     if(!['rh_oop_context','rh_oop_workspace','rh_oop_action_list','rh_oop_revisions','rh_oop_contact','rh_oop_action','rh_oop_save_contact','rh_oop_save_action','rh_oop_void_contact'].includes(body.name))throw new Error('Apenas o módulo OOP pode escrever nesta demonstração.');
     try{result={data:await t.rpc(body.user,body.name,body.args || {})};}catch(e){result={error:{message:e.message,code:e.code}};}
    }else{
     if(!['rh_persons','rh_vacations','rh_attendance_records','rh_assignment_history'].includes(body.table))throw new Error('Tabela não disponível na demonstração.');
     const rows=(await t.run(body.user,()=>t.db.query('select * from public.'+body.table))).rows;result={data:rows.slice(body.a,body.b+1),count:rows.length};
    }
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));
   }
   if(u.pathname.startsWith('/api/')){res.statusCode=503;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({error:'Ambiente OOP local: APIs externas desativadas.'}));}
   if(['/','/oop-demo.html','/mapa-recursos-humanos.html','/mapa-coordenacao-2026.html'].includes(u.pathname)){
    const user=Object.hasOwn(t.users,u.searchParams.get('as'))?u.searchParams.get('as'):'admin';
    const html=fs.readFileSync(path.join(root,'mapa-recursos-humanos.html'),'utf8').replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>','').replace(/^initSupabaseApp\(\);\r?$/m,await fixture(user));
    res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);
   }
   const file=path.resolve(root,decodeURIComponent(u.pathname.slice(1)));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
   res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');
   fs.readFile(file,(error,bytes)=>{if(error){res.statusCode=404;res.end();}else res.end(bytes);});
  }catch(e){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}));}
 });
 return {server,t,async close(){await new Promise(r=>server.close(r));await t.close();}};
}
if(require.main===module)(async()=>{
 const app=await createPreview();const port=Number(process.env.OOP_PORT || 9473);
 app.server.listen(port,'127.0.0.1',()=>console.log('OOP local isolado: http://127.0.0.1:'+port+'/oop-demo.html'));
 app.server.on('error',async e=>{console.error(e.message);await app.t.close();process.exitCode=1;});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={createPreview};
