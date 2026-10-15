import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareDraft, activationPayload, assignmentAt, belongsOnDate, historicalPeople } from '../src/rh-team-history.mjs';

const persons = [
  { id:'old',name:'Old Manager',role:'chefe_equipa',chefeId:'old' },
  { id:'next',name:'New Manager',role:'vendedor',chefeId:'old' },
  ...['A','B','C'].map(id=>({id,name:'Person '+id,role:'vendedor',chefeId:'old'}))
];
const plan = { leaderName:'New Manager',sourceManagerName:'Old Manager',memberNames:['Person A','Person B','Person C'],effectiveDate:null };
const history = [
  { person_id:'A',valid_from:'0001-01-01',valid_to:'2026-11-01',role_code:'vendedor',chefe_id:'old',person_snapshot:{name:'Person A',ativo:true} },
  { person_id:'A',valid_from:'2026-11-01',valid_to:null,role_code:'vendedor',chefe_id:'next',person_snapshot:{name:'Person A',ativo:true} }
];

test('preparar os quatro colaboradores nao altera funcoes, equipas ou registos',()=>{
  const before = JSON.stringify(persons);
  const draft = prepareDraft(persons,plan);
  assert.equal(draft.status,'draft'); assert.equal(draft.effectiveDate,null);
  assert.equal(draft.changes.length,4);
  assert.equal(draft.changes[0].toRole,'chefe_equipa');
  assert.equal(JSON.stringify(persons),before);
});
test('sem data ou antes do dia nao existe payload de ativacao',()=>{
  const draft = prepareDraft(persons,plan);
  const id = '00000000-0000-4000-8000-000000000001';
  assert.throws(()=>activationPayload(draft,'2026-10-15',id),/confirmar a data/);
  assert.throws(()=>activationPayload({...draft,effectiveDate:'2026-11-01'},'2026-10-31',id),/ainda nao chegou/);
  assert.equal(activationPayload({...draft,effectiveDate:'2026-11-01'},'2026-11-01',id).p_changes.length,4);
});
test('alteracoes entretanto feitas e nomes duplicados obrigam a rever o rascunho',()=>{
  assert.throws(()=>prepareDraft(persons.map(p=>p.id==='A'?{...p,chefeId:'other'}:p),plan),/equipa atual mudou/);
  assert.throws(()=>prepareDraft([...persons,{...persons[2],id:'duplicate'}],plan),/duplicado/);
});
test('a data exata separa a equipa anterior e a equipa nova sem mudar presencas',()=>{
  const person = {...persons[2],chefeId:'next'};
  assert.equal(assignmentAt(person,'2026-10-31',history,true).chefeId,'old');
  assert.equal(assignmentAt(person,'2026-11-01',history,true).chefeId,'next');
  assert.equal(belongsOnDate(person,'2026-10-31',history,{role:'gestor',person_id:'next'},true),false);
  assert.equal(belongsOnDate(person,'2026-11-01',history,{role:'gestor',person_id:'next'},true),true);
});
test('um gestor recebe apenas o perfil historico autorizado e nao inventa periodos em falta',()=>{
  const ownHistory = history.slice(0,1);
  const former = historicalPeople([],ownHistory)[0];
  assert.equal(former.historyOnly,true);
  assert.equal(assignmentAt(former,'2026-11-01',ownHistory,true),null);
  assert.equal(assignmentAt(former,'2026-10-31',ownHistory,true).name,'Person A');
});
