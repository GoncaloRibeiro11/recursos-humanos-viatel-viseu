const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const jsonPath = process.argv[2] || path.join(__dirname, '..', 'mapa-coordenacao-2026.json');

if (!url || !serviceKey) {
  console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de correr.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const state = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

function isoOrNull(value) {
  return value || null;
}

async function main() {
  const persons = (state.persons || []).map(person => ({
    id: person.id,
    name: person.name || '',
    role_code: person.role || null,
    chefe_id: person.chefeId || null,
    empresa: person.empresa || null,
    carga: person.carga || null,
    ativo: person.ativo !== false,
    entrada: isoOrNull(person.entrada || person.dataEntrada),
    saida: isoOrNull(person.saida || person.dataSaida),
    nascimento: isoOrNull(person.nascimento || person.dataNascimento),
    data: person
  }));

  const vacations = (state.vacations || []).map(vacation => ({
    id: vacation.id,
    person_id: vacation.personId,
    start_date: vacation.start,
    end_date: vacation.end,
    note: vacation.note || null,
    color: vacation.color || null,
    data: vacation
  }));

  const records = Object.entries(state.records || {}).map(([key, code]) => {
    const separator = key.indexOf('|');
    return {
      person_id: key.slice(0, separator),
      record_date: key.slice(separator + 1),
      code
    };
  });

  console.log(`A enviar ${persons.length} colaboradores, ${vacations.length} ferias e ${records.length} registos.`);

  let result = await supabase.from('rh_persons').upsert(persons);
  if (result.error) throw result.error;

  if (vacations.length) {
    result = await supabase.from('rh_vacations').upsert(vacations);
    if (result.error) throw result.error;
  }

  if (records.length) {
    for (let i = 0; i < records.length; i += 500) {
      result = await supabase.from('rh_attendance_records').upsert(records.slice(i, i + 500));
      if (result.error) throw result.error;
    }
  }

  console.log('Migração concluída.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
