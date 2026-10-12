const copy = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function fetchAllRows(client, table, orderFields, pageSize = 500){
  const rows = [];
  while (true){
    let query = client.from(table).select('*', { count:'exact' });
    for (const field of orderFields) query = query.order(field, { ascending:true });
    const result = await query.range(rows.length, rows.length + pageSize - 1);
    if (result.error) throw result.error;
    const page = result.data || [];
    rows.push(...page);
    if (typeof result.count === 'number' && rows.length >= result.count) return rows;
    if (!page.length){
      if (typeof result.count === 'number' && rows.length < result.count) throw new Error('Carregamento incompleto dos registos.');
      return rows;
    }
    if (result.count == null && page.length < pageSize) return rows;
  }
}

function changedFields(previous, current){
  const changes = {};
  for (const field of new Set([...Object.keys(previous), ...Object.keys(current)])){
    if (field !== 'id' && !same(previous[field], current[field])) changes[field] = current[field] ?? null;
  }
  return changes;
}

function personRow(person){
  return {
    id:person.id, name:person.name || '', role_code:person.role || null,
    chefe_id:person.chefeId || null, empresa:person.empresa || null,
    carga:person.carga || null, ativo:person.ativo !== false,
    entrada:person.entrada || null, saida:person.saida || null,
    nascimento:person.nascimento || null, data:person
  };
}

function vacationRow(vacation){
  return {
    id:vacation.id, person_id:vacation.personId,
    start_date:vacation.start, end_date:vacation.end,
    note:vacation.note || null, color:vacation.color || null, data:vacation
  };
}

export class RhSync {
  constructor({ client, storage, userId, projectId, onStatus = () => {}, locks = globalThis.navigator?.locks }){
    this.client = client;
    this.storage = storage;
    this.prefix = `rh-pending-v1:${projectId}:${userId}:`;
    this.lockName = this.prefix;
    this.onStatus = onStatus;
    this.locks = locks;
    this.pending = new Map();
    this.volatile = new Set();
    this.confirmed = new Set();
    this.observed = { persons:[], vacations:[], records:{} };
    this.running = null;
    this.retryTimer = null;
    this.retryDelay = 2000;
    this.storageFailed = false;
    this.stopped = false;
    this.lastAt = 0;
    this.lastError = null;
    this.readJournal();
  }

  readJournal(){
    try {
      for (const key of this.pending.keys()){
        if (!this.volatile.has(key) && this.storage.getItem(key) === null) this.pending.delete(key);
      }
      for (let i = 0; i < this.storage.length; i++){
        const key = this.storage.key(i);
        if (!key?.startsWith(this.prefix) || this.pending.has(key) || this.confirmed.has(key)) continue;
        const operation = JSON.parse(this.storage.getItem(key));
        if (operation && ['person','vacation','record'].includes(operation.type) && ['put','delete'].includes(operation.action)){
          this.pending.set(key, operation);
        }
      }
    } catch(error){ this.storageFailed = true; }
    return [...this.pending.entries()].sort((a,b) => a[1].at - b[1].at || a[1].id.localeCompare(b[1].id));
  }

  status(){
    this.onStatus({ pending:this.pending.size, writing:!!this.running, durable:!this.storageFailed, error:this.lastError });
  }

  observe(state){ this.observed = copy(state); }

  acceptPersonFields(id, fields){
    const previous = this.observed.persons.find(person => person.id === id);
    if (previous) Object.assign(previous, copy(fields));
  }

  enqueue(type, action, key, fields = {}){
    const id = crypto.randomUUID();
    this.lastAt = Math.max(Date.now() * 1000,this.lastAt + 1);
    const operation = { id, at:this.lastAt, type, action, key, fields:copy(fields) };
    const storageKey = this.prefix + id;
    this.pending.set(storageKey, operation);
    try { this.storage.setItem(storageKey, JSON.stringify(operation)); }
    catch(error){ this.storageFailed = true; this.volatile.add(storageKey); }
  }

  track(state, recordKeys){
    if (this.stopped) return;
    if (!recordKeys){
      const removedPersons = new Set();
      for (const type of ['person','vacation']){
        const collection = type === 'person' ? 'persons' : 'vacations';
        const previous = new Map(this.observed[collection].map(row => [row.id,row]));
        const current = new Map(state[collection].map(row => [row.id,row]));
        for (const [id, row] of current){
          const fields = previous.has(id) ? changedFields(previous.get(id),row) : copy(row);
          if (Object.keys(fields).length) this.enqueue(type,'put',id,fields);
        }
        for (const [id, row] of previous){
          if (!current.has(id)){
            if (type === 'person') removedPersons.add(id);
            if (type === 'person' || !removedPersons.has(row.personId)) this.enqueue(type,'delete',id);
          }
        }
      }
      const keys = new Set([...Object.keys(this.observed.records), ...Object.keys(state.records)]);
      for (const key of keys){
        if (!removedPersons.has(key.split('|')[0])) this.trackRecord(state,key);
      }
      this.observe(state);
    } else {
      for (const key of recordKeys) this.trackRecord(state,key);
    }
    this.status();
    void this.flush();
  }

  trackRecord(state, key){
    const code = state.records[key] || '';
    if ((this.observed.records[key] || '') === code) return;
    this.enqueue('record', code ? 'put' : 'delete', key, { code });
    if (code) this.observed.records[key] = code;
    else delete this.observed.records[key];
  }

