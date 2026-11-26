const assert=require('node:assert/strict'),createDb=require('./oop-test-db.cjs');
(async()=>{
 const t=await createDb({installOop:false});
 try{
  await t.install('20261124_commissions.sql');
  await t.install('20261126_commissions_permissions.sql');
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
  const restrictedCe=t.uuid(97);await t.query('insert into auth.users(id) values($1)',[restrictedCe]);
  await t.query("insert into user_profiles(user_id,role,person_id,display_name) values($1,'vendedor','ce1','Commission-only chief')",[restrictedCe]);
  await t.query("insert into rh_vacations(id,person_id,start_date,end_date,note) values('private-a','b','2026-11-02','2026-11-03','Private fiction'),('private-ce','ce1','2026-11-04','2026-11-05','Own private fiction')");
  await t.query("insert into rh_attendance_records(person_id,record_date,code) values('ce1','2026-11-02','P'),('b','2026-11-02','P')");
  const rhTables=['rh_persons','rh_assignment_history','rh_vacations','rh_attendance_records'];
  for(const user of [seller,restrictedCe,unmapped]){
   for(const table of rhTables)assert.equal((await t.run(user,()=>t.db.query('select * from '+table))).rows.length,0,user+' must not read '+table);
   await assert.rejects(t.run(user,()=>t.db.query('select * from rh_visible_vacations()')),/apenas consultar comissões/);
   await assert.rejects(t.run(user,()=>t.db.query('select * from rh_visible_vacations_before_commissions()')),/permission denied/);
  }
  assert.deepEqual(await read(restrictedCe),[30],'commission-only chief keeps only personal commissions');
  const before=JSON.stringify(await t.query('select * from rh_commissions order by period,owner_nif'));
  assert.ok((await t.run('ce1',()=>t.db.query('select * from rh_assignment_history'))).rows.some(r=>r.person_id==='b'));
  assert.deepEqual((await t.run('ce1',()=>t.db.query('select id from rh_visible_vacations() order by id'))).rows.map(r=>r.id.split('@')[0]),['private-a','private-ce']);
  assert.equal((await t.run('ce2',()=>t.db.query('select * from rh_visible_vacations()'))).rows.length,0);
  assert.equal((await t.run('admin',()=>t.db.query('select * from rh_visible_vacations()'))).rows.length,2);
  await t.run('admin',()=>t.install('20261126_commissions_permissions.sql'),'postgres');
  assert.equal(JSON.stringify(await t.query('select * from rh_commissions order by period,owner_nif')),before,'migration does not change payments');
  assert.deepEqual(await read(seller),[10,20]);assert.deepEqual(await read('ce1'),[10,30]);
  console.log('PASS: commission isolation, vendor denied all RH tables and vacation RPCs, chief-linked vendor denied team data, manager/admin access preserved, migration idempotent and payments unchanged');
 }finally{await t.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
