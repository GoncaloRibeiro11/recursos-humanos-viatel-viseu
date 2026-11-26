const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateImport,buildHistory,annualData,vpTotal,personalHistory,reportOptions}=require('../public/commission-model.js');
const row=()=>({period:'2026-11-01',owner_nif:'100000001',chief_nif:null,source_name:'Pessoa <teste>',total:20,payload:{period:'Novembro 2026',people:[{id:'p100000001',total:20,rubrics:[{label:'Comissão',amount:20}]}],records:[],productionVdd:[],productionChe:[],adjustments:[],checks:[]}});
const data=()=>({version:1,identities:[{nif:'100000001',source_name:'Pessoa'}],rows:[row()]});
test('public report template contains no embedded payment history or identifiers',()=>{
 const fs=require('node:fs'),path=require('node:path'),html=fs.readFileSync(path.join(__dirname,'../public/commission-report.html'),'utf8');
 assert.match(html,/<script id="report-data" type="application\/json">\{\}<\/script>/);
 assert.equal(/(?<!\d)\d{9}(?!\d)/.test(html),false);
 assert.equal(/<script[^>]*src="https?:/.test(html),false);
});
test('import rejects cross-person detail, conflicting totals and duplicate payments',()=>{
 assert.equal(validateImport(data()).rows.length,1);
 for(const field of ['records','productionVdd','productionChe','adjustments','checks']){
  const d=data();d.rows[0].payload[field].push({owner:'p999999999'});assert.throws(()=>validateImport(d),/outra pessoa/);
 }
 const a=data();a.rows[0].total=99;assert.throws(()=>validateImport(a));
 const b=data();b.rows.push(row());assert.throws(()=>validateImport(b),/repetido/);
});
test('VP deduplicates original lines and preserves negative, zero and missing credits',()=>{
 const base={period:'Novembro 2026'};
 assert.equal(vpTotal([{...base,line:1,credits:2},{...base,line:1,credits:2},{...base,line:2,credits:-.5}]),1.5);
 assert.equal(vpTotal([{...base,line:1,credits:0}]),0);assert.equal(vpTotal([{...base,line:1}]),null);
});
test('history follows the monthly chief and annual totals never count production twice',()=>{
 const a=row();a.chief_nif='100000010';a.payload.people[0].name='Comercial';a.payload.people[0].team='Equipa antiga';a.payload.productionVdd=[{owner:'p100000001',metrics:[{label:'Indicador',value:999}]}];
 const b=structuredClone(a);b.period='2026-12-01';b.chief_nif='100000011';b.payload.period='Dezembro 2026';b.payload.people[0].team='Equipa nova';
 const before=JSON.stringify([a,b]);const history=buildHistory([a,b],{kind:'person',key:a.owner_nif,label:'Comercial'});
 assert.equal(annualData(history.years['2026'],'2026').people[0].total,40);
 assert.equal(history.years['2026'].months['11'].people[0].team,'Equipa antiga');assert.equal(history.years['2026'].months['12'].people[0].team,'Equipa nova');
 const old=buildHistory([a,b],{kind:'team',key:a.chief_nif,label:'Antiga'});assert.deepEqual(Object.keys(old.years['2026'].months),['11']);assert.equal(JSON.stringify([a,b]),before);
 assert.equal(buildHistory([a],{kind:'person',key:'999999999',label:'Sem acesso'}),null);assert.equal(reportOptions([a,b]).filter(v=>v.kind==='team').length,2);
});
test('personal export retains only the chosen person in every year and every detail array',()=>{
 const a=row(),b=row();b.owner_nif='100000002';b.payload.people[0]={...b.payload.people[0],id:'p100000002',name:'Outra pessoa'};a.payload.people[0].name='Pessoa escolhida';
 const h=buildHistory([a,b],{kind:'team',key:null,label:'Equipa'});h.years['2026'].annual=annualData(h.years['2026'],'2026');const one=personalHistory(h,'p100000001');
 for(const year of Object.values(one.years))for(const m of Object.values(year.months)){assert.equal(m.people.length,1);assert.equal(m.people[0].id,'p100000001');}
 assert.equal(JSON.stringify(one).includes('Outra pessoa'),false);assert.throws(()=>personalHistory(h,'p999999999'),/Seleciona/);
});
test('rubrics require finite numeric amounts before totals are compared',()=>{
 for(const amount of [undefined,null,'20','',NaN,Infinity,-Infinity]){
  const d=data();d.rows[0].payload.people[0].rubrics=[{label:'Comissão',amount}];assert.throws(()=>validateImport(d),/numérico/);
 }
 const missing=data();missing.rows[0].payload.people[0].rubrics=[{label:'Sem valor'}];assert.throws(()=>validateImport(missing),/numérico/);
 const empty=data();empty.rows[0].payload.people[0].rubrics=[null];assert.throws(()=>validateImport(empty),/numérico/);
 const overflow=data();overflow.rows[0].payload.people[0].rubrics=[{amount:Number.MAX_VALUE},{amount:Number.MAX_VALUE}];assert.throws(()=>validateImport(overflow),/total/);
 const valid=data();valid.rows[0].payload.people[0].rubrics=[{label:'Positivo',amount:25},{label:'Acerto',amount:-5},{label:'Zero',amount:0}];assert.equal(validateImport(valid),valid);
 const decimals=data();decimals.rows[0].payload.people[0].rubrics=[{amount:19.9},{amount:.1}];assert.equal(validateImport(decimals),decimals);
});
