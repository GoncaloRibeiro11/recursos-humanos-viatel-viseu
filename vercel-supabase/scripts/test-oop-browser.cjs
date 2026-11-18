const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {createPreview}=require('./oop-dev-server.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})}),app=await createPreview();
 const output=process.env.OOP_OUTPUT || path.resolve(__dirname,'../../../../recovery/oop-tests');fs.mkdirSync(output,{recursive:true});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],external=[];
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{const url=route.request().url();if(/^https?:/.test(url) && !url.startsWith(origin)){external.push(url);return route.abort();}return route.continue();});
 const action=name=>page.locator('#oopRoot [data-oop-action="'+name+'"]');
 const loaded=async()=>{await page.waitForSelector('#oopRoot .oop-kpis');await page.waitForFunction(()=>!oopApp.loading);};
 const saved=async()=>{await page.waitForFunction(()=>oopApp.pending.count===0 && !oopApp.loading && !oopApp.dialog);};
 const select=async(selector,value)=>page.locator(selector).selectOption(value);
 try{
  const rhBefore=JSON.stringify(await app.t.query('select * from rh_persons order by id'));
  await page.goto(origin+'/oop-demo.html');await loaded();assert.equal(await page.locator('#oopRoot .oop-status').innerText(),'');
  await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
  // Form state survives a reload before any server write.
  await action('new-contact').click();await select('[data-field=person_ref]','a');await page.locator('[data-field=fact]').fill('Rascunho fictício recuperável');
  await page.reload();await loaded();await action('new-contact').click();assert.equal(await page.locator('[data-field=fact]').inputValue(),'Rascunho fictício recuperável');
  await select('[data-field=product]','both');await select('[data-field=outcome]','refusal');
  for(let i=1;i<=5;i++)await page.locator('[name=stage-'+i+'][value=good]').check();
  await page.locator('[name=stage-6][value=no_objections]').check();await page.locator('[name=stage-7][value=good]').check();
  await select('[data-field=reason]','no_reason');await page.locator('[data-field=fact]').fill('');
  await action('save-contact').click();await saved();
  let rows=await app.t.query("select * from rh_oop_contacts where created_by=$1",[app.t.users.admin]);assert.equal(rows.length,1);const id=rows[0].id;
  await page.reload();await loaded();await action('view').filter({hasText:'Contactos'}).click();await loaded();assert.ok((await page.locator('#oopRoot').innerText()).includes('Comercial Ana'));
  await page.locator('[data-oop-action=contact][data-id="'+id+'"]').click();await action('edit-contact').click();await page.locator('[data-field=fact]').fill('Observação local pendente.');await page.locator('[data-field=revision_reason]').fill('Complemento da observação.');
  // Concurrent server edit must not be overwritten by a stale version.
  await app.t.rpc('admin','rh_oop_save_contact',{p_id:id,p_version:1,p_data:{...rows[0].data,person_ref:'a',occurred_at:rows[0].occurred_at,effective:true,product:'both',outcome:'refusal',reason:'no_reason',end_stage:null,fact:'Observação mais recente no servidor.',revision_reason:'Atualização concorrente.'},p_request_id:crypto.randomUUID()});
  await action('save-contact').click();await page.waitForFunction(()=>oopApp.pending.issues.length===1);await action('review-pending').click();await page.waitForSelector('[data-oop-action=reapply-pending]');assert.match(await page.locator('.oop-dialog').innerText(),/Observação mais recente no servidor/);
  await action('reapply-pending').click();await page.locator('[data-field=revision_reason]').fill('Revisão explícita das duas versões.');await action('save-contact').click();await saved();
  rows=await app.t.query('select * from rh_oop_contacts where id=$1',[id]);assert.equal(rows[0].version,3);assert.equal(rows[0].data.fact,'Observação local pendente.');
  // Local action drafts, linked evidence and explicit completion.
  await page.locator('[data-oop-action=contact][data-id="'+id+'"]').click();await action('contact-action').click();await page.locator('[name=description]').fill('Treinar perguntas abertas antes de apresentar o produto.');await action('close').click();
  await page.locator('[data-oop-action=contact][data-id="'+id+'"]').click();await action('contact-action').click();assert.equal(await page.locator('[name=description]').inputValue(),'Treinar perguntas abertas antes de apresentar o produto.');await action('save-action').click();await saved();
  const tasks=await app.t.query('select * from rh_oop_actions where contact_id=$1',[id]);assert.equal(tasks.length,1);await page.locator('[data-oop-action=action][data-id="'+tasks[0].id+'"]').click();await select('[name=status]','done');await page.locator('[name=progress]').fill('Nos contactos revistos, apurou a necessidade antes de apresentar.');await action('save-action').click();await saved();assert.equal((await app.t.query('select status from rh_oop_actions where id=$1',[tasks[0].id]))[0].status,'done');
  // Offline write is durable, survives reload and is sent exactly once later.
  await action('new-contact').click();await select('[data-field=person_ref]','b');await page.locator('[name=effective][value=no]').check();await select('[data-field=reason]','no_answer');
  await context.route('**/__oop/rpc',route=>{const b=route.request().postDataJSON();if(b.name==='rh_oop_save_contact')return route.abort();return route.continue();});
  await action('save-contact').click();await page.waitForFunction(()=>oopApp.pending.count===1 && !oopApp.pending.writing);await page.reload();await loaded();await page.waitForFunction(()=>oopApp.pending.count===1 && !oopApp.pending.writing);await context.unroute('**/__oop/rpc');await action('retry').click();await saved();assert.equal((await app.t.query('select * from rh_oop_contacts where created_by=$1',[app.t.users.admin])).length,2);
  assert.equal(await page.evaluate(()=>JSON.stringify(state)===window.oopHrBefore),true);assert.equal(JSON.stringify(await app.t.query('select * from rh_persons order by id')),rhBefore);
  await page.evaluate(()=>setThemePreference('dark'));await action('view').filter({hasText:'Coordenação'}).click();await loaded();await page.screenshot({path:path.join(output,'dark.png'),fullPage:true});
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});await page.evaluate(()=>{setThemePreference('light');for(const a of document.getAnimations())a.finish();});await page.screenshot({path:path.join(output,'mobile-'+width+'.png'),fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'No body overflow at '+width);
   await action('new-contact').click();await page.screenshot({path:path.join(output,'form-'+width+'.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.querySelector('.oop-dialog').scrollWidth<=document.querySelector('.oop-dialog').clientWidth+1),true);await action('close').click();
  }
  await page.goto(origin+'/oop-demo.html?as=ce1');await loaded();assert.equal(await page.locator('[data-oop-filter=team]').count(),0);assert.equal(await page.locator('[data-oop-filter=person] option[value=c]').count(),0);await action('new-contact').click();assert.equal(await page.locator('[data-field=person_ref] option[value=c]').count(),0);await action('close').click();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({browserToSql:true,draftReload:true,conflictReview:true,linkedTraining:true,offlineReloadExactlyOnce:true,ceScope:true,hrUntouched:true,desktopMobileDark:true,consoleErrors:errors,externalRequests:external,screenshots:output}));
 }finally{await context.close();await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
