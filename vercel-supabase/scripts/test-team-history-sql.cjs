const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  const admin = '00000000-0000-4000-8000-000000000001';
  const old = '00000000-0000-4000-8000-000000000002';
  const next = '00000000-0000-4000-8000-000000000003';
  const other = '00000000-0000-4000-8000-000000000004';
  const request = '00000000-0000-4000-8000-000000000100';
  const queryAs = async (user, sql, params = []) => {
    await db.exec('set role authenticated');
    await db.query("select set_config('test.uid',$1,false)", [user]);
    try { return await db.query(sql,params); }
    finally { await db.exec('reset role'); await db.query("select set_config('test.uid','',false)"); }
  };
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid; $$;
      grant usage on schema public,auth to authenticated,anon;`);
    const base = fs.readFileSync(path.resolve(__dirname,'../../supabase/schema.sql'),'utf8').replace('create extension if not exists pgcrypto;','');
    await db.exec(base);
    await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated');
    for (const uid of [admin,old,next,other]) await db.query('insert into auth.users(id) values($1)',[uid]);
    for (const [uid,role,id] of [[admin,'admin',null],[old,'gestor','old'],[next,'gestor','next'],[other,'gestor','other']]){
      await db.query('insert into public.user_profiles(user_id,role,person_id) values($1,$2,$3)',[uid,role,id]);
    }
    for (const id of ['old','next','a','b','c','other']){
      const manager = ['old','other'].includes(id);
      await db.query(`insert into public.rh_persons(id,name,role_code,chefe_id,entrada,data)
        values($1,$2,$3,$4,'2020-01-01',$5)`,[id,'Person '+id,manager?'chefe_equipa':'vendedor',manager?id:'old',{ photo:'',color:'#0284c7',telefone:'private',nascimento:'private' }]);
    }
    const today = (await db.query("select (now() at time zone 'Europe/Lisbon')::date::text as value")).rows[0].value;
    const shift = days => { const date = new Date(today+'T12:00:00Z'); date.setUTCDate(date.getUTCDate()+days); return date.toISOString().slice(0,10); };
    const before = shift(-1), after = shift(1);
    for (const id of ['next','a','b','c']) for (const date of [before,today,after]){
      await db.query("insert into public.rh_attendance_records(person_id,record_date,code) values($1,$2,'P')",[id,date]);
    }
    await db.query(`insert into public.rh_vacations(id,person_id,start_date,end_date,data)
      values('spanning','a',$1,$2,$3)`,[before,after,{ start:before,end:after,private:'not for the other team' }]);
    const records = (await db.query('select * from public.rh_attendance_records order by person_id,record_date')).rows;
    const migration = fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261015_team_history.sql'),'utf8');
    await db.exec(migration);
    assert.equal((await db.query("select count(*)::int as n from public.rh_assignment_history")).rows[0].n,6);
    assert.equal((await db.query("select role_code from public.rh_persons where id='next'")).rows[0].role_code,'vendedor');
    const changes = ['next','a','b','c'].map(id => ({ personId:id,fromRole:'vendedor',fromChefeId:'old',toRole:id==='next'?'chefe_equipa':'vendedor',toChefeId:'next' }));
    const apply = (user,date,body=changes,id=request) => queryAs(user,'select public.apply_rh_team_transition($1,$2,$3) as value',[id,date,body]);
    await assert.rejects(apply(other,today),/Apenas admin/);
    await assert.rejects(apply(admin,null),/Falta confirmar/);
    await assert.rejects(apply(admin,after),/ainda nao chegou/);
    await assert.rejects(apply(admin,today,changes.map((change,i)=>i===2?{...change,fromChefeId:'changed'}:change)),/equipa ou funcao mudou/);
    assert.equal((await db.query("select count(*)::int as n from public.rh_assignment_history")).rows[0].n,6);
    assert.equal((await db.query("select chefe_id from public.rh_persons where id='a'")).rows[0].chefe_id,'old');
    const result = await apply(admin,today);
    assert.equal(result.rows[0].value.count,4);
    assert.equal((await db.query("select count(*)::int as n from public.rh_assignment_history")).rows[0].n,10);
    assert.equal((await apply(admin,today)).rows[0].value.alreadyApplied,true);
    await db.exec("alter table public.rh_persons add constraint test_batch_failure check(id<>'b' or chefe_id<>'old') not valid");
    const reverse=changes.map(change=>({...change,fromRole:change.toRole,fromChefeId:'next',toRole:'vendedor',toChefeId:'old'}));
    await assert.rejects(apply(admin,today,reverse,'00000000-0000-4000-8000-000000000102'),/test_batch_failure/);
    assert.equal((await db.query("select chefe_id from public.rh_persons where id='a'")).rows[0].chefe_id,'next');
    assert.equal((await db.query("select role_code from public.rh_persons where id='next'")).rows[0].role_code,'chefe_equipa');
    assert.equal((await db.query("select count(*)::int as n from public.rh_assignment_history")).rows[0].n,10);
    assert.equal((await db.query("select count(*)::int as n from public.rh_team_transition_runs")).rows[0].n,1);
    await db.exec('alter table public.rh_persons drop constraint test_batch_failure');
    await assert.rejects(apply(admin,before),/dados diferentes/);
    await assert.rejects(apply(admin,before,changes.map(change=>({...change,fromRole:change.toRole,fromChefeId:'next'})),'00000000-0000-4000-8000-000000000101'),/alteracao posterior/);
    assert.deepEqual((await db.query('select * from public.rh_attendance_records order by person_id,record_date')).rows,records);
    const previousRows = (await queryAs(old,"select person_id,record_date::text from public.rh_attendance_records where person_id in ('a','b','c') order by person_id,record_date")).rows;
    assert.equal(previousRows.length,3);
    assert.ok(previousRows.every(row=>row.record_date===before));
    const nextRows = (await queryAs(next,"select person_id,record_date::text from public.rh_attendance_records where person_id in ('a','b','c')")).rows;
    assert.equal(nextRows.length,6);
    assert.ok(nextRows.every(row=>row.record_date>=today));
    assert.equal((await queryAs(other,'select * from public.rh_attendance_records')).rows.length,0);
    assert.equal((await queryAs(old,"select * from public.rh_persons where id='a'")).rows.length,0,'old manager cannot fetch the new current personal profile');
    const history = (await queryAs(old,"select * from public.rh_assignment_history where person_id='a'")).rows;
    assert.equal(history.length,1);
    assert.equal(history[0].chefe_id,'old');
    assert.equal(history[0].person_snapshot.telefone,undefined);
    assert.equal(history[0].person_snapshot.nascimento,undefined);
    assert.equal((await queryAs(next,"select * from public.rh_assignment_history where person_id='a'")).rows.length,1);
    assert.equal((await queryAs(old,"select * from public.rh_vacations where id='spanning'")).rows.length,0);
    assert.equal((await queryAs(next,"select * from public.rh_vacations where id='spanning'")).rows.length,0);
    const oldVacation = (await queryAs(old,'select start_date::text,end_date::text,data from public.rh_visible_vacations()')).rows;
    const nextVacation = (await queryAs(next,'select start_date::text,end_date::text,data from public.rh_visible_vacations()')).rows;
    assert.equal(oldVacation.length,1); assert.equal(nextVacation.length,1);
    assert.equal(oldVacation[0].end_date,before);
    assert.equal(nextVacation[0].start_date,today);
    assert.equal(oldVacation[0].data.end,before);
    assert.equal(nextVacation[0].data.start,today);
    assert.equal(nextVacation[0].data.private,undefined);
    assert.equal((await queryAs(other,'select * from public.rh_visible_vacations()')).rows.length,0);
    await assert.rejects(queryAs(admin,'delete from public.rh_assignment_history'),/permission denied/);
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.rh_team_history_version()'),/permission denied/);
    await db.exec('reset role');
    const stable = (await db.query('select * from public.rh_assignment_history order by person_id,valid_from')).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from public.rh_assignment_history order by person_id,valid_from')).rows,stable,'reinstalling cannot reset the existing history');
    console.log(JSON.stringify({ baselineDoesNotTransfer:true, noFutureActivation:true, adminOnly:true, atomicBatch:true, stalePlanRejected:true, idempotent:true, oldManagerBeforeOnly:true, newManagerAfterOnly:true, vacationsClipped:true, currentPrivateProfileProtected:true, allAttendanceUntouched:true, historyCannotBeOverwritten:true, reinstallPreservesHistory:true },null,2));
  } finally { await db.close(); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
