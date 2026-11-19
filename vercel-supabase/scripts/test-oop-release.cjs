const assert=require('node:assert/strict'),createDb=require('./oop-test-db.cjs');
(async()=>{
 const {releaseSql}=await import('./build-oop-release.mjs'),t=await createDb({installOop:false});
 try{
  const before=await t.query('select * from rh_persons order by id');
  await t.run('admin',()=>t.db.exec(releaseSql()),'postgres');
  assert.deepEqual(await t.query('select * from rh_persons order by id'),before);
  assert.equal((await t.rpc('admin','rh_oop_context')).people.length,4);
  assert.equal((await t.query("select row_count from rh_release_backups.oop_20261119_manifest where table_name='rh_persons'"))[0].row_count,7);
  await assert.rejects(t.run('ce1',()=>t.db.query('select * from rh_release_backups.oop_20261119_rows')),/permission denied/);
  console.log(JSON.stringify({guardedMigration:true,existingRhPreserved:true,privateSnapshot:true,rlsActive:true}));
 }finally{await t.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
