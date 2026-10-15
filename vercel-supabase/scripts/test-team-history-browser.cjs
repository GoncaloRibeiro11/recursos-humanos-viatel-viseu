const assert = require('node:assert/strict');
const path = require('node:path');

function historyFixture(database){
  return {
    enabled:false, rows:[],
    scope(table, rows){
      if (!this.enabled) return rows;
      const profile=database.user_profiles[0];
      if (profile.role==='admin') return rows;
      const id=profile.person_id;
      const owns=(person,date)=>person===id || this.rows.some(h=>h.person_id===person && h.chefe_id===id && h.valid_from<=date && (!h.valid_to || date<h.valid_to));
      if (table==='rh_persons') return rows.filter(p=>p.id===id || p.chefe_id===id);
      if (table==='rh_attendance_records') return rows.filter(r=>owns(r.person_id,r.record_date));
      if (table==='rh_assignment_history') return rows.filter(h=>h.person_id===id || h.chefe_id===id);
      if (table==='rh_vacations') return rows.filter(v=>v.person_id===id || this.rows.some(h=>h.person_id===v.person_id && h.chefe_id===id && h.valid_from<=v.start_date && (!h.valid_to || v.end_date<h.valid_to)));
      return rows;
    },
    visibleVacations(){
      const profile=database.user_profiles[0];
      if (profile.role==='admin') return database.rh_vacations;
      const rows=[];
      for (const v of database.rh_vacations){
        if (v.person_id===profile.person_id){ rows.push(v); continue; }
        for (const h of this.rows){
          if (h.person_id!==v.person_id || h.chefe_id!==profile.person_id || h.valid_from>v.end_date || (h.valid_to && h.valid_to<=v.start_date)) continue;
          const previous=h.valid_to?new Date(h.valid_to+'T12:00:00Z'):null;
          if (previous) previous.setUTCDate(previous.getUTCDate()-1);
          const start_date=v.start_date>h.valid_from?v.start_date:h.valid_from;
          const end_date=previous && previous.toISOString().slice(0,10)<v.end_date?previous.toISOString().slice(0,10):v.end_date;
          rows.push({...v,id:v.id+'@'+h.id,start_date,end_date,data:{start:start_date,end:end_date}});
        }
      }
      return rows;
    }
  };
}

