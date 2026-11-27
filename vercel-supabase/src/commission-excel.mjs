import {read,utils} from 'xlsx';

export const MONTHS=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
const text=v=>v==null||v==='(em branco)'?'':v instanceof Date?v.toISOString().slice(0,10):String(v);
const title=v=>text(v).toLocaleLowerCase('pt-PT').replace(/(^|[\s-])\p{L}/gu,s=>s.toLocaleUpperCase('pt-PT'));
const nif=v=>/^\d{9}$/.test(text(v))?text(v):null;
const money=(v,where)=>{if(v==null||v==='')return 0;if(typeof v!=='number'||!Number.isFinite(v))throw Error('Valor não numérico em '+where+'. Abre o Excel e confirma o valor calculado.');return v;};
const VF=[[7,'Brutos mês','n'],[8,'Anulados mês','n'],[9,'Líquidos mês','n'],[10,'Líquidos TVs','i'],[11,'Líquidos MEs','i'],[12,'Instalados','n'],[13,'A pagamento (produção)','n'],[14,'TVs instaladas','i'],[17,'% instalados','p']];
const CF=[[6,'Brutos mês','n'],[7,'Anulados mês','n'],[8,'Líquidos mês','n'],[9,'Líquidos TVs','i'],[10,'Líquidos MEs','i'],[11,'Instalados','n'],[12,'A pagamento (produção)','n'],[13,'TVs instaladas','i'],[16,'% instalados','p']];
const VE=[[6,'Tabela base','t'],[15,'Escalão vendedor','i'],[18,'TCO zona / vendedor','p'],[19,'Fator TCO (prémios)','n'],[21,'Prémio de escalão indicado','e'],[22,'Critérios para atribuição','t'],[23,'Atribuição do prémio','t'],[25,'Prémio objetivo','e'],[26,'Total prémios indicado','e']];
const CE=[[5,'Tabela base','t'],[14,'Escalão chefe','i'],[17,'TCO zona / vendedor','p'],[18,'Fator TCO (prémios)','n'],[20,'Número de viaturas','n'],[21,'Objetivo mínimo','n'],[22,'Desvio do objetivo','n'],[24,'Prémio de escalão indicado','e'],[25,'Critérios para atribuição','t'],[26,'Atribuição do prémio','t'],[28,'Prémio objetivo','e'],[29,'Total prémios indicado','e']];
const fields=(r,defs)=>defs.map(([c,label,type])=>({label,type,value:r[c-1] instanceof Date?String(r[c-1].getUTCMonth()+1).padStart(2,'0')+'/'+r[c-1].getUTCFullYear():r[c-1]??null}));

