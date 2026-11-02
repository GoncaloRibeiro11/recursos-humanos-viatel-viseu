const assert=require('node:assert/strict');
const path=require('node:path');

module.exports=async function testDashboardAnalytics(page,output){
  await page.reload();await page.locator('#dashboardAnalytics').waitFor();
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>setThemePreference('light'));
  await page.evaluate(()=>window.scrollTo(0,0));
  const metric=key=>page.locator(`[data-analytics-total="${key}"]`).textContent();
  assert.equal(await metric('opening'),'12');assert.equal(await metric('closing'),'22');
  assert.equal(await metric('entries'),'19');assert.equal(await metric('exits'),'9');assert.equal(await metric('balance'),'+10');
  assert.equal(await page.locator('#dashboardCommissionModels [data-model-coverage]').textContent(),'54,5%');
  assert.equal(await page.locator('.analytics-trend-point').count(),11,'no future monthly closing is invented');
  assert.equal(await page.locator('.analytics-trend-value').last().textContent(),'22');
  assert.equal(await page.locator('#dashboardTeamAnalysis tbody img').count(),3);
  await page.screenshot({path:path.join(output,'dashboard-analytics-desktop.png'),fullPage:true});
  await page.locator('#dashboardAnalyticsFrom').fill('2026-11-01');await page.locator('#dashboardAnalyticsFrom').dispatchEvent('change');
  await page.locator('#dashboardAnalyticsTeam').selectOption('a');
  assert.equal(await metric('opening'),'10');assert.equal(await metric('closing'),'9');
  assert.equal(await metric('entries'),'0');assert.equal(await metric('exits'),'0');assert.equal(await metric('balance'),'0');
  const teamRow=page.locator('[data-analytics-team="a"]');
  assert.equal(await teamRow.locator('td').nth(6).textContent(),'1');
  assert.equal(await teamRow.locator('td').nth(7).textContent(),'-1');
  await page.getByRole('button',{name:'Ano',exact:true}).click();
  await page.locator('[data-analytics-team="a"] td').nth(3).getByRole('button').click();
  assert.equal(await page.locator('#dashboardMovementDetails').getAttribute('open'),'');
  assert.equal(await page.locator('#dashboardMovementDetails tbody tr').count(),9);
  assert.match(await page.locator('#dashboardMovementDetails tbody').textContent(),/Colaborador 0/,'a hire remains with the original team after a transfer');
  await page.locator('#dashboardAnalyticsEventType').selectOption('transfer');
  assert.equal(await page.locator('#dashboardMovementDetails tbody tr').count(),1);
  await page.locator('#dashboardAnalyticsTeam').selectOption('*');
  await page.locator('#dashboardMovementDetails summary').click();
  for(const width of [820,390,320]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>window.scrollTo(0,0));
    for(const selector of ['#dashboardAnalytics','#dashboardTeamAnalysis','#dashboardCommissionModels']){
      const box=await page.locator(selector).boundingBox();
      assert.ok(box.x>=0 && box.x+box.width<=width+1,selector+' fits '+width);
      assert.equal(await page.locator(selector).evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,selector+' has no content overflow');
    }
    assert.equal(await page.locator('.analytics-kpis>div').evaluateAll(items=>items.every(item=>item.scrollWidth<=item.clientWidth+1)),true);
    await page.screenshot({path:path.join(output,`dashboard-analytics-${width}.png`),fullPage:true});
  }
  await page.evaluate(()=>setThemePreference('dark'));
  await page.screenshot({path:path.join(output,'dashboard-analytics-dark.png'),fullPage:true});
  assert.equal(await page.locator('.analytics-trend-fill').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(45, 212, 191)');
  assert.equal(await page.evaluate(()=>JSON.stringify(state)===window.originalState),true);
  await page.locator('#dashboardAnalyticsFrom').fill('2026-11-03');await page.locator('#dashboardAnalyticsFrom').dispatchEvent('change');
  assert.match(await page.locator('#dashboardAnalytics [role="alert"]').textContent(),/Confirma as datas/);
  await page.locator('#dashboardAnalyticsFrom').fill('2026-11-01');await page.locator('#dashboardAnalyticsFrom').dispatchEvent('change');
  assert.equal(await metric('entries'),'0');
  console.log(JSON.stringify({analytics:true,datedTeamTransfers:true,closingTrendWithoutForecast:true,currentCommissionModels:true,drilldown:true,previousPeriod:true,mobile320:true,mobile390:true,darkTheme:true,readOnly:true}));
};
