export function lisbonDate(now=new Date()){
  const parts=new Intl.DateTimeFormat('en',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function validDate(value){
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date=new Date(value+'T12:00:00Z');return Number.isFinite(+date) && date.toISOString().slice(0,10)===value;
}
export function anniversaryEvents(persons,date){
  if(!validDate(date)) throw new Error('Data invalida.');
  const events=[];
  for(const person of persons){
    if(person.ativo===false || (validDate(person.entrada) && person.entrada>date) || (validDate(person.saida) && person.saida<=date)) continue;
    for(const [kind,field] of [['birthday','nascimento'],['work','entrada']]){
      const source=person[field];if(!validDate(source)) continue;
      const year=Number(date.slice(0,4)),years=year-Number(source.slice(0,4));
      if(years<=0) continue;
      // Matches the site's March 1 observance for February 29 in non-leap years.
      const anniversary=new Date(Date.UTC(year,Number(source.slice(5,7))-1,Number(source.slice(8,10)),12)).toISOString().slice(0,10);
      if(anniversary===date) events.push({person,kind,years,date,
        imageSubtitle:kind==='birthday'?`${years} ${years===1?'ano':'anos'}`:undefined,
        imageMessage:kind==='birthday'?'Que seja um dia feliz, com muita energia e bons momentos.':undefined});
    }
  }
  return events.sort((a,b)=>a.person.id.localeCompare(b.person.id)||a.kind.localeCompare(b.kind));
}
export function eventCaption(event){
  const date=event.date.split('-').reverse().join('/');
  return event.kind==='birthday'
    ? `Aniversário de vida · ${date}\nParabéns ${event.person.name}! Que seja um dia feliz, com muita energia e bons momentos.`
    : `Aniversário de empresa · ${date}\nParabéns ${event.person.name} pelos ${event.years} ${event.years===1?'ano':'anos'} de casa! Obrigado pelo teu compromisso, dedicação e por fazeres parte da equipa.`;
}
