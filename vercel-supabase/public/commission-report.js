(function(){
 'use strict';
 const $=id=>document.getElementById(id),H=JSON.parse($('report-data').textContent),pristine=document.documentElement.cloneNode(true);
 if(!H.years||!Object.keys(H.years).length){$('readable-fallback').hidden=false;$('readable-fallback').textContent='Sem dados de relatório.';return;}
 const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>Number.isFinite(v)?new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format(Math.abs(v)<1e-8?0:v):'—';
 const sum=(xs,f)=>xs.reduce((s,x)=>s+f(x),0),norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const monthNames=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
 let activeYear=H.latestYear,Y=H.years[activeYear],period=Y.latest,D,selected=H.personId||'all',filtered=[];
 function options(el,values,all){el.innerHTML=(all?'<option value="all">'+e(all)+'</option>':'')+values.map(([id,label])=>'<option value="'+e(id)+'">'+e(label)+'</option>').join('');}
 function initYear(){
  Y=H.years[activeYear];Y.annual=CommissionModel.annualData(Y,activeYear);period=Y.latest;
  options($('period'),[['all','Acumulado '+activeYear],...Object.keys(Y.months).sort((a,b)=>a-b).map(k=>[k,Y.months[k].period])]);$('period').value=period;
  const people=new Map();for(const p of Y.annual.people)people.set(p.id,p.name);options($('person'),[...people],people.size>1?'Todas as pessoas':null);
  if(!people.has(selected))selected=people.size===1?[...people.keys()][0]:'all';$('person').value=selected;render();
 }
 function people(){return D.people.filter(p=>selected==='all'||p.id===selected);}
 function rows(){const ids=new Set(people().map(p=>p.id));return D.records.filter(r=>ids.has(r.owner));}
 function timeline(){
  const months=Array.from({length:12},(_,i)=>{const m=Y.months[String(i+1)],ps=m?.people.filter(p=>selected==='all'||p.id===selected)||[];return {key:String(i+1),m,value:ps.length?sum(ps,p=>p.total):null};});
  const max=Math.max(1,...months.map(m=>Math.abs(m.value||0)));
  $('timeline').innerHTML=months.map((m,i)=>'<button type="button" class="month-bar '+(period===m.key?'active':'')+'" data-month="'+m.key+'" '+(!m.m?'disabled':'')+'><span>'+money(m.value)+'</span><i style="height:'+(m.value===null?3:Math.max(3,Math.abs(m.value)/max*110))+'px;background:'+(m.value<0?'var(--red)':'var(--teal)')+'"></i><b>'+monthNames[i].slice(0,3)+'</b><small>'+(!m.m?'Sem mapa':m.value===null?'Sem registo':m.m.partial?'Só pagamento':'')+'</small></button>').join('');
  const keys=Object.keys(Y.months).sort((a,b)=>a-b),ps=Y.annual.people.filter(p=>selected==='all'||p.id===selected);
  $('historyTable').innerHTML='<div class="table-wrap"><table><thead><tr><th>Pessoa</th>'+keys.map(k=>'<th class="money">'+monthNames[+k-1].slice(0,3)+'</th>').join('')+'<th class="money">Acumulado</th></tr></thead><tbody>'+ps.map(p=>'<tr><td>'+e(p.name)+'</td>'+keys.map(k=>'<td class="money">'+money(Y.months[k].people.find(x=>x.id===p.id)?.total)+'</td>').join('')+'<td class="money">'+money(p.total)+'</td></tr>').join('')+'</tbody></table></div>';
 }
 function production(){
  for(const field of ['productionChe','productionVdd']){
   const list=D[field].filter(r=>selected==='all'||r.owner===selected);
   $(field).innerHTML=list.map(r=>'<details class="panel production-block"><summary>'+e(r.name)+' · '+e(r.sheet)+' · '+e(r.period)+'</summary>'+(r.sourceTeam?'<p class="note">Equipa no resumo de origem: '+e(r.sourceTeam)+'</p>':'')+['metrics','criteria'].map(k=>'<div class="table-wrap"><table><tbody>'+(r[k]||[]).map(x=>'<tr><td>'+e(x.label)+'</td><td class="money '+(typeof x.value==='string'&&x.value.startsWith('#')?'neg':'')+'">'+e(x.value??'Não indicado')+'</td></tr>').join('')+'</tbody></table></div>').join('')+'</details>').join('');
  }
  if(!$('productionChe').innerHTML&&!$('productionVdd').innerHTML)$('productionVdd').innerHTML='<p class="note">Sem resumo de produção disponível para esta seleção.</p>';
  const adjustments=D.adjustments.filter(r=>selected==='all'||r.owner===selected);
  $('adjustmentsBody').innerHTML=adjustments.length?'<div class="table-wrap"><table><thead><tr><th>Pessoa / mês</th><th>Descrição</th><th>Notas</th><th class="money">Valor</th></tr></thead><tbody>'+adjustments.map(r=>'<tr><td>'+e(r.person)+'<small>'+e(r.period||r.month)+'</small></td><td>'+e(r.description)+(r.included?'<small>Incluído no pagamento</small>':'')+'</td><td>'+e(r.notes??'—')+'</td><td class="money">'+money(r.amount)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="note">Sem acertos disponíveis para esta seleção.</p>';
 }
 function render(){
  D=period==='all'?Y.annual:Y.months[period];const ps=people(),rs=rows(),one=ps.length===1,total=ps.length?sum(ps,p=>p.total):null,detail=sum(rs,r=>r.amount);
  $('heading').textContent=one?ps[0].name:H.displayName;$('subtitle').textContent=D.period+' · '+H.displayName;$('audience').textContent=H.personId?'HISTÓRICO PESSOAL':'HISTÓRICO DE COMISSÕES';$('periodLabel').textContent=D.period;
  $('total').textContent=money(total);$('totalHint').textContent=ps.length?ps.length+' pessoa(s)':'Sem registo neste mês';$('clientTotal').textContent=D.partial||H.personal?'Não disponível':money(detail);
  const partial=sum(Object.values(Y.months).filter(m=>m.partial),m=>sum(m.people.filter(p=>selected==='all'||p.id===selected),p=>p.total));
  $('otherTotal').textContent=H.personal?'Ver composição':D.partial?'Não disponível':money(total===null?null:total-detail-(period==='all'?partial:0));$('missingKpi').classList.toggle('hidden',period!=='all'||!Object.values(Y.months).some(m=>m.partial&&m.people.some(p=>selected==='all'||p.id===selected)));$('missingTotal').textContent=money(partial);$('missingKpi').querySelector('small').textContent='Pagamentos sem detalhe disponível';
  $('peopleSection').classList.toggle('hidden',one||!ps.length);$('compositionSection').classList.toggle('hidden',!one);
  $('cards').innerHTML=ps.map(p=>'<button type="button" class="person" data-person="'+e(p.id)+'"><span class="initials">'+e(p.name.split(' ').filter(Boolean).filter((_,i,a)=>i===0||i===a.length-1).map(x=>x[0]).join(''))+'</span><b>'+e(p.name)+'</b><small>'+e(p.role)+' · '+e(p.team)+'</small><strong>'+money(p.total)+'</strong></button>').join('');
  if(one){
   $('compositionSubtitle').textContent=period==='all'?'Rubricas acumuladas de '+activeYear:'Fonte: '+(D.sourceSheet||'Mapa de pagamento')+' · linha '+(ps[0].sourceRow??'—');
   $('rubrics').innerHTML=ps[0].rubrics.map(r=>'<div class="rubric"><span>'+e(r.label)+'</span><b class="'+(r.amount<0?'neg':'')+'">'+money(r.amount)+'</b></div>').join('')+'<div class="rubric"><b>Total</b><b>'+money(ps[0].total)+'</b></div>';
   const origins=new Map();for(const r of rs)origins.set(r.origin,(origins.get(r.origin)||0)+r.amount);const max=Math.max(1,...[...origins.values()].map(Math.abs));
   $('bars').innerHTML=[...origins].map(([name,value])=>'<div class="rubric"><span>'+e(name)+'</span><b>'+money(value)+'</b></div><div class="bar"><i style="width:'+Math.abs(value)/max*100+'%;background:'+(value<0?'var(--red)':'var(--teal)')+'"></i></div>').join('')||(H.personal?'<p class="note">Sem repartição pessoal por cliente na origem.</p>':'<p class="note">Sem detalhe por cliente disponível.</p>');
  }
  const checks=D.checks.filter(r=>(selected==='all'||r.owner===selected)&&Number.isFinite(r.difference)&&Math.abs(r.difference)>.01);
  $('reviewNotes').innerHTML=checks.length?'<details class="source" open><summary>Diferenças existentes entre o mapa e o detalhe</summary><table><thead><tr><th>Pessoa / mês</th><th class="money">Pagamento</th><th class="money">Detalhe</th><th class="money">Diferença</th></tr></thead><tbody>'+checks.map(r=>'<tr><td>'+e(r.person)+' · '+e(r.month)+'</td><td class="money">'+money(r.payment)+'</td><td class="money">'+money(r.detail)+'</td><td class="money">'+money(r.difference)+'</td></tr>').join('')+'</tbody></table></details>':'';
  const productionRows=[...D.productionVdd,...D.productionChe].filter(r=>selected==='all'||r.owner===selected),hasErrors=productionRows.some(r=>[...(r.metrics||[]),...(r.criteria||[])].some(x=>typeof x.value==='string'&&x.value.startsWith('#')));
  $('coverage').textContent='A equipa de cada pessoa corresponde ao mapa de cada mês. Meses sem registo aparecem com um traço.'+(D.partial?' Está disponível apenas o pagamento; falta o detalhe deste mês.':'')+(hasErrors?' Existem erros de fórmula na origem; foram preservados e não tratados como zero.':'')+(H.notice?' '+H.notice:'');
  $('detailNote').textContent=H.notice||(D.partial?'Detalhe por cliente não disponível neste mapa.':'Valores do detalhe da seleção atual. Os filtros não alteram o total do mapa de pagamento.');
  options($('service'),[...new Set(rs.map(r=>r.service))].sort().map(x=>[x,x]),'Todos os serviços');options($('origin'),[...new Set(rs.map(r=>r.origin))].sort().map(x=>[x,x]),'Todas as origens');
  const sources=period==='all'?Object.values(Y.months):[D];$('sourceInfo').innerHTML='<summary>Fontes e critérios de leitura</summary>'+sources.map(m=>'<p><b>'+e(m.period)+'</b>: '+e(m.sourcePay||'Mapa de pagamento')+' · '+e(m.sourceSheet||'')+(m.sourceDetail?'<br>Detalhe: '+e(m.sourceDetail):'<br>Sem detalhe disponível.')+'</p>').join('')+'<p>Os pagamentos seguem os valores de origem. Produção, prémios e acertos informativos não são somados novamente. A apresentação a duas casas decimais pode criar diferenças de arredondamento.</p>';
  timeline();production();detailRender();
 }
 function detailRender(){
  const q=norm($('search').value),service=$('service').value,origin=$('origin').value,sign=$('sign').value;
  filtered=rows().filter(r=>($('zero').checked||r.amount!==0)&&(service==='all'||r.service===service)&&(origin==='all'||r.origin===origin)&&(sign==='all'||(sign==='positive'?r.amount>0:r.amount<0))&&(!q||norm([r.client,r.nif,r.sale,r.item,r.service,r.seller,r.ownerName].join(' ')).includes(q)));
  const groups=new Map();for(const r of filtered){const key=r.period+'|'+r.nif;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  $('filteredTotal').textContent=money(sum(filtered,r=>r.amount));$('filteredCount').textContent=filtered.length+' registos · '+new Set(filtered.map(r=>r.nif)).size+' clientes (NIF)';
  $('clients').innerHTML=[...groups.values()].sort((a,b)=>String(a[0].nif).localeCompare(String(b[0].nif))).map(list=>{
   const first=list[0],value=sum(list,r=>r.amount),vp=CommissionModel.vpTotal(list);
   return '<details class="client"><summary><span class="identity"><b>'+e(first.client||('Cliente · NIF '+first.nif))+'</b><small>NIF '+e(first.nif)+' · '+e(first.period)+'</small></span><span class="sum '+(value<0?'neg':'')+'">'+money(value)+'<small>'+(vp===null?'VP não indicado':new Intl.NumberFormat('pt-PT',{maximumFractionDigits:4}).format(vp)+' créditos VP')+'</small><small>'+list.length+' registos</small></span></summary><div class="table-wrap"><table><thead><tr><th>Serviço</th><th>Créditos VP</th><th>Origem</th><th>Estado</th><th>Referência</th><th class="money">Valor</th></tr></thead><tbody>'+list.map(r=>'<tr><td><b>'+e(r.service)+'</b><small>'+e(r.seller)+' · OV '+e(r.sale)+'</small></td><td>'+e(r.credits??'—')+'</td><td>'+e(r.origin)+'<small>'+e(r.ownerName)+' · '+e(r.event??'')+'</small></td><td>'+e(r.status??'Não indicado')+'</td><td>Item '+e(r.item)+'<small>Linha '+e(r.line)+' · '+(r.chief?'Comissão CE':'Valor vendedor')+'</small></td><td class="money '+(r.amount<0?'neg':'')+'">'+money(r.amount)+'</td></tr>').join('')+'</tbody></table></div></details>';
  }).join('')||'<div class="empty">Não existem registos com estes filtros.</div>';
 }
 function download(text,type,name){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 options($('year'),Object.keys(H.years).sort().reverse().map(k=>[k,k]));$('year').value=activeYear;$('team').closest('.field').hidden=true;$('recipientLink').hidden=true;
 $('year').onchange=()=>{activeYear=$('year').value;initYear();};$('period').onchange=()=>{period=$('period').value;render();};$('person').onchange=()=>{selected=$('person').value;render();};
 $('timeline').onclick=ev=>{const b=ev.target.closest('[data-month]');if(b&&!b.disabled){period=b.dataset.month;$('period').value=period;render();}};
 $('cards').onclick=ev=>{const b=ev.target.closest('[data-person]');if(b){selected=b.dataset.person;$('person').value=selected;render();window.scrollTo({top:0});}};
 for(const id of ['service','origin','sign','zero'])$(id).onchange=detailRender;$('search').oninput=detailRender;
 $('reset').onclick=()=>{$('search').value='';for(const id of ['service','origin','sign'])$(id).value='all';$('zero').checked=false;detailRender();};
 $('expand').onclick=()=>document.querySelectorAll('.client').forEach(x=>x.open=true);$('collapse').onclick=()=>document.querySelectorAll('.client').forEach(x=>x.open=false);
 $('navOverview').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});$('navDetail').onclick=()=>$('detail').scrollIntoView({behavior:'smooth'});$('print').onclick=()=>window.print();
 let openBefore=[];window.addEventListener('beforeprint',()=>{openBefore=[...document.querySelectorAll('.client')].map(x=>x.open);document.querySelectorAll('.client').forEach(x=>x.open=true);});window.addEventListener('afterprint',()=>document.querySelectorAll('.client').forEach((x,i)=>x.open=openBefore[i]));
 $('csv').onclick=()=>{const cell=v=>'"'+String(typeof v==='number'?String(v).replace('.',','):typeof v==='string'&&/^[=+@\-\t\r]/.test(v)?"'"+v:v??'').replace(/"/g,'""')+'"';const headers=['Mês','Destinatário','Cliente','NIF cliente','Vendedor','Serviço','OV','Origem','Estado','Créditos VP','Valor EUR','Linha origem'];const lines=filtered.map(r=>[r.period,r.ownerName,r.client,r.nif,r.seller,r.service,r.sale,r.origin,r.status,r.credits,r.amount,r.line]);download('\ufeff'+[headers,...lines].map(row=>row.map(cell).join(';')).join('\r\n'),'text/csv;charset=utf-8','Detalhe_Comissoes_'+activeYear+'.csv');};
 const exportButton=document.createElement('button');exportButton.type='button';exportButton.className='btn primary';exportButton.textContent='Exportar pessoa selecionada · HTML';document.querySelector('.actions').append(exportButton);
 exportButton.onclick=()=>{if(selected==='all'){alert('Seleciona primeiro uma pessoa.');return;}const history=CommissionModel.personalHistory(H,selected),copy=pristine.cloneNode(true);copy.querySelector('#report-data').textContent=JSON.stringify(history).replace(/</g,'\\u003c');download('<!doctype html>'+copy.outerHTML,'text/html;charset=utf-8','Comissoes_'+selected.slice(1)+'.html');};
 document.querySelector('.aside-bottom').textContent='Portal RH Viatel Viseu';initYear();$('interactive-shell').style.display='block';
})();
