const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {createPreview}=require('./oop-dev-server.cjs');
(async()=>{
 const app=await createPreview({seed:false}),browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;
 const output=path.resolve(__dirname,'../../../../recovery/oop-tests');fs.mkdirSync(output,{recursive:true});
 const adminContext=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),ceContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const admin=await adminContext.newPage(),ce=await ceContext.newPage(),errors=[],external=[];let adminReads=0;
 for(const context of [adminContext,ceContext]){context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));await context.route('**/*',route=>{const url=route.request().url();if(/^https?:/.test(url) && !url.startsWith(origin)){external.push(url);return route.abort();}return route.continue();});}
 for(const page of [admin,ce])page.on('pageerror',error=>errors.push(error.message));
 admin.on('request',request=>{if(request.url().endsWith('/__oop/rpc') && request.postDataJSON()?.name==='rh_oop_workspace')adminReads++;});
 const loaded=async page=>{await page.locator('#oopRoot .oop-kpis').waitFor();await page.waitForFunction(()=>!oopApp.loading);};
 const action=(page,name)=>page.locator('#oopRoot [data-oop-action="'+name+'"]');
 try{
  const before=JSON.stringify(await app.t.query('select * from rh_persons order by id'));
  await admin.goto(origin+'/oop-demo.html?view=oop');await loaded(admin);await action(admin,'team-links').click();
  assert.equal(await admin.locator('.oop-team-link').count(),3);const linkField=admin.getByRole('textbox',{name:'Ligação de Equipa Norte',exact:true}),link=await linkField.inputValue();
  const parsed=new URL(link);assert.equal(parsed.searchParams.get('view'),'oop');assert.equal(parsed.searchParams.get('ce'),'ce1');assert.deepEqual([...parsed.searchParams.keys()],['view','ce']);
  await admin.getByRole('button',{name:'Copiar ligação de Equipa Norte',exact:true}).click();await admin.getByText('Ligação copiada.',{exact:true}).waitFor();assert.equal(await admin.evaluate(()=>navigator.clipboard.readText()),link);
  await admin.screenshot({path:path.join(output,'ligacoes-ce-desktop.png'),fullPage:true});
  await admin.evaluate(()=>setThemePreference('dark'));await admin.locator('.oop-dialog').screenshot({path:path.join(output,'ligacoes-ce-dark.png')});await admin.evaluate(()=>setThemePreference('light'));
  for(const width of [390,320]){await admin.setViewportSize({width,height:844});assert.equal(await admin.locator('.oop-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await admin.screenshot({path:path.join(output,'ligacoes-ce-'+width+'.png'),fullPage:true});}
  await admin.setViewportSize({width:1440,height:1000});await admin.getByRole('button',{name:'Configurar acesso de Equipa Norte',exact:true}).click();await admin.locator('#accessModal.open').waitFor();assert.equal(await admin.locator('#accessPersonName').inputValue(),'Equipa Norte');assert.equal(await admin.locator('#accessRole').inputValue(),'gestor');await admin.evaluate(()=>closeModal('accessModal'));
  // A draft on the coordination screen must not be replaced by cross-device refresh.
  await action(admin,'new-contact').click();await admin.locator('[data-field=fact]').fill('Rascunho da coordenação ainda em preenchimento.');const readsBefore=adminReads;
  const personal=new URL(link);personal.searchParams.set('as','ce1');await ce.goto(personal.href);await loaded(ce);assert.equal(await ce.evaluate(()=>oopApp.view),'team');
  assert.equal(await action(ce,'team-links').count(),0);assert.equal(await ce.locator('[data-oop-filter=team]').count(),0);assert.equal(await ce.locator('[data-oop-filter=person] option[value=c]').count(),0);
  await action(ce,'new-contact').click();await ce.locator('[data-field=person_ref]').selectOption('a');await ce.locator('[name=effective][value=no]').check();await ce.locator('[data-field=reason]').selectOption('no_answer');await action(ce,'save-contact').click();
  await ce.waitForFunction(()=>oopApp.pending.count===0 && !oopApp.loading && !oopApp.dialog);assert.equal((await app.t.query('select * from rh_oop_contacts'))[0].created_by,app.t.users.ce1);
  await admin.evaluate(()=>oopApp.refreshLive(true));assert.equal(adminReads,readsBefore);assert.equal(await admin.locator('[data-field=fact]').inputValue(),'Rascunho da coordenação ainda em preenchimento.');await action(admin,'close').click();
  // Wait for the actual background timer, without pressing refresh or reloading.
  await admin.waitForFunction(()=>oopApp.data?.total===1,{},{timeout:22000});await admin.waitForFunction(()=>!oopApp.loading);assert.ok(adminReads>readsBefore);assert.match(await admin.locator('[data-oop-sync-time]').innerText(),/Atualizado/);
  await ce.reload();await loaded(ce);assert.equal(await ce.evaluate(()=>oopApp.data.total),1);await ce.screenshot({path:path.join(output,'ligacao-ce-equipa-mobile.png'),fullPage:true});
  const ce2=await ceContext.newPage();await ce2.goto(origin+'/oop-demo.html?view=oop&ce=ce2&as=ce2');await loaded(ce2);assert.equal(await ce2.evaluate(()=>oopApp.data.total),0);assert.equal(await ce2.locator('[data-oop-filter=person] option[value=a]').count(),0);
  await ce.goto(origin+'/oop-demo.html?view=oop&ce=ce2&as=ce1&role=admin');await ce.getByText('Esta ligação pertence a outra equipa. Entra com a conta do CE correspondente.',{exact:true}).waitFor();assert.equal(await ce.locator('#oopRoot .oop-kpis').count(),0);assert.equal(await action(ce,'new-contact').count(),0);
  assert.equal((await app.t.rpc('ce1','rh_oop_workspace',{p_from:app.t.shift(-2),p_to:app.t.today,p_team:'ce2'})).total,0);
  assert.equal(JSON.stringify(await app.t.query('select * from rh_persons order by id')),before);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify({oneLinkPerCe:true,copyLink:true,existingAccessManager:true,ownTeamOnly:true,forgedTeamBlocked:true,saveToCentralDb:true,coordinationUpdatesWithoutReload:true,draftNotInterrupted:true,desktopMobile:true,rhUnchanged:true,errors,external}));
 }finally{await adminContext.close();await ceContext.close();await browser.close();await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
