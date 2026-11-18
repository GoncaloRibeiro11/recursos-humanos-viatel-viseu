const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const createDb=require('./fleet-share-test-db.cjs');
(async()=>{
 const t=await createDb(),{query,call,uuid}=t;
 const install=async name=>t.run('postgres',t.admin,()=>t.db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/'+name),'utf8')));
 try{
  await install('20261117_fleet_initial_state.sql');await install('20261118_fleet_external.sql');
  const base=(await query('select * from rh_fleet_custody where vehicle_id=$1',[uuid(1)]))[0],before=(await query('select count(*)::int as n from rh_persons'))[0].n;
  const data={...t.data,kind:'return',to_person_id:'',destination:'external_structure',external_structure:'Estrutura Externa de Teste',driver_fields:{from:{name:'Entrega Teste'},to:{name:'Pessoa Externa de Teste',phone:'900 123 456'}}};
  let h=await call('rh_fleet_save_handover',[uuid(2),uuid(1),0,base.id,{...data,external_structure:''}]);
  await assert.rejects(call('rh_fleet_confirm_handover',[h.id,h.version]),/estrutura de destino/);
  for(const patch of [{external_structure:123},{driver_fields:{to:{name:['Nome externo']}}},{external_structure:'Estrutura\nTeste'}]){
   h=await call('rh_fleet_save_handover',[h.id,uuid(1),h.version,base.id,{...data,...patch}]);
   await assert.rejects(call('rh_fleet_confirm_handover',[h.id,h.version]),/estrutura de destino/);
  }
  h=await call('rh_fleet_save_handover',[h.id,uuid(1),h.version,base.id,data]);
  const prepared=await call('rh_fleet_prepare_share',[h.id]);assert.equal(prepared.payload.to_person.name,'Pessoa Externa de Teste');assert.equal(prepared.payload.to_person.structure,data.external_structure);assert.equal(prepared.payload.to_person.id,null);
  h=await call('rh_fleet_confirm_handover',[h.id,h.version]);assert.equal(h.status,'confirmed');assert.equal(h.snapshot.to_person.name,'Pessoa Externa de Teste');assert.equal(h.snapshot.to_person.structure,data.external_structure);
  assert.equal((await query('select * from rh_fleet_custody where vehicle_id=$1 and to_at is null',[uuid(1)])).length,0);
  const v=(await query('select * from rh_fleet_vehicles where id=$1',[uuid(1)]))[0];assert.equal(v.active,false);assert.equal(v.habitual_person_id,null);
  await call('rh_fleet_confirm_handover',[h.id,h.version]);assert.equal((await query('select version from rh_fleet_vehicles where id=$1',[uuid(1)]))[0].version,v.version);
  assert.equal((await query('select count(*)::int as n from rh_persons'))[0].n,before);
  await assert.rejects(call('rh_fleet_delete_unused_vehicle',[v.id,v.version,v.plate]),/autos ou histórico/);
  await call('rh_fleet_save_vehicle',[uuid(10),0,{plate:'EF-34-GH',make_model:'Teste',habitual_person_id:'b',odometer:0,active:true}]);
  await call('rh_fleet_register_initial_state',[uuid(10),1]);
  await assert.rejects(call('rh_fleet_delete_unused_vehicle',[uuid(10),2,'EF-34-GH'],'authenticated',t.manager),/administrador/);
  await assert.rejects(call('rh_fleet_delete_unused_vehicle',[uuid(10),2,'EF-34-GH'],'anon'),/permission denied/);
  await assert.rejects(call('rh_fleet_delete_unused_vehicle',[uuid(10),1,'EF-34-GH']),/mudou/);
  await assert.rejects(call('rh_fleet_delete_unused_vehicle',[uuid(10),2,'ERRADO']),/matrícula/);
  assert.equal(await call('rh_fleet_delete_unused_vehicle',[uuid(10),2,'ef-34-gh']),true);
  assert.equal((await query('select * from rh_fleet_vehicles where id=$1',[uuid(10)])).length,0);assert.equal((await query('select * from rh_fleet_custody where vehicle_id=$1',[uuid(10)])).length,0);
  await install('20261118_fleet_external.sql');assert.equal((await query('select * from rh_fleet_handovers where id=$1',[h.id]))[0].status,'confirmed');
  console.log(JSON.stringify({externalRecipientWithoutRhAccount:true,requiredDestination:true,closesCustody:true,archivesVehicle:true,immutableDocument:true,idempotentConfirmation:true,noRhChanges:true,unusedVehicleDeletionGuarded:true,adminOnly:true,historyPreventsDeletion:true}));
 }finally{await t.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
