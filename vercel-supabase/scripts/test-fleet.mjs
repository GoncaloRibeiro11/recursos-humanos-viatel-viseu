import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {INSPECTION_ITEMS,INSPECTION_GROUPS,inspectionProgress,validateHandover,fromLisbonInput,lisbonInput,custodyAt,driverName,handoverOrigin,adoptInitialDraftVersion,handoverLabel,VEHICLE_STATES,showVehicleInspection,vehicleSaveData} from '../src/rh-fleet-model.mjs';
const require=createRequire(import.meta.url);
const {renderFleetPdf}=require('../lib/fleet-pdf.cjs');
const {createFleetApi}=require('../api/fleet-auto.js');
const {PDFDocument}=require('pdf-lib');
const uuid='10000000-0000-4000-8000-000000000001';
test('estado da viatura controla a data sem eliminar datas antigas ou enviar licenca de transportes',()=>{
  assert.deepEqual(Object.values(VEHICLE_STATES),['Nova','Recente','Usada']);
  for(const vehicle_condition of ['new','recent']){
    const v={plate:'AB-12-CD',vehicle_condition,inspection_until:'2028-01-15',transport_until:'2027-03-01'};
    assert.equal(showVehicleInspection(v),false);const payload=vehicleSaveData(v);assert.equal(payload.vehicle_condition,vehicle_condition);assert.ok(!Object.hasOwn(payload,'inspection_until'));assert.ok(!Object.hasOwn(payload,'transport_until'));assert.equal(v.inspection_until,'2028-01-15');
  }
  assert.equal(showVehicleInspection({vehicle_condition:'used'}),true);assert.equal(showVehicleInspection({}),true);
  assert.equal(vehicleSaveData({vehicle_condition:'used',inspection_until:'2028-01-15'}).inspection_until,'2028-01-15');
});
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
test('nomes completos no auto distinguem condutores da empresa e do nome abreviado RH',()=>{
  const op={driver_fields:{from:{name:'  Manuel de Entrega Teste  '},to:{name:'Ana de Rececao Teste'}}};
  assert.equal(driverName(op,'from',{name:'Empresa / parque'}),'Manuel de Entrega Teste');
  assert.equal(driverName(op,'to',{id:'a',name:'Ana Teste'}),'Ana de Rececao Teste');
  assert.equal(driverName({},'from',{name:'Empresa / parque'}),'');
  assert.equal(driverName({},'to',{id:'a',name:'Ana Teste'}),'Ana Teste');
  assert.equal(driverName({signature_receipts:{to:{signer_name:'Recebe na empresa'}}},'to',{name:'Empresa / parque'}),'Recebe na empresa');
  assert.equal(op.driver_fields.from.name,'  Manuel de Entrega Teste  ');
});
test('origem usa entrega real antes do habitual sem inventar periodos de utilizacao',()=>{
  const vehicle={habitual_person_id:'a'},persons=[{id:'a',name:'Gestor A'},{id:'b',name:'Colaborador B'}];
  assert.deepEqual(handoverOrigin(vehicle,null,'initial',persons),{id:null,name:'Empresa / parque',source:'company'});
  assert.deepEqual(handoverOrigin(vehicle,null,'temporary',persons),{id:'a',name:'Gestor A',source:'habitual'});
  const current={person_id:'b',person_name:'Nome guardado B'};
  assert.deepEqual(handoverOrigin(vehicle,current,'return',persons),{id:'b',name:'Colaborador B',source:'custody'});
  assert.equal(handoverOrigin({},null,'temporary',persons).source,'company');
  assert.equal(current.person_id,'b');assert.equal(vehicle.habitual_person_id,'a');
});
test('passagem sem entrega real explica o registo inicial em falta mesmo com responsavel habitual',()=>{
  const errors=validateHandover({...structuredClone(fixture.snapshot.operation),to_person_id:'b'},{odometer:0,habitual_person_id:'a'},null);
  assert.ok(errors.some(message=>message.includes('regista a situação inicial')));
});
test('situacao inicial nao inventa uma data nem atribui utilizacao em datas antigas',()=>{
  const baseline={vehicle_id:'v',person_id:'a',from_at:null,to_at:null,origin:'initial_state'};
  assert.equal(custodyAt([baseline],'v','2026-01-01T09:00:00Z'),null);
  const data={...structuredClone(fixture.snapshot.operation),to_person_id:'b'};
  assert.deepEqual(validateHandover(data,{odometer:0},baseline,new Date('2026-11-18')),[]);
});
test('entrega externa exige estrutura e pessoa sem escolher um colaborador do RH',()=>{
  const data={...structuredClone(fixture.snapshot.operation),kind:'return',destination:'external_structure',to_person_id:'',external_structure:'Estrutura de teste',driver_fields:{to:{name:'Pessoa Externa de Teste'}}};
  const current={person_id:'a',from_at:null};assert.deepEqual(validateHandover(data,{odometer:0},current,new Date('2026-11-18')),[]);assert.equal(handoverLabel(data),'Entrega a outra estrutura');
  assert.ok(validateHandover({...data,external_structure:''},{odometer:0},current).some(message=>message.includes('estrutura de destino')));
  assert.ok(validateHandover({...data,driver_fields:{to:{}}},{odometer:0},current).some(message=>message.includes('nome de quem recebe')));
  assert.ok(validateHandover({...data,kind:'temporary'},{odometer:0},current).some(message=>message.includes('encerrar')));
});
test('rascunho local conserva os campos ao adotar apenas a versao administrativa do arranque',()=>{
  const d={type:'handover',id:'h',vehicleId:'v',version:1,expectedCustodyId:null,data:{notes:'Alteracao local ainda nao enviada'}};
  const b={id:'c',vehicle_id:'v',origin:'initial_state',initial_recorded_at:'2026-11-17T10:00:00Z'};
  const h={id:'h',vehicle_id:'v',status:'draft',version:2,expected_custody_id:'c',updated_at:b.initial_recorded_at,data:{notes:'Versao do servidor'}};
  const adopted=adoptInitialDraftVersion(d,h,b);assert.equal(adopted.version,2);assert.equal(adopted.expectedCustodyId,'c');assert.equal(adopted.data.notes,d.data.notes);assert.equal(d.version,1);
  assert.equal(adoptInitialDraftVersion(d,{...h,version:3},b),d);
  assert.equal(adoptInitialDraftVersion(d,{...h,updated_at:'2026-11-17T10:01:00Z'},b),d);
  assert.equal(adoptInitialDraftVersion(d,{...h,status:'confirmed'},b),d);
});
test('auto mantem duas paginas e suporta acentos, observacoes extensas e modelo versionado',async()=>{
  const bytes=await renderFleetPdf(fixture);assert.equal(bytes.subarray(0,4).toString(),'%PDF');
  const doc=await PDFDocument.load(bytes);assert.equal(doc.getPageCount(),2);assert.match(doc.getTitle(),/AB-12-CD/);
  const lengthy=structuredClone(fixture);lengthy.snapshot.operation.notes='Observação adicional de teste. '.repeat(100);
  assert.ok((await PDFDocument.load(await renderFleetPdf(lengthy))).getPageCount()>2);
  const unknown=structuredClone(fixture);unknown.snapshot.template_version=9;await assert.rejects(renderFleetPdf(unknown),/modelo/);
  const optional=structuredClone(fixture);for(const key of ['at','reason','place','odometer','fuel','zone_name','expected_return','damage_notes'])optional.snapshot.operation[key]='';
  optional.snapshot.captured_at='';delete optional.created_at;
  assert.equal((await PDFDocument.load(await renderFleetPdf(optional))).getPageCount(),2,'metadados opcionais vazios nao impedem consultar o PDF para assinar');
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
