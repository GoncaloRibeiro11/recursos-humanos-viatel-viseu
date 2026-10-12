import test from 'node:test';
import assert from 'node:assert/strict';
import { RhSync, fetchAllRows } from '../src/rh-sync.mjs';

class Storage {
  constructor(){ this.values = new Map(); }
  get length(){ return this.values.size; }
  key(index){ return [...this.values.keys()][index] || null; }
  getItem(key){ return this.values.get(key) ?? null; }
  setItem(key,value){ this.values.set(key,String(value)); }
  removeItem(key){ this.values.delete(key); }
}

class Client {
  constructor(){
    this.rows = { rh_persons:[], rh_vacations:[], rh_attendance_records:[] };
    this.calls = [];
    this.fail = false;
    this.pageCap = 500;
    this.gate = null;
  }
  from(table){
    const client = this;
    const query = { mode:'select', filters:[], ordering:[] };
    const builder = {
      select(){ return builder; },
      order(field){ query.ordering.push(field); return builder; },
      eq(field,value){ query.filters.push([field,value]); return builder; },
      range(from,to){ query.range = [from,to]; return execute(); },
      maybeSingle(){ query.single = true; return execute(); },
      delete(){ query.mode = 'delete'; return builder; },
      update(value){ query.mode = 'update'; query.value = value; return builder; },
      upsert(value){ query.mode = 'upsert'; query.value = value; return builder; },
      then(resolve,reject){ return execute().then(resolve,reject); }
    };
    async function execute(){
      client.calls.push({ table, ...structuredClone(query) });
      if (query.mode !== 'select' && client.gate) await client.gate;
      if (client.fail) return { error:new Error('Offline') };
      const matches = row => query.filters.every(([field,value]) => row[field] === value);
      if (query.mode === 'select'){
        const rows = client.rows[table].filter(matches).map(row => structuredClone(row));
        rows.sort((a,b) => {
          for (const field of query.ordering){ const result = String(a[field]).localeCompare(String(b[field])); if (result) return result; }
          return 0;
        });
        const count = rows.length;
        return { data:query.single ? rows[0] || null : query.range ? rows.slice(query.range[0],Math.min(query.range[1]+1,query.range[0]+client.pageCap)) : rows, count };
      }
      if (query.mode === 'delete'){
        client.rows[table] = client.rows[table].filter(row => !matches(row));
      } else if (query.mode === 'update'){
        for (const row of client.rows[table]) if (matches(row)) Object.assign(row,structuredClone(query.value));
      } else {
        for (const value of structuredClone(Array.isArray(query.value) ? query.value : [query.value])){
          const existing = client.rows[table].find(row => table === 'rh_attendance_records'
            ? row.person_id === value.person_id && row.record_date === value.record_date : row.id === value.id);
          if (existing) Object.assign(existing,value);
          else client.rows[table].push(value);
        }
      }
      return {};
    }
    return builder;
  }
}

const baseline = () => ({ persons:[{ id:'p1', name:'Teste', carga:'40h' }], vacations:[], records:{} });
const create = (client,storage = new Storage(), userId = 'admin') => new RhSync({ client, storage, userId, projectId:'test', locks:null });

test('a marcação fica no disco imediatamente e só desaparece da fila após confirmação', async () => {
  const client = new Client(), storage = new Storage(), sync = create(client,storage);
  const state = baseline(); sync.observe(state);
  let release; client.gate = new Promise(resolve => { release = resolve; });
  state.records['p1|2026-10-12'] = 'P'; sync.track(state,['p1|2026-10-12']);
  assert.equal(storage.length,1);
  client.rows.rh_attendance_records.push({ person_id:'outro-pc', record_date:'2026-10-09', code:'B' });
  release(); await sync.flush();
  assert.equal(storage.length,0);
  assert.equal(client.rows.rh_attendance_records.length,2);
  assert.deepEqual(client.calls.map(call => call.table),['rh_attendance_records']);
  assert.equal(client.calls[0].mode,'upsert'); sync.stop();
});

test('uma atualização offline repõe a marcação pendente e reenvia ao voltar a ligação', async () => {
  const client = new Client(), storage = new Storage(), sync = create(client,storage);
  const state = baseline(); sync.observe(state); client.fail = true;
  state.records['p1|2026-10-12'] = 'FJ'; sync.track(state,['p1|2026-10-12']);
  await sync.flush(); sync.stop(); assert.equal(storage.length,1);
  const refreshed = create(client,storage);
  const restored = refreshed.overlay(baseline());
  assert.equal(restored.records['p1|2026-10-12'],'FJ');
  refreshed.observe(restored); client.fail = false; await refreshed.flush();
  assert.equal(storage.length,0); assert.equal(client.rows.rh_attendance_records[0].code,'FJ'); refreshed.stop();
});

test('limpar uma célula só remove esse colaborador e esse dia', async () => {
  const client = new Client(), sync = create(client);
  client.rows.rh_attendance_records = [
    { person_id:'p1', record_date:'2026-10-12', code:'P' },
    { person_id:'p1', record_date:'2026-10-13', code:'B' }
  ];
  const state = baseline(); state.records['p1|2026-10-12'] = 'P'; sync.observe(state);
  delete state.records['p1|2026-10-12']; sync.track(state,['p1|2026-10-12']); await sync.flush();
  assert.deepEqual(client.calls[0].filters,[['person_id','p1'],['record_date','2026-10-12']]);
  assert.equal(client.rows.rh_attendance_records[0].record_date,'2026-10-13'); sync.stop();
});