export function filePeriod(name){
 const s=norm(name),year=s.match(/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/)?.[1],month=MONTHS.findIndex(m=>new RegExp('(?:^|[^A-Z])'+norm(m)+'(?:[^A-Z]|$)').test(s));
 return year&&month>=0?year+'-'+String(month+1).padStart(2,'0')+'-01':null;
}
export function discoverFiles(files){
 const groups=new Map();
 for(const file of files){
  const name=file.name||'',kind=/^PAGAMENTOS/i.test(name)?'pay':/^DETALHES/i.test(name)?'detail':null;
  if(!kind||name.startsWith('~$')||! /\.(xlsx|xlsm|xls)$/i.test(name))continue;
  const period=filePeriod(name);if(!period)continue;
  const g=groups.get(period)||{period,pay:[],detail:[]};g[kind].push(file);groups.set(period,g);
 }
 return [...groups.values()].sort((a,b)=>b.period.localeCompare(a.period)).map(g=>({...g,error:g.pay.length!==1||g.detail.length!==1?'É necessário exatamente um PAGAMENTOS e um DETALHES para este mês.':''}));
}
export function matrix(sheet){
 if(!sheet)return [];
 const range=utils.decode_range(sheet['!ref']||'A1');if(range.e.r>250000||range.e.c>300)throw Error('Folha demasiado extensa para este importador.');
 const result=[];
 for(let r=0;r<=range.e.r;r++){
  const cells=sheet['!data']?.[r],row=[];
  for(let c=0;c<=range.e.c;c++){
   const cell=cells?cells[c]:sheet[utils.encode_cell({r,c})];
   row[c]=!cell?null:cell.t==='e'?(cell.w||'#ERRO'):cell.f&&cell.v==null?'#SEM VALOR CALCULADO':cell.v??null;
  }
  result.push(row);
 }
 return result;
}
async function workbook(file){
 if(file.size>32*1024*1024)throw Error(file.name+': excede 32 MB.');
 return read(await file.arrayBuffer(),{type:'array',dense:true,cellDates:true,cellFormula:true,cellText:true});
}
function paymentSheet(book,period){
 const label=MONTHS[Number(period.slice(5,7))-1]+' '+period.slice(0,4);
 const sheets=book.SheetNames.filter(name=>!norm(name).includes('RESUMO')).map(name=>({name,rows:matrix(book.Sheets[name])})).filter(s=>norm(s.rows[4]?.[4])===norm(label));
 if(sheets.length!==1)throw Error(label+': folha de pagamento ambígua ou mês diferente do nome do ficheiro.');
 const s=sheets[0],offset=s.rows[6]?.indexOf('Total')-59;
 if(offset!==0&&!(offset===3&&s.rows[7]?.[20]==='Vencimento Base'))throw Error(label+': formato de colunas não reconhecido. Nenhum valor foi importado.');
 if(offset)s.rows=s.rows.map(r=>[...r.slice(0,12),...r.slice(12+offset)]);
 if(s.rows[6]?.[5]!=='Nome Completo'||s.rows[6]?.[59]!=='Total')throw Error(label+': cabeçalhos de pagamento não reconhecidos.');
 return s;
}
const roleName=r=>norm(r).replace(/_/g,' ').replace(/\s+/g,' ');
const personalRole=r=>/^(COORDENADOR|GESTOR (DE )?PARCEIR)/.test(roleName(r));
const chiefRole=r=>/^(CHEFE|GESTOR (DE )?EQUIPA)/.test(roleName(r));

