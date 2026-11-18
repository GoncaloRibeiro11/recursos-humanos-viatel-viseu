import {validDate} from './rh-team-history.mjs';
export const STAGES=[['Apresentação inicial','Confirmou quem é e o motivo do contacto?'],['Criação de empatia','Escutou e adaptou a abordagem?'],['Diagnóstico das necessidades','Apurou necessidades e condições de decisão?'],['Apresentação do produto','Ligou a proposta ao diagnóstico?'],['Criação de valor','Explicou benefícios relevantes para este cliente?'],['Gestão de objeções','Esclareceu a objeção concreta apresentada?'],['Fecho','Propôs e confirmou uma decisão ou próximo passo?']];
export const STAGE_STATUS={good:'Fez bem',difficulty:'Com dificuldade',omitted:'Não realizou',unobserved:'Não observado',no_objections:'Não existiram objeções',not_reached:'Não chegou'};
export const PRODUCTS={tv:'TV / Telecomunicações',energy:'MEO Energia',both:'TV + MEO Energia',unidentified:'Não identificada'};
export const OUTCOMES={tv:'Venda TV',energy:'Venda MEO Energia',both:'Venda TV + Energia',refusal:'Recusa',followup:'Acompanhamento acordado',no_conversation:'Sem conversa'};
export const REASONS={price_value:'Preço / benefício',commitment:'Fidelização / penalização',satisfied:'Satisfeito com o serviço atual',no_change:'Não pretende mudar',decision_absent:'Decisor ausente',coverage:'Cobertura / instalação',need_unknown:'Necessidade não apurada',interrupted:'Conversa interrompida',no_reason:'Sem motivo declarado',other:'Outro motivo específico',no_answer:'Não abriu / não respondeu',no_start:'Não quis iniciar conversa'};
export const ACTION_STATUS={open:'Por fazer',in_progress:'Em curso',done:'Concluída',cancelled:'Cancelada'};
export const DIAGNOSIS={known:'Apurado',unknown:'Não apurado',not_applicable:'Não aplicável'};
export const todayLisbon=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function periodDates(mode,today=todayLisbon()){
  if(!validDate(today))throw new Error('Data inválida.');
  const d=new Date(today+'T12:00:00Z'),from=new Date(d);
  if(mode==='week')from.setUTCDate(from.getUTCDate()-((from.getUTCDay()+6)%7));
  if(mode==='month')from.setUTCDate(1);
  return {from:from.toISOString().slice(0,10),to:today};
}
export function newContact(personId='',at=new Date().toISOString()){
  return {id:crypto.randomUUID(),version:0,person_ref:personId,occurred_at:at,effective:true,product:'',outcome:'',end_stage:null,reason:'',fact:'',objection:'',response:'',diagnosis:{service:'unknown',need:'unknown',decision:'unknown'},stages:STAGES.map((_,i)=>({stage:i+1,status:'',note:''})),followup_at:'',followup_action:''};
}
export function setEndStage(data,stage){
  const copy=structuredClone(data);copy.end_stage=stage;
  copy.stages=STAGES.map((_,i)=>i+1>stage && stage?{stage:i+1,status:'not_reached',note:''}:{...copy.stages[i],status:copy.stages[i].status==='not_reached'?'':copy.stages[i].status});
  return copy;
}
const generic=value=>/^(?:o )?(?:cliente )?(?:n[aã]o quis|est[aá] caro|vai pensar)[.!\s]*$/i.test(String(value || '').trim());
export function validateContact(d,now=new Date()){
  const errors=[],at=new Date(d.occurred_at);
  if(!d.person_ref)errors.push('Seleciona o vendedor.');
  if(!Number.isFinite(+at) || +at>+now+120000)errors.push('Confirma a data e hora do contacto realizado.');
  if(typeof d.effective!=='boolean')errors.push('Indica se houve conversa.');
  if(!d.effective){if(!['no_answer','no_start','interrupted','other','no_reason'].includes(d.reason))errors.push('Indica por que não houve conversa.');if(generic(d.fact) || d.reason==='other' && !d.fact?.trim())errors.push('Regista o facto concreto observado.');if(typeof d.fact!=='string' || d.fact.length>1500)errors.push('Texto inválido ou demasiado longo.');return errors;}
  if(!Object.hasOwn(PRODUCTS,d.product) || !Object.hasOwn(OUTCOMES,d.outcome) || d.outcome==='no_conversation')errors.push('Seleciona a oportunidade e o resultado.');
  if(d.end_stage!=null && (!Number.isInteger(d.end_stage) || d.end_stage<1 || d.end_stage>7))errors.push('Etapa de término inválida.');
  if(!Array.isArray(d.stages) || d.stages.length!==7)errors.push('Avalia as sete etapas.');
  else d.stages.forEach((s,i)=>{
    if(s.stage!==i+1)errors.push('Sequência de etapas inválida.');
    if(d.end_stage && i+1>d.end_stage){if(s.status!=='not_reached')errors.push('As etapas posteriores ao término ficam como não alcançadas.');}
    else if(!['good','difficulty','omitted','unobserved',...(i===5?['no_objections']:[])].includes(s.status))errors.push('Avalia a etapa '+STAGES[i][0]+'.');
    if(['difficulty','omitted'].includes(s.status) && (!String(s.note || '').trim() || generic(s.note)))errors.push('Descreve o comportamento observado em '+STAGES[i][0]+'.');
    if(String(s.note || '').length>500)errors.push('A observação de etapa tem no máximo 500 caracteres.');
  });
  if(d.outcome==='refusal' && !Object.hasOwn(REASONS,d.reason))errors.push('Indica o motivo da recusa, ou Sem motivo declarado.');
  if((d.outcome==='refusal' && d.reason!=='no_reason' || d.reason==='other') && !String(d.fact || '').trim())errors.push('Descreve o facto concreto observado, sem dados pessoais.');
  if(generic(d.fact) || generic(d.objection))errors.push('Acrescenta o contexto concreto; uma frase genérica, por si só, não explica o que aconteceu.');
  if(String(d.objection || '').trim() && !String(d.response || '').trim())errors.push('Regista a resposta do vendedor, ou indica que não respondeu.');
  if(d.stages?.[5]?.status==='difficulty' && (!String(d.objection || '').trim() || !String(d.response || '').trim()))errors.push('Regista a objeção concreta e a resposta do vendedor.');
  if(d.stages?.[5]?.status==='no_objections' && d.objection?.trim())errors.push('Foi registada uma objeção. Revê a opção Não existiram objeções.');
  if(['tv','energy','both'].includes(d.outcome)){
    if(d.end_stage || ['not_reached','omitted'].includes(d.stages?.[6]?.status))errors.push('Numa venda concluída, confirma como decorreu o fecho.');
    if(d.outcome==='tv' && !['tv','both'].includes(d.product) || d.outcome==='energy' && !['energy','both'].includes(d.product) || d.outcome==='both' && d.product!=='both')errors.push('A oportunidade trabalhada não corresponde à venda indicada.');
  }
  if(d.outcome==='followup' && (!d.followup_action?.trim() || !Number.isFinite(+new Date(d.followup_at)) || +new Date(d.followup_at)<=+at))errors.push('Indica a ação acordada e uma data posterior ao contacto.');
  for(const key of ['fact','objection','response'])if(typeof d[key]!=='string' || d[key].length>1500)errors.push('Texto inválido ou demasiado longo.');
  if(!['service','need','decision'].every(k=>Object.hasOwn(DIAGNOSIS,d.diagnosis?.[k])))errors.push('Confirma os três campos do diagnóstico.');
  for(const key of ['service','need','decision'])if(d.diagnosis?.[key]==='known' && (!d.diagnosis[key+'_note']?.trim() || d.diagnosis[key+'_note'].length>400))errors.push('Regista o detalhe do diagnóstico apurado.');
  return [...new Set(errors)];
}
export const ratio=(n,d)=>d?Math.round(n*1000/d)/10:null;
export function officialMetrics(input){
  const gross=input?.gross_tv,cancelled=input?.cancelled_tv;
  if(input?.available!==true || !input.cohort || !Number.isInteger(gross) || !Number.isInteger(cancelled) || gross<0 || cancelled<0 || cancelled>gross)return {available:false,grossTv:null,cancelledTv:null,cancellationRate:null,eligible:false};
  return {available:true,grossTv:gross,cancelledTv:cancelled,cancellationRate:gross>=4?ratio(cancelled,gross):null,eligible:gross>=4};
}
export function bucketTrend(daily,mode='day'){
  const groups=new Map();
  for(const row of daily){
    if(!validDate(row.date))continue;let key=row.date;
    if(mode==='month')key=key.slice(0,7);else if(mode==='week')key=periodDates('week',key).from;
    const value=groups.get(key) || {date:key,effective:0,tv:0,energy:0,refusals:0};
    for(const field of ['effective','tv','energy','refusals'])value[field]+=Number(row[field]) || 0;groups.set(key,value);
  }
  return [...groups.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function priorities(stages){
  return stages.map(s=>({...s,assessed:Number(s.good)+Number(s.difficulty)+Number(s.omitted),issues:Number(s.difficulty)+Number(s.omitted)})).filter(s=>s.issues>0).sort((a,b)=>b.issues-a.issues || a.stage-b.stage);
}
