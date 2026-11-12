import assert from 'node:assert/strict';
import test from 'node:test';
import { workforceAnalytics,comparisonPeriod } from '../src/rh-analytics.mjs';

const person=(id,overrides={})=>({id,name:id,entrada:'2025-01-01',ativo:true,role:'vendedor',chefeId:'a',...overrides});
const base={from:'2026-11-01',to:'2026-11-30',today:'2026-11-02'};
const row=(person_id,chefe_id,valid_from='0001-01-01',valid_to=null)=>({person_id,chefe_id,valid_from,valid_to,role_code:'vendedor'});
test('entradas, saidas e efetivo reconciliam sem contar dias futuros',()=>{
  const persons=[person('stable'),person('join',{entrada:'2026-11-01'}),person('leave',{saida:'2026-11-02',ativo:false}),person('future',{entrada:'2026-11-15'})];
  const original=JSON.stringify(persons);
  const result=workforceAnalytics({...base,persons});
  assert.equal(result.days,2);assert.equal(result.truncated,true);
  assert.equal(result.total.opening,2);assert.equal(result.total.closing,2);
  assert.equal(result.total.entries,1);assert.equal(result.total.exits,1);assert.equal(result.total.balance,0);
  assert.equal(result.total.average,2.5);assert.equal(result.total.turnover,40);
  assert.deepEqual(result.series.map(point=>point.count),[3,2]);
  assert.equal(JSON.stringify(persons),original);
});
test('transferencias respeitam a data e nao se transformam em entradas e saidas da empresa',()=>{
  const persons=[person('move',{chefeId:'b'})];
  const history=[row('move','a','0001-01-01','2026-11-01'),row('move','b','2026-11-01')];
  const result=workforceAnalytics({...base,persons,history,historyEnabled:true});
  const a=result.teams.find(team=>team.id==='a'),b=result.teams.find(team=>team.id==='b');
  assert.equal(a.opening,1);assert.equal(a.closing,0);assert.equal(a.transfersOut,1);
  assert.equal(b.opening,0);assert.equal(b.closing,1);assert.equal(b.transfersIn,1);
  assert.equal(result.total.entries,0);assert.equal(result.total.exits,0);
  assert.equal(result.total.events.length,1);
  assert.deepEqual([result.total.events[0].fromTeamId,result.total.events[0].toTeamId],['a','b']);
  const before=workforceAnalytics({...base,from:'2026-10-01',to:'2026-10-31',persons,history,historyEnabled:true,teamId:'a'});
  assert.equal(before.total.closing,1);assert.equal(before.total.transfersOut,0);
});
test('promocoes sem mudar de equipa e atribuicoes na entrada nao contam como transferencias',()=>{
  const persons=[person('promoted'),person('join',{entrada:'2026-11-01'})];
  const history=[row('promoted','a','0001-01-01','2026-11-01'),{...row('promoted','a','2026-11-01'),role_code:'chefe_equipa'},row('join','old','0001-01-01','2026-11-01'),row('join','a','2026-11-01')];
  const result=workforceAnalytics({...base,persons,history,historyEnabled:true});
  assert.equal(result.total.transfersIn,0);assert.equal(result.total.transfersOut,0);assert.equal(result.total.entries,1);
});
test('um gestor ve apenas a sua parte da transferencia e nao identifica a equipa escondida',()=>{
  const persons=[person('move',{historyOnly:true})];
  const history=[row('move','a','0001-01-01','2026-11-01')];
  const result=workforceAnalytics({...base,persons,history,historyEnabled:true,profile:{role:'gestor',person_id:'a'}});
  assert.equal(result.total.transfersOut,1);assert.equal(result.total.transfersIn,0);
  assert.equal(result.total.events[0].toTeamId,undefined);
  assert.equal(result.currentPeople.length,0);
  const next=workforceAnalytics({...base,persons:[person('move',{chefeId:'b'})],history:[row('move','b','2026-11-01')],historyEnabled:true,profile:{role:'gestor',person_id:'b'}});
  assert.equal(next.total.transfersIn,1);assert.equal(next.total.events[0].fromTeamId,undefined);
});
test('sem datas de emprego completas nao inventa taxa de saida ou tempo de permanencia',()=>{
  const persons=[person('unknown',{entrada:''}),person('exit',{saida:'2026-11-01',entrada:'',ativo:false}),person('inactive',{ativo:false,saida:''})];
  const result=workforceAnalytics({...base,persons});
  assert.equal(result.total.turnover,null);assert.equal(result.total.exits,1);
  assert.equal(result.total.events[0].tenureDays,null);assert.equal(result.total.earlyExits,0);
  assert.equal(result.quality.missingEntry,2);assert.equal(result.quality.missingExit,1);
});
test('modelos sao categorias proprias atuais e nao sao deduzidos da carga horaria',()=>{
  const persons=[person('x',{modeloComissional:' Modelo A ',carga:'20h'}),person('y',{modeloComissional:'modelo a'}),person('unknown',{carga:'bolsa_formacao'}),person('left',{modeloComissional:'B',ativo:false,saida:'2026-10-20'})];
  const result=workforceAnalytics({...base,persons});
  assert.equal(result.models.length,2);assert.equal(result.models[0].count,2);
  assert.equal(result.unknownModels,1);assert.equal(result.currentPeople.length,3);
  assert.ok(Math.abs(result.modelCoverage-200/3)<1e-8);
  assert.equal(result.models.some(model=>model.label==='bolsa_formacao'),false);
});
test('comparacao segue o calendario e trata anos bissextos e intervalos personalizados',()=>{
  assert.deepEqual(comparisonPeriod('2026-11-01','2026-11-02','month'),{from:'2026-10-01',to:'2026-10-02'});
  assert.deepEqual(comparisonPeriod('2024-01-01','2024-02-29','year'),{from:'2023-01-01',to:'2023-02-28'});
  assert.deepEqual(comparisonPeriod('2026-11-01','2026-11-02'),{from:'2026-10-30',to:'2026-10-31'});
});
test('saidas precoces usam a permanencia real e incluem o limite de 60 dias',()=>{
  const result=workforceAnalytics({...base,persons:[person('sixty',{entrada:'2026-09-02',saida:'2026-11-01',ativo:false}),person('sixty-one',{entrada:'2026-09-01',saida:'2026-11-01',ativo:false})]});
  assert.equal(result.total.exits,2);assert.equal(result.total.earlyExits,1);
});
test('periodo vazio nao produz previsoes nem taxas artificiais',()=>{
  const result=workforceAnalytics({...base,from:'2026-12-01',to:'2026-12-31',persons:[person('one')]});
  assert.equal(result.days,0);assert.equal(result.total.closing,0);assert.equal(result.total.turnover,null);
});
test('datas de emprego contraditorias e intervalos excessivos nao produzem indicadores falsos',()=>{
  const result=workforceAnalytics({...base,persons:[person('bad',{entrada:'2026-11-02',saida:'2026-11-01',ativo:false})]});
  assert.equal(result.total.entries,0);assert.equal(result.total.exits,0);assert.equal(result.total.turnover,null);
  assert.equal(result.total.uncertainCount,1);assert.equal(result.quality.invalidDates,1);
  assert.throws(()=>workforceAnalytics({...base,from:'1900-01-01',persons:[]}),/20 anos/);
});

