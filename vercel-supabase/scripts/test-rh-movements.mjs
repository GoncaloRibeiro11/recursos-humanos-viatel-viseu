import assert from 'node:assert/strict';
import test from 'node:test';
import { annualMovements } from '../src/rh-movements.mjs';

test('saldo anual corresponde a entradas menos saidas, incluindo inativos',()=>{
  const people=Array.from({length:19},(_,i)=>({id:String(i),chefeId:i%2?'a':'b',entrada:'2026-01-01',saida:i<9?'2026-06-01':'',ativo:i>=9}));
  const before=JSON.stringify(people);
  const totals=annualMovements(people,2026);
  assert.equal(totals.entries,19); assert.equal(totals.exits,9); assert.equal(totals.balance,10);
  assert.equal(totals.entriesByMonth[0],19); assert.equal(totals.exitsByMonth[5],9);
  assert.equal(totals.teams.reduce((sum,t)=>sum+t.balance,0),10);
  assert.equal(JSON.stringify(people),before);
});
test('saldo negativo, nulo, sem equipa e equipa sem movimentos',()=>{
  const result=annualMovements([
    {chefeId:'negative',entrada:'2025-01-01',saida:'2026-01-01'},
    {chefeId:'zero',entrada:'2026-01-01',saida:'2026-02-01'},
    {entrada:'2026-03-01'}, {chefeId:'idle'}
  ],2026);
  assert.equal(result.teams.find(t=>t.id==='negative').balance,-1);
  assert.equal(result.teams.find(t=>t.id==='zero').balance,0);
  assert.equal(result.teams.find(t=>t.id==='').balance,1);
  assert.equal(result.teams.find(t=>t.id==='idle').entries,0);
  assert.equal(result.balance,0);
});
test('ignora datas invalidas, outros anos e mudancas de chefe',()=>{
  const result=annualMovements([
    {entrada:'2026-02-30',saida:'2027-01-01'}, {entrada:'2025-12-31',saida:'invalid'},
    {rhMovements:[{field:'chefeId',date:'2026-01-01',from:'old',to:'new'}]}
  ],2026);
  assert.equal(result.entries,0); assert.equal(result.exits,0); assert.equal(result.balance,0);
});
test('permite a futura atribuicao historica por data sem contar transferencias como entradas',()=>{
  const result=annualMovements([{chefeId:'new',entrada:'2026-02-01',saida:'2026-12-01'}],2026,(_,date)=>date<'2026-11-01'?'old':'new');
  assert.equal(result.teams.find(t=>t.id==='old').entries,1);
  assert.equal(result.teams.find(t=>t.id==='new').exits,1);
  assert.equal(result.balance,0);
});
test('datas sem autorizacao no historico nao sao atribuidas a outra equipa',()=>{
  const result=annualMovements([{chefeId:'new',entrada:'2026-02-01',saida:'2026-12-01'}],2026,(_,date)=>date<'2026-11-01'?null:'new');
  assert.equal(result.entries,0); assert.equal(result.exits,1);
});
