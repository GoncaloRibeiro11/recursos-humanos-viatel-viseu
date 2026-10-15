const knownRoles = new Set(['coordenador','capitao','chefe_equipa','vendedor','gestor_parceiros']);
const identity = value => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');

export function validDate(value){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10) === value;
}

export function assignmentAt(person, date, history, strict = false){
  const own = history.filter(row => row.person_id === person.id);
  const row = own.filter(row => row.valid_from <= date && (!row.valid_to || date < row.valid_to))
    .sort((a,b) => b.valid_from.localeCompare(a.valid_from))[0];
  if (!row) return strict ? null : person;
  return { ...row.person_snapshot, ...person, role:row.role_code || '', chefeId:row.chefe_id || '' };
}

export function historicalPeople(persons, history){
  const known = new Set(persons.map(person => person.id));
  const missing = new Map();
  for (const row of [...history].sort((a,b) => a.valid_from.localeCompare(b.valid_from))){
    if (!known.has(row.person_id)) missing.set(row.person_id, { ...row.person_snapshot, id:row.person_id, role:row.role_code || '', chefeId:row.chefe_id || '', historyOnly:true });
  }
  return [...missing.values()];
}

export function belongsOnDate(person, date, history, profile, strict = false){
  const assignment = assignmentAt(person,date,history,strict);
  if (!assignment) return false;
  return !profile || profile.role === 'admin' || person.id === profile.person_id || assignment.chefeId === profile.person_id;
}

export function prepareDraft(persons, plan){
  const find = name => {
    const matches = persons.filter(person => identity(person.name) === identity(name));
    if (matches.length !== 1) throw new Error(`Nome inexistente ou duplicado: ${name}`);
    if (matches[0].ativo === false) throw new Error(`Colaborador inativo: ${name}`);
    return matches[0];
  };
  const leader = find(plan.leaderName);
  const source = find(plan.sourceManagerName);
  const members = (plan.memberNames || []).map(find);
  if (!members.length || new Set([leader.id, ...members.map(person => person.id)]).size !== members.length + 1) throw new Error('Seleciona colaboradores diferentes, sem incluir o novo gestor na lista de vendedores.');
  if (!['chefe_equipa','coordenador','capitao'].includes(source.role)) throw new Error('A equipa de origem nao tem um gestor valido.');
  if ([leader,...members].some(person => person.role !== 'vendedor' || person.chefeId !== source.id)) throw new Error('A funcao ou equipa atual mudou. Confirma a preparacao antes de continuar.');
  const date = plan.effectiveDate || null;
  if (date && !validDate(date)) throw new Error('Data de inicio invalida.');
  return {
    status:'draft', effectiveDate:date,
    changes:[leader,...members].map(person => ({
      personId:person.id, name:person.name,
      fromRole:person.role, fromChefeId:person.chefeId || '',
      toRole:person.id === leader.id ? 'chefe_equipa' : person.role,
      toChefeId:leader.id
    }))
  };
}

export function activationPayload(draft, today, requestId){
  if (draft.status !== 'draft') throw new Error('A transicao nao esta em preparacao.');
  if (!validDate(draft.effectiveDate)) throw new Error('Falta confirmar a data de inicio.');
  if (!validDate(today) || draft.effectiveDate > today) throw new Error('A data ainda nao chegou. A transicao nao foi aplicada.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId || '')) throw new Error('Identificador de confirmacao invalido.');
  if (!draft.changes?.length || draft.changes.length > 100) throw new Error('Transicao invalida.');
  for (const change of draft.changes){
    if (!knownRoles.has(change.toRole) || !change.personId || !change.toChefeId) throw new Error('Funcao ou gestor invalido.');
  }
  return { p_request_id:requestId, p_effective_date:draft.effectiveDate, p_changes:draft.changes.map(({ name, ...change }) => change) };
}
