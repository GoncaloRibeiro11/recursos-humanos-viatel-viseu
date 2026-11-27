(function(){
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 window.CommissionSync={mount(options){
  let files=[],worker,job=0,busy=false,rejectJob,intent=0;
  const message=text=>$('syncStatus').textContent=text;
  function stop(){job++;worker?.terminate();worker=null;rejectJob?.(Error('Operação cancelada.'));rejectJob=null;busy=false;$('syncPrepare').disabled=false;}
  function reset(){intent++;stop();files=[];$('syncFolder').value='';$('syncPanel').hidden=true;$('syncPeriods').innerHTML='';$('syncCoordinator').innerHTML='';$('syncCoordinatorWrap').hidden=true;message('');}
  async function run(data){
   stop();const ticket=job;busy=true;$('syncPrepare').disabled=true;
   return new Promise((resolve,reject)=>{
    rejectJob=reject;worker=new Worker('commission-worker.js');
    const finish=()=>{worker?.terminate();worker=null;rejectJob=null;busy=false;$('syncPrepare').disabled=false;};
    worker.onmessage=({data})=>{if(ticket!==job)return;if(data.progress){message(data.progress);return;}finish();data.error?reject(Error(data.error)):resolve(data.result);};
    worker.onerror=()=>{finish();reject(Error('Não foi possível iniciar o leitor Excel. Recarrega a página e tenta novamente.'));};
    worker.postMessage(data);
   });
  }
  $('syncOpen').onclick=()=>{if(options.getProfile()?.role!=='admin')return;reset();options.onStart();$('syncPanel').hidden=false;$('syncFolder').click();};
  $('syncChoose').onclick=()=>{if(!busy){$('syncFolder').value='';$('syncFolder').click();}};
  $('syncClose').onclick=reset;
  $('syncFolder').onchange=async()=>{
   if(options.getProfile()?.role!=='admin')return;const owner=options.getProfile(),ticket=++intent;options.onStart();
   files=[...$('syncFolder').files].filter(f=>/^(PAGAMENTOS|DETALHES)/i.test(f.name)&&/\.(xlsx|xlsm|xls)$/i.test(f.name)&&!f.name.startsWith('~$'));
   $('syncPeriods').innerHTML='';$('syncCoordinatorWrap').hidden=true;$('syncCoordinator').innerHTML='';
   try{
    const groups=await run({action:'discover',files});if(options.getProfile()!==owner||ticket!==intent)return;
    const metadata=options.getMetadata(),latest=metadata.map(r=>r.period).sort().at(-1)||'',existing=new Set(metadata.map(r=>r.period));
    $('syncPeriods').innerHTML=groups.map(g=>'<label class="sync-period"><input type="checkbox" data-period="'+esc(g.period)+'" '+(!g.error&&g.period>latest?'checked':'')+' '+(g.error?'disabled':'')+'><span><b>'+esc(g.period.slice(0,7))+'</b><small>'+esc(g.error||(existing.has(g.period)?'Já importado · substituição só após confirmação':g.period<=latest?'Mês anterior · não selecionado':'Novo mês'))+'</small></span></label>').join('');
    message(groups.length?groups.filter(g=>!g.error&&g.period>latest).length+' meses novos encontrados.':'Não foram encontrados pares PAGAMENTOS / DETALHES com mês e ano no nome.');
   }catch(error){if(options.getProfile()===owner&&ticket===intent)message(error.message);}
  };
  $('syncPrepare').onclick=async()=>{
   if(busy||options.getProfile()?.role!=='admin')return;const owner=options.getProfile(),ticket=++intent;options.onStart();busy=true;$('syncPrepare').disabled=true;
   const periods=[...document.querySelectorAll('#syncPeriods input:checked')].map(x=>x.dataset.period);
   try{
    if(!periods.length)throw Error('Seleciona pelo menos um mês. Os meses já importados ficam desmarcados por defeito.');
    message('A conferir as equipas históricas…');const aliases=await options.getAliases();if(options.getProfile()!==owner||ticket!==intent)return;
    const data=await run({action:'prepare',files,periods,knownNifs:[...new Set(options.getMetadata().map(r=>r.owner_nif))],coordinator:$('syncCoordinator').value,aliases});if(options.getProfile()!==owner||ticket!==intent)return;
    if(data.needsCoordinator){$('syncCoordinatorWrap').hidden=false;$('syncCoordinator').innerHTML='<option value="">Selecionar coordenação…</option>'+data.coordinators.map(c=>'<option>'+esc(c)+'</option>').join('');message('Confirma a coordenação dos mapas antes de preparar os pagamentos.');return;}
    await options.prepareImport(data);if(options.getProfile()!==owner)return;message('Mapas conferidos. Pagamentos ainda não gravados.');$('importReview').scrollIntoView({block:'start',behavior:'smooth'});
   }catch(error){if(options.getProfile()===owner&&ticket===intent)message(error.message);}
   finally{if(ticket===intent){busy=false;$('syncPrepare').disabled=false;}}
  };
  const selectionChanged=()=>{intent++;stop();options.onStart();message('Seleção alterada. Confere os meses antes de gravar.');};
  $('syncPeriods').onchange=selectionChanged;$('syncCoordinator').onchange=selectionChanged;
  return {reset};
 }};
})();
