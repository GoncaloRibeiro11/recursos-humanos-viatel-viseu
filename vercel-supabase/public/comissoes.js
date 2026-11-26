'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let client,profile,metadata=[],pending,revision=0,passwordBusy=false,views=[],assetsPromise,loginBusy=false;
function status(text){$('status').textContent=text;}
function closePasswordDialog(){
 const dialog=$('passwordDialog');
 if(typeof dialog.close==='function')dialog.close();
 dialog.hidden=true;dialog.removeAttribute('open');dialog.classList.remove('fallback');$('passwordBackdrop').hidden=true;
 $('passwordForm').reset();$('passwordStatus').textContent='';
}
function clear(){
 revision++;profile=null;metadata=[];pending=null;views=[];passwordBusy=false;
 $('passwordOpen').hidden=true;$('logout').hidden=true;closePasswordDialog();
 $('importSave').hidden=true;$('importFile').value='';$('mapping').innerHTML='';$('reportScope').innerHTML='';$('reportFrame').srcdoc='';$('reportFrame').hidden=true;$('app').hidden=true;$('admin').hidden=true;
}
async function checked(query){const result=await query;if(result.error)throw result.error;return result.data;}
async function allRows(make){const result=[];for(let offset=0;;){const page=await checked(make().range(offset,offset+99));result.push(...page);if(!page.length)return result;offset+=page.length;}}
async function reportAssets(){
 if(!assetsPromise)assetsPromise=Promise.all(['commission-report.html','commission-model.js','commission-report.js'].map(async name=>{const response=await fetch(name,{cache:'no-store'});if(!response.ok)throw Error('Não foi possível carregar o modelo.');return response.text();})).catch(error=>{assetsPromise=null;throw error;});
 return assetsPromise;
}
function reportDocument(assets,history){
 const doc=new DOMParser().parseFromString(assets[0],'text/html');
 doc.getElementById('report-data').textContent=JSON.stringify(history).replace(/</g,'\\u003c');
 const runtime=doc.querySelector('script[src="commission-report.js"]'),model=doc.createElement('script');model.textContent=assets[1];runtime.before(model);runtime.removeAttribute('src');runtime.textContent=assets[2];
 return '<!doctype html>'+doc.documentElement.outerHTML;
}
async function showReport(){
 const view=views.find(v=>v.id===$('reportScope').value);if(!view)return;
 const ticket=++revision,owner=profile;$('reportFrame').srcdoc='';$('reportFrame').hidden=true;status('A carregar o histórico…');
 const query=()=>client.from('rh_commissions').select('*').eq(view.kind==='team'?'chief_nif':'owner_nif',view.key).order('period',{ascending:false}).order('owner_nif');
 const [data,assets]=await Promise.all([allRows(query),reportAssets()]);if(ticket!==revision||profile!==owner)return;
 const history=CommissionModel.buildHistory(data,view);if(!history){status('Sem pagamentos para este relatório.');return;}
 const frame=$('reportFrame');frame.hidden=false;frame.getBoundingClientRect();frame.srcdoc=reportDocument(assets,history);status('');
}
async function load(){
 const previous=$('reportScope').value;clear();const ticket=revision;
 const {data:{session}}=await client.auth.getSession();if(ticket!==revision)return;
 $('login').hidden=!!session;if(!session){status('Entre com o seu acesso RH.');return;}
 const next=await checked(client.from('user_profiles').select('role,person_id').eq('user_id',session.user.id).single());if(ticket!==revision)return;
 profile=next;$('passwordOpen').hidden=false;$('logout').hidden=false;$('admin').hidden=next.role!=='admin';
 metadata=await allRows(()=>client.from('rh_commissions').select('period,owner_nif,chief_nif,source_name,total').order('period',{ascending:false}).order('owner_nif'));if(ticket!==revision)return;
 if(!metadata.length){status('Ainda não existem comissões disponíveis para este acesso.');return;}
 views=CommissionModel.reportOptions(metadata);
 let ownNif=null;
 if(next.person_id){const identity=await allRows(()=>client.from('rh_commission_identities').select('nif,source_name').eq('person_id',next.person_id).order('nif'));if(ticket!==revision)return;ownNif=identity[0]?.nif;}
 $('reportScope').innerHTML=['team','person'].map(kind=>'<optgroup label="'+(kind==='team'?'Equipas':'Históricos pessoais')+'">'+views.filter(v=>v.kind===kind).map(v=>'<option value="'+esc(v.id)+'">'+esc(v.label)+'</option>').join('')+'</optgroup>').join('');
 const preferred=next.role==='vendedor'?'person:'+ownNif:next.role==='gestor'?'team:'+ownNif:previous;
 $('reportScope').value=(views.find(v=>v.id===preferred)||views.find(v=>v.kind==='team')||views[0]).id;
 $('app').hidden=false;await showReport();
}
$('login').onsubmit=async event=>{
 event.preventDefault();if(loginBusy||!client)return;loginBusy=true;
 const button=$('loginSubmit');button.disabled=true;button.textContent='A entrar…';$('login').setAttribute('aria-busy','true');status('A entrar…');
 try{await checked(client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value}));$('password').value='';await load();}
 catch(error){clear();$('login').hidden=false;status(error.message);}
 finally{loginBusy=false;button.disabled=false;button.textContent='Entrar';$('login').removeAttribute('aria-busy');}
};
$('logout').onclick=async()=>{await client.auth.signOut();clear();$('login').hidden=false;status('Sessão terminada.');};
$('reportScope').onchange=()=>showReport().catch(error=>status(error.message));
$('reload').onclick=()=>load().catch(error=>status(error.message));
$('passwordOpen').onclick=()=>{
 if(!profile)return;
 $('passwordForm').reset();$('passwordStatus').textContent='';$('passwordStatus').className='';
 for(const field of $('passwordForm').elements)field.disabled=false;
 const dialog=$('passwordDialog');dialog.hidden=false;
 if(typeof dialog.showModal==='function')dialog.showModal();
 else{dialog.setAttribute('open','');dialog.classList.add('fallback');$('passwordBackdrop').hidden=false;}
 $('newPassword').focus();
};
$('passwordClose').onclick=()=>{if(!passwordBusy)closePasswordDialog();};
$('passwordBackdrop').onclick=()=>{if(!passwordBusy)closePasswordDialog();};
$('passwordDialog').addEventListener('cancel',e=>{if(passwordBusy)e.preventDefault();});
$('passwordDialog').addEventListener('close',()=>{$('passwordDialog').hidden=true;$('passwordForm').reset();$('passwordStatus').textContent='';});
$('passwordDialog').addEventListener('keydown',e=>{
 if(!$('passwordDialog').classList.contains('fallback'))return;
 if(e.key==='Escape'){e.preventDefault();if(!passwordBusy)closePasswordDialog();}
 if(e.key==='Tab'){
  const fields=[...$('passwordForm').elements].filter(x=>!x.disabled),first=fields[0],last=fields[fields.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
 }
});
$('passwordForm').onsubmit=async e=>{
 e.preventDefault();if(!profile||passwordBusy)return;
 const password=$('newPassword').value,confirm=$('confirmPassword').value,message=$('passwordStatus');
 message.className='error';
 if(password.length<12){message.textContent='A password deve ter pelo menos 12 caracteres.';return;}
 if(password!==confirm){message.textContent='As passwords não coincidem.';return;}
 const owner=profile;passwordBusy=true;message.textContent='A guardar…';
 for(const field of $('passwordForm').elements)field.disabled=true;
 try{
  await checked(client.auth.updateUser({password}));if(profile!==owner)return;
  $('passwordForm').reset();message.className='success';message.textContent='Password alterada.';
 }catch(error){if(profile===owner)message.textContent=error.message||'Não foi possível alterar a password.';}
 finally{if(profile===owner){passwordBusy=false;for(const field of $('passwordForm').elements)field.disabled=false;}}
};

$('importFile').onchange=async()=>{
 if(profile?.role!=='admin')return;const ticket=revision,owner=profile;pending=null;$('importSave').hidden=true;
 try{
  const file=$('importFile').files[0];if(!file)return;const parsed=CommissionModel.validateImport(JSON.parse(await file.text()));
  const [people,known]=await Promise.all([allRows(()=>client.from('rh_persons').select('id,name').order('id')),allRows(()=>client.from('rh_commission_identities').select('*').order('nif'))]);
  if(ticket!==revision||profile!==owner)return;pending=parsed;
  $('mapping').innerHTML=parsed.identities.map(i=>'<label class="mapping-row"><span>'+esc(i.source_name)+' · '+esc(i.nif)+'</span><select data-nif="'+esc(i.nif)+'"><option value="">Manter acesso existente / não criar novo</option>'+people.map(p=>'<option value="'+esc(p.id)+'" '+(known.some(k=>k.nif===i.nif&&k.person_id===p.id)?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>').join('');
  $('importSave').hidden=false;status(parsed.rows.length+' pagamentos · '+new Set(parsed.rows.map(r=>r.period)).size+' meses · '+parsed.identities.length+' pessoas. Rever associações antes de importar.');
 }catch(error){if(profile===owner){pending=null;status(error.message);}}
};
$('importSave').onclick=async()=>{
 if(!pending||profile?.role!=='admin')return;const snapshot=pending,owner=profile,button=$('importSave');button.disabled=true;
 try{
  const ids=[...document.querySelectorAll('[data-nif]')].filter(x=>x.value).map(x=>({nif:x.dataset.nif,person_id:x.value,source_name:snapshot.identities.find(i=>i.nif===x.dataset.nif).source_name}));
  if(new Set(ids.map(i=>i.person_id)).size!==ids.length)throw Error('A mesma pessoa RH foi associada a mais de um NIF.');
  if(ids.length)await checked(client.from('rh_commission_identities').upsert(ids));
  for(let i=0;i<snapshot.rows.length;i+=20){if(profile!==owner)throw Error('Sessão alterada. A importação foi interrompida.');status('A importar pagamentos: '+i+' / '+snapshot.rows.length+'…');await checked(client.from('rh_commissions').upsert(snapshot.rows.slice(i,i+20),{onConflict:'period,owner_nif'}));}
  if(profile!==owner)return;await load();status('Importação concluída.');
 }catch(error){if(profile===owner)status('Importação não concluída: '+error.message+' Pode repetir sem duplicar pagamentos.');}finally{button.disabled=false;}
};
(async()=>{try{const response=await fetch('/api/config',{cache:'no-store'});if(!response.ok)throw Error('Configuração indisponível.');const config=await response.json();client=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey);client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){clear();$('login').hidden=false;}});await load();}catch(error){clear();status('Não foi possível abrir as comissões: '+error.message);}})();
