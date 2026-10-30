const assert=require('node:assert/strict');
const path=require('node:path');

function teamChangeRpc(name,args,database,fixture){
  if (name==='rh_process_due_team_changes') return {data:0};
  if (!['rh_submit_team_change','rh_cancel_team_change'].includes(name)) return;
  const plans=database.rh_team_change_plans;
  if (name==='rh_cancel_team_change'){
    plans.find(plan=>plan.request_id===args.p_request_id).status='cancelled';
    return {data:{ok:true}};
  }
  let plan=plans.find(plan=>plan.request_id===args.p_request_id);
  if (!plan){
    const status=args.p_effective_date>'2026-11-15'?'pending':'applied';
    plan={request_id:args.p_request_id,effective_date:args.p_effective_date,changes:args.p_changes,status};
    plans.push(plan);
    if (status==='applied') for (const change of args.p_changes){
      const person=database.rh_persons.find(person=>person.id===change.personId);
      person.role_code=change.toRole;person.chefe_id=change.toChefeId;
      person.data={...person.data,role:change.toRole,chefeId:change.toChefeId};
      fixture.rows.find(row=>row.person_id===person.id && !row.valid_to).valid_to=args.p_effective_date;
      fixture.rows.push({id:'applied-'+person.id,person_id:person.id,valid_from:args.p_effective_date,valid_to:null,role_code:change.toRole,chefe_id:change.toChefeId,person_snapshot:{name:person.name,ativo:true,entrada:'2020-01-01'}});
    }
  }
  if (fixture.failOnce){fixture.failOnce=false;return {error:{message:'Resposta interrompida depois da confirmacao no servidor'}};}
  return {data:{ok:true,status:plan.status}};
}

async function testTeamChanges(page,database,writes,fixture){
  fixture.version=2;
  database.rh_team_change_plans=[];
  database.user_profiles[0].role='admin';database.user_profiles[0].person_id='test-person';
  await page.reload();await page.waitForFunction(()=>document.body.classList.contains('authenticated'));
  const beforeRecords=JSON.stringify(database.rh_attendance_records);
  const beforePersons=JSON.stringify(database.rh_persons);
  await page.evaluate(()=>rhUpdate('history-A','chefeId','history-old'));
  await page.locator('#teamChangesModal').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>state.persons.find(p=>p.id==='history-A').chefeId),'history-next');
  await page.locator('#teamChangesDate').fill('2026-11-16');
  await page.locator('#teamChangesDate').dispatchEvent('change');
  assert.equal(await page.locator('#teamChangesSubmit').isDisabled(),true);
  await page.locator('#teamChangesConfirm').check();
  assert.equal(await page.locator('#teamChangesSubmit').textContent(),'Agendar alteração');
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    const modal=page.locator('#teamChangesModal .modal');
    assert.equal(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await page.screenshot({path:path.resolve(__dirname,`../../../../recovery/team-changes-form-${width}.png`)});
  }
  await page.evaluate(()=>setThemePreference('dark'));
  await page.screenshot({path:path.resolve(__dirname,'../../../../recovery/team-changes-form-dark.png')});
  await page.evaluate(()=>setThemePreference('light'));
  fixture.failOnce=true;
  await page.locator('#teamChangesSubmit').click();
  await page.waitForFunction(()=>document.getElementById('teamChangesStatus').textContent.includes('Resposta interrompida'));
  assert.equal(database.rh_team_change_plans.length,1);
  await page.locator('#teamChangesSubmit').click();
  await page.waitForFunction(()=>document.getElementById('teamChangesStatus').textContent.includes('agendada e guardada'));
  assert.equal(database.rh_team_change_plans.length,1,'retry reuses the confirmation ID');
  assert.equal(JSON.stringify(database.rh_persons),beforePersons,'scheduling never applies early');
  await page.reload();await page.waitForFunction(()=>document.body.classList.contains('authenticated'));
  await page.evaluate(()=>openTeamChanges());
  await page.locator('#teamChangesTab-pending').click();
  assert.match(await page.locator('#teamChangesPending').textContent(),/Seller A/);
  await page.locator('#teamChangesPending').getByRole('button',{name:'Cancelar alteração'}).click();
  await page.waitForFunction(()=>document.getElementById('teamChangesStatus').textContent==='Alteração cancelada.');
  assert.equal(database.rh_team_change_plans[0].status,'cancelled');
  assert.equal(JSON.stringify(database.rh_persons),beforePersons);
  await page.evaluate(()=>{closeModal('teamChangesModal');rhUpdate('history-A','chefeId','history-old');});
  await page.locator('#teamChangesConfirm').check();
  assert.equal(await page.locator('#teamChangesSubmit').textContent(),'Aplicar alteração');
  await page.locator('#teamChangesSubmit').click();
  await page.waitForFunction(()=>document.getElementById('teamChangesStatus').textContent.includes('Histórico preservado'));
  assert.equal(database.rh_persons.find(p=>p.id==='history-A').chefe_id,'history-old');
  assert.equal(await page.evaluate(()=>reportPersonOnDate('history-A','2026-11-14').chefeId),'history-next');
  assert.equal(await page.evaluate(()=>reportPersonOnDate('history-A','2026-11-15').chefeId),'history-old');
  assert.equal(JSON.stringify(database.rh_attendance_records),beforeRecords);
  assert.equal(writes.filter(write=>write.table==='rh_persons' && (write.value?.role_code || write.value?.chefe_id)).length,0);
  await page.evaluate(()=>closeModal('teamChangesModal'));
  console.log(JSON.stringify({selfServiceForm:true,mobile320:true,mobile390:true,darkTheme:true,scheduledSurvivesReload:true,networkRetryIdempotent:true,cancellation:true,immediateDatedChange:true,attendanceUntouched:true}));
}
module.exports={teamChangeRpc,testTeamChanges};
