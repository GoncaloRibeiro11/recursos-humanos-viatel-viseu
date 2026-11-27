(function(root){
 'use strict';
 function validateImport(data){
  if(data?.version!==1||!Array.isArray(data.rows)||!Array.isArray(data.identities))throw Error('Formato de importação inválido.');
  const keys=new Set(),ids=new Set();
  for(const i of data.identities){
   if(!/^\d{9}$/.test(i.nif)||!i.source_name||ids.has(i.nif))throw Error('Identidade inválida ou repetida.');
   ids.add(i.nif);
  }
  const fields=['records','productionVdd','productionChe','adjustments','checks'];
  for(const r of data.rows){
   const k=r.period+'|'+r.owner_nif,p=r.payload,owner='p'+r.owner_nif;
   if(!/^\d{4}-(0[1-9]|1[012])-01$/.test(r.period)||!ids.has(r.owner_nif)||!Number.isFinite(r.total)||keys.has(k))throw Error('Pagamento mensal inválido ou repetido.');
   keys.add(k);
   if(r.chief_nif!==null&&!ids.has(r.chief_nif))throw Error('Chefe de equipa sem identidade.');
   if(p?.people?.length!==1||p.people[0].id!==owner||p.people[0].total!==r.total)throw Error('O pagamento não corresponde à pessoa.');
   const rubrics=p.people[0].rubrics;
   if(!Array.isArray(rubrics)||rubrics.some(x=>!x||!Number.isFinite(x.amount)))throw Error('Cada rubrica deve ter um valor numérico válido.');
   const sum=rubrics.reduce((s,x)=>s+x.amount,0);
   if(!Number.isFinite(sum)||Math.abs(sum-r.total)>.005)throw Error('As rubricas não correspondem ao total.');
   for(const f of fields)if(!Array.isArray(p[f])||p[f].some(x=>x.owner!==owner))throw Error('O detalhe contém dados de outra pessoa.');
  }
  return data;
 }
 const detailFields=['records','productionVdd','productionChe','adjustments','checks'];
 function reportOptions(rows){
  const people=new Map(),teams=new Set();
  for(const row of rows){if(!people.has(row.owner_nif))people.set(row.owner_nif,row.source_name);if(row.chief_nif)teams.add(row.chief_nif);}
  return [...[...teams].map(key=>({id:'team:'+key,kind:'team',key,label:'Equipa '+(people.get(key)||key)})),...[...people].map(([key,label])=>({id:'person:'+key,kind:'person',key,label}))].sort((a,b)=>a.kind.localeCompare(b.kind)||a.label.localeCompare(b.label,'pt'));
 }
 function buildHistory(rows,view){
  if(!view||!['team','person'].includes(view.kind))throw Error('Relatório inválido.');
  const chosen=rows.filter(r=>view.kind==='team'?r.chief_nif===view.key:r.owner_nif===view.key),years={};
  if(!chosen.length)return null;
  const names=new Map();for(const r of chosen){names.set(r.owner_nif,r.source_name);if(r.chief_nif&&!names.has(r.chief_nif))names.set(r.chief_nif,'Chefia');}
  validateImport({version:1,identities:[...names].map(([nif,source_name])=>({nif,source_name})),rows:chosen});
  for(const row of chosen){
   const year=row.period.slice(0,4),key=String(Number(row.period.slice(5,7))),p=row.payload;
   const y=years[year]||=( {teamName:view.label,months:{},latest:key} );
   if(Number(key)>Number(y.latest))y.latest=key;
   const m=y.months[key]||=( {mode:'team',teamName:view.label,period:p.period,monthNum:Number(key),partial:false,defaultPerson:view.kind==='person'?'p'+view.key:'all',sourcePay:p.sourcePay,sourceDetail:p.sourceDetail,sourceSheet:p.sourceSheet,people:[],...Object.fromEntries(detailFields.map(f=>[f,[]]))} );
   m.partial ||= p.partial===true;m.people.push(structuredClone(p.people[0]));
   for(const field of detailFields)m[field].push(...structuredClone(p[field]));
  }
  const notice=chosen.find(r=>r.payload.personalNotice)?.payload.personalNotice||'';
  return {displayName:view.label,personal:view.kind==='person'&&!!notice,personId:view.kind==='person'?'p'+view.key:null,notice,latestYear:Object.keys(years).sort().at(-1),years};
 }
 function annualData(year,label){
  const people=new Map(),months=Object.keys(year.months).sort((a,b)=>Number(a)-Number(b)).map(k=>year.months[k]);
  for(const month of months)for(const person of month.people){
   if(!people.has(person.id))people.set(person.id,{...structuredClone(person),total:0,rubrics:[]});
   const item=people.get(person.id);item.role=person.role;item.team=person.team;item.chief=person.chief;item.total+=person.total;
   item.rubrics.push(...person.rubrics.map(r=>({...r,label:month.period+' · '+r.label})));
  }
  return {mode:'team',teamName:year.teamName,period:'Acumulado '+label,partial:false,people:[...people.values()],...Object.fromEntries(detailFields.map(f=>[f,months.flatMap(m=>m[f])]))};
 }
 function vpTotal(rows){const unique=new Map();for(const row of rows)if(Number.isFinite(row.credits))unique.set(row.period+'|'+row.line,row.credits);return unique.size?[...unique.values()].reduce((s,v)=>s+v,0):null;}
 function paymentMetrics(person){
  if(!Number.isFinite(person?.total)||!Array.isArray(person.rubrics)||person.rubrics.some(r=>!r||!Number.isFinite(r.amount)))return null;
  let cbRetention=0,paymentRetention=0;
  for(const r of person.rubrics){
   const label=String(r.label??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ');
   if(/\bretencao (?:de )?cb\b/.test(label))cbRetention+=r.amount;
   if(/\bretencao (?:de )?pagam(?:ento)?\b/.test(label))paymentRetention+=r.amount;
  }
  const afterCB=person.total-paymentRetention;
  return {afterCB,cbRetention,paymentRetention,final:person.total,beforeCB:afterCB-cbRetention};
 }
 function aggregatePayments(people){
  if(!people.length)return null;
  const metrics=people.map(paymentMetrics);if(metrics.some(m=>!m))return null;
  return Object.fromEntries(['afterCB','cbRetention','paymentRetention','final','beforeCB'].map(key=>[key,metrics.reduce((s,m)=>s+m[key],0)]));
 }
 function personalHistory(history,id){
  const years={};let name='';
  for(const [year,data] of Object.entries(history.years)){
   const months={};
   for(const [key,month] of Object.entries(data.months)){
    const p=month.people.find(p=>p.id===id);if(!p)continue;name=p.name;
    months[key]={...structuredClone(month),defaultPerson:id,people:[structuredClone(p)],...Object.fromEntries(detailFields.map(f=>[f,structuredClone(month[f].filter(r=>r.owner===id))]))};
   }
   if(Object.keys(months).length)years[year]={teamName:data.teamName,months,latest:String(Math.max(...Object.keys(months).map(Number)))};
  }
  if(!name)throw Error('Seleciona uma pessoa para exportar.');
  return {...history,displayName:name,personId:id,years,latestYear:Object.keys(years).sort().at(-1)};
 }
 root.CommissionModel={validateImport,reportOptions,buildHistory,annualData,vpTotal,personalHistory,paymentMetrics,aggregatePayments};
 if(typeof module!=='undefined')module.exports=root.CommissionModel;
})(typeof window!=='undefined'?window:globalThis);
