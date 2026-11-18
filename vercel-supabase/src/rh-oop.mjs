import {createIcons,Plus,Pencil,History,RefreshCw,X,Check,Save,Archive,ArrowLeft,ArrowRight,ClipboardList,Target,Users,BarChart3,CalendarDays} from 'lucide';
import {STAGES,STAGE_STATUS,PRODUCTS,OUTCOMES,REASONS,ACTION_STATUS,DIAGNOSIS,newContact,setEndStage,validateContact,periodDates,todayLisbon,ratio,bucketTrend,priorities,officialMetrics} from './oop-model.mjs';
import {lisbonInput,fromLisbonInput} from './rh-fleet-model.mjs';
import {OopJournal} from './oop-journal.mjs';
const icons={Plus,Pencil,History,RefreshCw,X,Check,Save,Archive,ArrowLeft,ArrowRight,ClipboardList,Target,Users,BarChart3,CalendarDays};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
const command=(name,title,action,extra='')=>`<button type="button" class="btn oop-icon" title="${esc(title)}" aria-label="${esc(title)}" data-oop-action="${action}" ${extra}>${icon(name)}</button>`;
const date=v=>v?new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(v)):'—';
const percent=v=>v==null?'—':v.toLocaleString('pt-PT',{maximumFractionDigits:1})+'%';
const options=(values,selected,empty='Selecionar…')=>`<option value="">${esc(empty)}</option>`+Object.entries(values).map(([k,v])=>`<option value="${k}" ${k===selected?'selected':''}>${esc(v)}</option>`).join('');
export function mount(options){return new Oop(options);}
class Oop {
  constructor(options){
    Object.assign(this,options);this.view='overview';this.period='month';Object.assign(this,periodDates('month'));this.person='';this.team='';this.current=true;this.offset=0;this.actionOffset=0;this.actionStatus='active';this.trend='day';this.includeVoided=false;this.context=null;this.data=null;this.actions={items:[],total:0};this.loading=false;this.error='';this.notice='';this.pending={count:0,items:[],issues:[],durable:true};this.dialog=null;this.generation=0;
    this.session=0;this.root.innerHTML='<div class="oop-workspace"></div><div class="oop-modal-host"></div>';this.panel=this.root.firstElementChild;this.host=this.root.lastElementChild;
    this.root.addEventListener('click',e=>this.click(e));
    this.online=()=>{if(this.journal)this.flush();};window.addEventListener('online',this.online);
    this.unload=e=>{if(this.pending.count && !this.pending.durable){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',this.unload);
  }
  get admin(){return this.context?.profile.role==='admin';}
  get key(){return `rh-oop-drafts-v1:${this.getProjectId()}:${this.getUserId()}:`;}
  async rpc(name,args={}){const result=await this.getClient().rpc(name,args);if(result.error)throw new Error(result.error.message || 'Pedido indisponível.');return result.data;}
  personInfo(id){return this.context?.people.find(p=>p.id===id) || this.context?.teams.find(p=>p.id===id);}
  sellerRows(){
    const rows=[...this.data.sellers];
    if(this.admin || this.current)for(const p of this.context.people)if(p.active && p.current_member && p.role==='vendedor' && (!this.person || this.person===p.id) && (!this.team || this.team===p.ce_id) && !rows.some(r=>r.person_ref===p.id))rows.push({person_ref:p.id,person_name:p.name,effective:0,tv:0,energy:0,tv_opportunities:0,energy_opportunities:0,refusals:0});
    return rows;
  }
  avatar(id,name){const p=this.personInfo(id);return `<span class="oop-person">${p?.photo?`<img src="${esc(p.photo)}" alt="">`:`<span class="oop-avatar" aria-hidden="true">${esc((name || p?.name || '?').split(/\s+/).map(s=>s[0]).slice(0,2).join(''))}</span>`}<span>${esc(name || p?.name || 'Histórico')}</span></span>`;}
  async open(){
    if(!this.getProfile())return;
    try{
      this.context=await this.rpc('rh_oop_context');
      if(!this.journal){const uid=this.getUserId(),session=this.session;this.journal=new OopJournal({storage:localStorage,userId:uid,projectId:this.getProjectId(),rpc:(n,a)=>{if(this.getUserId()!==uid || this.session!==session)throw new Error('Sessão alterada.');return this.rpc(n,a);},onStatus:s=>{if(this.session!==session)return;const drained=this.pending.count>0 && s.count===0;this.pending=s;if(!this.dialog)this.render();if(drained && !this.dialog && !this.loading)void this.load();}});}
      await this.load();if(this.pending.count)void this.flush();
    }catch(e){this.error=/rh_oop_|does not exist|schema cache/.test(e.message)?'O módulo OOP ainda não está instalado neste ambiente.':e.message;this.render();}
  }
  async load(){
    if(!this.context)return;const generation=++this.generation;this.loading=true;this.error='';this.render();
    try{
      const data=await this.rpc('rh_oop_workspace',{p_from:this.from,p_to:this.to,p_person:this.person || null,p_team:this.admin?this.team || null:null,p_current:!this.admin && this.current && !this.person,p_offset:this.offset,p_limit:20,p_include_voided:this.includeVoided});
      const actions=await this.rpc('rh_oop_action_list',{p_person:this.person || null,p_team:this.admin?this.team || null:null,p_status:this.actionStatus,p_offset:this.actionOffset,p_limit:20,p_current:!this.admin && this.current && !this.person});
      if(generation!==this.generation)return;this.data=data;this.actions=actions;
    }catch(e){if(generation===this.generation)this.error=e.message;}
    finally{if(generation===this.generation){this.loading=false;this.render();}}
  }
  draw(){createIcons({icons,attrs:{'stroke-width':1.7}});}
  render(){
    const views=[['overview','Coordenação','bar-chart-3'],['seller','Vendedor','target'],['team','Equipa','users'],['history','Contactos','history'],['actions','Acompanhamentos','clipboard-list']].filter(([v])=>this.admin || v!=='overview');
    if(!this.admin && this.view==='overview')this.view='team';
    this.panel.innerHTML=`<div class="oop-top"><div><h2>Acompanhamento Comercial OOP</h2><span class="oop-muted">${esc(this.context?.profile.name || '')}${this.context?' · '+(this.admin?'Coordenação':'Gestor de equipa'):''}</span></div><div class="oop-tools">${this.context?`<button class="btn btn-primary" data-oop-action="new-contact">${icon('plus')}Novo contacto</button><button class="btn" data-oop-action="new-action">${icon('target')}Nova ação</button>`:''}${command('refresh-cw','Atualizar OOP','reload')}</div></div>
      <div class="oop-status ${this.error?'oop-error':''}" role="status" aria-live="polite">${esc(this.error || this.notice || (this.loading?'A carregar…':''))}</div>
      ${this.pending.count?`<section class="oop-pending" aria-label="Gravações pendentes"><strong>${this.pending.count} alteração(ões) ${this.pending.writing?'a guardar':'aguardam confirmação do servidor'}</strong>${!this.pending.durable?'<span class="oop-error">Armazenamento local indisponível. Mantém esta janela aberta.</span>':''}<button class="btn" data-oop-action="retry">${icon('refresh-cw')}Tentar guardar</button>${this.pending.issues.map(item=>`<div>${esc(item.error)} <button class="btn" data-oop-action="review-pending" data-id="${item.id}">${icon('pencil')}Rever</button>${command('archive','Descartar apenas esta alteração pendente','discard-pending',`data-id="${item.id}"`)}</div>`).join('')}</section>`:''}
      ${this.context?`<nav class="oop-tabs" aria-label="Análise comercial">${views.map(([v,label,i])=>`<button class="btn ${this.view===v?'selected':''}" data-oop-action="view" data-view="${v}" aria-current="${this.view===v?'page':'false'}">${icon(i)}${label}</button>`).join('')}</nav>${this.filters()}${this.data?this.body():''}`:''}`;
    this.panel.querySelectorAll('[data-oop-filter]').forEach(el=>el.addEventListener('change',()=>{
      const key=el.dataset.oopFilter;
      if(key==='period'){this.period=el.value;if(this.period!=='custom')Object.assign(this,periodDates(this.period));}
      else if(key==='voided')this.includeVoided=el.checked;
      else if(key==='current')this.current=el.value==='current';
      else{this[key]=el.value;if(['from','to'].includes(key))this.period='custom';}
      this.offset=0;this.actionOffset=0;this.notice='';void this.load();
    }));this.draw();
  }
  filters(){
    const people=this.context.people.map(p=>`<option value="${esc(p.id)}" ${this.person===p.id?'selected':''}>${esc(p.name)}${!p.current_member?' · histórico':!p.active?' · inativo':''}</option>`).join('');
    return `<div class="oop-filters"><label>Período<select data-oop-filter="period">${Object.entries({today:'Hoje',week:'Esta semana',month:'Este mês',custom:'Intervalo'}).map(([v,n])=>`<option value="${v}" ${this.period===v?'selected':''}>${n}</option>`).join('')}</select></label><label>De<input type="date" value="${esc(this.from)}" data-oop-filter="from"></label><label>Até<input type="date" value="${esc(this.to)}" data-oop-filter="to"></label>${this.admin?`<label>Equipa do contacto<select data-oop-filter="team"><option value="">Todas</option>${this.context.teams.map(t=>`<option value="${esc(t.id)}" ${this.team===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>`:`<label>Âmbito<select data-oop-filter="current"><option value="current" ${this.current?'selected':''}>Equipa atual · histórico completo</option><option value="history" ${!this.current?'selected':''}>Histórico acompanhado</option></select></label>`}<label>Vendedor<select data-oop-filter="person"><option value="">Todos</option>${people}</select></label>${this.view==='history'?`<label class="oop-check"><input type="checkbox" data-oop-filter="voided" ${this.includeVoided?'checked':''}>Incluir anulados</label>`:''}${this.view==='actions'?`<label>Estado<select data-oop-filter="actionStatus">${Object.entries({active:'Em aberto',all:'Todos',done:'Concluídos',cancelled:'Cancelados'}).map(([k,v])=>`<option value="${k}" ${this.actionStatus===k?'selected':''}>${v}</option>`).join('')}</select></label>`:''}</div>`;
  }
  body(){
    const d=this.data,c=d.counts;
    const kpi=(value,label)=>`<div><strong>${esc(value)}</strong><span>${label}</span></div>`;
    const summary=`<section class="oop-kpis" aria-label="Indicadores do período">${kpi(c.effective,'Contactos efetivos acompanhados')}${kpi(c.tv,'TV observadas')}${kpi(c.energy,'Energia observadas')}${kpi(percent(ratio(c.tv,c.tv_opportunities)),'Conversão TV observada')}${kpi(percent(ratio(c.energy,c.energy_opportunities)),'Conversão Energia observada')}${kpi(c.refusals,'Recusas')}${kpi(c.no_conversation,'Sem conversa')}</section>`;
    if(this.view==='history')return summary+this.contacts();
    if(this.view==='actions')return this.actionList();
    const selected=this.personInfo(this.person);
    return `${this.view==='seller' && selected?`<div class="oop-seller-heading">${this.avatar(selected.id,selected.name)}<span class="oop-muted">${esc(selected.ce_name || 'Histórico comercial')}</span></div>`:''}${summary}<div class="oop-analysis"><section><h3>Funil observado</h3>${this.funnel()}</section><section><h3>Dificuldades a acompanhar</h3>${this.priorityList()}<h3 class="oop-subhead">Motivos de recusa</h3>${this.reasons()}</section></div>${this.view==='overview'?this.teamTable():''}${this.view!=='seller'?this.sellerTable():''}${this.trendChart()}${this.official()}${this.view==='seller'?this.contacts()+this.actionList():''}`;
  }
  funnel(){
    const maximum=Math.max(1,...this.data.stages.map(s=>s.reached));
    return `<div class="oop-funnel">${this.data.stages.map(s=>`<div class="oop-stage-report"><div><strong>${s.stage}. ${esc(STAGES[s.stage-1][0])}</strong><span class="oop-muted">${s.reached} alcançaram · ${s.ended} terminaram aqui</span></div><div class="oop-stage-track" title="${s.good} bem; ${s.difficulty} dificuldade; ${s.omitted} não realizou; ${s.unobserved} não observado; ${s.no_objections} sem objeções">${[['good','good'],['difficulty','warn'],['omitted','bad'],['unobserved','neutral'],['no_objections','na']].map(([key,css])=>`<span class="${css}" style="width:${100*s[key]/maximum}%"></span>`).join('')}</div><div class="oop-stage-numbers"><span class="good-text">${s.good} bem</span><span class="warn-text">${s.difficulty} dificuldade</span><span class="bad-text">${s.omitted} não realizou</span><span>${s.not_reached} não chegaram</span>${s.no_objections?`<span>${s.no_objections} sem objeções</span>`:''}${s.unobserved?`<span>${s.unobserved} não observados</span>`:''}</div></div>`).join('')}</div>`;
  }
  priorityList(){const rows=priorities(this.data.stages);return rows.length?`<table class="oop-compact"><thead><tr><th>Competência</th><th>Dificuldade / não realizou</th><th>Avaliadas</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td>${esc(STAGES[s.stage-1][0])}</td><td>${s.issues}</td><td>${s.assessed}</td><td>${command('target','Definir treino nesta competência','new-action',`data-stage="${s.stage}"`)}</td></tr>`).join('')}</tbody></table>`:'<div class="oop-empty">Sem dificuldades registadas neste filtro.</div>';}
  reasons(){return this.data.reasons.length?`<ul class="oop-reasons">${this.data.reasons.map(r=>`<li><span>${esc(REASONS[r.reason] || 'Não registado')}</span><strong>${r.count}</strong></li>`).join('')}</ul>`:'<div class="oop-empty">Sem recusas registadas.</div>';}
  sellerTable(){return `<section class="oop-section"><h3>Evolução por vendedor</h3><div class="oop-table-wrap"><table><thead><tr><th>Vendedor</th><th>Contactos efetivos</th><th>TV</th><th>Energia</th><th>Conversão TV</th><th>Conversão Energia</th><th>Recusas</th><th></th></tr></thead><tbody>${this.sellerRows().map(p=>`<tr><td>${this.avatar(p.person_ref,p.person_name)}</td><td>${p.effective}</td><td>${p.tv}</td><td>${p.energy}</td><td>${percent(ratio(p.tv,p.tv_opportunities))} <small>(${p.tv_opportunities} oportunidades)</small></td><td>${percent(ratio(p.energy,p.energy_opportunities))} <small>(${p.energy_opportunities} oportunidades)</small></td><td>${p.refusals}</td><td>${command('bar-chart-3','Analisar vendedor','seller',`data-id="${esc(p.person_ref)}"`)}</td></tr>`).join('') || '<tr><td colspan="8">Sem contactos no período.</td></tr>'}</tbody></table></div></section>`;}
  teamTable(){return `<section class="oop-section"><h3>Equipas na data do contacto</h3><div class="oop-table-wrap"><table><thead><tr><th>Equipa / CE</th><th>Contactos efetivos</th><th>TV</th><th>Energia</th><th>Recusas</th><th></th></tr></thead><tbody>${this.data.teams.map(t=>`<tr><td>${this.avatar(t.ce_ref,t.ce_name)}</td><td>${t.effective}</td><td>${t.tv}</td><td>${t.energy}</td><td>${t.refusals}</td><td>${command('users','Analisar equipa','team',`data-id="${esc(t.ce_ref)}"`)}</td></tr>`).join('') || '<tr><td colspan="6">Sem contactos no período.</td></tr>'}</tbody></table></div></section>`;}
  trendChart(){
    const rows=bucketTrend(this.data.daily,this.trend),max=Math.max(1,...rows.map(r=>r.effective));
    return `<section class="oop-section"><div class="oop-section-head"><h3>Evolução dos contactos acompanhados</h3><div class="oop-tabs" aria-label="Escala temporal">${Object.entries({day:'Dia',week:'Semana',month:'Mês'}).map(([key,label])=>`<button class="btn ${this.trend===key?'selected':''}" data-oop-action="trend" data-scale="${key}">${label}</button>`).join('')}</div></div><div class="oop-trend" role="img" aria-label="Contactos efetivos por ${this.trend==='day'?'dia':this.trend==='week'?'semana':'mês'}">${rows.map(r=>`<div class="oop-trend-column" title="${esc(r.date)}: ${r.effective} contactos, ${r.tv} TV e ${r.energy} Energia"><strong>${r.effective}</strong><span class="oop-trend-track"><span style="height:${100*r.effective/max}%"></span></span><span>${esc(r.date.split('-').reverse().join('/'))}</span><small>${r.tv} TV · ${r.energy} ME</small></div>`).join('') || '<div class="oop-empty">Sem contactos no período.</div>'}</div></section>`;
  }
  official(){const d=officialMetrics(this.data.official);return `<section class="oop-official"><h3>Produção validada</h3>${d.available?`<span>${d.grossTv} TVs brutas · ${d.cancelledTv} anulações</span>${d.eligible?`<strong>${percent(d.cancellationRate)} de anulações</strong>`:'<span>Menos de 4 TVs brutas · sem avaliação percentual individual</span>'}`:'<span>TVs brutas e anulações: fonte oficial por definir</span>'}</section>`;}
  contacts(){return `<section class="oop-section"><div class="oop-section-head"><h3>Histórico de contactos</h3><span class="oop-muted">${this.data.total} registo(s)</span></div><div class="oop-table-wrap"><table><thead><tr><th>Data / hora</th><th>Vendedor</th><th>CE na data</th><th>Resultado</th><th>Término</th><th></th></tr></thead><tbody>${this.data.contacts.map(c=>`<tr class="${c.voided_at?'oop-voided':''}"><td>${date(c.occurred_at)}</td><td>${this.avatar(c.person_ref,c.person_name)}</td><td>${esc(c.ce_name)}</td><td><span class="oop-tag ${c.outcome==='refusal'?'bad':c.outcome==='followup'?'follow':''}">${c.voided_at?'Anulado':esc(OUTCOMES[c.outcome])}</span></td><td>${c.end_stage?esc(STAGES[c.end_stage-1][0]):'—'}</td><td>${command('clipboard-list','Consultar contacto','contact',`data-id="${c.id}"`)}</td></tr>`).join('') || '<tr><td colspan="6">Sem contactos no filtro selecionado.</td></tr>'}</tbody></table></div>${this.pager(this.offset,this.data.total,'contacts')}</section>`;}
  actionList(){return `<section class="oop-section"><div class="oop-section-head"><h3>Próximas ações e planos de treino</h3><span class="oop-muted">${this.actions.total} ação(ões)</span></div><div class="oop-action-list">${this.actions.items.map(a=>`<article class="oop-action-item"><div>${this.avatar(a.person_ref,a.person_name)}<span class="oop-tag ${a.status==='done'?'good':a.status==='cancelled'?'neutral':+new Date(a.due_at)<Date.now()?'bad':'follow'}">${esc(ACTION_STATUS[a.status])}</span></div><h4>${a.kind==='training'?'Treino · '+esc(STAGES[a.stage-1]?.[0] || ''):'Acompanhamento de contacto'}</h4><p>${esc(a.description)}</p><div class="oop-section-head"><span class="oop-muted">${date(a.due_at)}</span>${command('pencil','Consultar ou atualizar ação','action',`data-id="${a.id}"`)}</div></article>`).join('') || '<div class="oop-empty">Sem ações neste filtro.</div>'}</div>${this.pager(this.actionOffset,this.actions.total,'actions')}</section>`;}
  pager(offset,total,kind){return `<div class="oop-pager">${command('arrow-left','Página anterior','page',`data-kind="${kind}" data-step="-1" ${offset===0?'disabled':''}`)}<span>${total?offset+1:0}–${Math.min(offset+20,total)} / ${total}</span>${command('arrow-right','Página seguinte','page',`data-kind="${kind}" data-step="1" ${offset+20>=total?'disabled':''}`)}</div>`;}
  async click(event){
    const b=event.target.closest('[data-oop-action]');if(!b || !this.root.contains(b) || b.disabled)return;const action=b.dataset.oopAction,id=b.dataset.id;
    try{
      if(action==='reload')await this.open();
      if(action==='view'){this.view=b.dataset.view;if(this.view==='seller' && !this.person)this.person=this.context.people.find(p=>p.current_member && p.active && p.role==='vendedor')?.id || '';if(this.view==='team' && this.admin && !this.team)this.team=this.context.teams[0]?.id || '';this.offset=0;this.actionOffset=0;await this.load();}
      if(action==='seller'){this.person=id;this.team='';this.view='seller';this.offset=0;await this.load();}
      if(action==='team'){this.team=id;this.person='';this.view='team';this.offset=0;await this.load();}
      if(action==='trend'){this.trend=b.dataset.scale;this.render();}
      if(action==='page'){const key=b.dataset.kind==='contacts'?'offset':'actionOffset';this[key]=Math.max(0,this[key]+Number(b.dataset.step)*20);await this.load();}
      if(action==='new-contact')this.openContact();
      if(action==='contact')this.openContact(this.data.contacts.find(c=>c.id===id));
      if(action==='edit-contact'){let saved;try{saved=JSON.parse(localStorage.getItem(this.dialog.draftKey) || 'null');}catch{}if(saved?.version===this.dialog.data.version)this.dialog.data=saved;this.dialog.readOnly=false;this.drawContact();}
      if(action==='save-contact')await this.saveContact();
      if(action==='new-action')this.openAction(null,Number(b.dataset.stage) || null);
      if(action==='contact-action'){const d=this.dialog.data;this.openAction({id:crypto.randomUUID(),version:0,person_ref:d.person_ref,kind:'training',stage:d.end_stage || 5,contact_id:d.id,description:'',due_at:new Date(Date.now()+86400000).toISOString(),status:'open',progress:''});}
      if(action==='action')this.openAction(this.actions.items.find(a=>a.id===id));
      if(action==='save-action')await this.saveAction();
      if(action==='void-contact')this.openVoid();
      if(action==='confirm-void')await this.voidContact();
      if(action==='revisions')await this.showRevisions();
      if(action==='close')this.close();
      if(action==='retry')await this.flush();
      if(action==='discard-draft' && confirm('Descartar apenas este rascunho local?')){localStorage.removeItem(this.dialog.draftKey);this.host.innerHTML='';this.dialog=null;}
      if(action==='discard-pending' && confirm('Descartar apenas esta alteração pendente? Os dados já guardados no servidor não são apagados.')){this.journal.discard(id);this.render();}
      if(action==='review-pending'){
        const item=this.pending.items.find(i=>i.id===id);
        if(item && ['contact','action'].includes(item.kind))await this.reviewPending(item);
        else this.notice='A anulação pendente mantém o motivo original. Atualiza a lista antes de repetir ou descartar.';
      }
      if(action==='reapply-pending'){
        const {item,current}=this.dialog,data={...current,...item.args.p_data,id:current.id,version:current.version,pendingId:item.id};
        if(item.kind==='contact'){data.person_ref=current.person_ref;data.occurred_at=current.occurred_at;data.originalOutcome=current.outcome;data.revision_reason='';this.openContact(null,data);}
        else{data.person_ref=current.person_ref;data.kind=current.kind;data.contact_id=current.contact_id;this.openAction(data);}
      }
      if(action==='keep-server' && confirm('Manter a versão do servidor e descartar apenas a alteração pendente?')){this.journal.discard(this.dialog.item.id);this.close();await this.load();}
    }catch(e){this.showError(e.message);}
  }
  async reviewPending(item){
    const current=await this.rpc(item.kind==='contact'?'rh_oop_contact':'rh_oop_action',{p_id:item.args.p_id});
    if(!current || current.version===item.args.p_version){
      const data={...item.args.p_data,id:item.args.p_id,version:item.args.p_version,pendingId:item.id};
      if(item.kind==='contact')this.openContact(null,data);else this.openAction(data);return;
    }
    this.dialog={type:'conflict',item,current};
    const latest={...current.data,...current},labels={effective:'Conversa efetiva',product:'Oportunidade',outcome:'Resultado',end_stage:'Etapa de término',reason:'Motivo',fact:'Facto observado',objection:'Objeção',response:'Resposta',diagnosis:'Diagnóstico',stages:'Avaliações',followup_action:'Ação inicial',followup_at:'Data inicial',kind:'Tipo de ação',stage:'Competência',description:'Ação concreta',due_at:'Data de revisão',status:'Estado',progress:'Desfecho'};
    const display=(key,value)=>key==='stages'?value?.map(s=>`${s.stage}. ${STAGE_STATUS[s.status]}${s.note?' · '+s.note:''}`).join('\n'):key==='diagnosis'?Object.entries(value || {}).map(([k,v])=>`${({service:'Serviço',need:'Necessidade',decision:'Decisão',service_note:'Detalhe do serviço',need_note:'Detalhe da necessidade',decision_note:'Detalhe da decisão'})[k] || k}: ${DIAGNOSIS[v] || v}`).join('\n'):({product:PRODUCTS,outcome:OUTCOMES,reason:REASONS,status:ACTION_STATUS})[key]?.[value] || (typeof value==='boolean'?value?'Sim':'Não':value??'—');
    const changes=Object.entries(labels).filter(([key])=>Object.hasOwn(item.args.p_data,key) && JSON.stringify(latest[key])!==JSON.stringify(item.args.p_data[key]));
    this.modal('Rever versões antes de guardar',`<p>O servidor tem uma versão mais recente. A alteração pendente não foi aplicada.</p><div class="oop-table-wrap"><table><thead><tr><th>Campo diferente</th><th>No servidor · versão ${current.version}</th><th>Pendente · versão ${item.args.p_version}</th></tr></thead><tbody>${changes.map(([key,label])=>`<tr><th>${label}</th><td class="oop-compare">${esc(display(key,latest[key]))}</td><td class="oop-compare">${esc(display(key,item.args.p_data[key]))}</td></tr>`).join('')}</tbody></table></div><p>Reaplicar abre os dados pendentes para revisão sobre a versão atual. Confirma todos os campos antes de guardar.</p>`,`<button class="btn" data-oop-action="keep-server">Manter servidor</button>${!current.voided_at?'<button class="btn btn-primary" data-oop-action="reapply-pending">Reaplicar versão pendente</button>':''}`);
  }
  showError(text){const target=this.host.querySelector('[data-oop-error]');if(target)target.textContent=text;else{this.error=text;this.render();}}
  modal(title,body,footer){
    this.host.innerHTML=`<div class="oop-backdrop"><section class="oop-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2>${command('x','Fechar','close')}</header><div class="oop-error" data-oop-error role="alert"></div>${body}<footer>${footer}</footer></section></div>`;this.draw();this.host.querySelector('button,input,select')?.focus();
    this.host.querySelector('.oop-dialog').addEventListener('keydown',e=>{if(e.key==='Escape')this.close();if(e.key==='Tab'){const list=[...this.host.querySelectorAll('button,input,select,textarea,summary')].filter(x=>!x.disabled && x.getClientRects().length),i=list.indexOf(document.activeElement);if(e.shiftKey && i===0){e.preventDefault();list.at(-1)?.focus();}if(!e.shiftKey && i===list.length-1){e.preventDefault();list[0]?.focus();}}});
  }
  openContact(row,resume){
    const profile=this.context.profile;
    const selected=this.personInfo(this.person),data=resume || (row?{...structuredClone(row.data),...row,revision_reason:''}:newContact(selected?.active && selected.current_member && selected.role==='vendedor'?this.person:''));
    const draftKey=this.key+'contact:'+(data.version?data.id:'new');
    let saved;try{saved=JSON.parse(localStorage.getItem(draftKey) || 'null');}catch{}
    const canEdit=!row?.voided_at && (!row || this.admin || row.created_by===profile.user_id && this.personInfo(row.person_ref)?.current_member);
    this.dialog={type:'contact',data:resume || (!row && saved?.version===0?saved:data),originalOutcome:resume?.originalOutcome || row?.outcome,draftKey,readOnly:!!row,canEdit,pendingId:resume?.pendingId};this.drawContact();
  }
  captureContact(){
    const d=this.dialog?.data,form=this.host.querySelector('[data-oop-contact]');if(!form || this.dialog.readOnly)return d;
    for(const el of form.querySelectorAll('[data-field]')){if(!el.disabled)d[el.dataset.field]=el.value;}
    const effective=form.querySelector('[name=effective]:checked');if(effective)d.effective=effective.value==='yes';
    if(!d.version)try{d.occurred_at=fromLisbonInput(form.elements.occurred_input.value);}catch{d.occurred_at='';}
    if(form.elements.followup_input && !form.elements.followup_input.disabled)try{d.followup_at=fromLisbonInput(form.elements.followup_input.value);}catch{d.followup_at='';}
    for(const key of ['service','need','decision']){d.diagnosis[key]=form.querySelector(`[data-diagnosis=${key}]`)?.value || 'unknown';const note=form.querySelector(`[data-diagnosis-note=${key}]`);if(note)d.diagnosis[key+'_note']=note.value;}
    for(let i=1;i<=7;i++){const status=form.querySelector(`[name=stage-${i}]:checked`);if(status)d.stages[i-1].status=status.value;const note=form.querySelector(`[data-stage-note="${i}"]`);if(note)d.stages[i-1].note=note.value;}
    try{localStorage.setItem(this.dialog.draftKey,JSON.stringify(d));}catch{this.showError('Não foi possível guardar o rascunho neste dispositivo. Mantém esta janela aberta até guardar no servidor.');}return d;
  }
  drawContact(){
    const {data:d,readOnly,canEdit}=this.dialog;
    const people=this.context.people.filter(p=>p.id===d.person_ref || p.current_member && p.active && p.role==='vendedor');
    const person=people.find(p=>p.id===d.person_ref),ce=d.ce_name || person?.ce_name || this.context.profile.name;
    const stageHtml=STAGES.map(([name,question],i)=>{
      const s=d.stages[i] || {stage:i+1,status:'not_reached',note:''},unreached=d.end_stage && i+1>d.end_stage;
      return `<section class="oop-stage-input ${unreached?'unreached':''}"><div class="oop-section-head"><h3>${i+1}. ${esc(name)}</h3><label class="oop-check"><input type="checkbox" data-end="${i+1}" ${d.end_stage===i+1?'checked':''} ${unreached || readOnly?'disabled':''}>Terminou aqui</label></div><p class="oop-muted">${esc(question)}</p>${unreached?'<strong class="oop-muted">Não alcançada</strong>':`<div class="oop-stage-choices">${Object.entries(STAGE_STATUS).filter(([k])=>k!=='not_reached' && (k!=='no_objections' || i===5)).map(([key,label])=>`<label><input type="radio" name="stage-${i+1}" value="${key}" ${s.status===key?'checked':''} ${readOnly?'disabled':''}><span>${esc(label)}</span></label>`).join('')}</div>${['difficulty','omitted'].includes(s.status) || s.note?`<label class="oop-note">Facto observado<textarea data-stage-note="${i+1}" maxlength="500" ${readOnly?'disabled':''}>${esc(s.note)}</textarea></label>`:''}`}</section>`;
    }).join('');
    this.modal(d.version?'Contacto · '+date(d.occurred_at):'Novo contacto',`<form data-oop-contact><fieldset ${readOnly?'disabled':''}><div class="oop-form-grid"><label>Vendedor<select data-field="person_ref" ${d.version?'disabled':''}><option value="">Selecionar…</option>${people.map(p=>`<option value="${esc(p.id)}" ${d.person_ref===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>CE na data<input value="${esc(ce)}" readonly></label><label>Data / hora (Portugal)<input type="datetime-local" name="occurred_input" value="${esc(lisbonInput(d.occurred_at))}" ${d.version?'disabled':''}></label><div class="oop-modes"><label><input type="radio" name="effective" value="yes" ${d.effective?'checked':''}>Conversa efetiva</label><label><input type="radio" name="effective" value="no" ${!d.effective?'checked':''}>Sem conversa</label></div></div>${d.effective?`<div class="oop-form-grid"><label>Oportunidade<select data-field="product">${options(PRODUCTS,d.product)}</select></label><label>Resultado<select data-field="outcome">${options(Object.fromEntries(Object.entries(OUTCOMES).filter(([k])=>k!=='no_conversation')),d.outcome)}</select></label></div><div class="oop-stages">${stageHtml}</div><h3 class="oop-subhead">Diagnóstico</h3><div class="oop-form-grid">${[['service','Serviço atual'],['need','Necessidade'],['decision','Condição de decisão']].map(([key,label])=>`<label>${label}<select data-diagnosis="${key}">${Object.entries(DIAGNOSIS).map(([k,v])=>`<option value="${k}" ${d.diagnosis[key]===k?'selected':''}>${v}</option>`).join('')}</select></label>`).join('')}</div><div class="oop-form-grid"><label>Objeção concreta<textarea data-field="objection" maxlength="1500">${esc(d.objection)}</textarea></label><label>Resposta do vendedor<textarea data-field="response" maxlength="1500">${esc(d.response)}</textarea></label></div>`:''}<div class="oop-form-grid"><label>${d.effective?'Motivo do desfecho':'Motivo de não haver conversa'}<select data-field="reason">${options(Object.fromEntries(Object.entries(REASONS).filter(([k])=>d.effective?!['no_answer','no_start'].includes(k):['no_answer','no_start','interrupted','other','no_reason'].includes(k))),d.reason)}</select></label><label>Facto observado · sem dados identificativos do cliente<textarea data-field="fact" maxlength="1500">${esc(d.fact)}</textarea></label></div>${d.effective && d.outcome==='followup'?`<div class="oop-form-grid"><label>Próxima ação acordada<input data-field="followup_action" maxlength="500" value="${esc(d.followup_action)}" ${d.version?'disabled':''}></label><label>Data acordada<input type="datetime-local" name="followup_input" value="${esc(lisbonInput(d.followup_at))}" ${d.version?'disabled':''}></label></div>`:''}${d.version && !readOnly?`<label class="oop-note">Motivo da correção<input data-field="revision_reason" maxlength="500" value="${esc(d.revision_reason)}" required></label>`:''}</fieldset></form>${d.voided_at?'<p class="oop-error">Registo anulado · conservado no histórico</p>':''}`,`${d.version?`<button class="btn" data-oop-action="revisions">${icon('history')}Alterações</button>`:''}${readOnly?canEdit?`<button class="btn" data-oop-action="void-contact">${icon('archive')}Anular registo</button><button class="btn btn-primary" data-oop-action="edit-contact">${icon('pencil')}Corrigir</button>`:'':`<button class="btn" data-oop-action="discard-draft">${icon('archive')}Descartar rascunho</button><button class="btn btn-primary" data-oop-action="save-contact">${icon('save')}Guardar contacto</button>`}`);
    if(readOnly && person?.role==='historical')this.host.querySelector('[data-oop-action=edit-contact]')?.remove();
    if(readOnly && !d.voided_at && person?.active && (this.admin || person?.current_member))this.host.querySelector('footer').insertAdjacentHTML('afterbegin',`<button class="btn" data-oop-action="contact-action">${icon('target')}Definir treino</button>`);
    if(!readOnly && this.dialog.originalOutcome!=='followup')for(const el of this.host.querySelectorAll('[data-field="followup_action"],[name="followup_input"]'))el.disabled=false;
    for(const el of this.host.querySelectorAll('[data-diagnosis]'))if(d.diagnosis[el.dataset.diagnosis]==='known')el.parentElement.insertAdjacentHTML('beforeend',`<input data-diagnosis-note="${el.dataset.diagnosis}" maxlength="400" aria-label="Detalhe de ${esc(el.parentElement.firstChild.textContent)}" placeholder="Facto apurado, sem nome ou contacto do cliente" value="${esc(d.diagnosis[el.dataset.diagnosis+'_note'])}">`);
    this.draw();const form=this.host.querySelector('form');form.addEventListener('submit',e=>{e.preventDefault();void this.saveContact().catch(e=>this.showError(e.message));});
    form.addEventListener('input',()=>this.captureContact());
    form.addEventListener('change',e=>{
      if(this.dialog.readOnly)return;this.captureContact();
      if(e.target.dataset.end){this.dialog.data=setEndStage(this.dialog.data,e.target.checked?Number(e.target.dataset.end):null);this.captureDraft();this.drawContact();}
      else if(e.target.matches('[data-field=person_ref],[data-field=outcome],[data-diagnosis],[name=effective],[name^=stage-]'))this.drawContact();
    });
  }
  captureDraft(){try{localStorage.setItem(this.dialog.draftKey,JSON.stringify(this.dialog.data));}catch{}}
  async saveContact(){
    const d=this.captureContact(),errors=validateContact(d);if(d.version && !d.revision_reason?.trim())errors.push('Indica o motivo da correção.');if(errors.length){this.showError(errors.join('\n'));return;}
    const payload=Object.fromEntries(['person_ref','occurred_at','effective','product','outcome','end_stage','reason','fact','objection','response','diagnosis','stages','followup_at','followup_action','revision_reason'].filter(k=>d[k]!==undefined).map(k=>[k,d[k]]));
    await this.queue('contact',{p_id:d.id,p_version:d.version,p_data:payload},this.dialog.pendingId);try{localStorage.removeItem(this.dialog.draftKey);}catch{}this.dialog=null;this.host.innerHTML='';this.notice='Contacto na fila de gravação.';this.render();await this.flush();
  }
  openAction(row,stage){
    let d=row?structuredClone(row):{id:crypto.randomUUID(),version:0,person_ref:this.person,kind:'training',stage:stage || 5,contact_id:null,description:'',due_at:new Date(Date.now()+86400000).toISOString(),status:'open',progress:''};
    const draftKey=this.key+'action:'+(d.version?d.id:'new'+(d.contact_id || ''));
    let saved;try{saved=JSON.parse(localStorage.getItem(draftKey) || 'null');}catch{}
    if(!row?.pendingId && saved && saved.version===d.version && (!row || row.version>0 || saved.contact_id===d.contact_id))d=saved;
    const canEdit=this.personInfo(d.person_ref)?.role!=='historical' && (this.admin || this.personInfo(d.person_ref)?.current_member);this.dialog={type:'action',data:d,draftKey,readOnly:!!row?.version && !canEdit,pendingId:row?.pendingId};this.drawAction();
  }
  drawAction(){
    const d=this.dialog.data;
    this.modal(d.version?'Acompanhamento · '+d.person_name:'Nova ação',`<form data-oop-action-form><fieldset ${this.dialog.readOnly?'disabled':''}><div class="oop-form-grid"><label>Vendedor<select name="person_ref" ${d.version?'disabled':''}><option value="">Selecionar…</option>${this.context.people.filter(p=>p.id===d.person_ref || p.active && p.current_member && p.role==='vendedor').map(p=>`<option value="${esc(p.id)}" ${d.person_ref===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>Tipo<select name="kind" ${d.version?'disabled':''}>${options({training:'Plano de treino',followup:'Acompanhamento'},d.kind)}</select></label><label>Competência<select name="stage">${options(Object.fromEntries(STAGES.map((s,i)=>[i+1,s[0]])),String(d.stage || ''))}</select></label><label>Data de revisão / próxima ação<input type="datetime-local" name="due_input" value="${esc(lisbonInput(d.due_at))}"></label><label>Ação concreta<textarea name="description" maxlength="1500" required>${esc(d.description)}</textarea></label><label>Estado<select name="status">${options(ACTION_STATUS,d.status)}</select></label><label class="oop-wide">Desfecho observado / acompanhamento<textarea name="progress" maxlength="1500">${esc(d.progress)}</textarea></label></div></fieldset></form>`,`${d.version?`<button class="btn" data-oop-action="revisions">${icon('history')}Alterações</button>`:''}${!this.dialog.readOnly?`<button class="btn btn-primary" data-oop-action="save-action">${icon('save')}Guardar ação</button>`:''}`);
    const form=this.host.querySelector('form');form.addEventListener('input',()=>this.captureAction());form.addEventListener('change',()=>this.captureAction());form.addEventListener('submit',e=>{e.preventDefault();void this.saveAction().catch(e=>this.showError(e.message));});
  }
  captureAction(){
    const form=this.host.querySelector('[data-oop-action-form]'),d=this.dialog?.data;if(!form || this.dialog.readOnly)return d;
    for(const key of ['person_ref','kind','description','status','progress'])if(!form.elements[key].disabled)d[key]=form.elements[key].value;
    d.stage=Number(form.elements.stage.value) || null;try{d.due_at=fromLisbonInput(form.elements.due_input.value);}catch{d.due_at='';}
    try{localStorage.setItem(this.dialog.draftKey,JSON.stringify(d));}catch{this.showError('Rascunho local indisponível. Mantém esta janela aberta até guardar.');}return d;
  }
  async saveAction(){
    const form=this.host.querySelector('[data-oop-action-form]');if(!form.reportValidity())return;const d=this.captureAction();
    if(!d.person_ref || !d.kind || !d.due_at || !d.status || !d.description.trim() || d.kind==='training' && !d.stage){this.showError('Confirma o vendedor, a competência, a ação e a data.');return;}
    if(['done','cancelled'].includes(d.status) && !d.progress.trim()){this.showError('Regista o desfecho observado da ação.');return;}
    const payload=Object.fromEntries(['person_ref','kind','stage','contact_id','description','due_at','status','progress'].map(k=>[k,d[k]]));
    await this.queue('action',{p_id:d.id,p_version:d.version,p_data:payload},this.dialog.pendingId);try{localStorage.removeItem(this.dialog.draftKey);}catch{}this.dialog=null;this.host.innerHTML='';this.view='actions';this.notice='Ação na fila de gravação.';this.render();await this.flush();
  }
  openVoid(){const d=this.dialog.data;this.dialog={type:'void',data:d};this.modal('Anular contacto',`<p>${esc(d.person_name)} · ${date(d.occurred_at)}</p><label>Motivo<textarea data-void-reason maxlength="500" required></textarea></label><label class="oop-check"><input type="checkbox" data-void-confirm>Confirmo a anulação deste registo.</label>`,`<button class="btn" data-oop-action="confirm-void">${icon('archive')}Anular registo</button>`);}
  async voidContact(){const d=this.dialog.data,reason=this.host.querySelector('[data-void-reason]').value.trim();if(!reason || !this.host.querySelector('[data-void-confirm]').checked){this.showError('Indica o motivo e confirma a anulação.');return;}await this.queue('void',{p_id:d.id,p_version:d.version,p_reason:reason});this.dialog=null;this.host.innerHTML='';await this.flush();}
  async showRevisions(){const d=this.dialog.data,rows=await this.rpc('rh_oop_revisions',{p_id:d.id});this.modal('Histórico de alterações',`<ol class="oop-revisions">${rows.map(r=>`<li><strong>${date(r.created_at)}</strong><span>${esc(r.reason || 'Registo inicial / atualização de acompanhamento')}</span><small>Versão ${r.after_data?.version || '—'}</small><details><summary>Dados da revisão</summary><pre>${esc(JSON.stringify(r.after_data,null,2))}</pre></details></li>`).join('') || '<li>Sem alterações registadas.</li>'}</ol>`,'');this.dialog={type:'revisions',data:d};}
  async queue(kind,args,pendingId){
    if(pendingId && this.journal.running)throw new Error('Aguarda o fim da gravação antes de rever.');
    const request=this.journal.enqueue(kind,args);
    if(pendingId){if(this.journal.items.get(this.journal.prefix+request)?.volatile)throw new Error('Não foi possível substituir o pedido local; o original foi mantido.');this.journal.discard(pendingId);}
    if(!this.pending.durable){await this.journal.flush();if(this.pending.count)throw new Error('Não foi possível guardar localmente nem no servidor. Mantém esta janela aberta.');}
  }
  async flush(){await this.journal?.flush();if(!this.pending.count)this.notice='Alterações guardadas no servidor.';if(!this.dialog)await this.load();}
  close(){if(this.dialog?.type==='contact')this.captureContact();if(this.dialog?.type==='action')this.captureAction();this.host.innerHTML='';this.dialog=null;this.render();}
  reset(){this.generation++;this.session++;this.journal?.stop();this.journal=null;this.context=null;this.data=null;this.dialog=null;this.pending={count:0,items:[],issues:[],durable:true};this.panel.innerHTML='';this.host.innerHTML='';}
}
