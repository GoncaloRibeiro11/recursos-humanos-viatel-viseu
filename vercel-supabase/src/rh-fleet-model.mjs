export const OPERATIONS={initial:'Entrega inicial',temporary:'Passagem temporária',permanent:'Atribuição permanente',return:'Devolução à empresa'};
export const CONDITIONS=['Bom','Suf','Mau','NE','NA'];
const group=(id,label,page,top,step,columns,items)=>({id,label,page,columns,items:items.map(([key,label],index)=>({key,label,top:top+index*step}))});
export const INSPECTION_GROUPS=[
  group('doc','Documentos',0,281.6,13.2,[208.4,227,246.6,265.8,285],[['doc_dua','DUA ou similar'],['doc_contract','Contrato de aluguer'],['doc_manual','Manual de instruções'],['doc_service','Livro de revisões'],['doc_fuel','Cartão de combustível'],['doc_toll','Via Verde'],['doc_cartrack','Sistema Cartrack'],['doc_other1','Outro 1'],['doc_other2','Outro 2']]),
  group('glass','Vidros',0,281.6,13.2,[455.8,475,494.2,513.4,532.6],[['glass_front','Para-brisas'],['glass_lf','Vidro lateral esquerdo frente'],['glass_rf','Vidro lateral direito frente'],['glass_lr','Vidro lateral esquerdo trás'],['glass_rr','Vidro lateral direito trás'],['glass_back','Vidro de retaguarda'],['glass_mirror_l','Espelho exterior esquerdo'],['glass_mirror_r','Espelho exterior direito'],['glass_light_f','Óticas frente / piscas'],['glass_light_r','Óticas traseiras / piscas'],['glass_side','Luzes laterais'],['glass_other','Outro']]),
  group('eq','Equipamentos',0,466.4,13.2,[208.4,227,246.6,265.8,285],[['eq_radio','Rádio'],['eq_mirror','Espelho interno'],['eq_triangle','Triângulo'],['eq_vest','Colete refletor'],['eq_jack','Macaco'],['eq_wrench','Chave de rodas'],['eq_spare','Pneu sobresselente / kit'],['eq_rack','Grade'],['eq_wheels','Jantes'],['eq_caps','Tampões'],['eq_roof','Barras de tejadilho'],['eq_stickers','Autocolantes'],['eq_antenna','Antena'],['eq_other','Outro']]),
  group('int','Interior',0,466.4,13.2,[455.8,475,494.2,513.4,532.6],[['int_roof','Forro do tejadilho'],['int_driver','Banco do condutor'],['int_passenger','Banco do passageiro'],['int_back','Banco traseiro'],['int_mats','Tapetes'],['int_other','Outro']]),
  group('level','Níveis',0,572,13.2,[455.8,475,494.2,513.4,532.6],[['level_engine','Óleo do motor'],['level_brake','Óleo dos travões'],['level_water','Água'],['level_tyres','Estado dos pneus'],['level_other1','Outro 1'],['level_other2','Outro 2']]),
  group('body','Chaparia',1,80.2,12.6,[215,235.4,256,276.6],[['body_bumper_f','Para-choques frente'],['body_grill','Grelha frente'],['body_hood','Capot'],['body_roof','Tejadilho'],['body_left','Painel e portas esquerda'],['body_right','Painel e portas direita'],['body_back','Painel traseiro'],['body_bumper_r','Para-choques traseiro'],['body_sill_r','Embaladeira direita'],['body_sill_l','Embaladeira esquerda'],['body_other1','Outro 1'],['body_other2','Outro 2']]),
  group('cargo','Carroçaria',1,80.2,12.6,[458,478.6,499.2,519.8],[['cargo_left','Lateral esquerda'],['cargo_right','Lateral direita'],['cargo_back','Traseira'],['cargo_front','Frente'],['cargo_floor','Piso'],['cargo_stand','Cavalete'],['cargo_middle','Cavalete meio'],['cargo_tail','Taipal'],['cargo_lights','Luzes laterais'],['cargo_other1','Outro 1'],['cargo_other2','Outro 2'],['cargo_other3','Outro 3']])
];
// The document checklist has date-only rows between its condition rows.
const docTops=[281.6,321.2,347.6,360.8,374,387.2,400.4,413.6,426.8];
INSPECTION_GROUPS[0].items.forEach((item,index)=>item.top=docTops[index]);
const columns=[[209.21,227.81,246.41,265.01,283.61],[456.65,474.65,491.21,509.81,526.25]];
for(const group of INSPECTION_GROUPS)group.columns=group.page===1?(group.id==='body'?[215.81,233.21,250.61,268.01]:[448.25,468.65,489.05,509.45]):columns[['glass','int','level'].includes(group.id)?1:0];
export const INSPECTION_ITEMS=INSPECTION_GROUPS.flatMap(group=>group.items);
export const TEMPLATE_VERSION=1;
export function driverName(operation,kind,person={}){
  const value=operation.driver_fields?.[kind]?.name;
  if(typeof value==='string' && value.trim())return value.trim();
  if(person?.id)return String(person.name || '').trim();
  return String(operation.signature_receipts?.[kind]?.signer_name || '').trim();
}
export function inspectionProgress(inspection={}){
  return {complete:INSPECTION_ITEMS.filter(item=>CONDITIONS.includes(inspection[item.key])).length,total:INSPECTION_ITEMS.length};
}
export function validateHandover(data,vehicle,current,now=new Date()){
  const errors=[];
  if(!OPERATIONS[data.kind])errors.push('Seleciona a operação.');
  if(!data.place?.trim() || !data.reason?.trim())errors.push('Indica local e motivo.');
  const at=new Date(data.at);
  if(!data.at || !Number.isFinite(+at))errors.push('Indica uma data e hora válidas.');
  else if(+at>+now)errors.push('A entrega ainda não ocorreu. Guarda-a como rascunho.');
  if(current && +at<=+new Date(current.from_at))errors.push('A operação tem de ser posterior à entrega atual.');
  if(!Number.isInteger(Number(data.odometer)) || data.odometer==='' || data.odometer==null || Number(data.odometer)<Number(vehicle.odometer) || Number(data.odometer)>99999999)errors.push('Confirma os quilómetros; não podem diminuir.');
  if(!['Reserva','1/4','1/2','3/4','Cheio'].includes(data.fuel))errors.push('Confirma o combustível.');
  if(data.kind!=='return' && (!data.to_person_id || data.to_person_id===current?.person_id))errors.push('Seleciona quem recebe, diferente de quem entrega.');
  if(data.kind==='initial' && current)errors.push('A viatura já tem um responsável.');
  if(['temporary','return'].includes(data.kind) && !current)errors.push('A viatura não tem uma entrega em curso.');
  if(data.kind==='temporary' && (!data.expected_return || +new Date(data.expected_return)<=+at || !Number.isFinite(+new Date(data.expected_return))))errors.push('Indica a devolução prevista posterior à entrega.');
  for(const group of INSPECTION_GROUPS)for(const item of group.items){
    const value=data.inspection?.[item.key];
    if(!CONDITIONS.includes(value) || (group.page===1 && value==='NE')){errors.push('Completa todos os itens da inspeção.');break;}
  }
  if(Object.values(data.inspection || {}).includes('Mau') && !data.damage_notes?.trim())errors.push('Justifica os itens em mau estado.');
  if(!data.zone_name?.trim())errors.push('Indica o responsável de zona.');
  if(!data.checked)errors.push('Confirma a verificação da entrega real.');
  return [...new Set(errors)];
}
export function lisbonInput(value){
  if(!value)return '';
  const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
  const get=type=>parts.find(part=>part.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function fromLisbonInput(value){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || ''))return '';
  const nominal=Date.parse(value+'Z');if(!Number.isFinite(nominal))return '';
  const options=[nominal,nominal-3600000].filter(date=>lisbonInput(date)===value);
  return options.length===1?new Date(options[0]).toISOString():'';
}
export function custodyAt(rows,vehicleId,date){
  return rows.find(row=>row.vehicle_id===vehicleId && +new Date(row.from_at)<=+new Date(date) && (!row.to_at || +new Date(date)<+new Date(row.to_at))) || null;
}
