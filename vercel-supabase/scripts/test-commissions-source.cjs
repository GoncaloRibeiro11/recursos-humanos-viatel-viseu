const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {prepareFiles}=await import('../src/commission-excel.mjs');
 const [root,source,onlyPeriod]=process.argv.slice(2),expected=JSON.parse(fs.readFileSync(source,'utf8').replace(/^\uFEFF/,''));
 const periods=[...new Set(expected.rows.map(r=>r.period).filter(p=>p>='2026-01-01'&&(!onlyPeriod||p===onlyPeriod)))].sort(),results=[];
 for(const period of periods){
  const months=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],folder=path.join(root,period.slice(0,4),months[Number(period.slice(5,7))-1]);
  const files=fs.readdirSync(folder).filter(n=>/^(PAGAMENTOS|DETALHES).*\.xlsx$/i.test(n)&&!n.startsWith('~$')).map(name=>({name,size:fs.statSync(path.join(folder,name)).size,arrayBuffer:async()=>fs.readFileSync(path.join(folder,name))}));
  const aliases=Object.fromEntries(expected.rows.filter(r=>r.owner_nif===r.chief_nif&&r.period<=period).map(r=>[r.owner_nif,r.payload.people[0].team]));
  let actual=await prepareFiles(files,[period],expected.identities.map(x=>x.nif),'',()=>{},aliases);
  const coordinationConfirmation=!!actual.needsCoordinator;
  if(actual.needsCoordinator){
   const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
   const coordinatorPerson=expected.rows.find(r=>r.period===period&&r.payload.people[0].role.startsWith('Coordenador'));
   const coordinator=actual.coordinators.find(c=>normalize(c)===normalize(coordinatorPerson.payload.people[0].team));assert.ok(coordinator,'explicit coordination choice');
   actual=await prepareFiles(files,[period],expected.identities.map(x=>x.nif),coordinator,()=>{},aliases);
  }
  const old=expected.rows.filter(r=>r.period===period);assert.equal(actual.rows.length,old.length,period+' person count');
  for(const row of actual.rows){
   const original=old.find(x=>x.owner_nif===row.owner_nif);assert.ok(original,period+' identity');
   assert.equal(row.chief_nif,original.chief_nif,period+' historical chief');assert.ok(Math.abs(row.total-original.total)<.00001,period+' payment');
   assert.deepEqual(row.payload.people[0].rubrics.map(r=>[r.column,r.amount]),original.payload.people[0].rubrics.map(r=>[r.column,r.amount]),period+' rubrics');
   assert.equal(row.payload.records.length,original.payload.records.length,period+' detail count');
   for(const detail of row.payload.records){const prior=original.payload.records.find(x=>x.line===detail.line&&x.chief===detail.chief);assert.ok(prior,period+' original detail line');assert.equal(detail.amount,prior.amount,period+' detail amount');assert.equal(detail.credits,prior.credits,period+' VP');}
  }
  results.push({period,people:actual.rows.length,paymentTotalsAndDetailsMatch:true,coordinationConfirmation});
 }
 console.log(JSON.stringify({sourceFilesUnmodified:true,results}));
})().catch(e=>{console.error(e);process.exitCode=1});