export function parseMonth({payBook,detailBook,payName,detailName,period,coordinator,aliases={}}){
 const source=paymentSheet(payBook,period),rows=source.rows,label=MONTHS[Number(period.slice(5,7))-1]+' '+period.slice(0,4);
 const detailNameSheet=detailBook.SheetNames.find(s=>norm(s)==='DETALHE DE VARIAVEIS');if(!detailNameSheet)throw Error(detailName+': falta a folha Detalhe de Variáveis.');
 const detail=matrix(detailBook.Sheets[detailNameSheet]),vpColumn=detail[5]?.findIndex(v=>norm(v)==='VP')??-1;
 const adjustments=matrix(detailBook.Sheets[detailBook.SheetNames.find(s=>norm(s)==='ACERTOS DIVERSOS')]);
 const sellers=matrix(payBook.Sheets[payBook.SheetNames.find(s=>norm(s).endsWith('_VDD'))]);
 const chiefs=matrix(payBook.Sheets[payBook.SheetNames.find(s=>norm(s).endsWith('_CHEE'))]);
 const sourcePeople=rows.map((r,i)=>({r,line:i+1})).filter(({r})=>norm(r[8])===norm(coordinator)&&(nif(r[4])||(r[5]&&(r[6]||typeof r[59]==='number'))));
 if(!sourcePeople.length)throw Error(label+': sem pessoas da coordenação escolhida.');
 const ids=new Set(),teamChiefs=new Map();
 for(const {r} of sourcePeople){
  if(!nif(r[4]))throw Error(label+': NIF em falta ou inválido no mapa de pagamentos.');
  if(!text(r[5]).trim())throw Error(label+': nome em falta no mapa de pagamentos.');
  if(!/^(VENDEDOR|GESTOR COMERCIAL)/.test(roleName(r[6]))&&!personalRole(r[6])&&!chiefRole(r[6]))throw Error(label+': função nova no mapa; confirmar o formato antes de importar.');
  if(ids.has(nif(r[4])))throw Error(label+': NIF repetido no mapa de pagamentos.');ids.add(nif(r[4]));
 }
 for(const team of new Set(sourcePeople.filter(({r})=>!personalRole(r[6])).map(({r})=>text(r[7])))){
  const members=sourcePeople.filter(({r})=>text(r[7])===team&&!personalRole(r[6]));
  let leaders=members.filter(({r})=>norm(r[13])==='TAB_CHEE');if(!leaders.length)leaders=members.filter(({r})=>chiefRole(r[6]));
  if(leaders.length!==1)throw Error(label+': não foi possível identificar um único chefe para a equipa '+team+'.');teamChiefs.set(team,nif(leaders[0].r[4]));
 }
 const parsed=[];
 for(const {r,line} of sourcePeople){
  const id=nif(r[4]),owner='p'+id,name=title(r[5]),team=text(r[7]),personal=personalRole(r[6]),chief=norm(r[13])==='TAB_CHEE',rubrics=[],sourceAnnotations=[];
  const numeric=(v,c)=>money(v,payName+' · linha '+line+' · coluna '+c);
  for(const c of [...Array.from({length:36},(_,i)=>i+18),55,56,57,59]){
   if(typeof r[c-1]==='string'&&!r[c-1].startsWith('#')){if(r[c-1].trim())sourceAnnotations.push({column:c,value:r[c-1]});continue;}
   const amount=numeric(r[c-1],c);if(amount!==0)rubrics.push({label:text((c<54?rows[7]?.[c-1]:null)||rows[6]?.[c-1]||'Outros').replace(/\n/g,' '),amount,column:c});
  }
  if(r[59]==null||typeof r[59]!=='number')throw Error(label+': total em falta ou sem resultado calculado, linha '+line+'.');
  const total=numeric(r[59],60);if(Math.abs(rubrics.reduce((s,x)=>s+x.amount,0)-total)>.005)throw Error(label+': as rubricas não correspondem ao total, linha '+line+'.');
  const p={id:owner,name,role:text(r[6]).replace(/_/g,' '),team,total,sourceRow:line,chief,file:'',rubrics,sourceAnnotations,period:label};
  const payload={mode:'team',teamName:team,period:label,monthNum:Number(period.slice(5,7)),partial:false,defaultPerson:owner,people:[p],records:[],productionVdd:[],productionChe:[],adjustments:[],checks:[],sourcePay:payName,sourceDetail:detailName,sourceSheet:source.name};
  const myAdjustments=adjustments.map((a,i)=>({a,line:i+1})).filter(({a})=>norm(a[1])===norm(coordinator)&&norm(a[4])===norm(team)&&(norm(a[5])===norm(name)||(!a[5]&&chief)));
  const chiefDetailTeam=chief||chiefRole(r[6])?team:aliases[id];
  if(!personal&&!chiefDetailTeam&&(numeric(r[36],37)!==0||numeric(r[47],48)!==0))throw Error(label+': falta a equipa histórica de chefia para conferir comissões anteriores, linha '+line+'.');
  let technical=false;
  for(let i=0;i<detail.length;i++){
   const d=detail[i];if(norm(d[9])!==norm(coordinator))continue;
   const isTechnical=norm(d[13]).includes(' (TECNICOS)')&&norm(d[13]).replace(' (TECNICOS)','')===norm(name);technical ||= isTechnical;
   const components=[];
   if(nif(d[14])===id||isTechnical)components.push([false,money(d[20],detailName+' · linha '+(i+1)+' · comissão vendedor')]);
   if(!personal&&(chief||numeric(r[36],37)!==0||numeric(r[47],48)!==0)&&norm(d[12])===norm(chiefDetailTeam))components.push([true,money(d[21],detailName+' · linha '+(i+1)+' · comissão chefe')]);
   for(const [isChief,amount] of components)payload.records.push({owner,ownerName:name,chief:isChief,line:i+1,period:label,client:text(d[4]),nif:text(d[5]),service:text(d[7]),sale:text(d[1]),item:text(d[2]),origin:text(d[0]).replace(/_/g,' '),event:text(d[18]),status:text(d[8]),month:text(d[17]),seller:text(d[13]),amount,credits:vpColumn>=0&&typeof d[vpColumn]==='number'?d[vpColumn]:null});
  }
  for(let i=0;i<sellers.length;i++){
   const s=sellers[i];if(norm(s[3])!==norm(coordinator))continue;
   if(nif(s[1])===id||(!nif(s[1])&&norm(s[0])===norm(name)))payload.productionVdd.push({owner,name:text(s[0]),sourceTeam:text(s[2]),row:i+1,sheet:'Resumo Produção_Vdd',period:label,metrics:fields(s,VF),criteria:fields(s,VE)});
  }
  if(chief)for(let i=0;i<chiefs.length;i++){const c=chiefs[i];if(norm(c[2])===norm(coordinator)&&norm(c[0])===norm(team))payload.productionChe.push({owner,name:text(c[0]),row:i+1,sheet:'Resumo Produção_Chee',period:label,metrics:fields(c,CF),criteria:fields(c,CE)});}
  for(const {a,line:adjustmentLine} of myAdjustments){const amount=money(a[6],detailName+' · acerto linha '+adjustmentLine);payload.adjustments.push({owner,person:name,description:text(a[0]).replace(/_/g,' · '),amount,month:a[7] instanceof Date?String(a[7].getUTCMonth()+1).padStart(2,'0')+'/'+a[7].getUTCFullYear():a[7]??null,notes:a[8]??null,row:adjustmentLine,period:label,included:rubrics.some(x=>Math.abs(x.amount-amount)<.005)});}
  if(personal)payload.personalNotice='O mapa de detalhe não tem uma coluna de comissão específica para esta função. O pagamento pessoal segue o mapa de pagamentos; não foi repartido pelos clientes.';
  else{
   const columns=[28,30,32,34,37,46,47,48,...(technical?[43,44]:[]),...(payload.records.some(d=>/^(ACERTOS|ANULADOS)/.test(d.origin))?[29,31,33,35]:[])];
   const extra=myAdjustments.reduce((sum,{a})=>sum+(rubrics.some(x=>columns.includes(x.column)&&[29,31,33,35].includes(x.column)&&Math.abs(x.amount-money(a[6],detailName))<.005)?money(a[6],detailName):0),0);
   const expected=columns.reduce((sum,c)=>sum+numeric(r[c-1],c),0)-extra,detailTotal=payload.records.reduce((sum,d)=>sum+d.amount,0),difference=expected-detailTotal;
   if(Math.abs(difference)>.005)payload.checks.push({owner,person:name,month:label,payment:expected,detail:detailTotal,difference});
  }
  parsed.push({period,owner_nif:id,chief_nif:personal?null:teamChiefs.get(team),source_name:name,total,payload});
 }
 return parsed;
}

