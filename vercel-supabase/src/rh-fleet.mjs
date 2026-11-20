import {createIcons,Car,Plus,Pencil,ArrowRightLeft,History,FileText,RefreshCw,X,Check,Save,Download,Archive,Lock,Undo2,Trash2,Paperclip,Link,Copy,Share2} from 'lucide';
import {signaturePad} from './fleet-signature-pad.mjs';
import {fetchAllRows} from './rh-sync.mjs';
import {OPERATIONS,CONDITIONS,VEHICLE_STATES,showVehicleInspection,vehicleSaveData,INSPECTION_GROUPS,inspectionProgress,validateHandover,lisbonInput,fromLisbonInput,handoverOrigin,DAMAGE_VIEW,adoptInitialDraftVersion,handoverLabel,driverName,filterFleetVehicles} from './rh-fleet-model.mjs';
const icons={Car,Plus,Pencil,ArrowRightLeft,History,FileText,RefreshCw,X,Check,Save,Download,Archive,Lock,Undo2,Trash2,Paperclip,Link,Copy,Share2};
const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>value && typeof value==='object'?(Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]))):value;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const core=value=>{const result={...value};delete result.signatures;delete result.signature_receipts;delete result.checked;return result;};
const date=value=>value?new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)):'—';
const day=value=>value?value.split('-').reverse().join('/'):'—';
const fileLabel=name=>name==='auto-v1.pdf'?'Auto original arquivado':/^auto-fotos-v1-[a-f0-9]{64}\.pdf$/.test(name)?'Auto com fotografias arquivado':name.replace(/^[a-f0-9-]{36}-/,'');
const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
const button=(name,title,action,extra='')=>`<button type="button" class="btn fleet-icon" data-action="${action}" title="${esc(title)}" aria-label="${esc(title)}" ${extra}>${icon(name)}</button>`;
const statusLabel={draft:'Rascunho',confirmed:'Confirmado',cancelled:'Cancelado'};
export function mount(options){return new Fleet(options);}
export function mountRemoteEditor(options,payload){
  const v=payload.payload.vehicle,h=payload.handover,from=payload.payload.from_person,to=payload.payload.to_person;
  const app=new Fleet({...options,remote:true,isAdmin:()=>true,getUserId:()=>payload.link_id,getPersons:()=>[from,to].filter(p=>p.id).map(p=>({...p,ativo:true})),getProfile:()=>({display_name:h.data.zone_name})});
  app.vehicles=[v];app.handovers=[h];app.custody=from.id?[{id:h.expected_custody_id,vehicle_id:v.id,person_id:from.id,person_name:from.name,from_at:''}]:[];app.loaded=true;
  const local=app.localDraft();const resume=local?.id===h.id && local.version===h.version?local:null;
  app.openHandover(v,h,resume);return app;
}
class Fleet {
  constructor(options){
    Object.assign(this,options);this.vehicles=[];this.handovers=[];this.custody=[];this.pendingDeletes=[];this.page='vehicles';this.search='';this.personFilter='';this.vehicleFilter='';this.showArchived=false;this.loaded=false;this.loading=false;this.dialog=null;this.busy=false;this.draftSaving=null;this.dirty=false;this.uploadingCount=0;
    this.root.innerHTML='<div class="fleet-workspace"></div><div class="fleet-modal-host"></div>';
    this.panel=this.root.querySelector('.fleet-workspace');this.host=this.root.querySelector('.fleet-modal-host');
    this.root.addEventListener('click',event=>this.click(event));
    window.addEventListener('online',()=>{if(this.dialog?.type==='handover' && !this.dialog.readOnly)this.saveDraft().catch(()=>{});});
    this.beforeUnload=event=>{if(this.dirty || this.draftSaving){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',this.beforeUnload);
  }
  get client(){return this.getClient();}get persons(){return this.getPersons();}
  get storageKey(){return 'rh-fleet-draft-v1:'+this.getUserId();}
  person(id,name='Empresa / parque'){const person=this.persons.find(p=>p.id===id);return person || {id,name};}
  personHtml(id,name){const person=this.person(id,name),p=name?{...person,name}:person;return `<span class="fleet-person">${p.photo?`<img src="${esc(p.photo)}" alt="">`:''}<span>${esc(p.name)}</span></span>`;}
  holder(id){return this.custody.find(item=>item.vehicle_id===id && !item.to_at);}
  canRegisterInitial(v){return v.active && v.habitual_person_id && !this.custody.some(c=>c.vehicle_id===v.id) && !this.handovers.some(h=>h.vehicle_id===v.id && h.status==='confirmed');}
  canDeleteVehicle(v){return !this.handovers.some(h=>h.vehicle_id===v.id) && !this.custody.some(c=>c.vehicle_id===v.id && c.origin!=='initial_state');}
  vehicle(id){return this.vehicles.find(v=>v.id===id);}
  localDraft(){try{return JSON.parse(localStorage.getItem(this.storageKey) || 'null');}catch{return null;}}
  stash(){
    if(!this.dialog || this.dialog.readOnly)return;
    try{localStorage.setItem(this.storageKey,JSON.stringify(this.dialog));}catch{this.message('Não foi possível guardar o rascunho neste navegador. Mantém esta janela aberta até guardar no servidor.',true);}
  }
  clearStash(){try{localStorage.removeItem(this.storageKey);}catch{}}
  status(text,error=false){const target=this.host.querySelector('[data-fleet-status]');if(target){target.textContent=text;target.classList.toggle('fleet-error',error);}}
  message(text,error=false){const target=this.host.querySelector('[data-fleet-message]') || this.panel.querySelector('[data-fleet-message]');if(target){target.textContent=text;target.classList.toggle('fleet-error',error);}}
  async rpc(name,args){const result=await this.client.rpc(name,args);if(result.error)throw new Error(result.error.message || 'Não foi possível guardar no servidor.');return Array.isArray(result.data)?result.data[0]:result.data;}
  async open(personId){
    if(!this.isAdmin())return;
    if(personId!==undefined){this.personFilter=personId;this.page='vehicles';}
    if(!this.loaded)await this.load();else this.render();
  }
  async load(){
    if(this.loading || !this.isAdmin())return;this.loading=true;this.render();
    try{
      await this.rpc('rh_fleet_version',{});
      this.vehicles=await fetchAllRows(this.client,'rh_fleet_vehicles',['plate']);
      this.handovers=await fetchAllRows(this.client,'rh_fleet_handovers',['number']);
      this.custody=await fetchAllRows(this.client,'rh_fleet_custody',['from_at','id']);
      this.loaded=true;this.error='';
      try{this.pendingDeletes=(await this.rpc('rh_fleet_pending_deletions',{})).items || [];}catch{this.pendingDeletes=[];}
    }catch(error){this.error=error.message.includes('rh_fleet_version')?'A configuração da frota ainda não está instalada no servidor.':error.message;}
    finally{this.loading=false;this.render();}
  }
  render(){
    if(this.remote){this.panel.innerHTML='';return;}
    if(!this.isAdmin()){this.panel.innerHTML='';this.host.innerHTML='';return;}
    const data=filterFleetVehicles(this.vehicles,{page:this.page,includeArchived:this.showArchived,personId:this.personFilter,vehicleId:this.vehicleFilter,search:this.search,persons:this.persons,custody:this.custody,handovers:this.handovers});
    const available=this.vehicles.filter(v=>v.active && !this.holder(v.id)).length;
    const late=this.handovers.filter(h=>h.status==='confirmed' && h.data.kind==='temporary' && h.data.expected_return && +new Date(h.data.expected_return)<Date.now() && this.holder(h.vehicle_id)?.handover_id===h.id).length;
    const personOptions=this.persons.filter(p=>!p.historyOnly).sort((a,b)=>a.name.localeCompare(b.name,'pt')).map(p=>`<option value="${esc(p.id)}" ${this.personFilter===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
    const vehicleOptions=this.vehicles.map(v=>`<option value="${v.id}" ${this.vehicleFilter===v.id?'selected':''}>${esc(v.plate)}</option>`).join('');
    this.panel.innerHTML=`<div class="fleet-bar"><h2>Frota</h2><button type="button" class="btn btn-primary" data-action="new-vehicle">${icon('plus')}Adicionar viatura</button><button type="button" class="btn" data-action="template">${icon('file-text')}Modelo do auto</button>${button('refresh-cw','Recarregar frota','reload')}<span class="fleet-status">${this.loading?'A carregar…':''}</span></div>
      <div data-fleet-message class="fleet-error" role="status" aria-live="polite">${esc(this.error || '')}</div>
      <div class="fleet-totals"><div><strong>${this.vehicles.filter(v=>v.active).length}</strong><small>Viaturas ativas</small></div><div><strong>${available}</strong><small>Disponíveis</small></div><div class="${late?'fleet-late':''}"><strong>${late}</strong><small>Devoluções em atraso</small></div></div>
      <div class="fleet-tabs" role="tablist" aria-label="Frota">${[['vehicles','Viaturas'],['handovers','Autos'],['history','Histórico']].map(([key,label])=>`<button type="button" class="btn ${this.page===key?'selected':''}" role="tab" aria-selected="${this.page===key}" data-action="page" data-page="${key}">${label}</button>`).join('')}</div>
      <div class="fleet-filter"><input aria-label="Pesquisar matrícula, Cartrack ou colaborador" placeholder="Matrícula, Cartrack, colaborador…" value="${esc(this.search)}" data-filter="search"><label>Colaborador <select data-filter="person"><option value="">Todos</option>${personOptions}</select></label><label>Viatura <select data-filter="vehicle"><option value="">Todas</option>${vehicleOptions}</select></label><label class="fleet-check"><input type="checkbox" data-filter="archived" ${this.showArchived?'checked':''}>Incluir arquivadas</label></div>
      ${this.localDraft()?'<div class="fleet-bar"><button type="button" class="btn" data-action="resume">Retomar rascunho local</button>'+button('trash-2','Eliminar apenas o rascunho deste navegador','discard-local')+'</div>':''}
      ${this.page==='vehicles'?this.vehiclesHtml(data):this.page==='handovers'?this.handoversHtml(data):this.historyHtml(data)}`;
    this.panel.querySelectorAll('[data-filter]').forEach(input=>input.addEventListener(input.dataset.filter==='search'?'input':'change',()=>{
      const key=input.dataset.filter,value=input.value;
      if(key==='search')this.search=value;if(key==='person')this.personFilter=value;if(key==='vehicle')this.vehicleFilter=value;if(key==='archived')this.showArchived=input.checked;
      const cursor=input.selectionStart;this.render();if(key==='search'){const next=this.panel.querySelector('[data-filter=search]');next.focus();next.setSelectionRange(cursor,cursor);}
    }));
    if(this.page!=='vehicles')this.panel.querySelector('[data-filter=archived]')?.closest('label').remove();
    if(this.pendingDeletes.length)this.panel.querySelector('.fleet-tabs').insertAdjacentHTML('beforebegin',`<div class="fleet-bar fleet-error" role="status">${this.pendingDeletes.length} auto(s) eliminado(s) com anexos por limpar.<button class="btn" type="button" data-action="cleanup-deleted">${icon('refresh-cw')}Tentar limpar anexos</button></div>`);
    for(const row of this.panel.querySelectorAll('[data-fleet-vehicle]'))row.querySelector('.fleet-actions').insertAdjacentHTML('beforeend',button('trash-2','Eliminar viatura','delete-vehicle',`data-id="${row.dataset.fleetVehicle}"`));
    if(this.page==='handovers')for(const row of this.panel.querySelectorAll('tbody tr')){const id=row.querySelector('[data-action=edit-handover]').dataset.id;row.querySelector('.fleet-actions').insertAdjacentHTML('beforeend',button('trash-2','Eliminar auto','delete-handover',`data-id="${id}"`));}
    this.drawIcons();
  }
  vehiclesHtml(vehicles){
    if(!vehicles.length)return '<div class="fleet-empty">Sem viaturas nesta seleção.</div>';
    return `<div class="fleet-table-wrap"><table><thead><tr><th>Viatura</th><th>N.º Cartrack</th><th>Responsável habitual</th><th>Quem tem agora</th><th>Km</th><th>Devolução prevista</th><th>Validades</th><th>Ações</th></tr></thead><tbody>${vehicles.map(v=>{
      const holder=this.holder(v.id),current=holder && this.handovers.find(h=>h.id===holder.handover_id),expected=current?.data.kind==='temporary'?current.data.expected_return:null;
      const custodyLabel=holder?.origin==='initial_state'?'Situação inicial · sem auto anterior':date(holder?.from_at);
      return `<tr data-fleet-vehicle="${v.id}"><td class="fleet-cell"><strong>${esc(v.plate)}</strong><span class="fleet-small">${esc(v.make_model)}${v.company?' · '+esc(v.company):''}${!v.active?' · Arquivada':''}</span><span class="fleet-small">${esc(VEHICLE_STATES[v.vehicle_condition] || 'Estado por definir')}</span></td><td>${esc(v.cartrack_number) || '—'}</td><td>${v.habitual_person_id?this.personHtml(v.habitual_person_id):'—'}</td><td>${holder?this.personHtml(holder.person_id,holder.person_name)+'<span class="fleet-small">'+custodyLabel+'</span>':'Disponível / empresa'}</td><td>${Number(v.odometer).toLocaleString('pt-PT')}</td><td class="${expected && +new Date(expected)<Date.now()?'fleet-late':''}">${date(expected)}</td><td><span class="fleet-small ${v.insurance_until && v.insurance_until<new Date().toISOString().slice(0,10)?'fleet-late':''}">Seguro: ${day(v.insurance_until)}</span>${showVehicleInspection(v)?`<span class="fleet-small ${v.inspection_until && v.inspection_until<new Date().toISOString().slice(0,10)?'fleet-late':''}">Inspeção: ${day(v.inspection_until)}</span>`:''}</td><td><div class="fleet-actions">${button('pencil','Editar viatura','edit-vehicle',`data-id="${v.id}"`)}${v.active?button('arrow-right-left',holder?'Passar ou devolver viatura':'Registar entrega inicial','handover',`data-id="${v.id}"`):''}${this.canRegisterInitial(v)?button('check','Registar situação inicial','initial-state',`data-id="${v.id}"`):''}${button('history','Histórico da viatura','vehicle-history',`data-id="${v.id}"`)}</div></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  handoversHtml(vehicles){
    const ids=new Set(vehicles.map(v=>v.id));const rows=this.handovers.filter(h=>ids.has(h.vehicle_id)).sort((a,b)=>b.number-a.number);
    return rows.length?`<div class="fleet-table-wrap"><table><thead><tr><th>Auto</th><th>Viatura</th><th>Operação</th><th>Data / hora</th><th>Recebe</th><th>Estado</th><th>Ações</th></tr></thead><tbody>${rows.map(h=>`<tr><td>FRO-${String(h.number).padStart(5,'0')}</td><td>${esc(h.snapshot?.vehicle?.plate || this.vehicle(h.vehicle_id)?.plate)}${this.vehicle(h.vehicle_id)?.active===false?'<span class="fleet-small">Viatura arquivada</span>':''}</td><td>${esc(handoverLabel(h.data))}</td><td>${date(h.data.at)}</td><td>${h.data.destination==='external_structure'?esc(driverName(h.data,'to',h.snapshot?.to_person)):h.snapshot?esc(h.snapshot.to_person.name):this.personHtml(h.data.to_person_id)}</td><td>${statusLabel[h.status]}</td><td><div class="fleet-actions">${button(h.status==='draft'?'pencil':'file-text',h.status==='draft'?'Editar rascunho':'Consultar auto','edit-handover',`data-id="${h.id}"`)}${h.status!=='cancelled'?button('download','Descarregar auto PDF','pdf',`data-id="${h.id}"`):''}${h.status==='draft'?button('x','Cancelar rascunho','cancel-handover',`data-id="${h.id}"`):''}</div></td></tr>`).join('')}</tbody></table></div>`:'<div class="fleet-empty">Sem autos nesta seleção.</div>';
  }
  historyHtml(vehicles){
    const ids=new Set(vehicles.map(v=>v.id));const rows=this.custody.filter(c=>ids.has(c.vehicle_id)).sort((a,b)=>+new Date(b.from_at)-+new Date(a.from_at));
    const autoLink=h=>h?`<button type="button" class="btn" data-action="edit-handover" data-id="${h.id}">${icon('file-text')}FRO-${String(h.number).padStart(5,'0')}</button>`:'—';
    return rows.length?`<div class="fleet-table-wrap"><table><thead><tr><th>Viatura</th><th>Responsável</th><th>Desde</th><th>Até</th><th>Auto de entrada</th><th>Auto de saída</th></tr></thead><tbody>${rows.map(c=>{
      const h=this.handovers.find(h=>h.id===c.handover_id);
      const exit=c.to_at && this.handovers.find(h=>h.status==='confirmed' && h.expected_custody_id===c.id && +new Date(h.data.at)===+new Date(c.to_at));
      return `<tr><td>${esc(this.vehicle(c.vehicle_id)?.plate)}${this.vehicle(c.vehicle_id)?.active===false?'<span class="fleet-small">Viatura arquivada</span>':''}</td><td>${this.personHtml(c.person_id,c.person_name)}</td><td>${c.origin==='initial_state'?'Início desconhecido':date(c.from_at)}</td><td>${c.to_at?date(c.to_at):'Em curso'}</td><td>${c.origin==='initial_state'?'<span class="fleet-small">Situação inicial · sem auto anterior<br>Registo: '+date(c.initial_recorded_at)+'</span>':autoLink(h)}</td><td>${autoLink(exit)}</td></tr>`;
    }).join('')}</tbody></table></div>`:'<div class="fleet-empty">Sem entregas confirmadas nesta seleção.</div>';
  }
  drawIcons(){createIcons({icons,attrs:{'stroke-width':1.7}});}
  async click(event){
    const control=event.target.closest('[data-action]');if(!control || !this.root.contains(control) || control.disabled)return;
    const {action,id}=control.dataset;
    try{
      if(action==='page'){this.page=control.dataset.page;this.render();}
      if(action==='reload')await this.load();
      if(action==='template'){const response=await this.authFetch('/api/fleet-auto?template=1');this.downloadBlob(await response.blob(),'modelo-auto-viaturas.pdf');}
      if(action==='new-vehicle')this.openVehicle();
      if(action==='edit-vehicle')this.openVehicle(this.vehicle(id));
      if(action==='delete-vehicle')this.openDeleteVehicle(this.vehicle(id));
      if(action==='confirm-delete-vehicle')await this.deleteVehicle();
      if(action==='vehicle-autos'){this.vehicleFilter=id;this.page='handovers';this.personFilter='';this.search='';this.showArchived=true;this.host.innerHTML='';this.dialog=null;this.render();}
      if(action==='delete-handover')await this.openDeleteHandover(this.handovers.find(h=>h.id===id));
      if(action==='confirm-delete-handover')await this.deleteHandover();
      if(action==='cleanup-deleted'){control.disabled=true;try{for(const item of this.pendingDeletes)await this.shareApi({action:'cleanup-deleted',id:item.id});await this.load();}finally{control.disabled=false;}}
      if(action==='handover')this.openHandover(this.vehicle(id));
      if(action==='initial-state')this.openInitialState(this.vehicle(id));
      if(action==='register-initial-state')await this.registerInitialState();
      if(action==='vehicle-history'){this.vehicleFilter=id;this.page='history';this.render();}
      if(action==='edit-handover'){const h=this.handovers.find(h=>h.id===id);this.openHandover(this.vehicle(h.vehicle_id),h);}
      if(action==='resume'){const d=this.localDraft();if(d?.type==='vehicle')this.openVehicle(null,d);if(d?.type==='handover')this.openHandover(this.vehicle(d.vehicleId),null,d);}
      if(action==='discard-local' && confirm('Eliminar apenas o rascunho deste navegador? Os autos já guardados no servidor e o histórico são mantidos.')){this.clearStash();this.render();}
      if(action==='close')await this.close();
      if(action==='save-vehicle')await this.saveVehicle();
      if(action==='save-draft'){await this.saveDraft();this.status('Rascunho guardado no servidor');}
      if(action==='remote-submit'){await this.saveDraft();await this.onRemoteSubmit(this.dialog.version,this.dialog.data);this.clearStash();this.dirty=false;this.dialog=null;this.host.innerHTML='';}
      if(action==='create-link')await this.createShare(control.dataset.purpose);
      if(action==='refresh-shares')await this.refreshShares();
      if(action==='revoke-links' && confirm('Cancelar as ligações e invalidar as assinaturas remotas recolhidas neste auto?')){await this.shareApi({action:'revoke',id:this.dialog.id});await this.refreshShares();}
      if(action==='copy-share'){await navigator.clipboard.writeText(this.host.querySelector('[data-share-url]').value);this.status('Ligação copiada');}
      if(action==='send-share'){const url=this.host.querySelector('[data-share-url]').value;if(navigator.share)await navigator.share({title:'Auto de viatura',text:'Ligação privada para o auto de viatura',url});else window.open('https://wa.me/?text='+encodeURIComponent('Auto de viatura: '+url),'_blank','noopener,noreferrer');}
      if(action==='confirm')await this.confirmHandover();
      if(action==='pdf')await this.downloadPdf(id);
      if(action==='draft-pdf'){await this.saveDraft();await this.downloadPdf(this.dialog.id);}
      if(action==='cancel-handover' && confirm('Cancelar este rascunho? Não altera o histórico da viatura.')){const h=this.handovers.find(h=>h.id===id);await this.rpc('rh_fleet_cancel_handover',{p_id:id,p_version:h.version});await this.load();}
      if(action==='batch'){
        const group=control.dataset.group,value=this.host.querySelector(`[data-batch="${group}"]`).value;
        if(value){for(const input of this.host.querySelectorAll(`[data-group="${group}"]`))if(!input.value)input.value=value;this.capture();this.scheduleSave();this.updateProgress();}
      }
      if(action==='clear-signature'){delete this.dialog.data.signatures[control.dataset.kind];const canvas=this.host.querySelector(`[data-signature="${control.dataset.kind}"]`);canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);this.stash();this.scheduleSave();}
      if(action==='undo-damage'){this.dialog.data.damage_markers.pop();this.paintDamage();this.stash();this.scheduleSave();}
      if(action==='download-file')await this.downloadFile(control.dataset.path);
    }catch(error){this.message(error.message,true);this.status('Não guardado / requer revisão',true);}
  }
  showDialog(title,body,footer){
    this.host.innerHTML=`<div class="fleet-backdrop"><div class="fleet-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="fleet-dialog-head"><h2>${esc(title)}</h2>${button('x','Fechar','close')}</div><div data-fleet-message role="alert" class="fleet-error"></div>${body}<div class="fleet-dialog-footer"><span data-fleet-status class="fleet-status" role="status" aria-live="polite"></span>${footer}</div></div></div>`;
    if(this.dialog?.type?.startsWith('delete-'))this.host.querySelector('.fleet-dialog').classList.add('fleet-delete');
    this.drawIcons();this.host.querySelector('input,select,button')?.focus();
    this.host.querySelector('.fleet-dialog').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();this.close();}if(event.key==='Tab'){const items=[...this.host.querySelectorAll('button,input,select,textarea,summary')].filter(el=>!el.disabled && el.getClientRects().length);const index=items.indexOf(document.activeElement);if(event.shiftKey && index===0){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey && index===items.length-1){event.preventDefault();items[0]?.focus();}}});
  }
  field(label,name,value='',type='text',extra=''){return `<label>${esc(label)}<input type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;}
  openDeleteVehicle(vehicle){
    if(!this.canDeleteVehicle(vehicle)){
      const autos=this.handovers.filter(h=>h.vehicle_id===vehicle.id);
      this.dialog={type:'delete-vehicle-blocked',vehicleId:vehicle.id};
      this.showDialog(vehicle.plate+' · Eliminar viatura',`<p>Esta viatura tem ${autos.length} auto(s) associado(s) ou histórico de utilização.</p><p>Para eliminar uma viatura de teste, elimina primeiro os seus autos. Para uma viatura real, mantém o histórico e arquiva-a.</p>`,`<button type="button" class="btn btn-primary" data-action="vehicle-autos" data-id="${vehicle.id}">${icon('file-text')}Ver autos desta viatura</button>`);return;
    }
    this.dialog={type:'delete-vehicle',vehicleId:vehicle.id,version:vehicle.version};
    this.showDialog(vehicle.plate+' · Eliminar viatura',`<dl class="fleet-read-data"><div><dt>Viatura</dt><dd>${esc(vehicle.make_model)}</dd></div><div><dt>Autos</dt><dd>0</dd></div></dl><label>Confirmar matrícula<input data-delete-plate autocomplete="off" placeholder="${esc(vehicle.plate)}"></label><label class="fleet-check"><input type="checkbox" data-delete-confirm>Eliminar definitivamente esta viatura e a sua situação inicial.</label>`,`<button type="button" class="btn fleet-error" data-action="confirm-delete-vehicle">${icon('trash-2')}Eliminar definitivamente</button>`);
  }
  async deleteVehicle(){
    if(this.busy)return;const v=this.vehicle(this.dialog.vehicleId),plate=this.host.querySelector('[data-delete-plate]').value;
    if(plate.trim().toUpperCase()!==v.plate || !this.host.querySelector('[data-delete-confirm]').checked)throw new Error('Confirma a matrícula e a eliminação definitiva.');
    this.busy=true;const control=this.host.querySelector('[data-action=confirm-delete-vehicle]');control.disabled=true;
    try{await this.rpc('rh_fleet_delete_unused_vehicle',{p_id:v.id,p_version:this.dialog.version,p_plate:plate});if(this.localDraft()?.vehicleId===v.id || this.localDraft()?.id===v.id)this.clearStash();this.dialog=null;this.host.innerHTML='';await this.load();}
    finally{this.busy=false;if(control.isConnected)control.disabled=false;}
  }
  async openDeleteHandover(h){
    if(!h || this.busy)return;
    if(this.dialog?.id===h.id && !this.dialog.readOnly){await this.saveDraft();h={...h,version:this.dialog.version,data:clone(this.dialog.data)};}
    clearTimeout(this.saveTimer);this.dirty=false;
    const number='FRO-'+String(h.number).padStart(5,'0'),vehicle=this.vehicle(h.vehicle_id);
    this.dialog={type:'delete-handover',id:h.id,version:h.version,number};
    const effect=h.status==='confirmed'?`<p>Este auto está confirmado. Se for o último movimento e não existirem autos dependentes, será reposto o estado anterior: ${esc(h.snapshot?.from_person?.name || 'Empresa / parque')} e ${Number(h.snapshot?.vehicle?.odometer || 0).toLocaleString('pt-PT')} km.</p>`:'<p>A eliminação deste rascunho ou auto cancelado não altera a utilização da viatura.</p>';
    this.showDialog(number+' · Eliminar auto',`<dl class="fleet-read-data"><div><dt>Viatura</dt><dd>${esc(vehicle?.plate)}</dd></div><div><dt>Estado</dt><dd>${statusLabel[h.status]}</dd></div></dl>${effect}<p>O auto, os anexos e as ligações de assinatura serão retirados do site. Fica uma cópia de segurança técnica, sem ligações de acesso ativas.</p><label>Confirmar número do auto<input data-delete-number autocomplete="off" placeholder="${number}"></label><label class="fleet-check"><input type="checkbox" data-delete-confirm>Confirmo que este auto é de teste e que o quero eliminar.</label>`,`<button class="btn fleet-error" type="button" data-action="confirm-delete-handover">${icon('trash-2')}Eliminar auto de teste</button>`);
  }
  async deleteHandover(){
    if(this.busy)return;const d=this.dialog,number=this.host.querySelector('[data-delete-number]').value.trim().toUpperCase();
    if(number!==d.number || !this.host.querySelector('[data-delete-confirm]').checked)throw new Error('Escreve o número do auto e confirma a eliminação do teste.');
    this.busy=true;const control=this.host.querySelector('[data-action=confirm-delete-handover]');control.disabled=true;
    try{
      const result=await this.shareApi({action:'delete',id:d.id,version:d.version,number,test:true});if(!result.deleted)throw new Error('A eliminação não foi confirmada.');
      if(this.localDraft()?.id===d.id)this.clearStash();this.dialog=null;this.host.innerHTML='';this.page='handovers';await this.load();
      this.message(result.filesPending?'Auto eliminado. Os anexos aguardam limpeza; podes repetir no aviso acima.':'Auto eliminado.',!!result.filesPending);
    }finally{this.busy=false;if(control.isConnected)control.disabled=false;}
  }
  openInitialState(vehicle){
    if(!this.canRegisterInitial(vehicle))throw new Error('Esta viatura já tem histórico ou falta o responsável habitual.');
    this.dialog={type:'initial-state',vehicleId:vehicle.id,version:vehicle.version};
    this.showDialog(vehicle.plate+' · Situação inicial',`<dl class="fleet-read-data"><div><dt>Responsável</dt><dd>${esc(this.person(vehicle.habitual_person_id).name)}</dd></div><div><dt>Início da utilização</dt><dd>Desconhecido</dd></div><div><dt>Auto anterior</dt><dd>Não disponível</dd></div></dl><label class="fleet-check"><input type="checkbox" data-initial-confirm>Confirmo que a viatura já está com esta pessoa e não tenho um auto anterior.</label>`,`<button type="button" class="btn btn-primary" data-action="register-initial-state">${icon('check')}Registar situação inicial</button>`);
  }
  async registerInitialState(){
    if(this.busy)return;if(!this.host.querySelector('[data-initial-confirm]')?.checked)throw new Error('Confirma a situação inicial da viatura.');
    this.busy=true;const control=this.host.querySelector('[data-action=register-initial-state]');control.disabled=true;
    try{await this.rpc('rh_fleet_register_initial_state',{p_vehicle_id:this.dialog.vehicleId,p_vehicle_version:this.dialog.version});this.dialog=null;this.host.innerHTML='';await this.load();}
    finally{this.busy=false;if(control.isConnected)control.disabled=false;}
  }
  openVehicle(vehicle,resume){
    this.dialog=resume || {type:'vehicle',id:vehicle?.id || crypto.randomUUID(),version:vehicle?.version || 0,data:vehicle?clone(vehicle):{plate:'',make_model:'',cartrack_number:'',company:'',habitual_person_id:this.personFilter,odometer:0,active:true}};
    const d=this.dialog.data;
    this.showDialog(this.dialog.version?'Editar viatura':'Adicionar viatura',`<form data-fleet-form><fieldset><div class="fleet-form-grid">${this.field('Matrícula','plate',d.plate,'text','required maxlength="20"')}${this.field('Marca / modelo','make_model',d.make_model,'text','required maxlength="120"')}<label>Estado da viatura<select name="vehicle_condition" required><option value="">Selecionar…</option>${Object.entries(VEHICLE_STATES).map(([value,label])=>`<option value="${value}" ${d.vehicle_condition===value?'selected':''}>${label}</option>`).join('')}</select></label>${this.field('N.º Cartrack','cartrack_number',d.cartrack_number,'text','maxlength="80"')}${this.field('Empresa','company',d.company,'text','maxlength="120"')}<label>Responsável habitual<select name="habitual_person_id">${this.peopleOptions(d.habitual_person_id,true)}</select></label>${this.field('Quilómetros','odometer',d.odometer,'number','min="0" max="99999999" step="1" required')}${this.field('Seguro válido até','insurance_until',d.insurance_until,'date')}${this.field('Inspeção válida até','inspection_until',d.inspection_until,'date')}<label class="fleet-check"><input type="checkbox" name="active" ${d.active?'checked':''}>Viatura ativa</label></div></fieldset></form>`, `<button class="btn btn-primary" type="button" data-action="save-vehicle">${icon('save')}Guardar viatura</button>`);
    this.host.querySelector('[name=vehicle_condition]').setAttribute('aria-label','Estado da viatura');
    this.updateVehicleInspection();this.bindForm();
    if(vehicle){const footer=this.host.querySelector('.fleet-dialog-footer');footer.insertAdjacentHTML('afterbegin',`<button type="button" class="btn fleet-error" data-action="delete-vehicle" data-id="${vehicle.id}">${icon('trash-2')}Eliminar viatura</button>`);this.drawIcons();}
  }
  updateVehicleInspection(){
    const input=this.host.querySelector('[name=inspection_until]');if(!input)return;
    const visible=showVehicleInspection(this.dialog.data);input.closest('label').hidden=!visible;input.disabled=!visible;
  }
  peopleOptions(selected,empty=false){return `<option value="">${empty?'Sem atribuição':'Selecionar…'}</option>`+this.persons.filter(p=>!p.historyOnly && p.ativo!==false || p.id===selected).sort((a,b)=>a.name.localeCompare(b.name,'pt')).map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('');}
  capture(){
    const form=this.host.querySelector('[data-fleet-form]');if(!form || !this.dialog || this.dialog.readOnly)return;
    const d=this.dialog.data,previousReceiver=d.to_person_id,previousDestination=d.destination;
    for(const [key,value] of new FormData(form))if(!(value instanceof File) && !key.startsWith('inspection.') && !key.startsWith('driver.'))d[key]=value;
    if(this.dialog.type==='vehicle')d.active=form.elements.active.checked;
    else{
      const choice=form.elements.kind.value;d.kind=choice==='external'?'return':choice;
      if(choice==='external')d.destination='external_structure';else if(previousDestination==='external_structure'){delete d.destination;delete d.external_structure;}
      d.checked=form.elements.checked.checked;d.at=fromLisbonInput(form.elements.at_input.value);d.expected_return=fromLisbonInput(form.elements.expected_input.value);
      delete d.at_input;delete d.expected_input;
      d.inspection={};for(const input of form.querySelectorAll('[data-inspection]'))d.inspection[input.dataset.inspection]=input.value;
      const previousFields=d.driver_fields || {};d.driver_fields={from:{},to:{}};
      for(const input of form.querySelectorAll('[data-driver]')){
        const {kind,driver}=input.dataset;
        if(driver==='name' && !input.value.trim() && !Object.hasOwn(previousFields[kind] || {},'name'))continue;
        d.driver_fields[kind][driver]=input.value;
      }
      if(d.kind==='return')d.to_person_id='';
      if(previousReceiver!==d.to_person_id || previousDestination!==d.destination){d.driver_fields.to={};for(const input of form.querySelectorAll('[data-kind=to][data-driver]')){input.value='';if(input.dataset.driver==='name')input.dataset.autoName='1';}}
    }
    this.stash();
  }
  bindForm(){
    const form=this.host.querySelector('[data-fleet-form]');
    if(this.dialog.type==='handover'){
      for(const input of form.querySelectorAll('[name=reason],[name=at_input],[name=odometer],[name=place],[name=zone_name]'))input.required=false;
      for(const input of form.querySelectorAll('[data-inspection]'))input.required=true;
    }
    form.addEventListener('submit',event=>event.preventDefault());
    form.addEventListener('input',event=>{
      if(event.target.matches('[data-driver=name]'))event.target.dataset.autoName='0';
      const before=clone(this.dialog.data);this.capture();
      if(this.dialog.type==='handover'){
        if(Object.keys(before.signature_receipts || {}).length && !equal(core(before),core(this.dialog.data)) && !this.dialog.invalidatingApproved){
          if(!confirm('Alterar o conteúdo invalida as assinaturas recolhidas. Continuar e pedir novas assinaturas?')){const previous={...this.dialog,data:before};this.stash();this.openHandover(this.vehicle(previous.vehicleId),null,previous);return;}
          this.dialog.invalidatingApproved=true;
        }
        this.scheduleSave();this.updateProgress();
      }
    });
    form.addEventListener('change',event=>{this.capture();if(this.dialog.type==='vehicle')this.updateVehicleInspection();if(this.dialog.type==='handover'){this.updateKind();this.scheduleSave();this.updateProgress();}});
  }
  async saveVehicle(){
    const form=this.host.querySelector('[data-fleet-form]');if(!form.reportValidity() || this.busy)return;
    this.capture();this.busy=true;form.querySelector('fieldset').disabled=true;this.status('A guardar no servidor…');
    try{const data=vehicleSaveData(this.dialog.data),result=await this.rpc('rh_fleet_save_vehicle',{p_id:this.dialog.id,p_version:this.dialog.version,p_data:data});
      this.dialog.version=result.version;
      const differs=['make_model','cartrack_number','company','habitual_person_id','insurance_until','vehicle_condition',...(showVehicleInspection(data)?['inspection_until']:[])].some(key=>String(result[key] || '')!==String(data[key] || '')) || Number(result.odometer)!==Number(data.odometer) || result.active!==data.active;
      if(differs){this.stash();throw new Error('A viatura já tinha sido guardada. Revê a ficha e volta a guardar as alterações.');}
      this.clearStash();this.host.innerHTML='';this.dialog=null;await this.load();}
    finally{this.busy=false;if(form.isConnected)form.querySelector('fieldset').disabled=false;}
  }
  openHandover(vehicle,handover,resume){
    if(!vehicle)throw new Error('Viatura indisponível. Atualiza a frota.');
    const current=this.holder(vehicle.id);
    if(resume && !this.remote)resume=adoptInitialDraftVersion(resume,handover || this.handovers.find(h=>h.id===resume.id),current);
    this.dialog=resume || {type:'handover',id:handover?.id || crypto.randomUUID(),vehicleId:vehicle.id,version:handover?.version || 0,expectedCustodyId:handover?.expected_custody_id ?? current?.id ?? null,readOnly:handover && handover.status!=='draft',data:handover?clone(handover.data):{kind:current?'temporary':'initial',reason:current?'Férias do titular':'Entrega de viatura',to_person_id:current?'':vehicle.habitual_person_id || '',at:fromLisbonInput(lisbonInput(new Date())),expected_return:'',place:'Viseu',odometer:'',fuel:'',zone_name:this.getProfile()?.display_name || '',inspection:{},damage_markers:[],signatures:{},driver_fields:{from:{},to:{}},notes:'',damage_notes:'',checked:false}};
    const d=this.dialog.data;d.signatures ||= {};d.damage_markers ||= [];d.inspection ||= {};
    if(this.dialog.readOnly){this.readHandover(handover,vehicle);return;}
    this.autoNameDefaults=!this.dialog.version || !!this.remote;
    const giver=handoverOrigin(vehicle,current,d.kind,this.persons).name;
    const groups=INSPECTION_GROUPS.map(group=>`<details><summary>${esc(group.label)} <span class="fleet-small" data-progress="${group.id}"></span></summary><div class="fleet-inspection-grid">${group.items.map(item=>`<label>${esc(item.label)}<select name="inspection.${item.key}" data-inspection="${item.key}" data-group="${group.id}"><option value="">Por verificar</option>${CONDITIONS.filter(c=>group.page!==1 || c!=='NE').map(c=>`<option ${d.inspection[item.key]===c?'selected':''}>${c}</option>`).join('')}</select></label>`).join('')}</div><div class="fleet-group-actions"><select aria-label="Estado para itens por preencher de ${esc(group.label)}" data-batch="${group.id}"><option value="">Estado…</option>${CONDITIONS.filter(c=>group.page!==1 || c!=='NE').map(c=>`<option>${c}</option>`).join('')}</select><button class="btn" type="button" data-action="batch" data-group="${group.id}">Aplicar aos por preencher</button></div></details>`).join('');
    const driverNames=`<div class="fleet-form-grid">${[['from','Nome completo de quem entrega'],['to','Nome completo de quem recebe']].map(([kind,label])=>`<label>${label}<input name="driver.${kind}.name" data-kind="${kind}" data-driver="name" maxlength="120" value="${esc(d.driver_fields?.[kind]?.name || '')}"></label>`).join('')}</div>`;
    const driverFields=driverNames+['from','to'].map(kind=>`<details><summary>${kind==='from'?'Quem entrega':'Quem recebe'} · Dados para o auto</summary><div class="fleet-form-grid" style="margin-top:14px">${[['number','N.º interno'],['phone','Telefone'],['bi','BI / CC (opcional)'],['nif','NIF (opcional)'],['license','Carta de condução (opcional)']].map(([key,label])=>`<label>${label}<input name="driver.${kind}.${key}" data-kind="${kind}" data-driver="${key}" maxlength="80" value="${esc(d.driver_fields?.[kind]?.[key] || '')}"></label>`).join('')}</div></details>`).join('');
    this.showDialog(`${vehicle.plate} · ${handover?'Editar auto':'Nova entrega / devolução'}`,`<form data-fleet-form><fieldset><div class="fleet-form-grid"><label>Operação<select name="kind">${Object.entries(OPERATIONS).map(([key,label])=>`<option value="${key}" ${d.kind===key?'selected':''}>${label}</option>`).join('')}</select></label>${this.field('Motivo','reason',d.reason,'text','maxlength="120" required')}<label>Entrega<input value="${esc(giver)}" readonly></label><label data-receiver>Recebe<select name="to_person_id">${this.peopleOptions(d.to_person_id)}</select></label>${this.field('Data / hora (Portugal)','at_input',lisbonInput(d.at),'datetime-local','required')}<label data-expected>Devolução prevista<input type="datetime-local" name="expected_input" value="${esc(lisbonInput(d.expected_return))}"></label>${this.field('Quilómetros atuais','odometer',d.odometer,'number',`min="${vehicle.odometer}" max="99999999" step="1" placeholder="Última leitura: ${vehicle.odometer}" required`)}<label>Combustível<select name="fuel"><option value="">Por confirmar</option>${['Reserva','1/4','1/2','3/4','Cheio'].map(value=>`<option ${d.fuel===value?'selected':''}>${value}</option>`).join('')}</select></label>${this.field('Local','place',d.place,'text','maxlength="120" required')}${this.field('Responsável de zona','zone_name',d.zone_name,'text','maxlength="100" required')}</div><div class="fleet-section">${driverFields}</div><section class="fleet-section"><h3>Inspeção <span data-progress-total class="fleet-small"></span></h3>${groups}</section><details class="fleet-section" data-damage-details><summary>Danos · R Risco / A Amolgadela / P Partido</summary><div class="fleet-bar" style="margin-top:14px"><select aria-label="Tipo de dano" data-damage-type><option>R</option><option>A</option><option>P</option></select>${button('undo-2','Retirar último dano','undo-damage')}</div><div data-damage-error class="fleet-small"></div><canvas class="fleet-damage-canvas" width="595" height="842" aria-label="Esquema do auto para assinalar danos" role="img"></canvas></details><div class="fleet-form-grid fleet-section"><label class="fleet-wide">Observações / justificação dos danos<textarea name="damage_notes" rows="3" maxlength="3000">${esc(d.damage_notes)}</textarea></label><label class="fleet-wide">Outras observações<textarea name="notes" rows="2" maxlength="2000">${esc(d.notes)}</textarea></label></div><section class="fleet-section"><h3>Assinaturas (opcional)</h3><div class="fleet-signatures">${[['from','Entrega'],['to','Recebe'],['zone','Responsável de zona']].map(([key,label])=>`<figure><figcaption>${label}${button('trash-2','Limpar assinatura de '+label,'clear-signature',`data-kind="${key}"`)}</figcaption><canvas width="600" height="200" data-signature="${key}" aria-label="Assinatura de ${label}"></canvas></figure>`).join('')}</div></section><label class="fleet-check"><input type="checkbox" name="checked" ${d.checked?'checked':''}>Confirmei a entrega real, os quilómetros e a inspeção desta operação.</label></fieldset></form><section class="fleet-section"><h3>Fotografias / documentos</h3><input type="file" data-fleet-upload accept="image/jpeg,image/png,image/webp,application/pdf" multiple aria-label="Anexar fotografias ou documentos"><ul class="fleet-file-list" data-fleet-files></ul></section>`, `<button class="btn" type="button" data-action="save-draft">${icon('save')}Guardar rascunho</button><button class="btn" type="button" data-action="draft-pdf">${icon('file-text')}Pré-visualizar PDF</button><button class="btn btn-primary" type="button" data-action="confirm">${icon('check')}Confirmar entrega</button>`);
    const operation=this.host.querySelector('[name=kind]');operation.insertAdjacentHTML('beforeend','<option value="external">Entrega a outra estrutura</option>');if(d.destination==='external_structure' && d.kind==='return')operation.value='external';
    this.host.querySelector('.fleet-form-grid').insertAdjacentHTML('beforeend',`<label data-external-destination>Estrutura de destino<input name="external_structure" maxlength="120" value="${esc(d.external_structure || '')}"></label>`);
    const giverInput=this.host.querySelector('.fleet-form-grid input[readonly]');giverInput.dataset.giver='';giverInput.insertAdjacentHTML('afterend','<span data-giver-status class="fleet-small"></span>');
    this.bindForm();this.updateKind();this.updateProgress();this.setupSignatures();this.setupFiles();this.loadFiles();
    this.host.querySelector('[data-damage-details]').addEventListener('toggle',event=>{if(event.target.open)this.loadDamage();});
    this.stash();this.status(this.dialog.version?'Rascunho guardado no servidor':'Rascunho local');
    if(this.remote){
      this.host.querySelector('.fleet-dialog-head [data-action=close]')?.remove();
      for(const name of ['kind','to_person_id','reason','zone_name','external_structure'])this.host.querySelector(`[name="${name}"]`).disabled=true;
      this.host.querySelector('.fleet-signatures')?.closest('section').remove();
      this.host.querySelector('[data-fleet-upload]').accept='image/jpeg,image/png,image/webp';
      this.host.querySelector('.fleet-dialog-footer').innerHTML='<span data-fleet-status class="fleet-status" role="status" aria-live="polite"></span><button class="btn" type="button" data-action="save-draft">'+icon('save')+'Guardar</button><button class="btn" type="button" data-action="draft-pdf">'+icon('file-text')+'Consultar PDF</button><button class="btn btn-primary" type="button" data-action="remote-submit">'+icon('check')+'Concluir preenchimento</button>';
      this.drawIcons();
    }else this.setupSharing();
  }
  updateKind(){
    const form=this.host.querySelector('[data-fleet-form]');if(!form)return;const kind=form.elements.kind.value;
    this.host.querySelector('[data-expected]').hidden=kind!=='temporary';this.host.querySelector('[data-receiver]').hidden=['return','external'].includes(kind);
    const external=this.host.querySelector('[data-external-destination]');external.hidden=kind!=='external';external.querySelector('input').disabled=kind!=='external' || !!this.remote;
    const d=this.dialog.data,origin=handoverOrigin(this.vehicle(this.dialog.vehicleId),this.holder(this.dialog.vehicleId),kind,this.persons);
    form.querySelector('[data-giver]').value=origin.name;
    form.querySelector('[data-giver-status]').textContent=origin.source==='habitual'?(this.custody.some(c=>c.vehicle_id===this.dialog.vehicleId)?'Sem utilização em curso':'Responsável habitual · situação inicial por registar'):'';
    const defaults={from:origin.id?origin.name:'',to:['return','external'].includes(kind)?'':this.person(form.elements.to_person_id.value,'').name};
    for(const role of ['from','to']){
      const input=form.querySelector(`[data-kind=${role}][data-driver=name]`);
      input.placeholder=defaults[role] || (role==='from'?'Indicar quem entrega':'Indicar quem recebe');
      if(this.autoNameDefaults && (input.dataset.autoName==='1' || (!Object.hasOwn(d.driver_fields?.[role] || {},'name') && !input.value))){input.value=defaults[role];input.dataset.autoName='1';}
    }
  }
  updateProgress(){
    const inspection=this.dialog?.data.inspection || {};const progress=inspectionProgress(inspection);const total=this.host.querySelector('[data-progress-total]');if(total)total.textContent=`${progress.complete} / ${progress.total}`;
    for(const group of INSPECTION_GROUPS){const target=this.host.querySelector(`[data-progress="${group.id}"]`);if(target)target.textContent=`${group.items.filter(item=>inspection[item.key]).length}/${group.items.length}`;}
  }
  scheduleSave(){
    this.dirty=true;this.status('A guardar rascunho…');clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.saveDraft().catch(error=>{this.status('Rascunho local · aguarda ligação',true);this.message(error.message,true);}),700);
  }
  async saveDraft(){
    if(!this.dialog || this.dialog.type!=='handover' || this.dialog.readOnly)return;
    this.capture();this.dirty=true;clearTimeout(this.saveTimer);
    if(this.draftSaving)return this.draftSaving;
    const current=this.dialog;
    this.draftSaving=(async()=>{
      while(this.dirty && this.dialog===current){
        this.dirty=false;const sent=clone(current.data);this.stash();
        try{
          const result=await this.rpc('rh_fleet_save_handover',{p_id:current.id,p_vehicle_id:current.vehicleId,p_version:current.version,p_expected_custody_id:current.expectedCustodyId,p_data:sent});
          if(result.status!=='draft')throw new Error('Este auto já foi confirmado ou cancelado. Fecha e atualiza a frota.');
          current.version=result.version;
          if(!equal(core(result.data),core(sent)))this.dirty=true;
          if(sent.signature_receipts && !equal(result.data.signature_receipts || {},sent.signature_receipts)){
            current.data.signatures=result.data.signatures || {};current.data.signature_receipts=result.data.signature_receipts || {};
            for(const canvas of this.host.querySelectorAll('[data-signature]'))canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
            this.message('O conteúdo foi alterado. É necessário recolher novas assinaturas.',true);
          }
          this.stash();this.status(this.dirty?'A guardar rascunho…':'Rascunho guardado no servidor');
        }catch(error){this.dirty=true;throw error;}
      }
    })().finally(()=>this.draftSaving=null);
    return this.draftSaving;
  }
  async confirmHandover(){
    if(this.busy)return;this.capture();const vehicle=this.vehicle(this.dialog.vehicleId),errors=validateHandover(this.dialog.data,vehicle,this.holder(vehicle.id));
    const absence=this.host.querySelector('[data-recipient-absent]')?.checked,reason=this.host.querySelector('[data-absence-reason]')?.value.trim() || '';
    if(absence && (reason.length<8 || reason.length>500))errors.push('Indica o motivo da assinatura de quem recebe não ter sido recolhida (8 a 500 caracteres).');
    if(errors.length){this.confirmError(errors.join('\n'));return;}
    if(!confirm(`Confirmar a ${handoverLabel(this.dialog.data).toLowerCase()} da viatura ${vehicle.plate}? O histórico e este auto ficam fechados para edição.${this.dialog.data.destination==='external_structure'?' A viatura será retirada da frota ativa.':''}${absence?' A assinatura de quem recebe ficará registada como NÃO RECOLHIDA; nenhuma marca nesse campo será apresentada como assinatura.':''}`))return;
    this.busy=true;const form=this.host.querySelector('fieldset');form.disabled=true;
    try{
      await this.saveDraft();this.status('A confirmar no servidor…');
      const h=await this.rpc(absence?'rh_fleet_confirm_without_recipient':'rh_fleet_confirm_handover',{p_id:this.dialog.id,p_version:this.dialog.version,...(absence?{p_reason:reason}:{})});
      if(h.data.destination==='external_structure')this.showArchived=true;
      this.clearStash();this.dirty=false;this.host.innerHTML='';this.dialog=null;await this.load();this.page='handovers';this.render();
      try{await this.downloadPdf(h.id);}catch(error){this.message('Entrega confirmada. '+error.message,true);}
    }catch(error){this.confirmError(error.message);}finally{this.busy=false;if(form.isConnected)form.disabled=false;}
  }
  confirmError(text){
    this.message(text,true);const target=this.host.querySelector('[data-confirm-error]');if(target){target.textContent=text;target.scrollIntoView({block:'nearest'});}
  }
  readHandover(h,vehicle){
    const s=h.snapshot;this.showDialog(`${vehicle.plate} · FRO-${String(h.number).padStart(5,'0')}`,`<p class="fleet-locked">${icon('lock')}${esc(statusLabel[h.status])} · histórico preservado</p><dl class="fleet-read-data"><div><dt>Operação</dt><dd>${esc(handoverLabel(h.data))}</dd></div><div><dt>Data / hora</dt><dd>${date(h.data.at)}</dd></div><div><dt>Entrega</dt><dd>${esc(driverName(s?.operation || h.data,'from',s?.from_person) || '—')}</dd></div><div><dt>Recebe</dt><dd>${esc(driverName(s?.operation || h.data,'to',s?.to_person) || '—')}</dd></div>${h.data.destination==='external_structure'?'<div><dt>Estrutura de destino</dt><dd>'+esc(h.data.external_structure)+'</dd></div>':''}<div><dt>N.º Cartrack</dt><dd>${esc(s?.vehicle.cartrack_number || vehicle.cartrack_number || '—')}</dd></div><div><dt>Quilómetros</dt><dd>${esc(h.data.odometer)}</dd></div><div><dt>Motivo</dt><dd>${esc(h.data.reason)}</dd></div><div><dt>Devolução prevista</dt><dd>${date(h.data.expected_return)}</dd></div></dl><div class="fleet-section"><h3>Observações</h3><p style="white-space:pre-wrap">${esc(h.data.damage_notes)}${h.data.notes?'\n'+esc(h.data.notes):''}</p></div><section class="fleet-section"><h3>Fotografias / documentos / auto assinado</h3>${h.status==='confirmed'?'<input type="file" data-fleet-upload accept="image/jpeg,image/png,image/webp,application/pdf" multiple aria-label="Anexar auto assinado ou fotografias">':''}<ul class="fleet-file-list" data-fleet-files></ul></section>`, h.status==='confirmed'?`<button class="btn btn-primary" data-action="pdf" data-id="${h.id}">${icon('download')}Auto PDF</button>`:'');
    const absence=s?.signature_absences?.to;if(absence)this.host.querySelector('.fleet-read-data').insertAdjacentHTML('afterend',`<section class="fleet-section"><h3>Assinatura de quem recebe · Não recolhida</h3><p>${esc(absence.reason)}</p><p class="fleet-small">Registado por administrador em ${date(absence.recorded_at)}.</p></section>`);
    this.setupFiles();this.loadFiles();
  }
  setupSignatures(){
    for(const canvas of this.host.querySelectorAll('[data-signature]')){
      const key=canvas.dataset.signature;
      signaturePad(canvas,{initial:this.dialog.data.signatures[key],onChange:value=>{this.dialog.data.signatures[key]=value;this.stash();this.scheduleSave();}});
    }
  }
  async shareApi(value){const response=await this.authFetch('/api/fleet-share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});return response.json();}
  setupSharing(){
    const footer=this.host.querySelector('.fleet-dialog-footer');
    footer.insertAdjacentHTML('beforebegin',`<section class="fleet-section"><label class="fleet-check"><input type="checkbox" data-recipient-absent>Assinatura de quem recebe não recolhida</label><div class="fleet-form-grid"><label class="fleet-wide" data-absence-field hidden>Motivo<textarea data-absence-reason rows="3" maxlength="500" autocomplete="off"></textarea></label></div></section><div data-confirm-error class="fleet-error" role="alert"></div>`);
    this.host.querySelector('[data-recipient-absent]').addEventListener('change',event=>{this.host.querySelector('[data-absence-field]').hidden=!event.target.checked;});
    footer.insertAdjacentHTML('beforebegin',`<section class="fleet-section" data-sharing><h3>Ligações privadas · preenchimento e assinaturas</h3><div class="fleet-bar">${[['editor','Enviar para preencher'],['from','Assinatura de quem entrega / devolve'],['to','Assinatura de quem recebe']].map(([key,label])=>`<button type="button" class="btn" data-action="create-link" data-purpose="${key}">${icon('link')}${label}</button>`).join('')}</div><div data-share-status class="fleet-small" role="status" aria-live="polite"></div><div data-share-output hidden><label class="fleet-small">Ligação privada<input readonly data-share-url aria-label="Ligação privada gerada"></label><div class="fleet-bar"><button type="button" class="btn" data-action="copy-share">${icon('copy')}Copiar</button><button type="button" class="btn" data-action="send-share">${icon('share-2')}Partilhar</button><span class="fleet-small" data-share-expiry></span></div></div><div class="fleet-bar"><button type="button" class="btn" data-action="refresh-shares">${icon('refresh-cw')}Atualizar assinaturas</button><button type="button" class="btn" data-action="revoke-links">${icon('x')}Cancelar ligações</button></div></section>`);
    this.drawIcons();
    if(this.dialog.version)this.shareApi({action:'status',id:this.dialog.id}).then(value=>this.showShareStatus(value)).catch(error=>{const target=this.host.querySelector('[data-share-status]');if(target)target.textContent=error.message;});
  }
  showShareStatus(value){
    const target=this.host.querySelector('[data-share-status]');if(!target)return;
    if(value.handover?.id===this.dialog?.id && !value.session?.required){this.autoNameDefaults=true;this.updateKind();}
    const labels={editor:'Preenchimento',from:'Entrega / devolve',to:'Recebe'};
    const receipts=(value.receipts || []).filter(r=>!r.invalidated_at);
    target.innerHTML=['from','to'].map(role=>{const receipt=receipts.find(r=>r.purpose===role);return `<div>${labels[role]}: ${receipt?esc(receipt.signer_name)+' · '+date(receipt.signed_at):'Por assinar'}</div>`;}).join('')+(value.links || []).filter(l=>!l.revoked_at && !l.used_at).map(l=>`<div>${labels[l.purpose]} · ligação ${+new Date(l.expires_at)<Date.now()?'expirada':'válida até '+date(l.expires_at)}</div>`).join('');
    if(value.handover?.version>this.dialog?.version)this.status('Há alterações noutro dispositivo. Atualiza as assinaturas.');
  }
  async refreshShares(){
    if(this.dirty && !confirm('Recarregar os dados do servidor e substituir o rascunho aberto nesta janela?'))return;
    if(this.draftSaving)try{await this.draftSaving;}catch{}
    const id=this.dialog.id,value=await this.shareApi({action:'status',id});
    if(value.handover){this.dirty=false;clearTimeout(this.saveTimer);this.openHandover(this.vehicle(value.handover.vehicle_id),value.handover);this.showShareStatus(value);}
  }
  async createShare(purpose){
    if(this.busy)return;
    if(this.uploadingCount){this.message('Aguarda que as fotografias terminem de carregar antes de criar a ligação.',true);this.status('Fotografias em carregamento',true);return;}
    this.busy=true;const fieldset=this.host.querySelector('fieldset');
    try{
      await this.saveDraft();fieldset.disabled=true;this.status('A criar ligação privada…');
      const result=await this.shareApi({action:'create',id:this.dialog.id,purpose});
      if(result.handover)this.openHandover(this.vehicle(result.handover.vehicle_id),result.handover);
      const output=this.host.querySelector('[data-share-output]');output.hidden=false;output.querySelector('[data-share-url]').value=result.url;output.querySelector('[data-share-expiry]').textContent='Válida até '+date(result.expires_at);
      this.status('Ligação privada criada');
    }catch(error){
      const target=this.host.querySelector('[data-share-status]');if(target){target.textContent=error.message;target.setAttribute('role','alert');target.classList.add('fleet-error');}
      throw error;
    }finally{this.busy=false;if(fieldset.isConnected)fieldset.disabled=false;}
  }
  async authFetch(url,options={}){
    if(this.remote)return this.remoteFetch(url,options);
    const token=await this.getToken();const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
    if(!response.ok){let value;try{value=await response.json();}catch{}throw new Error(value?.error || 'Pedido indisponível. Tenta novamente.');}return response;
  }
  async loadDamage(){
    const canvas=this.host.querySelector('.fleet-damage-canvas');if(!canvas)return;
    canvas.width=DAMAGE_VIEW.width;canvas.height=DAMAGE_VIEW.height;
    if(this.damageImage)this.paintDamage();
    else try{
      const response=await this.authFetch('/api/fleet-auto?diagram=1');const blob=await response.blob();const url=URL.createObjectURL(blob);const image=new Image();
      image.onload=()=>{URL.revokeObjectURL(url);this.damageImage=image;this.paintDamage();};image.src=url;
    }catch(error){const target=this.host.querySelector('[data-damage-error]');if(target)target.textContent=error.message;}
    canvas.onclick=event=>{const box=canvas.getBoundingClientRect(),x=DAMAGE_VIEW.x+(event.clientX-box.left)*DAMAGE_VIEW.width/box.width,y=DAMAGE_VIEW.y+(event.clientY-box.top)*DAMAGE_VIEW.height/box.height;if(x<50 || x>537 || y<260 || y>622)return;
      if(this.dialog.data.damage_markers.length>=100){this.message('O limite é de 100 marcas por auto.',true);return;}
      this.dialog.data.damage_markers.push({x:Math.round(x),y:Math.round(y),type:this.host.querySelector('[data-damage-type]').value});this.paintDamage();this.stash();this.scheduleSave();};
  }
  paintDamage(){
    const canvas=this.host.querySelector('.fleet-damage-canvas');if(!canvas || !this.damageImage)return;
    const ctx=canvas.getContext('2d'),view=DAMAGE_VIEW;ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(this.damageImage,view.x*this.damageImage.naturalWidth/595,view.y*this.damageImage.naturalHeight/842,view.width*this.damageImage.naturalWidth/595,view.height*this.damageImage.naturalHeight/842,0,0,canvas.width,canvas.height);
    ctx.font='bold 14px Arial';ctx.fillStyle='#b91c1c';for(const marker of this.dialog.data.damage_markers || [])ctx.fillText(marker.type,marker.x-view.x-4,marker.y-view.y+4);
  }
  setupFiles(){
    const upload=this.host.querySelector('[data-fleet-upload]');
    if(this.dialog?.type==='handover' && !this.dialog.readOnly){const heading=upload?.closest('section')?.querySelector('h3');if(heading)heading.textContent='Fotografias da viatura (obrigatórias)';}
    upload?.addEventListener('change',async event=>{
    const files=[...event.target.files];if(!files.length)return;
    const autoId=this.dialog.id;
    this.uploadingCount++;
    try{
      if(!this.dialog.readOnly)await this.saveDraft();
      for(const file of files){
        if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type) || file.size>10*1024*1024)throw new Error('Usa JPG, PNG, WebP ou PDF até 10 MB por ficheiro.');
        const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'}[file.type];
        const objectPath=autoId+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,80)+'.'+extension;
        this.status('A anexar '+file.name+'…');const {error}=await this.client.storage.from('rh-fleet').upload(objectPath,file,{cacheControl:'0',upsert:false,contentType:file.type});if(error)throw error;
      }
      this.status('Anexos guardados no servidor');await this.loadFiles();event.target.value='';
    }catch(error){this.message('Anexo não guardado: '+error.message,true);}
    finally{this.uploadingCount--;}
  });}
  async loadFiles(){
    const id=this.dialog?.id;if(!id)return;const target=this.host.querySelector('[data-fleet-files]');if(!target)return;
    const {data,error}=await this.client.storage.from('rh-fleet').list(id,{limit:100,sortBy:{column:'created_at',order:'asc'}});
    if(this.dialog?.id!==id)return;if(error){target.textContent='Não foi possível carregar os anexos.';return;}
    target.innerHTML=(data || []).filter(file=>file.name!=='.emptyFolderPlaceholder').map(file=>`<li>${icon('paperclip')}<span>${esc(fileLabel(file.name))}</span><button type="button" class="btn" data-action="download-file" data-path="${esc(id+'/'+file.name)}">${icon('download')}Abrir</button></li>`).join('');this.drawIcons();
  }
  async downloadFile(objectPath){const {data,error}=await this.client.storage.from('rh-fleet').download(objectPath);if(error)throw error;this.downloadBlob(data,objectPath.split('/').pop());}
  downloadBlob(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async downloadPdf(id){this.message('A preparar o auto PDF…');const response=await this.authFetch('/api/fleet-auto',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});this.downloadBlob(await response.blob(),'auto-'+(this.handovers.find(h=>h.id===id)?.number || 'rascunho')+'.pdf');this.message('Auto PDF preparado.');if(this.dialog?.id===id)this.loadFiles();}
  async close(){
    if(this.remote)return;
    if(this.busy)return;
    if(this.dialog?.type==='handover' && !this.dialog.readOnly){try{await this.saveDraft();}catch(error){if(!confirm('O rascunho ficou apenas neste navegador. Fechar e manter o rascunho local?'))return;}}
    else if(this.dialog?.type==='vehicle'){this.capture();if(!confirm('Fechar a ficha e manter o rascunho neste navegador?'))return;}
    this.host.innerHTML='';this.dialog=null;clearTimeout(this.saveTimer);this.dirty=false;await this.load();
  }
  reset(){clearTimeout(this.saveTimer);this.dialog=null;this.dirty=false;this.loaded=false;this.vehicles=[];this.handovers=[];this.custody=[];this.pendingDeletes=[];this.panel.innerHTML='';this.host.innerHTML='';}
}