test('alterações rápidas na mesma célula mantêm a última escolha', async () => {
  const client = new Client(), sync = create(client), state = baseline(); sync.observe(state);
  let release; client.gate = new Promise(resolve => { release = resolve; });
  state.records['p1|2026-10-12'] = 'P'; sync.track(state,['p1|2026-10-12']);
  state.records['p1|2026-10-12'] = 'B'; sync.track(state,['p1|2026-10-12']);
  release(); await sync.flush(); assert.equal(client.rows.rh_attendance_records[0].code,'B'); sync.stop();
});

test('editar um campo preserva a informação mais recente de outro PC', async () => {
  const client = new Client(), sync = create(client), state = baseline(); sync.observe(state);
  client.rows.rh_persons = [{ id:'p1', name:'Nome atual', carga:'40h', ativo:true, data:{ name:'Nome atual', telefone:'912345678', agv:'novo' } }];
  state.persons[0].carga = '20h'; sync.track(state); await sync.flush();
  const person = client.rows.rh_persons[0];
  assert.equal(person.name,'Nome atual'); assert.equal(person.carga,'20h');
  assert.equal(person.data.telefone,'912345678'); assert.equal(person.data.agv,'novo');
  const update = client.calls.find(call => call.mode === 'update');
  assert.deepEqual(Object.keys(update.value).sort(),['carga','data']); sync.stop();
});

test('um separador antigo não volta a enviar alterações já confirmadas por outro separador', async () => {
  const client = new Client(), storage = new Storage(), first = create(client,storage), state = baseline();
  first.observe(state); client.fail = true;
  state.records['p1|2026-10-12'] = 'P'; first.track(state,['p1|2026-10-12']); await first.flush();
  const second = create(client,storage); client.fail = false; await first.flush();
  client.rows.rh_attendance_records[0].code = 'B';
  await second.flush(); assert.equal(client.rows.rh_attendance_records[0].code,'B'); first.stop(); second.stop();
});

test('a fila é separada por conta e mantém o isolamento dos gestores', async () => {
  const client = new Client(), storage = new Storage(), first = create(client,storage), state = baseline();
  first.observe(state); client.fail = true;
  state.records['p1|2026-10-12'] = 'P'; first.track(state,['p1|2026-10-12']); await first.flush();
  const second = create(client,storage,'gestor');
  assert.deepEqual(second.overlay(baseline()).records,{}); first.stop(); second.stop();
});

test('carrega mais de 1000 registos mesmo se o servidor limitar cada resposta a 100', async () => {
  const client = new Client(); client.pageCap = 100;
  client.rows.rh_attendance_records = Array.from({ length:1252 },(_,i) => ({ person_id:String(i).padStart(4,'0'), record_date:'2026-10-12', code:'P' }));
  const rows = await fetchAllRows(client,'rh_attendance_records',['person_id','record_date']);
  assert.equal(rows.length,1252); assert.equal(rows[1251].person_id,'1251'); assert.equal(client.calls.length,13);
});

test('não recria um colaborador que foi removido noutro PC', async () => {
  const client = new Client(), sync = create(client), state = baseline(); sync.observe(state);
  state.persons[0].carga = '20h'; sync.track(state); await sync.flush();
  assert.equal(client.rows.rh_persons.length,0); assert.equal(sync.pending.size,1); sync.stop();
});

test('uma falha de armazenamento local fica assinalada e não perde a fila em memória', async () => {
  const client = new Client(), storage = new Storage(), sync = create(client,storage), state = baseline();
  sync.observe(state); storage.setItem = () => { throw new Error('QuotaExceededError'); }; client.fail = true;
  state.records['p1|2026-10-12'] = 'P'; sync.track(state,['p1|2026-10-12']); await sync.flush();
  assert.equal(sync.storageFailed,true); assert.equal(sync.pending.size,1);
  client.fail = false; await sync.flush(); assert.equal(client.rows.rh_attendance_records[0].code,'P'); sync.stop();
});

test('agrupa marcações rápidas sem duplicar células nem enviar o estado completo', async () => {
  const client = new Client(), sync = create(client), state = baseline(); sync.observe(state);
  const keys = [];
  for (let i = 1; i <= 25; i++){
    const key = `p1|2026-10-${String(i).padStart(2,'0')}`;
    state.records[key] = 'P'; keys.push(key);
  }
  sync.track(state,keys); await sync.flush();
  assert.equal(client.rows.rh_attendance_records.length,25);
  assert.equal(client.calls.length,1); assert.equal(client.calls[0].value.length,25); sync.stop();
});

test('criar colaborador e férias não altera os outros colaboradores', async () => {
  const client = new Client(), sync = create(client), state = baseline(); sync.observe(state);
  client.rows.rh_persons = [{ id:'p1', name:'Teste', data:{ name:'Teste' } }];
  state.persons.push({ id:'p2', name:'Novo', ativo:true });
  state.vacations.push({ id:'v1', personId:'p2', start:'2026-12-01', end:'2026-12-02' });
  sync.track(state); await sync.flush();
  assert.equal(client.rows.rh_persons.length,2); assert.equal(client.rows.rh_vacations[0].person_id,'p2');
  assert.equal(client.rows.rh_persons[0].name,'Teste'); sync.stop();
});

test('remover colaborador só envia a remoção desse colaborador', async () => {
  const client = new Client(), sync = create(client), state = baseline();
  state.vacations = [{ id:'v1', personId:'p1', start:'2026-12-01', end:'2026-12-02' }];
  state.records = { 'p1|2026-10-12':'P' }; sync.observe(state);
  sync.track({ persons:[], vacations:[], records:{} }); await sync.flush();
  assert.equal(client.calls.length,1); assert.equal(client.calls[0].table,'rh_persons');
  assert.deepEqual(client.calls[0].filters,[['id','p1']]); sync.stop();
});