test('contagens atuais cruzam equipa, contrato e empresa sem duplicar categorias',()=>{
  const persons=[
    person('one',{carga:'40h',empresa:' Viatel  '}),
    person('two',{carga:'40h',empresa:'viatel'}),
    person('three',{chefeId:'b',carga:'bolsa_formacao',empresa:'Triangle   Solutions'}),
    person('four',{chefeId:'',carga:'',empresa:''}),
    person('five',{chefeId:'b',carga:'recibo_verde',empresa:'Triangle Solutions'}),
    person('left',{ativo:false,saida:'2026-10-31',empresa:'Antiga'}),
    person('future',{entrada:'2026-11-20',empresa:'Futura'}),
    person('historical',{historyOnly:true,empresa:'Oculta'}),
  ];
  const original=JSON.stringify(persons);
  const result=workforceAnalytics({...base,persons}).composition;
  assert.equal(result.total,5);
  assert.deepEqual(result.companies.map(group=>[group.key,group.count]),[['triangle solutions',2],['viatel',2],['',1]]);
  assert.deepEqual(result.contracts.map(group=>[group.key,group.count]),[['40h',2],['bolsa_formacao',1],['recibo_verde',1],['',1]]);
  for(const dimension of ['companies','contracts']){
    assert.equal(result[dimension].reduce((sum,group)=>sum+group.count,0),result.total);
    for(const group of result[dimension]) assert.equal(result.teams.reduce((sum,team)=>sum+(team[dimension].find(item=>item.key===group.key)?.count || 0),0),group.count);
    for(const team of result.teams) assert.equal(team[dimension].reduce((sum,group)=>sum+group.count,0),team.count);
  }
  assert.equal(result.teams.find(team=>team.id==='').count,1);
  assert.equal(JSON.stringify(persons),original);
});

