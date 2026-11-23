const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const createDb=require('./fleet-share-test-db.cjs');
const migration=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261123_fleet_shared_signing.sql'),'utf8');
const signature='data:image/png;base64,'+'a'.repeat(200),otherSignature='data:image/png;base64,'+'b'.repeat(200);
(async()=>{
 const t=await createDb();
 try{
  for(const name of ['20261118_fleet_external.sql','20261118_fleet_deletions.sql','20261120_fleet_signature_absence.sql','20261120_fleet_regularization.sql','20261120_fleet_signature_history.sql','20261120_fleet_giver_absence.sql'])await t.run('postgres',t.admin,()=>t.db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/'+name),'utf8')));
  const before=JSON.stringify(await t.query('select * from rh_persons order by id'));
  const legacy=await t.draft(2),legacyHash='e'.repeat(64);await t.link(legacy.id,'to',legacyHash);
  const old=await t.call('rh_fleet_read_share',[legacyHash],'service_role');
  await t.call('rh_fleet_remote_sign',[legacyHash,'Pessoa anterior',signature,old.content_hash,true],'service_role');
  await t.run('postgres',t.admin,()=>t.db.exec(migration));
  let upgraded=await t.call('rh_fleet_read_share',[legacyHash],'service_role');assert.equal(upgraded.shared_signing,true);assert.equal(upgraded.receipts.to.signer_name,'Pessoa anterior');
  await t.call('rh_fleet_remote_shared_sign',[legacyHash,'from','Quem entrega',otherSignature,upgraded.content_hash,true],'service_role');
  upgraded=await t.call('rh_fleet_read_share',[legacyHash],'service_role');assert.equal(upgraded.status,'complete');
  const migrated=JSON.stringify(await t.query('select * from rh_fleet_handovers order by id'));
  await t.run('postgres',t.admin,()=>t.db.exec(migration));assert.equal(JSON.stringify(await t.query('select * from rh_fleet_handovers order by id')),migrated);
  const expires=new Date(Date.now()+30*86400000).toISOString();
  for(const [n,order] of [[3,['from','to']],[4,['to','from']]]){
   let h=await t.draft(n),hash=String(n).repeat(64);
   await t.call('rh_fleet_create_shared_share',[h.id,true,hash,expires]);
   let read=await t.call('rh_fleet_read_share',[hash],'service_role');assert.equal(read.purpose,'editor');
   await assert.rejects(t.call('rh_fleet_remote_shared_sign',[hash,'to','Recebe',signature,'bad',true],'service_role'),/inválida/);
   read=await t.call('rh_fleet_submit_shared',[hash,read.handover.version,{notes:'Conteúdo final '+n}],'service_role');assert.equal(read.purpose,'both');
   const fingerprint=read.content_hash;
   for(const [i,role] of order.entries()){
    read=await t.call('rh_fleet_remote_shared_sign',[hash,role,'Pessoa '+role,signature,fingerprint,true],'service_role');
    assert.equal(read.receipts[role].signer_name,'Pessoa '+role);assert.equal(read.status,i?'complete':'open');
    assert.equal((await t.query('select * from rh_fleet_signature_receipts where handover_id=$1 and invalidated_at is null',[h.id])).length,i+1);
    // A retry after a lost response must not insert another receipt.
    await t.call('rh_fleet_remote_shared_sign',[hash,role,'Pessoa '+role,signature,fingerprint,true],'service_role');
    await assert.rejects(t.call('rh_fleet_remote_shared_sign',[hash,role,'Outra pessoa',otherSignature,fingerprint,true],'service_role'),/já tem uma assinatura/);
   }
   read=await t.call('rh_fleet_read_share',[hash],'service_role');assert.equal(read.status,'complete');
   assert.equal(JSON.stringify(read).includes(signature),false);assert.equal(JSON.stringify(read).includes('token_hash'),false);
   const latest=(await t.query('select * from rh_fleet_handovers where id=$1',[h.id]))[0];
   const stale={...latest.data,signatures:{},signature_receipts:{}};
   h=await t.call('rh_fleet_save_handover',[h.id,h.vehicle_id,latest.version,h.expected_custody_id,stale]);
   assert.equal(h.data.signatures.from,signature);assert.equal(h.data.signatures.to,signature);
   await assert.rejects(t.call('rh_fleet_submit_shared',[hash,h.version,{notes:'Tentativa de mudar'}],'service_role'),/conteúdo assinado/);
   const again=await t.call('rh_fleet_submit_shared',[hash,1,{notes:'Conteúdo final '+n}],'service_role');assert.equal(again.status,'complete');
   const secondHash=String(n+3).repeat(64);await t.call('rh_fleet_create_shared_share',[h.id,false,secondHash,expires]);
   assert.equal((await t.call('rh_fleet_read_share',[hash],'service_role')).status,'complete','nova ligação para a mesma versão não cancela a anterior');
   assert.equal((await t.call('rh_fleet_read_share',[secondHash],'service_role')).status,'complete');
  }
  const h=await t.draft(5),hash='a'.repeat(64);await t.call('rh_fleet_create_shared_share',[h.id,false,hash,expires]);
  const read=await t.call('rh_fleet_read_share',[hash],'service_role');
  await assert.rejects(t.call('rh_fleet_remote_shared_sign',[hash,'zone','Pessoa',signature,read.content_hash,true],'service_role'),/campo/);
  await assert.rejects(t.call('rh_fleet_remote_shared_sign',[hash,'to','Pessoa',signature,read.content_hash,false],'service_role'),/aceitação/);
  await assert.rejects(t.call('rh_fleet_remote_shared_sign',[hash,'to','Pessoa',signature,'bad',true],'service_role'),/alterado/);
  await assert.rejects(t.call('rh_fleet_create_shared_share',[h.id,false,'f'.repeat(64),expires],'authenticated',t.manager),/administrador/);
  for(const role of ['anon','authenticated'])await assert.rejects(t.call('rh_fleet_remote_shared_sign',[hash,'to','Pessoa',signature,read.content_hash,true],role),/permission denied/);
  await t.call('rh_fleet_revoke_shares',[h.id]);await assert.rejects(t.call('rh_fleet_read_share',[hash],'service_role'),/cancelada/);
  await assert.rejects(t.call('rh_fleet_remote_shared_sign',[hash,'to','Pessoa',signature,read.content_hash,true],'service_role'),/cancelada/);
  assert.equal(JSON.stringify(await t.query('select * from rh_persons order by id')),before);
  assert.equal((await t.query('select * from rh_fleet_custody')).length,0);
  console.log(JSON.stringify({bothOrders:true,sameForwardedLink:true,existingSignedLinkUpgraded:true,partialServerSave:true,idempotent:true,staleAdminPreservesBoth:true,noImageDisclosure:true,rolesAndRevocation:true,migrationRepeatSafe:true,hrAndCustodyUnchanged:true}));
 }finally{await t.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
