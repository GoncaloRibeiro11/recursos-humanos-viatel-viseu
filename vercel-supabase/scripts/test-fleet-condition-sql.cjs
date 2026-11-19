const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),createDb=require('./fleet-share-test-db.cjs');
(async()=>{
 const t=await createDb(),migration=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261119_fleet_condition.sql'),'utf8');
 try{
  await t.query("update rh_fleet_vehicles set inspection_until='2028-01-15',transport_until='2027-03-01' where id=$1",[t.uuid(1)]);
  const old=(await t.query('select * from rh_fleet_vehicles'))[0];
  const draft=await t.draft(10),signedBefore=await t.call('rh_fleet_sign_payload',[draft.id],'postgres');
  await t.run('postgres',t.admin,()=>t.db.exec(migration));
  assert.equal((await t.query('select vehicle_condition from rh_fleet_vehicles'))[0].vehicle_condition,null);
  assert.deepEqual(await t.call('rh_fleet_sign_payload',[draft.id],'postgres'),signedBefore,'migration cannot change pending signature content');
  const save=(id,version,patch)=>t.call('rh_fleet_save_vehicle',[id,version,patch]);
  let row=await save(old.id,old.version,{...old,vehicle_condition:'new'});assert.equal(row.vehicle_condition,'new');
  const payload={plate:row.plate,make_model:row.make_model,cartrack_number:row.cartrack_number,odometer:row.odometer,habitual_person_id:row.habitual_person_id,active:true};
  row=await save(row.id,row.version,{...payload,vehicle_condition:'recent'});assert.equal(row.vehicle_condition,'recent');assert.equal(row.inspection_until,'2028-01-15');assert.equal(row.transport_until,'2027-03-01');
  row=await save(row.id,row.version,payload);assert.equal(row.vehicle_condition,'recent','old clients preserve the saved condition');
  await assert.rejects(save(row.id,row.version,{...payload,vehicle_condition:'bad'}),/estado/);
  await assert.rejects(save(row.id,row.version,{...payload,vehicle_condition:null}),/estado/);
  await assert.rejects(save(row.id,row.version-1,{...payload,vehicle_condition:'used'}),/mudou/);
  for(const [n,state] of [[50,'new'],[51,'recent'],[52,'used']]){const v=await save(t.uuid(n),0,{plate:'TT-'+n+'-TT',make_model:'Modelo ficticio',vehicle_condition:state});assert.equal(v.inspection_until,null);assert.equal(v.vehicle_condition,state);}
  await assert.rejects(t.call('rh_fleet_save_vehicle',[row.id,row.version,payload],'authenticated',t.manager),/administrador/);
  await assert.rejects(t.run('authenticated',t.admin,()=>t.db.query('select * from rh_release_backups.fleet_condition_20261119')),/permission denied/);
  const before=await t.query('select * from rh_fleet_vehicles order by id');await t.run('postgres',t.admin,()=>t.db.exec(migration));assert.deepEqual(await t.query('select * from rh_fleet_vehicles order by id'),before);
  console.log(JSON.stringify({classificationPersisted:true,newAndRecentWithoutDate:true,legacyDatesPreserved:true,signaturePayloadPreserved:true,staleVersionRejected:true,adminOnly:true,privateBackup:true,reinstallSafe:true}));
 }finally{await t.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
