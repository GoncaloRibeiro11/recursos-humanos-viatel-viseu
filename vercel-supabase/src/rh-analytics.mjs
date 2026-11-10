import { validDate } from './rh-team-history.mjs';

export function shiftDate(date,days){
  const value=new Date(date+'T12:00:00Z'); value.setUTCDate(value.getUTCDate()+days);
  return value.toISOString().slice(0,10);
}
function shiftMonths(date,months){
  const value=new Date(date+'T12:00:00Z'),day=value.getUTCDate();
  value.setUTCDate(1);value.setUTCMonth(value.getUTCMonth()+months);
  const last=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate();
  value.setUTCDate(Math.min(day,last));return value.toISOString().slice(0,10);
}
export function comparisonPeriod(from,to,preset='custom'){
  if (!validDate(from) || !validDate(to) || from>to) throw new Error('Periodo invalido.');
  const months={year:-12,quarter:-3,month:-1}[preset];
  if (months) return {from:shiftMonths(from,months),to:shiftMonths(to,months)};
  const days=Math.round((new Date(to+'T12:00:00Z')-new Date(from+'T12:00:00Z'))/86400000)+1;
  return {from:shiftDate(from,-days),to:shiftDate(from,-1)};
}
function employed(person,date){
  // Closing headcount includes the admission date and removes departures on their date.
  if (!validDate(person.entrada)) return null;
  if (person.saida && (!validDate(person.saida) || person.saida<person.entrada)) return null;
  if (person.entrada>date) return false;
  if (person.ativo===false && !person.saida) return null;
  return !person.saida || person.saida>date;
}
function emptyTeam(id){
  return {id,opening:0,closing:0,entries:0,exits:0,transfersIn:0,transfersOut:0,balance:0,netChange:0,
    dailyTotal:0,average:0,turnover:null,earlyExits:0,exitTenureDays:[],uncertain:new Set(),events:[]};
}

function currentComposition(persons){
  const teams=new Map(),contracts=new Map(),companies=new Map();
  const category=value=>{
    const label=typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' '):'';
    return {key:label.toLocaleLowerCase('pt'),label};
  };
  const add=(groups,value)=>{
    if(!groups.has(value.key)) groups.set(value.key,{...value,count:0});
    groups.get(value.key).count++;
  };
  for(const person of persons){
    const id=person.chefeId || '',contract=category(person.carga),company=category(person.empresa);
    if(!teams.has(id)) teams.set(id,{id,count:0,contracts:new Map(),companies:new Map()});
    const team=teams.get(id);team.count++;
    add(contracts,contract);add(companies,company);
    add(team.contracts,contract);add(team.companies,company);
  }
  const sorted=groups=>[...groups.values()].sort((a,b)=>Number(!a.key)-Number(!b.key) || b.count-a.count || a.label.localeCompare(b.label,'pt'));
  return {total:persons.length,contracts:sorted(contracts),companies:sorted(companies),
    teams:[...teams.values()].map(team=>({...team,contracts:sorted(team.contracts),companies:sorted(team.companies)}))};
}

