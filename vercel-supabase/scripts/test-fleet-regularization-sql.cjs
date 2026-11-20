const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),createDb=require('./fleet-share-test-db.cjs');
(async()=>{
 const t=await createDb(),migration=file=>fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations',file),'utf8');
 try{
  for(const file of ['20261117_fleet_initial_state.sql','20261118_fleet_external.sql','20261118_fleet_deletions.sql','20261120_fleet_signature_absence.sql','20261120_fleet_regularization.sql'])await t.run('postgres',t.admin,()=>t.db.exec(migration(file)));
  const holder=(await t.query('select * from rh_fleet_custody where to_at is null'))[0],before=JSON.stringify(holder);
  let h=await t.call('rh_fleet_save_handover',[t.uuid(2),t.uuid(1),0,holder.id,{...t.data}]);
  await assert.rejects(t.call('rh_fleet_confirm_handover',[h.id,h.version]),/já tem um responsável/);
  h=await t.call('rh_fleet_save_handover',[h.id,h.vehicle_id,h.version,holder.id,{...h.data,purpose:'regularization',to_person_id:'b'}]);
  await assert.rejects(t.call('rh_fleet_confirm_handover',[h.id,h.version]),/manter o responsável/);
  h=await t.call('rh_fleet_save_handover',[h.id,h.vehicle_id,h.version,holder.id,{...h.data,to_person_id:'a'}]);
  const link=await t.link(h.id,'from','2'.repeat(64));await t.link(h.id,'to','3'.repeat(64));
  const signature='data:image/png;base64,'+'A'.repeat(160);
  for(const hash of ['2','3'])await t.call('rh_fleet_remote_sign',[hash.repeat(64),'Assinante teste',signature,link.content_hash,true],'service_role');
  h=(await t.call('rh_fleet_share_status',[h.id])).handover;
  await assert.rejects(t.call('rh_fleet_confirm_handover',[h.id,h.version],'authenticated',t.manager),/administrador/);
  h=await t.call('rh_fleet_confirm_handover',[h.id,h.version]);assert.equal(h.status,'confirmed');assert.equal(h.snapshot.operation.purpose,'regularization');
  assert.equal(JSON.stringify((await t.query('select * from rh_fleet_custody where id=$1',[holder.id]))[0]),before);
  assert.equal((await t.query('select * from rh_fleet_custody')).length,1);assert.equal((await t.query('select odometer from rh_fleet_vehicles'))[0].odometer,120);
  const after=JSON.stringify(await t.query('select * from rh_fleet_handovers'));await t.run('postgres',t.admin,()=>t.db.exec(migration('20261120_fleet_regularization.sql')));assert.equal(JSON.stringify(await t.query('select * from rh_fleet_handovers')),after);
  await t.call('rh_fleet_delete_handover',[h.id,h.version,'FRO-'+String(h.number).padStart(5,'0'),true]);
  assert.equal(JSON.stringify((await t.query('select * from rh_fleet_custody where id=$1',[holder.id]))[0]),before);assert.equal((await t.query('select odometer from rh_fleet_vehicles'))[0].odometer,100);
  let transfer=await t.call('rh_fleet_save_handover',[t.uuid(3),t.uuid(1),0,holder.id,{...t.data,kind:'temporary',to_person_id:'b',expected_return:new Date(Date.now()+86400000).toISOString()}]);
  transfer=await t.call('rh_fleet_confirm_handover',[transfer.id,transfer.version]);
  const known=(await t.query('select * from rh_fleet_custody where to_at is null'))[0],knownBefore=JSON.stringify(known);
  let check=await t.call('rh_fleet_save_handover',[t.uuid(4),t.uuid(1),0,known.id,{...t.data,purpose:'regularization',to_person_id:'b',at:new Date(+new Date(t.data.at)+60000).toISOString()}]);
  check=await t.call('rh_fleet_confirm_handover',[check.id,check.version]);assert.equal(check.status,'confirmed');
  assert.equal(JSON.stringify((await t.query('select * from rh_fleet_custody where id=$1',[known.id]))[0]),knownBefore);assert.equal((await t.query('select habitual_person_id from rh_fleet_vehicles'))[0].habitual_person_id,'a');
  await t.call('rh_fleet_save_vehicle',[t.uuid(99),0,{plate:'ZZ-00-ZZ',make_model:'Sem utilizador',odometer:0,active:true}]);
  const empty=await t.call('rh_fleet_save_handover',[t.uuid(5),t.uuid(99),0,null,{...t.data,purpose:'regularization'}]);await assert.rejects(t.call('rh_fleet_confirm_handover',[empty.id,empty.version]),/manter o responsável/);
  console.log(JSON.stringify({sameHolder:true,noCustodyChange:true,unknownStartPreserved:true,adminOnly:true,bothSignatures:true,wrongRecipientRejected:true,originalGuardPreserved:true,idempotentMigration:true,testDeletionKeepsHistory:true}));
 }finally{await t.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
