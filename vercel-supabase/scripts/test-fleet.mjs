import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {INSPECTION_ITEMS,INSPECTION_GROUPS,inspectionProgress,validateHandover,fromLisbonInput,lisbonInput,custodyAt} from '../src/rh-fleet-model.mjs';
const require=createRequire(import.meta.url);
const {renderFleetPdf}=require('../lib/fleet-pdf.cjs');
const {createFleetApi}=require('../api/fleet-auto.js');
const {PDFDocument}=require('pdf-lib');
const uuid='10000000-0000-4000-8000-000000000001';
export const fixture={id:uuid,number:24,status:'draft',created_at:'2026-11-17T09:00:00Z',snapshot:{template_version:1,captured_at:'2026-11-17T09:00:00Z',vehicle:{plate:'AB-12-CD',make_model:'Renault Clio',cartrack_number:'000145',insurance_until:'2027-01-01',inspection_until:'2027-02-01'},from_person:{id:'a',name:'Gestor A',phone:'900 100 200'},to_person:{id:'b',name:'Colaborador B',phone:'900 300 400'},operation:{kind:'temporary',at:'2026-11-17T09:00:00Z',expected_return:'2026-11-24T09:00:00Z',place:'Viseu',reason:'Substituição durante férias',zone_name:'Responsável de zona',odometer:73680,fuel:'3/4',inspection:Object.fromEntries(INSPECTION_ITEMS.map(item=>[item.key,'NA'])),damage_markers:[{x:100,y:335,type:'R'}],damage_notes:'Risco já existente na porta esquerda.',notes:'EXEMPLO COM DADOS FICTÍCIOS. Não representa uma entrega real.',checked:true,signatures:{}}}};
test('frota valida inspecao completa e nunca inventa estados ou assinaturas',()=>{
  assert.equal(INSPECTION_ITEMS.length,new Set(INSPECTION_ITEMS.map(item=>item.key)).size);
  assert.equal(INSPECTION_GROUPS.length,7);assert.equal(inspectionProgress({}).complete,0);
  const data={...structuredClone(fixture.snapshot.operation),to_person_id:'b'};
  const current={person_id:'a',from_at:'2026-11-01T09:00:00Z'};
  assert.deepEqual(validateHandover(data,{odometer:73000},current,new Date('2026-11-17T10:00:00Z')),[]);
  assert.ok(validateHandover({...data,inspection:{}},{odometer:73000},current).some(v=>v.includes('inspeção')));
  assert.ok(validateHandover({...data,odometer:1},{odometer:73000},current).some(v=>v.includes('quilómetros')));
  assert.ok(validateHandover({...data,checked:false},{odometer:73000},current).some(v=>v.includes('verificação')));
  assert.equal(Object.keys(data.signatures).length,0);
});
test('datas de frota seguem Lisboa e recusam horas inexistentes ou ambiguas',()=>{
  assert.equal(fromLisbonInput('2026-11-17T09:00'),'2026-11-17T09:00:00.000Z');
  assert.equal(fromLisbonInput('2026-07-17T09:00'),'2026-07-17T08:00:00.000Z');
  assert.equal(fromLisbonInput('2026-03-29T01:30'),'');assert.equal(fromLisbonInput('2026-10-25T01:30'),'');
  assert.equal(lisbonInput('2026-07-17T08:00:00Z'),'2026-07-17T09:00');
  const rows=[{vehicle_id:'v',person_id:'a',from_at:'2026-11-01T09:00:00Z',to_at:'2026-11-02T09:00:00Z'},{vehicle_id:'v',person_id:'b',from_at:'2026-11-02T09:00:00Z',to_at:null}];
  assert.equal(custodyAt(rows,'v','2026-11-02T09:00:00Z').person_id,'b');
});
test('auto mantem duas paginas e suporta acentos, observacoes extensas e modelo versionado',async()=>{
  const bytes=await renderFleetPdf(fixture);assert.equal(bytes.subarray(0,4).toString(),'%PDF');
  const doc=await PDFDocument.load(bytes);assert.equal(doc.getPageCount(),2);assert.match(doc.getTitle(),/AB-12-CD/);
  const lengthy=structuredClone(fixture);lengthy.snapshot.operation.notes='Observação adicional de teste. '.repeat(100);
  assert.ok((await PDFDocument.load(await renderFleetPdf(lengthy))).getPageCount()>2);
  const unknown=structuredClone(fixture);unknown.snapshot.template_version=9;await assert.rejects(renderFleetPdf(unknown),/modelo/);
});
function response(){return {headers:{},statusCode:0,setHeader(key,value){this.headers[key]=value;},end(value){this.value=value;}};}
test('PDF exige sessao e administrador; nao usa chave de servico e arquiva sem substituir',async()=>{
  const calls=[];let stored=false;
  const row={...fixture,status:'confirmed'};
  const api=createFleetApi({env:{},render:async()=>Buffer.from('%PDF-test'),fetcher:async(url,options)=>{
    calls.push({url,method:options.method || 'GET',headers:options.headers});
    if(url.endsWith('/auth/v1/user'))return Response.json({id:'admin'});
    if(url.includes('/user_profiles?'))return Response.json([{role:'admin'}]);
    if(url.includes('/rh_fleet_handovers?'))return Response.json([row]);
    if(url.includes('/object/authenticated/'))return stored?new Response('%PDF-test'):Response.json({error:'not found'},{status:404});
    if(url.includes('/object/rh-fleet/')){stored=true;return Response.json({Key:'ok'});}
    throw new Error('unexpected '+url);
  }});
  let res=response();await api({method:'POST',headers:{},body:{id:uuid}},res);assert.equal(res.statusCode,401);assert.equal(calls.length,0);
  for(let i=0;i<2;i++){res=response();await api({method:'POST',headers:{authorization:'Bearer test-user-session'},body:{id:uuid}},res);assert.equal(res.statusCode,200);assert.equal(res.value.toString(),'%PDF-test');}
  assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.ok(calls.every(call=>call.headers.Authorization==='Bearer test-user-session'));
  assert.equal(res.headers['Cache-Control'],'no-store');
  const denied=createFleetApi({fetcher:async url=>Response.json(url.endsWith('/auth/v1/user')?{id:'manager'}:[{role:'gestor'}])});
  res=response();await denied({method:'POST',headers:{authorization:'Bearer manager'},body:{id:uuid}},res);assert.equal(res.statusCode,403);
});
