function monthInYear(date, year){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number(date.slice(0,4)) !== year) return -1;
  const value = new Date(date + 'T12:00:00Z');
  return !Number.isNaN(value.valueOf()) && value.toISOString().slice(0,10) === date ? Number(date.slice(5,7)) - 1 : -1;
}

function emptyTotals(){ return { entries:0, exits:0, balance:0, entriesByMonth:Array(12).fill(0), exitsByMonth:Array(12).fill(0) }; }

export function annualMovements(persons, year, teamOnDate = person => person.chefeId || ''){
  const total = emptyTotals();
  const teams = new Map();
  const team = id => {
    if (!teams.has(id)) teams.set(id,{ id,...emptyTotals() });
    return teams.get(id);
  };
  for (const person of persons){
    team(person.chefeId || '');
    for (const [field,type,months] of [['entrada','entries','entriesByMonth'],['saida','exits','exitsByMonth']]){
      const date = person[field];
      const month = monthInYear(date,year);
      if (month < 0) continue;
      const id = teamOnDate(person,date);
      if (id == null) continue;
      const group = team(id);
      total[type]++; group[type]++;
      total[months][month]++; group[months][month]++;
    }
  }
  total.balance = total.entries - total.exits;
  for (const group of teams.values()) group.balance = group.entries - group.exits;
  return { ...total, teams:[...teams.values()] };
}
