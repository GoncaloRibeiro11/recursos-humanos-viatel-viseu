const assert=require('node:assert/strict'),createDb=require('./oop-test-db.cjs');
(async()=>{
 const t=await createDb({installOop:false});
 try{
  await t.install('20261124_commissions.sql');
  const seller=t.uuid(99),unmapped=t.uuid(98);
  await t.query('insert into auth.users(id) values($1),($2)',[seller,unmapped]);
  await t.query("insert into user_profiles(user_id,role,person_id,display_name) values($1,'vendedor','a','Seller'),($2,'vendedor','b','Unmapped')",[seller,unmapped]);
  await t.query("insert into rh_commission_identities values ('100000001','ce1','Chief 1'),('100000002','ce2','Chief 2'),('100000003','a','Seller')");
  await t.query(`insert into rh_commissions values
   ('2026-10-01','100000003','100000001','Seller',10,'{}'),
   ('2026-11-01','100000003','100000002','Seller',20,'{}'),
   ('2026-11-01','100000001','100000001','Chief 1',30,'{}'),
   ('2026-11-01','100000002','100000002','Chief 2',40,'{}')`);
  const read=user=>t.run(user,()=>t.db.query('select total from rh_commissions order by total')).then(r=>r.rows.map(x=>Number(x.total)));
  assert.deepEqual(await read('admin'),[10,20,30,40]);
  assert.deepEqual(await read('ce1'),[10,30]);
  assert.deepEqual(await read('ce2'),[20,40]);
  assert.deepEqual(await read(seller),[10,20]);
  assert.deepEqual(await read(unmapped),[]);
  await assert.rejects(t.run('',()=>t.db.query('select * from rh_commissions'),'anon'),/permission denied/);
  await assert.rejects(t.run(seller,()=>t.db.query("insert into rh_commission_identities values('100000004','b','Intruder')")),/row-level security/);
  const updated=await t.run('ce1',()=>t.db.query('update rh_commissions set total=999 returning total'));
  assert.equal(updated.rows.length,0);
  await t.query("update rh_persons set chefe_id='ce2' where id='a'");
  assert.deepEqual(await read('ce1'),[10,30]);
  assert.deepEqual(await read('ce2'),[20,40]);
  console.log('PASS: admin, own history, historical teams, unmapped accounts, anonymous access and writes');
 }finally{await t.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