test('estrutura atual segue a equipa em vigor, nao o periodo de movimentos ou a equipa antiga',()=>{
  const persons=[person('move',{carga:'20h',empresa:'Viatel'})];
  const history=[row('move','a','0001-01-01','2026-11-01'),row('move','b','2026-11-01')];
  const args={...base,persons,history,historyEnabled:true};
  const current=workforceAnalytics(args).composition;
  assert.equal(current.teams[0].id,'b');assert.equal(current.total,1);
  assert.deepEqual(workforceAnalytics({...args,from:'2026-10-01',to:'2026-10-31'}).composition,current);
  assert.equal(workforceAnalytics({...args,teamId:'a'}).composition.total,0);
  assert.equal(workforceAnalytics({...args,teamId:'b'}).composition.total,1);
  assert.equal(workforceAnalytics({...args,profile:{role:'gestor',person_id:'a'}}).composition.total,0);
  assert.equal(workforceAnalytics({...args,profile:{role:'gestor',person_id:'b'}}).composition.total,1);
});

test('contagens vazias, campos em falta e nomes especiais nao perdem registos',()=>{
  assert.deepEqual(workforceAnalytics({...base,persons:[]}).composition,{total:0,contracts:[],companies:[],teams:[]});
  const result=workforceAnalytics({...base,persons:[person('unknown',{entrada:'',carga:null,empresa:null}),person('special',{empresa:'__proto__',carga:'Outro'})]}).composition;
  assert.equal(result.total,2);
  assert.equal(result.companies.find(group=>group.key==='__proto__').count,1);
  assert.equal(result.contracts.find(group=>group.key==='').count,1);
  assert.equal(result.contracts.find(group=>group.key==='outro').count,1);
});

test('motivos de saida reconciliam com as saidas do periodo sem inventar os antigos',()=>{
  const persons=[
    person('one',{saida:'2026-11-01',ativo:false,motivoSaida:'iniciativa_colaborador',observacoesSaida:'Nota privada'}),
    person('two',{saida:'2026-11-02',ativo:false,motivoSaida:'abandono_posto_trabalho'}),
    person('three',{saida:'2026-11-02',ativo:false,motivoSaida:'abandono_posto_trabalho'}),
    person('old',{saida:'2026-11-01',ativo:false}),
    person('before',{saida:'2026-10-31',ativo:false,motivoSaida:'fim_contrato'}),
    person('future',{saida:'2026-11-20',motivoSaida:'outro'}),
    person('active',{motivoSaida:'decisao_empresa'}),
  ];
  const original=JSON.stringify(persons),result=workforceAnalytics({...base,persons});
  assert.equal(result.exitReasons.total,result.total.exits);assert.equal(result.exitReasons.total,4);
  assert.equal(result.exitReasons.recorded,3);assert.equal(result.exitReasons.missing,1);assert.equal(result.exitReasons.coverage,75);
  assert.deepEqual(result.exitReasons.groups.map(group=>[group.key,group.count]),[['abandono_posto_trabalho',2],['iniciativa_colaborador',1],['',1]]);
  assert.equal(result.exitReasons.groups.reduce((sum,group)=>sum+group.count,0),4);
  assert.doesNotMatch(JSON.stringify(result.exitReasons),/Nota privada|observacoesSaida/);
  assert.equal(JSON.stringify(persons),original);
  const empty=workforceAnalytics({...base,from:'2026-09-01',to:'2026-09-30',persons}).exitReasons;
  assert.deepEqual(empty,{total:0,recorded:0,missing:0,coverage:null,groups:[]});
});

test('motivo de saida segue a equipa na data da saida e permanece privado para gestores',()=>{
  const persons=[person('left',{chefeId:'b',saida:'2026-11-01',ativo:false,motivoSaida:'mutuo_acordo'})];
  const history=[row('left','a','0001-01-01','2026-11-02'),row('left','b','2026-11-02')];
  const args={...base,persons,history,historyEnabled:true};
  assert.equal(workforceAnalytics({...args,teamId:'a'}).exitReasons.total,1);
  assert.equal(workforceAnalytics({...args,teamId:'b'}).exitReasons.total,0);
  const manager=workforceAnalytics({...args,profile:{role:'gestor',person_id:'a'}});
  assert.equal(manager.total.exits,1);assert.equal(manager.exitReasons,null);
});