export async function prepareFiles(files,periods,knownNifs=[],coordinator='',progress=()=>{},aliases={}){
 const groups=discoverFiles(files).filter(g=>periods.includes(g.period));
 if(groups.length!==new Set(periods).size||!groups.length)throw Error('Seleciona pelo menos um mês válido.');
 const loaded=[],allCoordinators=new Set(),candidates=new Set(),known=new Set(knownNifs);
 for(const g of groups){
  if(g.error)throw Error(g.period+': '+g.error);progress('A ler '+g.pay[0].name+'…');
  const payBook=await workbook(g.pay[0]),s=paymentSheet(payBook,g.period);
  for(const r of s.rows)if(nif(r[4])&&r[8]){allCoordinators.add(text(r[8]));if(known.has(nif(r[4])))candidates.add(text(r[8]));}
  loaded.push({g,payBook});
 }
 const chosen=coordinator|| (candidates.size===1?[...candidates][0]:'');
 if(!chosen||!allCoordinators.has(chosen))return {coordinators:[...allCoordinators].sort(),needsCoordinator:true};
 const rows=[];
 for(const {g,payBook} of loaded){
  progress('A ler '+g.detail[0].name+'…');
  const historical=Array.isArray(aliases)?Object.fromEntries(aliases.filter(r=>r.period<=g.period).map(r=>[r.owner_nif,r.team])):aliases;
  rows.push(...parseMonth({payBook,detailBook:await workbook(g.detail[0]),payName:g.pay[0].name,detailName:g.detail[0].name,period:g.period,coordinator:chosen,aliases:historical}));
 }
 const identities=[...new Map(rows.map(r=>[r.owner_nif,{nif:r.owner_nif,source_name:r.source_name}])).values()];
 return {version:1,identities,rows,coordinator:chosen};
}