async function testTeamHistory(page,database,writes,fixture){
  await page.clock.install({ time:new Date('2026-11-15T12:00:00Z') });
  const people=[
    {id:'history-old',name:'Old Manager',role:'chefe_equipa',chefeId:'history-old'},
    {id:'history-next',name:'New Manager',role:'vendedor',chefeId:'history-old'},
    ...['A','B','C'].map(id=>({id:'history-'+id,name:'Seller '+id,role:'vendedor',chefeId:'history-old'}))
  ];
  for (const p of people) database.rh_persons.push({id:p.id,name:p.name,role_code:p.role,chefe_id:p.chefeId,ativo:true,entrada:'2020-01-01',data:{...p,color:'#0284c7'}});
  fixture.rows=database.rh_persons.map(p=>({ id:'baseline-'+p.id,person_id:p.id,valid_from:'0001-01-01',valid_to:null,role_code:p.role_code,chefe_id:p.chefe_id,chefe_name:'Old Manager',person_snapshot:{name:p.name,color:'#0284c7',ativo:true,entrada:'2020-01-01'} }));
  fixture.enabled=true;
  const beforeWrites=writes.length;
  await page.reload(); await page.waitForFunction(()=>document.body.classList.contains('authenticated'));
  const before=await page.evaluate(()=>JSON.stringify(state));
  await page.evaluate(()=>openTeamDraft());
  const plan={leaderName:'New Manager',sourceManagerName:'Old Manager',memberNames:['Seller A','Seller B','Seller C'],effectiveDate:null};
  await page.locator('#teamDraftFile').setInputFiles({name:'draft.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(plan))});
  await page.waitForFunction(()=>preparedTeamDraft?.changes.length===4);
  assert.equal(await page.locator('#teamDraftDate').inputValue(),'');
  assert.match(await page.locator('#teamDraftStatus').textContent(),/data por confirmar/);
  assert.equal(await page.locator('#teamDraftModal .btn').filter({hasText:/Ativar|Aplicar|Confirmar/}).count(),0);
  await page.screenshot({path:path.resolve(__dirname,'../../../../recovery/team-transition-draft-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#teamDraftExport').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.resolve(__dirname,'../../../../recovery/team-transition-draft-mobile.png')});
  const downloadEvent=page.waitForEvent('download');
  await page.locator('#teamDraftExport').click();
  const download=await downloadEvent;
  assert.equal(download.suggestedFilename(),'transicao-equipa-rascunho.json');
  assert.equal(await page.evaluate(()=>JSON.stringify(state)),before);
  assert.equal(writes.length,beforeWrites);
  await page.evaluate(()=>closeModal('teamDraftModal'));
  await page.setViewportSize({width:1440,height:900});

  for (const p of people.slice(1)){
    fixture.rows.find(h=>h.person_id===p.id).valid_to='2026-11-01';
    fixture.rows.push({ id:'next-'+p.id,person_id:p.id,valid_from:'2026-11-01',valid_to:null,role_code:p.id==='history-next'?'chefe_equipa':'vendedor',chefe_id:'history-next',chefe_name:'New Manager',person_snapshot:{name:p.name,color:'#0284c7',ativo:true,entrada:'2020-01-01'} });
    const row=database.rh_persons.find(row=>row.id===p.id);
    row.role_code=p.id==='history-next'?'chefe_equipa':'vendedor'; row.chefe_id='history-next';
  }
  for (let i=0;i<31;i++){
    const day=new Date(Date.UTC(2026,9,21+i));
    if (day.getUTCDay()===0 || day.getUTCDay()===6) continue;
    database.rh_attendance_records.push({person_id:'history-A',record_date:day.toISOString().slice(0,10),code:'P'});
  }
  database.rh_vacations.push({id:'history-vacation',person_id:'history-A',start_date:'2026-10-29',end_date:'2026-11-04',data:{}});
  await page.reload(); await page.waitForFunction(()=>document.body.classList.contains('authenticated'));
  await page.evaluate(()=>{
    currentMonth=10; assidPeriodMode='payroll'; assidFilters={name:'Seller A',role:[],chefe:['history-old'],empresa:[],carga:[]};
    window.print=()=>{}; switchTab('assid');
  });
  const present=()=>page.locator('#assidStats .stat-card').nth(3).locator('.stat-value').textContent();
  assert.equal(await present(),'8');
  assert.equal(await page.locator('#sheet tbody tr .pct').textContent(),'100%');
  await page.evaluate(()=>doPrintAssid());
  assert.equal(await page.locator('#printArea .print-sheet tbody td').filter({hasText:/^P$/}).count(),8);
  await page.evaluate(()=>{ assidFilters.chefe=['history-next']; renderAssidFilters(); renderSheet(); renderAssidStats(); });
  assert.equal(await present(),'15');
  assert.equal(await page.locator('#sheet tbody tr .pct').textContent(),'100%');
  await page.evaluate(()=>{ assidFilters={name:'New Manager',role:[],chefe:[],empresa:[],carga:[]}; renderSheet(); });
  assert.match(await page.locator('#sheet .name-role').textContent(),/Gestor Comercial.*Gestor de Equipa/);
  await page.evaluate(()=>{ assidPeriodMode='month'; currentMonth=9; renderSheet(); });
  assert.equal(await page.locator('#sheet .name-role').textContent(),'Gestor Comercial');
  await page.evaluate(()=>{ currentMonth=10; renderSheet(); });
  assert.equal(await page.locator('#sheet .name-role').textContent(),'Gestor de Equipa');

  for (const [manager,expected] of [['history-old','8'],['history-next','15']]){
    database.user_profiles[0].role='gestor'; database.user_profiles[0].person_id=manager;
    await page.reload(); await page.waitForFunction(()=>document.body.classList.contains('authenticated'));
    await page.evaluate(()=>{ currentMonth=10; assidPeriodMode='payroll'; assidFilters={name:'Seller A',role:[],chefe:[],empresa:[],carga:[]}; switchTab('assid'); });
    assert.equal(await present(),expected);
    assert.equal(await page.evaluate(()=>reportPerson('history-A')?.name),'Seller A');
    const currentIds=await page.evaluate(()=>state.persons.map(p=>p.id));
    if (manager==='history-old') assert.equal(currentIds.includes('history-A'),false);
    const dates=await page.evaluate(()=>state.vacations.filter(v=>v.personId==='history-A').map(v=>[v.start,v.end]));
    assert.deepEqual(dates,manager==='history-old'?[['2026-10-29','2026-10-31']]:[['2026-11-01','2026-11-04']]);
    await page.evaluate(()=>{switchTab('ferias');feriasWeekStart='2026-10-26';setFeriasView('week');});
    if (manager==='history-old') assert.equal(await page.locator('.week-vac-person').count(),2);
    await page.evaluate(()=>{ setFeriasView('month'); openVacationsList(); });
    assert.equal(await page.locator('#vacationsList .vacation-entry').filter({hasText:'Seller A'}).count(),1);
    await page.evaluate(()=>closeModal('listModal'));
    assert.equal(await page.locator('button[onclick="openTeamDraft()"]').isVisible(),false);
  }
  assert.equal(writes.length,beforeWrites);
  console.log(JSON.stringify({draftNeverWrites:true, noActivationControl:true, payrollPreviousTeamDays:8, payrollNewTeamDays:15, promotionLabelsByDate:true, historicalProfilesMinimal:true, managerDatesScoped:true, vacationSplitVisible:true}));
}
module.exports={historyFixture,testTeamHistory};
