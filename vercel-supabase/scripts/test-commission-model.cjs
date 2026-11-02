const assert=require('node:assert/strict');
module.exports=async function testCommissionModel(page,database,writes){
  const beforeRecords=JSON.stringify(database.rh_attendance_records);
  const beforeVacations=JSON.stringify(database.rh_vacations);
  const assignments=()=>database.rh_persons.map(({id,role_code,chefe_id})=>({id,role_code,chefe_id}));
  const beforeAssignments=assignments(),offset=writes.length;
  const edit=async value=>{
    await page.evaluate(()=>{switchTab('rh');rhEditPerson('history-A');});
    const input=page.locator('#rhTable').getByLabel('Modelo comissional',{exact:true});
    await input.fill(value);await input.press('Tab');
    await page.waitForFunction(()=>document.getElementById('syncStatus').textContent==='Guardado');
    await page.reload();await page.waitForFunction(()=>document.body.classList.contains('authenticated'));
  };
  await edit('  Modelo Base  ');
  assert.equal(database.rh_persons.find(person=>person.id==='history-A').data.modeloComissional,'Modelo Base');
  assert.equal(await page.evaluate(()=>state.persons.find(person=>person.id==='history-A').modeloComissional),'Modelo Base');
  await page.evaluate(()=>switchTab('dashboard'));
  assert.match(await page.locator('#dashboardCommissionModels').textContent(),/Modelo Base/);
  await edit('');
  assert.equal(database.rh_persons.find(person=>person.id==='history-A').data.modeloComissional,'');
  assert.equal(JSON.stringify(database.rh_attendance_records),beforeRecords);
  assert.equal(JSON.stringify(database.rh_vacations),beforeVacations);
  assert.deepEqual(assignments(),beforeAssignments);
  assert.ok(writes.slice(offset).every(query=>query.table==='rh_persons' && query.mode==='update' && Object.keys(query.value).every(key=>key==='data')));
  console.log(JSON.stringify({commissionModelSavedImmediately:true,persistsAfterReload:true,unknownModelExplicit:true,rolesAndTeamsUnchanged:true,attendanceAndVacationsUntouched:true}));
};
