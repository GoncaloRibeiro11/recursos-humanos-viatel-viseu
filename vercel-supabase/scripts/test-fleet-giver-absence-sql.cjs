const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),createDb=require('./fleet-share-test-db.cjs');
(async()=>{
 const t=await createDb(),migration=file=>fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations',file),'utf8');
 const reason='Quem entrega está noutra estrutura; assinatura não recolhida à distância.',signature='data:image/png;base64,'+'A'.repeat(160);
 try{
  for(const file of ['20261117_fleet_initial_state.sql','20261118_fleet_external.sql','20261118_fleet_deletions.sql','20261120_fleet_signature_absence.sql','20261120_fleet_regularization.sql','20261120_fleet_signature_history.sql'])await t.run('postgres',t.admin,()=>t.db.exec(migration(file)));
  const holder=(await t.query('select * from rh_fleet_custody where to_at is null'))[0],custody=JSON.stringify(await t.query('select * from rh_fleet_custody'));
  let h=await t.call('rh_fleet_save_handover',[t.uuid(2),t.uuid(1),0,holder.id,{...t.data,purpose:'regularization'}]);
  await t.query('insert into storage.objects(bucket_id,name) values($1,$2)',['rh-fleet',h.id+'/photo.jpg']);
  const to=await t.link(h.id,'to','2'.repeat(64));
  await t.call('rh_fleet_remote_sign',['2'.repeat(64),'Recebe teste',signature,to.content_hash,true],'service_role');
  h=(await t.call('rh_fleet_share_status',[h.id])).handover;
  const before=JSON.stringify(await t.query('select * from rh_fleet_handovers')),receipts=JSON.stringify(await t.query('select * from rh_fleet_signature_receipts'));
  await t.run('postgres',t.admin,()=>t.db.exec(migration('20261120_fleet_giver_absence.sql')));
  assert.equal(JSON.stringify(await t.query('select * from rh_fleet_handovers')),before);
  for(const [role,user] of [['anon',t.admin],['authenticated',t.manager]])await assert.rejects(t.call('rh_fleet_confirm_with_absences',[h.id,h.version,{from:reason}],role,user),/administrador|permission denied/);
  for(const value of [null,[],{zone:reason},{from:null},{from:'NA'},{from:'x'.repeat(501)},{from:'linha\nseguinte'}])await assert.rejects(t.call('rh_fleet_confirm_with_absences',[h.id,h.version,value]));
  await t.query('delete from storage.objects where name=$1',[h.id+'/photo.jpg']);await assert.rejects(t.call('rh_fleet_confirm_with_absences',[h.id,h.version,{from:reason}]),/fotografia/);
  await t.query('insert into storage.objects(bucket_id,name) values($1,$2)',['rh-fleet',h.id+'/photo.jpg']);
  await assert.rejects(t.call('rh_fleet_confirm_handover',[h.id,h.version]),/Faltam/);
  await assert.rejects(t.call('rh_fleet_confirm_with_absences',[h.id,h.version,{from:reason,to:reason}]),/já assinou/);
  await assert.rejects(t.call('rh_fleet_confirm_with_absences',[h.id,h.version-1,{from:reason}]),/mudou/);
  const data=JSON.stringify(h.data);
  h=await t.call('rh_fleet_confirm_with_absences',[h.id,h.version,{from:reason}]);
  assert.equal(h.status,'confirmed');assert.equal(JSON.stringify(h.data),data);assert.equal(h.snapshot.operation.signatures.to,signature);
  assert.equal(h.snapshot.signature_absences.from.reason,reason);assert.equal(h.snapshot.signature_absences.from.recorded_by,t.admin);assert.equal(h.snapshot.signature_absences.from.content_hash,to.content_hash);
  assert.equal(h.snapshot.signature_absences.to,undefined);assert.equal(h.snapshot.operation.signature_receipts.from,undefined);
  assert.equal(JSON.stringify(await t.query('select * from rh_fleet_custody')),custody);
  assert.equal(JSON.stringify(await t.query('select * from rh_fleet_signature_receipts')),receipts);
  assert.equal((await t.call('rh_fleet_confirm_with_absences',[h.id,h.version,{from:reason}])).version,h.version);
  const after=JSON.stringify(await t.query('select * from rh_fleet_handovers'));
  await t.run('postgres',t.admin,()=>t.db.exec(migration('20261120_fleet_giver_absence.sql')));assert.equal(JSON.stringify(await t.query('select * from rh_fleet_handovers')),after);
  console.log(JSON.stringify({adminOnly:true,reasonRequired:true,photosRequired:true,existingRecipientPreserved:true,noFakeGiverSignature:true,noCustodyChange:true,installDoesNotEditAutos:true,idempotent:true}));
 }finally{await t.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
