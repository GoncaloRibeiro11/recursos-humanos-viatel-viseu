const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const users={admin:'00000000-0000-4000-8000-000000000001',ce1:'00000000-0000-4000-8000-000000000002',ce2:'00000000-0000-4000-8000-000000000003',ce3:'00000000-0000-4000-8000-000000000004'};
const uuid=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
module.exports=async function createOopDb(options={}){
 const db=new PGlite(options.directory?{dataDir:options.directory}:undefined);
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.user',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon;`);
 await db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/schema.sql'),'utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated');
 for(const [name,id] of Object.entries(users)){
  await db.query('insert into auth.users(id) values($1)',[id]);
  await db.query('insert into user_profiles(user_id,role,person_id,display_name) values($1,$2,$3,$4)',[id,name==='admin'?'admin':'gestor',name==='admin'?null:name,name==='admin'?'Coordenação de teste':'Gestor '+name]);
 }
 for(const [id,name,role,ce] of [['ce1','Equipa Norte','chefe_equipa','ce1'],['ce2','Equipa Centro','chefe_equipa','ce2'],['ce3','Equipa Sul','chefe_equipa','ce3'],['a','Comercial Ana','vendedor','ce1'],['b','Comercial Bruno','vendedor','ce1'],['c','Comercial Carla','vendedor','ce2'],['d','Comercial Daniel','vendedor','ce3']]){
  await db.query('insert into rh_persons(id,name,role_code,chefe_id,entrada,data) values($1,$2,$3,$4,$5,$6)',[id,name,role,ce,'2020-01-01',{photo:'',telefone:'RH-PRIVADO',nascimento:'RH-PRIVADO'}]);
 }
 const install=async file=>db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/'+file),'utf8'));
 await install('20261015_team_history.sql');await install('20261118_oop.sql');
 let pending=Promise.resolve();
 const run=(user,fn,role='authenticated')=>{const job=pending.catch(()=>{}).then(async()=>{await db.exec('reset role');await db.query("select set_config('app.user',$1,false)",[users[user] || user || '']);await db.exec('set role '+role);return fn();});pending=job;return job;};
 const rpc=(user,name,input={})=>{const args={...input};if(['rh_oop_save_contact','rh_oop_save_action','rh_oop_void_contact'].includes(name) && !Object.hasOwn(args,'p_actor_id'))args.p_actor_id=users[user] || user;return run(user,async()=>(await db.query(`select public.${name}(${Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')}) as data`,Object.values(args))).rows[0].data);};
 const query=(sql,args=[])=>run('admin',async()=>(await db.query(sql,args)).rows,'postgres');
 const today=(await query("select (now() at time zone 'Europe/Lisbon')::date::text as date"))[0].date;
 const shift=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const contact=(patch={})=>({person_ref:'a',occurred_at:shift(-1)+'T12:00:00Z',effective:true,product:'both',outcome:'both',end_stage:null,reason:'',fact:'Cliente confirmou os benefícios relevantes.',objection:'',response:'',diagnosis:{service:'known',service_note:'Pacote fixo sem cobertura no anexo.',need:'known',need_note:'Cobertura Wi-Fi no anexo.',decision:'known',decision_note:'Decisor presente e sem compromisso atual.'},stages:Array.from({length:7},(_,i)=>({stage:i+1,status:i===5?'no_objections':'good',note:''})),followup_at:'',followup_action:'',...patch});
 const save=(user,n,data=contact(),version=0,request=uuid(n+10000))=>rpc(user,'rh_oop_save_contact',{p_id:uuid(n),p_version:version,p_data:data,p_request_id:request});
 return {db,users,uuid,today,shift,contact,save,rpc,query,run,install,async close(){await pending.catch(()=>{});await db.close();}};
};
