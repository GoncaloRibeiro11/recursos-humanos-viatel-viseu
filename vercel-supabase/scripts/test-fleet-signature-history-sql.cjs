const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),createDb=require('./fleet-share-test-db.cjs');
(async()=>{
 const t=await createDb(),load=file=>t.run('postgres',t.admin,()=>t.db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations',file),'utf8'))),service=(n,a)=>t.call(n,a,'service_role');
 const signature='data:image/png;base64,'+'A'.repeat(160);
 try{
  for(const file of ['20261117_fleet_initial_state.sql','20261118_fleet_external.sql','20261118_fleet_deletions.sql','20261120_fleet_signature_absence.sql','20261120_fleet_regularization.sql'])await load(file);
  const holder=(await t.query('select * from rh_fleet_custody where to_at is null'))[0];
  let h=await t.call('rh_fleet_save_handover',[t.uuid(2),t.uuid(1),0,holder.id,{...t.data,driver_fields:{from:{name:'Gestor A'},to:{name:'Gestor A'}}}]);
  const first=await t.link(h.id,'to','1'.repeat(64));await service('rh_fleet_remote_sign',['1'.repeat(64),'Gestor A',signature,first.content_hash,true]);
  h=(await t.call('rh_fleet_share_status',[h.id])).handover;
  await load('20261120_fleet_signature_history.sql');
  assert.equal((await t.query('select * from rh_fleet_signature_archive'))[0].signature,signature,'installation seeds existing signatures');
  const oldReceipt=h.data.signature_receipts.to.id;
  h=await t.call('rh_fleet_save_handover',[h.id,h.vehicle_id,h.version,holder.id,{...h.data,purpose:'regularization',notes:'Nova versão'}]);
  assert.deepEqual(h.data.signatures,{});assert.equal((await t.query('select * from rh_fleet_signature_archive')).length,1);
  const next=await t.link(h.id,'to','2'.repeat(64));
  const read=await service('rh_fleet_read_share',['2'.repeat(64)]);assert.equal(read.previous_signature.id,oldReceipt);assert.equal(read.previous_signature.signature,undefined);assert.equal(read.payload.operation.signatures,undefined);
  await assert.rejects(t.call('rh_fleet_remote_reconfirm',['2'.repeat(64),oldReceipt,'Gestor A',next.content_hash,true]),/permission denied/);
  await assert.rejects(service('rh_fleet_remote_reconfirm',['2'.repeat(64),oldReceipt,'Gestor A',next.content_hash,false]),/aceitas/);
  await assert.rejects(service('rh_fleet_remote_reconfirm',['2'.repeat(64),oldReceipt,'Outra pessoa',next.content_hash,true]),/não corresponde/);
  await assert.rejects(service('rh_fleet_remote_reconfirm',['2'.repeat(64),t.uuid(999),'Gestor A',next.content_hash,true]),/não corresponde/);
  await assert.rejects(service('rh_fleet_remote_reconfirm',['2'.repeat(64),oldReceipt,'Gestor A','wrong',true]),/alterado/);
  const result=await service('rh_fleet_remote_reconfirm',['2'.repeat(64),oldReceipt,'Gestor A',next.content_hash,true]);assert.equal(result.status,'signed');
  assert.deepEqual(await service('rh_fleet_remote_reconfirm',['2'.repeat(64),oldReceipt,'Gestor A',next.content_hash,true]),result);
  let status=await t.call('rh_fleet_share_status',[h.id]);h=status.handover;assert.equal(status.signature_history.length,2);
  assert.equal(h.data.signatures.to,signature);assert.equal(h.data.signature_receipts.to.method,'screen_reconfirmed');assert.equal(h.data.signature_receipts.to.previous_receipt_id,oldReceipt);assert.equal(h.data.signature_receipts.to.content_hash,next.content_hash);
  assert.equal((await t.query('select * from rh_fleet_signature_archive where receipt_id=$1',[oldReceipt]))[0].content_hash,first.content_hash);
  await t.run('authenticated',t.manager,async()=>assert.equal((await t.db.query('select * from rh_fleet_signature_archive')).rows.length,0));
  await assert.rejects(t.run('authenticated',t.admin,()=>t.db.query('update rh_fleet_signature_archive set signer_name=$1',['forged'])),/permission denied/);
  // A different recipient cannot be offered the previous recipient's signature.
  h=await t.call('rh_fleet_save_handover',[h.id,h.vehicle_id,h.version,holder.id,{...h.data,to_person_id:'b',driver_fields:{...h.data.driver_fields,to:{name:'Colaborador B'}}}]);
  const other=await t.link(h.id,'to','3'.repeat(64));assert.equal((await service('rh_fleet_read_share',['3'.repeat(64)])).previous_signature,undefined);
  await assert.rejects(service('rh_fleet_remote_reconfirm',['3'.repeat(64),oldReceipt,'Gestor A',other.content_hash,true]),/não corresponde/);
  await t.link(h.id,'from','4'.repeat(64));assert.equal((await service('rh_fleet_read_share',['4'.repeat(64)])).previous_signature,undefined);
  const before=JSON.stringify(await t.query('select * from rh_fleet_signature_archive'));await load('20261120_fleet_signature_history.sql');assert.equal(JSON.stringify(await t.query('select * from rh_fleet_signature_archive')),before);
  h=(await t.call('rh_fleet_share_status',[h.id])).handover;await t.call('rh_fleet_delete_handover',[h.id,h.version,'FRO-'+String(h.number).padStart(5,'0'),true]);
  assert.equal((await t.query('select * from rh_fleet_signature_archive')).length,0);assert.equal((await t.query('select data from rh_fleet_deletion_backups where id=$1',[h.id]))[0].data.signature_history.length,2);
  console.log(JSON.stringify({historicalDrawingPreserved:true,existingSignaturesSeeded:true,newConsentRequired:true,newHashAndReceipt:true,noCrossPersonOrRole:true,imagesNotExposedToToken:true,privateHistory:true,idempotentRetry:true,idempotentInstall:true,testDeletionBacksUpHistory:true}));
 }finally{await t.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