  overlay(state){
    const restored = copy(state);
    for (const [, operation] of this.readJournal()){
      const { type, action, key, fields } = operation;
      if (type === 'record'){
        if (action === 'delete') delete restored.records[key];
        else restored.records[key] = fields.code;
        continue;
      }
      const collection = type === 'person' ? 'persons' : 'vacations';
      const index = restored[collection].findIndex(row => row.id === key);
      if (action === 'delete'){
        if (index !== -1) restored[collection].splice(index,1);
        if (type === 'person'){
          restored.vacations = restored.vacations.filter(vacation => vacation.personId !== key);
          for (const record of Object.keys(restored.records)) if (record.startsWith(key + '|')) delete restored.records[record];
        }
      } else if (index !== -1){
        Object.assign(restored[collection][index],fields);
      } else {
        restored[collection].push({ id:key, ...fields });
      }
    }
    return restored;
  }

  async write(operation){
    const { type, action, key, fields } = operation;
    if (type === 'record'){
      const [person_id, record_date] = key.split('|');
      const result = action === 'delete'
        ? await this.client.from('rh_attendance_records').delete().eq('person_id',person_id).eq('record_date',record_date)
        : await this.client.from('rh_attendance_records').upsert({ person_id, record_date, code:fields.code }, { onConflict:'person_id,record_date' });
      if (result.error) throw result.error;
      return;
    }
    const table = type === 'person' ? 'rh_persons' : 'rh_vacations';
    if (action === 'delete'){
      const result = await this.client.from(table).delete().eq('id',key);
      if (result.error) throw result.error;
      return;
    }
    const current = await this.client.from(table).select('*').eq('id',key).maybeSingle();
    if (current.error) throw current.error;
    const previous = current.data;
    if (!previous && !Object.prototype.hasOwnProperty.call(fields,'id')){
      throw new Error('O registo foi removido noutro dispositivo. A alteração ficou pendente neste PC.');
    }
    const base = previous ? type === 'person' ? {
      ...previous.data, name:previous.name, role:previous.role_code || previous.data?.role || '',
      chefeId:previous.chefe_id || previous.data?.chefeId || '',
      empresa:previous.empresa || previous.data?.empresa || '',
      carga:previous.carga || previous.data?.carga || '', ativo:previous.ativo !== false,
      entrada:previous.entrada || previous.data?.entrada || '',
      saida:previous.saida || previous.data?.saida || '',
      nascimento:previous.nascimento || previous.data?.nascimento || ''
    } : {
      ...previous.data, personId:previous.person_id, start:previous.start_date,
      end:previous.end_date, note:previous.note, color:previous.color
    } : {};
    const data = { ...base, id:key, ...fields };
    if (type === 'person' && fields.rhMovements){
      const movements = new Map([...(current.data?.data?.rhMovements || []), ...fields.rhMovements].map(movement => [movement.id,movement]));
      data.rhMovements = [...movements.values()].sort((a,b) => String(a.at).localeCompare(String(b.at))).slice(-100);
    }
    const row = type === 'person' ? personRow(data) : vacationRow(data);
    let result;
    if (previous){
      const columns = type === 'person'
        ? { name:'name', role:'role_code', chefeId:'chefe_id', empresa:'empresa', carga:'carga', ativo:'ativo', entrada:'entrada', saida:'saida', nascimento:'nascimento' }
        : { personId:'person_id', start:'start_date', end:'end_date', note:'note', color:'color' };
      const update = { data };
      for (const [field,column] of Object.entries(columns)) if (field in fields) update[column] = row[column];
      result = await this.client.from(table).update(update).eq('id',key);
    } else {
      result = await this.client.from(table).upsert(row, { onConflict:'id' });
    }
    if (result.error) throw result.error;
  }

  async drain(){
    while (!this.stopped){
      const entries = this.readJournal();
      if (!entries.length) return;
      const [key, operation] = entries[0];
      const batch = [];
      if (operation.type === 'record' && operation.action === 'put'){
        for (const entry of entries){
          if (batch.length >= 100 || entry[1].type !== 'record' || entry[1].action !== 'put') break;
          batch.push(entry);
        }
      }
      if (batch.length > 1){
        const latest = new Map(batch.map(entry => [entry[1].key,entry[1].fields.code]));
        const rows = [...latest].map(([record,code]) => {
          const [person_id,record_date] = record.split('|');
          return { person_id, record_date, code };
        });
        const result = await this.client.from('rh_attendance_records').upsert(rows,{ onConflict:'person_id,record_date' });
        if (result.error) throw result.error;
      } else {
        await this.write(operation);
      }
      // A confirmed row is removed from the journal only after the server reply.
      for (const [confirmedKey] of batch.length > 1 ? batch : [[key,operation]]){
        try { this.storage.removeItem(confirmedKey); } catch(error){ this.storageFailed = true; }
        this.confirmed.add(confirmedKey);
        this.volatile.delete(confirmedKey);
        this.pending.delete(confirmedKey);
      }
      this.lastError = null;
      this.status();
    }
  }

  flush(){
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    clearTimeout(this.retryTimer);
    this.running = Promise.resolve().then(() => this.locks
      ? this.locks.request(this.lockName, () => this.drain())
      : this.drain()).catch(error => {
        this.lastError = error;
        if (!this.stopped){
          this.retryTimer = setTimeout(() => void this.flush(),this.retryDelay);
          this.retryDelay = Math.min(30000,this.retryDelay * 2);
        }
      }).finally(() => {
        this.running = null;
        if (!this.lastError) this.retryDelay = 2000;
        this.status();
      });
    this.status();
    return this.running;
  }

  stop(){
    this.stopped = true;
    clearTimeout(this.retryTimer);
  }
}
