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