export function workforceAnalytics({persons,history=[],historyEnabled=false,profile=null,from,to,today,teamId=null}){
  if (![from,to,today].every(validDate) || from>to) throw new Error('Confirma as datas do periodo.');
  if((new Date(to+'T12:00:00Z')-new Date(from+'T12:00:00Z'))/86400000>7320) throw new Error('O periodo maximo de analise e de 20 anos.');
  const end=to<today?to:today;
  const dates=[];
  for(let date=from;date<=end;date=shiftDate(date,1)) dates.push(date);
  const rowsByPerson=new Map(),teams=new Map(),eventMap=new Map();
  for(const row of historyEnabled?history:[]){
    if(!rowsByPerson.has(row.person_id)) rowsByPerson.set(row.person_id,[]);
    rowsByPerson.get(row.person_id).push(row);
  }
  for(const rows of rowsByPerson.values()) rows.sort((a,b)=>a.valid_from.localeCompare(b.valid_from));
  const team=id=>{id=id || '';if(!teams.has(id)) teams.set(id,{...emptyTeam(id),dailyCounts:Array(dates.length).fill(0)});return teams.get(id);};
  const visible=person=>!profile || profile.role==='admin' || person.id===profile.person_id || person.chefeId===profile.person_id;
  const assignment=(person,date)=>{
    const row=(rowsByPerson.get(person.id) || []).findLast(row=>row.valid_from<=date && (!row.valid_to || date<row.valid_to));
    if(historyEnabled && !row) return null;
    const value=row?{...person,role:row.role_code || '',chefeId:row.chefe_id || ''}:person;
    return visible(value)?value:null;
  };
  const addEvent=(key,event)=>{
    const previous=eventMap.get(key);
    eventMap.set(key,{...previous,...event});
  };
  const quality={missingEntry:0,missingExit:0,invalidDates:0};
  for(const person of persons){
    const own=rowsByPerson.get(person.id) || [];
    const current=assignment(person,today);
    if(current) team(current.chefeId);
    for(const row of own){
      const value={...person,chefeId:row.chefe_id || ''};
      if(visible(value)) team(value.chefeId);
    }
    const overlaps=!!current || own.some(row=>row.valid_from<=end && (!row.valid_to || row.valid_to>from));
    if(overlaps){
      if(!validDate(person.entrada)) quality.missingEntry++;
      if(person.ativo===false && !person.saida) quality.missingExit++;
      if((person.saida && !validDate(person.saida)) || (validDate(person.entrada) && validDate(person.saida) && person.saida<person.entrada)) quality.invalidDates++;
    }
    if(!dates.length) continue;
    for(const [date,field] of [[shiftDate(from,-1),'opening'],[end,'closing']]){
      const assigned=assignment(person,date);
      if(!assigned) continue;
      const exists=employed(person,date),group=team(assigned.chefeId);
      if(exists) group[field]++;
      else if(exists===null) group.uncertain.add(person.id);
    }
    for(const [index,date] of dates.entries()){
      const assigned=assignment(person,date);
      if(!assigned) continue;
      const exists=employed(person,date),group=team(assigned.chefeId);
      if(exists){group.dailyTotal++;group.dailyCounts[index]++;}
      else if(exists===null) group.uncertain.add(person.id);
    }
    for(const [field,type] of [['entrada','entry'],['saida','exit']]){
      if(validDate(person.entrada) && validDate(person.saida) && person.saida<person.entrada) continue;
      const date=person[field];
      if(!validDate(date) || date<from || date>end) continue;
      const assigned=assignment(person,date);if(!assigned) continue;
      const group=team(assigned.chefeId);
      group[type==='entry'?'entries':'exits']++;
      const tenure=validDate(person.entrada) && date>=person.entrada?Math.round((new Date(date+'T12:00:00Z')-new Date(person.entrada+'T12:00:00Z'))/86400000):null;
      if(type==='exit' && tenure!==null){group.exitTenureDays.push(tenure);if(tenure<=60) group.earlyExits++;}
      addEvent(type+'|'+person.id,{type,personId:person.id,date,teamId:assigned.chefeId || '',tenureDays:type==='exit'?tenure:null});
    }
    // At each visible interval boundary, count only team changes, not promotions.
    // A manager may see one side only; never invent the hidden team's identity.
    for(let i=0;i<own.length;i++){
      const row=own[i],id=row.chefe_id || '';
      if(!visible({...person,chefeId:id})) continue;
      for(const side of ['in','out']){
        const date=side==='in'?row.valid_from:row.valid_to;
        if(!date || date<from || date>end || !validDate(person.entrada) || person.entrada>=date || (person.saida && person.saida<date)) continue;
        const adjacent=own[side==='in'?i-1:i+1];
        const adjacentDate=side==='in'?adjacent?.valid_to:adjacent?.valid_from;
        if(adjacentDate===date && (adjacent.chefe_id || '')===id) continue;
        team(id)[side==='in'?'transfersIn':'transfersOut']++;
        addEvent('transfer|'+person.id+'|'+date,{type:'transfer',personId:person.id,date,
          ...(side==='in'?{toTeamId:id}:{fromTeamId:id})});
      }
    }
  }
  const events=[...eventMap.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.personId.localeCompare(b.personId));
  for(const group of teams.values()){
    group.balance=group.entries-group.exits;
    group.netChange=group.balance+group.transfersIn-group.transfersOut;
    group.average=dates.length?group.dailyTotal/dates.length:0;
    group.turnover=!group.uncertain.size && group.average>0?group.exits/group.average*100:null;
    group.events=events.filter(event=>event.type==='transfer'?event.fromTeamId===group.id || event.toTeamId===group.id:event.teamId===group.id);
    group.uncertainCount=group.uncertain.size;
    delete group.uncertain;
  }
  const all=[...teams.values()];
  const selected=teamId===null?all:all.filter(team=>team.id===teamId);
  const total=emptyTeam(null);
  for(const group of selected) for(const key of ['opening','closing','entries','exits','transfersIn','transfersOut','balance','netChange','dailyTotal','earlyExits']) total[key]+=group[key];
  total.average=dates.length?total.dailyTotal/dates.length:0;
  total.uncertainCount=selected.reduce((sum,group)=>sum+group.uncertainCount,0);
  total.turnover=!total.uncertainCount && total.average>0?total.exits/total.average*100:null;
  total.dailyCounts=dates.map((date,index)=>selected.reduce((sum,group)=>sum+group.dailyCounts[index],0));
  total.events=events.filter(event=>teamId===null || (event.type==='transfer'?event.fromTeamId===teamId || event.toTeamId===teamId:event.teamId===teamId));
  delete total.uncertain;
  const currentPeople=persons.filter(person=>{
    const assigned=assignment(person,today);
    return !person.historyOnly && person.ativo!==false && employed(person,today)!==false && assigned && (teamId===null || (assigned.chefeId || '')===teamId);
  }).map(person=>assignment(person,today));
  const modelGroups=new Map();
  for(const person of currentPeople){
    const model=typeof person.modeloComissional==='string'?person.modeloComissional.trim().replace(/\s+/g,' ').slice(0,80):'';
    const key=model.normalize('NFKC').toLocaleLowerCase('pt');
    if(!modelGroups.has(key)) modelGroups.set(key,{key,label:model || 'Por preencher',count:0,persons:[],teams:{}});
    const group=modelGroups.get(key),id=assignment(person,today).chefeId || '';
    group.count++;group.persons.push(person.id);group.teams[id]=(group.teams[id] || 0)+1;
  }
  const models=[...modelGroups.values()].sort((a,b)=>b.count-a.count || a.label.localeCompare(b.label,'pt'));
  const unknown=models.find(model=>model.key==='')?.count || 0;
  return {from,to:end,requestedTo:to,days:dates.length,truncated:to>today,quality,teams:all,total,series:dates.map((date,index)=>({date,count:total.dailyCounts[index]})),
    composition:currentComposition(currentPeople),models,currentPeople:currentPeople.map(person=>person.id),modelCoverage:currentPeople.length?(currentPeople.length-unknown)/currentPeople.length*100:null,unknownModels:unknown};
}
