import {createIcons,Download,Trash2,Check} from 'lucide';
import {mountRemoteEditor} from './rh-fleet.mjs';
import {signaturePad} from './fleet-signature-pad.mjs';
import {OPERATIONS,INSPECTION_GROUPS,driverName,handoverLabel} from './rh-fleet-model.mjs';
const token=location.hash.slice(1),content=document.getElementById('remoteContent'),message=document.getElementById('remoteMessage');
const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value && Number.isFinite(+new Date(value))?new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)):'—';
const icons=()=>createIcons({icons:{Download,Trash2,Check}});
async function call(action,values={},binary=false){
  const response=await fetch('/api/fleet-remote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token,...values})});
  if(!response.ok){let data;try{data=await response.json();}catch{}throw new Error(data?.error || 'Não foi possível concluir o pedido. Tenta novamente.');}
  return binary?response:response.json();
}
function setMessage(text,error=false){message.textContent=text;message.classList.toggle('remote-error',error);}
function completed(value){
  document.getElementById('fleetRoot').innerHTML='';content.innerHTML=`<h1>${value.status==='signed'?'Assinatura registada':'Preenchimento enviado ao RH'}</h1>${value.signer_name?`<p>${esc(value.signer_name)}</p><p class="remote-muted">${date(value.signed_at)}</p>`:''}`;
  setMessage('');
}
function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function photoData(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>15*1024*1024)throw new Error('Usa uma fotografia JPG, PNG ou WebP até 15 MB.');
  const image=await createImageBitmap(file),scale=Math.min(1,1600/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);image.close();return canvas.toDataURL('image/jpeg',.82);
}
function editor(value){
  document.getElementById('remotePurpose').textContent='Preenchimento';
  content.innerHTML=`<p class="remote-muted">Ligação válida até ${date(value.expires_at)}</p>`;
  const client={rpc:async(name,args)=>{
    if(name!=='rh_fleet_save_handover')return {error:{message:'Operação não permitida.'}};
    try{return {data:await call('save',{version:args.p_version,data:args.p_data})};}catch(error){return {error:{message:error.message}};}
  },storage:{from:()=>({list:async()=>{try{return {data:(await call('files')).files};}catch(error){return {error};}},upload:async(_path,file)=>{try{await call('upload',{image:await photoData(file)});return {};}catch(error){return {error};}},download:async path=>{try{return {data:await (await call('file',{name:path.split('/').pop()},true)).blob()};}catch(error){return {error};}}})}};
  mountRemoteEditor({root:document.getElementById('fleetRoot'),getClient:()=>client,remoteFetch:async url=>call(url.includes('diagram=1')?'diagram':'pdf',{},true),onRemoteSubmit:async(version,data)=>{await call('submit',{version,data});completed({status:'submitted'});}},value);
  setMessage('');
}
function signer(value){
  const source=value.payload,op=source.operation,p={...source,from_person:{...source.from_person,name:driverName(op,'from',source.from_person) || 'Por indicar'},to_person:{...source.to_person,name:driverName(op,'to',source.to_person) || 'Por indicar'}},external=op.destination==='external_structure',role=value.purpose==='from'?(op.kind==='return' && !external?'Quem devolve':'Quem entrega'):(external?'Quem recebe noutra estrutura':op.kind==='return'?'Quem recebe a devolução':'Quem recebe');
  document.getElementById('remotePurpose').textContent=role;
  content.innerHTML=`<h1>Assinar auto · ${esc(p.vehicle.plate)}</h1><p class="remote-muted">FRO-${String(value.number).padStart(5,'0')} · ${esc(OPERATIONS[op.kind])}</p><dl class="remote-facts">${[['Viatura',p.vehicle.make_model],['Data / hora',date(op.at)],['Entrega',p.from_person.name],['Recebe',p.to_person.name],['Quilómetros',Number(op.odometer).toLocaleString('pt-PT')],['Combustível',op.fuel],['Local',op.place],['N.º Cartrack',p.vehicle.cartrack_number || '—']].map(([label,text])=>`<div><dt>${esc(label)}</dt><dd>${esc(text)}</dd></div>`).join('')}</dl><p class="remote-notes">${esc(op.damage_notes || '')}${op.notes?'\n'+esc(op.notes):''}</p><div class="remote-row"><button type="button" id="remotePdf"><i data-lucide="download" aria-hidden="true"></i>Consultar auto PDF</button><span class="remote-muted">Ligação válida até ${date(value.expires_at)}</span></div><section class="remote-section remote-inspection"><h2>Inspeção</h2>${INSPECTION_GROUPS.map(group=>`<details><summary>${esc(group.label)}</summary><ul>${group.items.map(item=>`<li><span>${esc(item.label)}</span><strong>${esc(op.inspection?.[item.key] || 'Por verificar')}</strong></li>`).join('')}</ul></details>`).join('')}</section><section class="remote-section"><h2>Fotografias</h2><div class="remote-photos" id="remotePhotos"></div></section><section class="remote-section"><h2>${role} · assinatura</h2><label>O teu nome completo<input id="remoteSignerName" autocomplete="name" maxlength="120" required></label><div class="remote-row"><button type="button" id="remoteClear"><i data-lucide="trash-2" aria-hidden="true"></i>Limpar assinatura</button></div><canvas id="remoteSignature" class="remote-signature" width="900" height="360" aria-label="Assinatura com o dedo" role="img"></canvas><label class="remote-check"><input type="checkbox" id="remoteAccept">Li o auto e confirmo que esta é a minha assinatura no campo “${role}”.</label><p class="remote-muted">Versão do auto: ${esc(value.content_hash.slice(0,12))}</p><div class="remote-row"><button type="button" class="btn-primary" id="remoteSign" disabled><i data-lucide="check" aria-hidden="true"></i>Confirmar assinatura</button></div></section>`;
  content.querySelector('.remote-muted').textContent='FRO-'+String(value.number).padStart(5,'0')+' · '+handoverLabel(op);
  for(const fact of content.querySelectorAll('.remote-facts>div')){
    const value=fact.querySelector('dd');
    if(fact.querySelector('dt').textContent==='Quilómetros' && (op.odometer==='' || op.odometer==null) || !value.textContent.trim())value.textContent='—';
  }
  if(op.destination==='external_structure')content.querySelector('.remote-facts').insertAdjacentHTML('beforeend','<div><dt>Estrutura de destino</dt><dd>'+esc(op.external_structure)+'</dd></div>');
  icons();setMessage('');
  const name=document.getElementById('remoteSignerName'),accept=document.getElementById('remoteAccept'),button=document.getElementById('remoteSign');let busy=false;
  name.value=driverName(op,value.purpose,source[value.purpose==='from'?'from_person':'to_person']);
  const update=()=>button.disabled=busy || name.value.trim().length<2 || !accept.checked || !pad.value();
  const pad=signaturePad(document.getElementById('remoteSignature'),{onChange:update});name.addEventListener('input',update);accept.addEventListener('change',update);
  document.getElementById('remoteClear').onclick=()=>{pad.clear();accept.checked=false;update();};
  document.getElementById('remotePdf').onclick=async()=>{try{download(await (await call('pdf',{},true)).blob(),'auto-viatura.pdf');}catch(error){setMessage(error.message,true);}};
  button.onclick=async()=>{
    if(busy)return;busy=true;update();name.disabled=true;accept.disabled=true;setMessage('A guardar a assinatura…');
    try{const result=await call('sign',{name:name.value.trim(),signature:pad.value(),content_hash:value.content_hash,accept:accept.checked});completed(result);}
    catch(error){setMessage(error.message,true);busy=false;name.disabled=false;accept.disabled=false;update();}
  };
  call('files').then(async result=>{const photos=document.getElementById('remotePhotos');if(!result.files.length && photos)photos.closest('section').hidden=true;for(const file of result.files){const response=await call('file',{name:file.name},true),url=URL.createObjectURL(await response.blob()),image=new Image();image.src=url;image.alt='Fotografia do auto';image.onload=()=>URL.revokeObjectURL(url);document.getElementById('remotePhotos')?.append(image);}}).catch(()=>{const photos=document.getElementById('remotePhotos');if(photos)photos.textContent='Não foi possível carregar as fotografias.';});
}
async function start(){
  try{
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Ligação inválida ou incompleta. Pede uma nova ligação ao RH.');
    const value=await call('read');if(value.status!=='open')completed(value);else if(value.purpose==='editor')editor(value);else signer(value);
  }catch(error){setMessage(error.message,true);content.innerHTML='<h1>Ligação indisponível</h1>';}
}
start();
