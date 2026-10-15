const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function testVacationSync(page, database, writes){
  const originalRecords = structuredClone(database.rh_attendance_records);
  const primary = 'test-person';
  const secondary = 'test-other';
  database.rh_persons.push({ id:secondary, name:'Outro colaborador', role_code:'vendedor', ativo:true, entrada:'2020-01-01', data:{ role:'vendedor', color:'#16a34a' } });
  database.rh_vacations.push({ id:'planned-october', person_id:primary, start_date:'2026-10-19', end_date:'2026-10-21', note:'Periodo existente', data:{} });
  for (const [person_id, record_date, code] of [
    [primary,'2026-10-14','FE'], [primary,'2026-10-19','FE'], [secondary,'2026-10-20','FE'],
    [primary,'2026-10-16','FJ'], [secondary,'2026-10-21','P'], [primary,'2026-10-17','FE']
  ]) database.rh_attendance_records.push({ person_id, record_date, code });
  const record = (id,date) => database.rh_attendance_records.find(row => row.person_id === id && row.record_date === date)?.code || '';
  const saved = () => page.waitForFunction(() => document.getElementById('syncStatus').textContent === 'Guardado');
  const reload = async () => {
    await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('authenticated'));
    await page.evaluate(() => { currentMonth = 9; assidPeriodMode = 'month'; switchTab('assid'); });
  };
  const setPaint = code => page.evaluate(code => { paintCode = code; renderPaintModes(); }, code);
  const clickDay = date => page.locator(`td.day-cell[onclick="cellClick('${primary}','${date}')"]`).click();
  const beforeRead = writes.length;
  await reload();
  assert.equal(writes.length, beforeRead, 'loading existing FE days must not create or replace database rows');
  assert.match(await page.locator(`td.day-cell[onclick="cellClick('${primary}','2026-10-20')"]`).getAttribute('class'), /\bferias\b/);
  const initial = await page.evaluate(() => ({
    day14:getVacationsForDay('2026-10-14').length,
    day19:getVacationsForDay('2026-10-19').length,
    day20:getVacationsForDay('2026-10-20').length,
    invalidDay:getVacationPeriods().filter(v => v.attendance && v.start === '2026-10-17').length,
    months:vacationMonthTotals(new Set(['test-person','test-other'])),
    otherHasVacation:hasVacationMarkedInYear('test-other'),
    monthPrint:buildMonthVacationSummary(9), dayPrint:buildDayVacationTable('2026-10-14')
  }));
  assert.equal(initial.day14, 1);
  assert.equal(initial.day19, 1, 'the same day in both sources must appear once');
  assert.equal(initial.day20, 2);
  assert.equal(initial.invalidDay, 0);
  assert.equal(initial.months[9], 5);
  assert.equal(initial.otherHasVacation, true);
  assert.match(initial.monthPrint, /14\/10\/2026/);
  assert.match(initial.monthPrint, /Outro colaborador/);
  assert.match(initial.dayPrint, /14\/10\/2026/);
  await page.evaluate(() => switchTab('ferias'));
  assert.equal(await page.locator('#calendarGrid .month-card').nth(9).locator('.day-cell[title]').filter({ hasText:'14' }).locator('.vacation-bar').count(), 1);
  assert.equal(await page.locator('#feriasStats > div > .stat-card').nth(2).locator('.stat-value').textContent(), '7');
  await page.evaluate(() => { feriasWeekStart = '2026-10-12'; setFeriasView('week'); });
  assert.equal(await page.locator('.week-day-card').nth(2).locator('.week-vac-person').count(), 1);
  await page.evaluate(() => { setFeriasView('month'); openVacationsList(); });
  assert.equal(await page.locator('.vacation-entry').count(), 4);
  await page.evaluate(() => closeModal('listModal'));
  await page.locator('#calendarGrid .month-card').nth(9).scrollIntoViewIfNeeded();
  await page.screenshot({ path:path.resolve(__dirname,'../../../../recovery/vacation-sync-desktop.png') });
  await page.setViewportSize({ width:390, height:844 });
  await page.locator('#calendarGrid .month-card').nth(9).scrollIntoViewIfNeeded();
  await page.screenshot({ path:path.resolve(__dirname,'../../../../recovery/vacation-sync-mobile.png') });
  await page.setViewportSize({ width:1440, height:900 });

  await page.evaluate(() => switchTab('assid'));
  await setPaint('FE');
  await clickDay('2026-10-15'); await saved();
  assert.equal(record(primary,'2026-10-15'), 'FE');
  assert.equal(writes.slice(beforeRead).every(query => query.table === 'rh_attendance_records'), true);
  await reload();
  assert.equal(await page.evaluate(() => getVacationPeriods().some(v => v.attendance && v.personId === 'test-person' && v.start === '2026-10-14' && v.end === '2026-10-15')), true);
  await setPaint('FE');
  await clickDay('2026-10-15'); await saved();
  assert.equal(record(primary,'2026-10-15'), '');
  assert.equal(await page.evaluate(() => getVacationsForDay('2026-10-15').length), 0);
  await setPaint('P');
  await clickDay('2026-10-14'); await saved();
  assert.equal(await page.evaluate(() => getVacationsForDay('2026-10-14').length), 0);
  assert.equal(record(primary,'2026-10-14'), 'P');
  await setPaint('FE');
  await clickDay('2026-10-14'); await saved();

  await page.evaluate(() => { switchTab('ferias'); openVacationsList(); });
  await page.locator('.vacation-entry').filter({ hasText:'Outro colaborador' }).getByTitle('Editar', { exact:true }).click();
  await page.locator('#vacEnd').fill('2026-10-23');
  await page.locator('#vacNote').fill('Periodo editado');
  await page.locator('#vacModal .btn-primary').click(); await saved();
  const edited = database.rh_vacations.find(v => v.note === 'Periodo editado');
  assert.ok(edited);
  assert.equal(edited.person_id, secondary);
  assert.equal(edited.start_date, '2026-10-20');
  assert.equal(edited.end_date, '2026-10-23');
  assert.equal(record(secondary,'2026-10-20'), '');
  assert.equal(record(secondary,'2026-10-21'), 'P', 'editing vacations must not replace attendance overrides');
  await reload();
  assert.equal(await page.evaluate(() => getVacationsForDay('2026-10-23').length), 1);
  await page.evaluate(() => { switchTab('ferias'); openVacationsList(); });
  await page.locator('.vacation-entry').filter({ hasText:'Periodo editado' }).getByTitle('Apagar', { exact:true }).click(); await saved();
  assert.equal(database.rh_vacations.some(v => v.id === edited.id), false);
  await page.locator('.vacation-entry').filter({ hasText:'14/10/2026' }).getByTitle('Apagar', { exact:true }).click(); await saved();
  assert.equal(record(primary,'2026-10-14'), '');
  assert.equal(await page.evaluate(() => getVacationsForDay('2026-10-14').length), 0);
  await page.evaluate(() => { closeModal('listModal'); deleteVacation('planned-october'); }); await saved();
  assert.equal(record(primary,'2026-10-19'), '');
  assert.equal(record(primary,'2026-10-16'), 'FJ');
  assert.equal(record(secondary,'2026-10-21'), 'P');
  assert.equal(record(primary,'2026-10-17'), 'FE', 'pre-existing invalid dates must be preserved, not silently deleted');
  assert.equal(database.rh_vacations.some(v => v.id === 'vacation-test'), true);
  assert.equal(writes.filter(query => query.mode === 'delete').every(query => query.filters.length > 0), true);
  for (const row of originalRecords) assert.equal(record(row.person_id,row.record_date), row.code);

  const grouping = await page.evaluate(() => {
    const original = state;
    try {
      state = { persons:[{ id:'a', ativo:true, entrada:'2026-01-01' }, { id:'b', ativo:true, entrada:'2026-10-10', saida:'2026-10-20' }], vacations:[], records:{
        'a|2026-10-02':'FE', 'a|2026-10-06':'FE', 'a|2026-10-08':'FE',
        'a|2026-09-30':'FE', 'a|2026-10-01':'FE', 'a|2026-10-05':'FE', 'a|2026-10-03':'FE',
        'b|2026-10-09':'FE', 'b|2026-10-21':'FE', 'a|2025-12-31':'FE'
      } };
      return { periods:getVacationPeriods().map(v => [v.start,v.end]), months:vacationMonthTotals(new Set(['a'])) };
    } finally { state = original; }
  });
  assert.deepEqual(grouping.periods, [['2026-09-30','2026-10-06'],['2026-10-08','2026-10-08']]);
  assert.equal(grouping.months[8], 1);
  assert.equal(grouping.months[9], 4);
  const beforeManager = writes.length;
  await page.evaluate(() => { currentProfile.role = 'gestor'; switchTab('ferias'); openVacationsList(); });
  assert.equal(await page.locator('#vacationsList .vac-delete').count(), 0);
  await page.evaluate(() => cellClick('test-person','2026-10-15'));
  assert.equal(writes.length, beforeManager);
  await reload();
  console.log(JSON.stringify({ attendanceVacations:'visible after reload', monthAndWeek:'passed', noDuplicateDays:true, dashboardAndPrint:'passed', editAndDelete:'passed', targetedWrites:true, existingRecordsPreserved:true, managerReadOnly:true }));
};
