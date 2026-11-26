const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {validateImport}=require('../public/commission-model.js');
const row=()=>({period:'2026-11-01',owner_nif:'100000001',chief_nif:null,source_name:'Pessoa <teste>',total:20,payload:{period:'Novembro 2026',people:[{id:'p100000001',total:20,rubrics:[{label:'Comissão',amount:20}]}],records:[],productionVdd:[],productionChe:[],adjustments:[],checks:[]}});
const data=()=>({version:1,identities:[{nif:'100000001',source_name:'Pessoa'}],rows:[row()]});
test('import rejects cross-person detail, conflicting totals and duplicate payments',()=>{
 assert.equal(validateImport(data()).rows.length,1);
 for(const field of ['records','productionVdd','productionChe','adjustments','checks']){
  const d=data();d.rows[0].payload[field].push({owner:'p999999999'});assert.throws(()=>validateImport(d),/outra pessoa/);
 }
 const a=data();a.rows[0].total=99;assert.throws(()=>validateImport(a));
 const b=data();b.rows.push(row());assert.throws(()=>validateImport(b),/repetido/);
});
test('client summary deduplicates VP source rows, preserves negative credits and escapes names',()=>{
 const elements=new Map(),document={getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}};
 const code=fs.readFileSync(path.join(__dirname,'../public/comissoes.js'),'utf8');
 const context=vm.createContext({document,Intl,console});vm.runInContext(code.slice(0,code.lastIndexOf('(async()=>'))+'\nthis.card=card;this.vp=vp;',context);
 const r=row(),base={owner:'p100000001',period:'Novembro 2026',nif:'200000001',client:'<img src=x onerror=alert(1)>',service:'TV',sale:'1',amount:10};
 r.payload.records=[{...base,line:1,credits:2},{...base,line:1,credits:2},{...base,line:2,credits:-.5}];
 assert.equal(context.vp(r.payload.records),1.5);
 const html=context.card(r);assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('1,5 VP'));assert.ok(html.includes('<details>'));
});
