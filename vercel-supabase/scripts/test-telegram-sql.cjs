const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
(async()=>{
  const db=new PGlite();
  const sql=fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261115_telegram_anniversaries.sql'),'utf8');
  const query=async(text,args=[])=>(await db.query(text,args)).rows;
  try{
    await db.exec('create role anon;create role authenticated;create role service_role;');
    await db.exec(sql);
    assert.equal((await query('select enabled from public.rh_telegram_config'))[0].enabled,false);
    const rls=await query("select relrowsecurity from pg_class where relname in ('rh_telegram_config','rh_telegram_deliveries')");assert.ok(rls.every(row=>row.relrowsecurity));
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from public.rh_telegram_config'),/permission denied/);
    await assert.rejects(db.query("select public.rh_claim_telegram_delivery('x','p','2026-11-15','work','123')"),/permission denied/);
    await db.exec('reset role');
    await db.exec("update public.rh_telegram_config set enabled=true,chat_id='123'");
    const claim=async key=>(await query("select public.rh_claim_telegram_delivery($1,'p','2026-11-15','work','123') as lease",[key]))[0].lease;
    const finish=async(key,lease,status)=>(await query('select public.rh_finish_telegram_delivery($1,$2,$3) as ok',[key,lease,status]))[0].ok;
    const first=await claim('first');assert.ok(first);assert.equal(await claim('first'),null);
    assert.equal(await finish('first',first,'sending'),true);
    assert.equal(await claim('first'),null);
    assert.equal(await finish('first',first,'sent'),true);assert.equal(await claim('first'),null);
    assert.equal(await finish('first',first,'failed'),false);
    const expired=await claim('expired');
    await db.exec("update public.rh_telegram_deliveries set lease_until=now()-interval '1 hour' where event_key='expired'");
    const replacement=await claim('expired');assert.notEqual(expired,replacement);
    assert.equal(await finish('expired',expired,'sending'),false);assert.equal(await finish('expired',replacement,'sending'),true);
    await db.exec("update public.rh_telegram_deliveries set lease_until=now()-interval '1 hour' where event_key='expired'");
    assert.equal(await claim('expired'),null,'an uncertain prior send is never automatically repeated');
    const paused=await claim('paused');await db.exec('update public.rh_telegram_config set enabled=false');
    assert.equal(await finish('paused',paused,'sending'),false);assert.equal(await claim('new'),null);
    await db.exec(sql);
    assert.equal((await query("select status from public.rh_telegram_deliveries where event_key='first'"))[0].status,'sent');
    assert.equal((await query('select enabled from public.rh_telegram_config'))[0].enabled,false);
    console.log(JSON.stringify({telegramTablesPrivate:true,rpcServiceOnly:true,duplicatePrevention:true,stalePreparationRecovered:true,uncertainSendNotRetried:true,pauseStopsPendingSend:true,reinstallKeepsState:true}));
  }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
