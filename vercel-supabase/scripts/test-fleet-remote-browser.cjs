const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const createDb=require('./fleet-share-test-db.cjs');const {createFleetShares}=require('../lib/fleet-shares.cjs');const {createFleetApi}=require('../api/fleet-auto.js');
const {PDFDocument}=require('pdf-lib');const {createCanvas}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'../public'),output=path.resolve(__dirname,'../../../../recovery/fleet-remote-tests');
const fromName='Manuel de Entrega Teste',toName='Ana de Rececao Teste';
(async()=>{
 const t=await createDb(),objects=new Map(),secret='local-test-server-key';let base,archived;
 const giverAbsence=process.env.TEST_GIVER_ABSENCE==='1',reconfirmMode=process.env.TEST_RECONFIRM==='1',regularization=process.env.TEST_REGULARIZATION==='1',absenceMode=process.env.TEST_SIGNATURE_ABSENCE==='1',deleteMode=process.env.TEST_DELETE==='1',initialState=process.env.TEST_INITIAL_STATE==='1' || deleteMode || regularization,external=process.env.TEST_EXTERNAL==='1',signatureOnly=process.env.TEST_SIGNATURE_ONLY==='1';
 const sharedMode=process.env.TEST_SHARED_SIGNING==='1',reverse=process.env.TEST_SHARED_REVERSE==='1';
 let failStorageDeletion=deleteMode;
 let h=await t.draft(2,external?{kind:'return',destination:'external_structure',external_structure:'Estrutura de Teste',driver_fields:{from:{name:fromName},to:{name:toName}}}:regularization?{kind:'initial',to_person_id:'a'}:initialState?{kind:'temporary',to_person_id:'b',expected_return:new Date(Date.now()+86400000).toISOString()}:{});
 if(initialState || external){
  await t.run('postgres',t.admin,()=>t.db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261117_fleet_initial_state.sql'),'utf8')));
  h=(await t.query('select * from rh_fleet_handovers where id=$1',[h.id]))[0];
  assert.equal((await t.query("select * from rh_fleet_handovers where status='confirmed'")).length,0);
  await t.call('rh_fleet_save_vehicle',[t.uuid(99),0,{plate:'EF-34-GH',make_model:'Teste inicial',habitual_person_id:'b',odometer:0,active:true}]);
 }
 await t.run('postgres',t.admin,()=>t.db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261118_fleet_external.sql'),'utf8')));
 await t.run('postgres',t.admin,()=>t.db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261118_fleet_deletions.sql'),'utf8')));
 await t.run('postgres',t.admin,()=>t.db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261120_fleet_signature_absence.sql'),'utf8')));
 await t.run('postgres',t.admin,()=>t.db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261120_fleet_regularization.sql'),'utf8')));
 await t.run('postgres',t.admin,()=>t.db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261120_fleet_signature_history.sql'),'utf8')));
 await t.run('postgres',t.admin,()=>t.db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261120_fleet_giver_absence.sql'),'utf8')));
 await t.run('postgres',t.admin,()=>t.db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261123_fleet_shared_signing.sql'),'utf8')));
 const originalCustody=JSON.stringify(await t.query('select * from rh_fleet_custody where vehicle_id=$1',[t.uuid(1)]));
 const fetcher=async(url,options={})=>{
  const u=new URL(url),body=options.body && !Buffer.isBuffer(options.body)?JSON.parse(options.body):null;
  if(u.pathname==='/auth/v1/user')return Response.json({id:t.admin});
  if(u.pathname.includes('/user_profiles'))return Response.json([{role:'admin'}]);
  if(u.pathname.startsWith('/rest/v1/rpc/')){
   const name=u.pathname.split('/').pop();try{return Response.json(await t.call(name,Object.values(body),options.headers.Authorization==='Bearer '+secret?'service_role':'authenticated'));}
   catch(error){return Response.json({code:error.code || 'P0001',message:error.message},{status:400});}
  }
  if(u.pathname==='/storage/v1/object/list/rh-fleet')return Response.json([...objects.keys()].filter(key=>key.startsWith(body.prefix+'/')).map(key=>({name:key.split('/').pop()})));
  if(u.pathname==='/storage/v1/object/rh-fleet' && options.method==='DELETE'){
   if(failStorageDeletion){failStorageDeletion=false;return Response.json({error:'Falha temporaria simulada'},{status:503});}
   for(const key of body.prefixes){objects.delete(key);await t.query('delete from storage.objects where bucket_id=$1 and name=$2',['rh-fleet',key]);}return Response.json({});
  }
  if(u.pathname.startsWith('/storage/v1/object/')){
   const objectPath=decodeURIComponent(u.pathname.split('/rh-fleet/')[1]);
   if(options.method==='POST'){
    if(objects.has(objectPath))return Response.json({error:'exists'},{status:409});
    objects.set(objectPath,Buffer.from(options.body));await t.query('insert into storage.objects(bucket_id,name) values($1,$2)',['rh-fleet',objectPath]);
    if(/\/auto-fotos-v1-[a-f0-9]+\.pdf$/.test(objectPath))archived=Buffer.from(options.body);return Response.json({Key:objectPath});
   }
   return objects.has(objectPath)?new Response(objects.get(objectPath),{headers:{'Content-Type':objectPath.endsWith('.pdf')?'application/pdf':'image/jpeg'}}):Response.json({error:'missing'},{status:404});
  }
  if(u.pathname.startsWith('/rest/v1/rh_fleet_handovers'))return Response.json(await t.query('select * from rh_fleet_handovers where id=$1',[u.searchParams.get('id').slice(3)]));
  throw new Error('Unexpected server route '+u.pathname);
 };
 const service=createFleetShares({env:{SUPABASE_SERVICE_ROLE_KEY:secret},fetcher});const pdfApi=createFleetApi({env:{},fetcher});
 const fixture=`
  state={persons:[{id:'a',name:'Gestor A',role:'chefe_equipa',ativo:true,entrada:'2020-01-01'},{id:'b',name:'Colaborador B',role:'vendedor',ativo:true,entrada:'2020-01-01'}],vacations:[],records:{}};currentProfile={role:'admin',display_name:'Admin de teste'};currentUserId='${t.admin}';supabaseReady=true;
  document.body.classList.add('authenticated','is-admin');document.getElementById('authOverlay').classList.remove('open');bolsaOutcomeDismissed=true;window.hrBefore=JSON.stringify(state);
  const send=async value=>(await fetch('/__db',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).json();
  supabaseClient={rpc:(name,args)=>send({rpc:name,args}),auth:{getSession:async()=>({data:{session:{access_token:'admin-test-session'}}})},from(table){const q={table,order:[]},chain={select(){return chain;},order(key){q.order.push(key);return chain;},range(a,b){q.range=[a,b];return send(q);}};return chain;},storage:{from:()=>({list:async()=>({data:[]}),upload:async()=>({}),download:async()=>({})})}};
  switchTab('fleet');`;
 const html=fs.readFileSync(path.join(root,'mapa-recursos-humanos.html'),'utf8').replace(/^initSupabaseApp\(\);\r?$/m,fixture);
 const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost');let data;
   if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;data=JSON.parse(raw);}
   if(u.pathname==='/__db'){
    let result;if(data.rpc){try{result={data:await t.call(data.rpc,Object.values(data.args))};}catch(error){result={error:{message:error.message}};}}
    else{assert.ok(['rh_fleet_vehicles','rh_fleet_handovers','rh_fleet_custody'].includes(data.table));const rows=await t.query('select * from '+data.table);result={data:rows.slice(data.range[0],data.range[1]+1),count:rows.length};}
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));
   }
   if(u.pathname==='/api/fleet-share' || u.pathname==='/api/fleet-remote'){
    try{const value=u.pathname.endsWith('/fleet-share')?await service.manage(req,data):await service.remote(data);res.setHeader('Content-Type',value.type || 'application/json');return res.end(value.binary || JSON.stringify(value));}
    catch(error){res.statusCode=error.status || 503;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({error:error.message}));}
   }
   if(u.pathname==='/api/fleet-auto'){req.body=data;req.query=Object.fromEntries(u.searchParams);return pdfApi(req,res);}
   if(u.pathname==='/test.html'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
   const file=path.resolve(root,u.pathname.slice(1));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
   res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');
   fs.readFile(file,(error,bytes)=>{if(error){res.statusCode=404;res.end();}else res.end(bytes);});
  }catch(error){res.statusCode=500;res.end(error.message);}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  fs.mkdirSync(output,{recursive:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),admin=await context.newPage();
  const errors=[];admin.on('pageerror',error=>errors.push(error.message));admin.on('dialog',dialog=>dialog.accept());
  await admin.route('**/supabase-js**',route=>route.fulfill({body:'window.supabase={}',contentType:'application/javascript'}));
  await admin.goto(base+'/test.html');
  if(external){
   await admin.locator('[data-action=edit-vehicle][data-id="'+t.uuid(1)+'"]').click();
   await admin.locator('.fleet-dialog [data-action=delete-vehicle]').click();
   await admin.getByText('Para eliminar uma viatura de teste, elimina primeiro os seus autos. Para uma viatura real, mantém o histórico e arquiva-a.',{exact:true}).waitFor();
   await admin.locator('.fleet-dialog [data-action=close]').click();
   await admin.locator('[data-action=edit-vehicle][data-id="'+t.uuid(99)+'"]').click();
   await admin.locator('.fleet-dialog [data-action=delete-vehicle]').click();
   await admin.locator('[data-action=confirm-delete-vehicle]').click();
   await admin.getByText('Confirma a matrícula e a eliminação definitiva.',{exact:true}).waitFor();
   assert.equal((await t.query('select * from rh_fleet_vehicles where id=$1',[t.uuid(99)])).length,1);
   await admin.setViewportSize({width:320,height:800});
   assert.equal(await admin.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+1),true);
   await admin.locator('.fleet-dialog').screenshot({path:path.join(output,'eliminar-viatura-teste-320.png')});
   await admin.locator('[data-delete-plate]').fill('EF-34-GH');await admin.locator('[data-delete-confirm]').check();
   await admin.locator('[data-action=confirm-delete-vehicle]').click();await admin.waitForFunction(()=>!document.querySelector('.fleet-dialog'));
   assert.equal((await t.query('select * from rh_fleet_vehicles where id=$1',[t.uuid(99)])).length,0);
   await admin.setViewportSize({width:1440,height:1000});
  }
  if(initialState){
   await admin.getByText('Situação inicial · sem auto anterior',{exact:true}).waitFor();
   await admin.locator('[data-fleet-vehicle="'+t.uuid(99)+'"]').getByRole('button',{name:'Registar situação inicial',exact:true}).click();
   const dialog=admin.locator('.fleet-dialog');await dialog.getByRole('button',{name:'Registar situação inicial',exact:true}).click();await dialog.getByText('Confirma a situação inicial da viatura.',{exact:true}).waitFor();
   await admin.setViewportSize({width:390,height:844});await dialog.screenshot({path:path.join(output,'situacao-inicial-390.png')});
   await dialog.locator('[data-initial-confirm]').check();await dialog.getByRole('button',{name:'Registar situação inicial',exact:true}).click();await admin.waitForFunction(()=>!document.querySelector('.fleet-dialog'));
   await admin.setViewportSize({width:1440,height:1000});await admin.locator('[data-action=initial-state][data-id="'+t.uuid(99)+'"]').waitFor({state:'detached'});
   await admin.locator('[data-action=page][data-page=history]').click();await admin.getByText('Início desconhecido',{exact:true}).first().waitFor();await admin.screenshot({path:path.join(output,'situacao-inicial-historico.png'),fullPage:true});
  }
  await admin.locator('[data-action=page][data-page=handovers]').click();await admin.locator('[data-action=edit-handover]').click();
  if(regularization){
   await admin.locator('[name=kind]').selectOption('regularization');await admin.locator('[data-action=save-draft]').click();
   assert.equal(await admin.locator('[name=to_person_id]').inputValue(),'a');assert.equal(await admin.locator('[name=to_person_id]').isDisabled(),true);
   await admin.setViewportSize({width:390,height:844});await admin.locator('.fleet-dialog').screenshot({path:path.join(output,'regularizar-atribuicao-390.png')});await admin.setViewportSize({width:1440,height:1000});
  }
  if(external){
   assert.equal(await admin.locator('[name=kind]').inputValue(),'external');
   assert.equal(await admin.locator('[name=external_structure]').inputValue(),'Estrutura de Teste');
   await admin.locator('.fleet-dialog').screenshot({path:path.join(output,'entrega-outra-estrutura-1440.png')});
  }
  async function makeLink(role){
   if(!sharedMode){const result=await service.manage({headers:{authorization:'Bearer admin-test-session'}},{action:'create',id:h.id,purpose:role});return new URL(result.url).hash;}
   const ready=admin.waitForResponse(response=>response.url().endsWith('/api/fleet-share') && response.request().postDataJSON()?.action==='create' && response.request().postDataJSON()?.purpose===role);await admin.locator(`[data-action=create-link][data-purpose=${role}]`).click();const response=await ready,value=await response.json();assert.equal(response.status(),200,JSON.stringify(value));await admin.waitForFunction(url=>document.querySelector('[data-share-url]')?.value===url,value.url);return new URL(value.url).hash;
  }
  const editorHash=await makeLink('editor');
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true,permissions:['clipboard-read','clipboard-write']});const editor=await mobile.newPage();editor.on('pageerror',error=>errors.push(error.message));
  const requestUrls=[];editor.on('request',request=>requestUrls.push(request.url()));
  await editor.goto(base+'/auto-viatura.html'+editorHash);await editor.locator('[name=odometer]').waitFor();
  assert.equal(await editor.locator('[name=kind]').isDisabled(),true);assert.equal(await editor.locator('[data-sharing]').count(),0);assert.equal(await editor.locator('[data-signature]').count(),0);
  if(external)assert.equal(await editor.locator('[name=external_structure]').isDisabled(),true);
  await editor.locator('[name=odometer]').fill('145');await editor.locator('[name=notes]').fill('Preenchido no telemovel.');
  await editor.locator('[name="driver.from.name"]').fill(fromName);await editor.locator('[name="driver.to.name"]').fill(toName);
  await editor.locator('[data-damage-details] summary').click();await editor.waitForFunction(()=>document.querySelector('.fleet-damage-canvas')?.onclick);
  const damage=editor.locator('.fleet-damage-canvas');await damage.scrollIntoViewIfNeeded();const damageBox=await damage.boundingBox();
  assert.equal(await damage.getAttribute('width'),'490');assert.equal(await damage.getAttribute('height'),'385');
  await editor.touchscreen.tap(damageBox.x+damageBox.width*(100-49)/490,damageBox.y+damageBox.height*(335-239)/385);
  await editor.getByRole('button',{name:'Guardar',exact:true}).click();await editor.getByText('Rascunho guardado no servidor',{exact:true}).waitFor();
  const photo=createCanvas(100,80);photo.getContext('2d').fillRect(0,0,100,80);
  await editor.locator('[data-fleet-upload]').setInputFiles({name:'viatura-teste.jpg',mimeType:'image/jpeg',buffer:photo.toBuffer('image/jpeg')});
  await editor.locator('[data-fleet-files] li').waitFor();assert.equal(objects.size,1);
  await editor.reload();assert.equal(await editor.locator('[name=odometer]').inputValue(),'145');
  assert.equal(await editor.locator('[name="driver.from.name"]').inputValue(),fromName);assert.equal(await editor.locator('[name="driver.to.name"]').inputValue(),toName);
  await editor.locator('[data-driver=name]').first().locator('xpath=../..').screenshot({path:path.join(output,'nomes-condutores-390.png')});
  await editor.screenshot({path:path.join(output,'preencher-390.png'),fullPage:true});
  await editor.getByRole('button',{name:'Concluir preenchimento',exact:true}).click();
  if(sharedMode){await editor.locator('[data-sign-party=from]').waitFor();assert.equal(await editor.locator('[data-party-signature]').count(),2);assert.equal(await editor.locator('[data-party-confirm]:disabled').count(),2);}
  else await editor.getByRole('heading',{name:'Preenchimento enviado ao RH',exact:true}).waitFor();
  assert.ok(requestUrls.every(url=>!url.includes(editorHash.slice(1))));
  await admin.getByRole('button',{name:'Atualizar assinaturas',exact:true}).click();await admin.locator('[data-sharing]').waitFor();
  await admin.waitForFunction(()=>document.querySelector('[name=odometer]')?.value==='145');
  assert.equal(await admin.locator('[name=odometer]').inputValue(),'145');
  if(signatureOnly){
   for(const name of ['at_input','expected_input','odometer','place','reason','zone_name','damage_notes']){const field=admin.locator('[name='+name+']');assert.equal(await field.getAttribute('required'),null);if(await field.isVisible())await field.fill('');else assert.equal(await field.inputValue(),'');}
   await admin.locator('[name=fuel]').selectOption('');await admin.locator('[name=checked]').uncheck();
   const item=admin.locator('[data-inspection=doc_dua]');await item.locator('xpath=ancestor::details').locator('summary').click();await item.selectOption('Mau');
  }
  const fromHash=sharedMode?editorHash:await makeLink('from'),toHash=sharedMode?editorHash:await makeLink('to');
  await admin.locator('[data-sharing]').screenshot({path:path.join(output,'rh-ligacoes.png')});
  async function sign(fragment,name,width,role){
   const page=await mobile.newPage();page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width,height:900});await page.goto(base+'/auto-viatura.html'+fragment);
   if(sharedMode){
    const party=page.locator('[data-sign-party='+role+']');await party.locator('[data-party-name]').waitFor();assert.equal(await party.locator('[data-party-name]').inputValue(),name);assert.equal(await party.locator('[data-party-confirm]').isDisabled(),true);
    if(width===320)await page.emulateMedia({colorScheme:'dark'});
    const canvas=party.locator('canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox(),cdp=await mobile.newCDPSession(page),point=(x,y)=>({x:box.x+box.width*x,y:box.y+box.height*y});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(.1,.6)]});for(const [x,y] of [[.2,.25],[.35,.75],[.5,.3],[.7,.65],[.85,.4]])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x,y)]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    await party.locator('[data-party-accept]').check();assert.equal(await party.locator('[data-party-confirm]').isEnabled(),true);assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+1),true);
    await page.screenshot({path:path.join(output,'link-unico-'+role+'-'+width+'.png'),fullPage:true});await party.locator('[data-party-confirm]').click();await party.getByText('Assinatura guardada',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Copiar ligação',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),base+'/auto-viatura.html'+fragment);
    await page.reload();await page.locator('[data-sign-party='+role+']').getByText('Assinatura guardada',{exact:true}).waitFor();return page;
   }
   await page.locator('#remoteSignerName').waitFor();assert.equal(await page.locator('#remoteSignerName').inputValue(),name);assert.equal(await page.locator('#remoteSign').isDisabled(),true);
   assert.match(await page.locator('.remote-facts').innerText(),new RegExp(fromName));assert.match(await page.locator('.remote-facts').innerText(),new RegExp(toName));
   await page.waitForFunction(()=>document.querySelector('#remotePhotos img')?.naturalWidth>0);
   if(signatureOnly){const text=await page.locator('.remote-facts').innerText();assert.ok(!text.includes('NaN'));assert.match(text,/Quilómetros\s+—/);const pdf=await page.request.post(base+'/api/fleet-remote',{data:{action:'pdf',token:fragment.slice(1)}});assert.equal(pdf.status(),200);assert.ok((await PDFDocument.load(await pdf.body())).getPageCount()>=2);}
   if(width===320){await page.emulateMedia({colorScheme:'dark'});assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(20, 25, 31)');}
   const canvas=page.locator('#remoteSignature');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox(),cdp=await mobile.newCDPSession(page);
   const point=(x,y)=>({x:box.x+box.width*x,y:box.y+box.height*y});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(.1,.6)]});
   for(const [x,y] of [[.2,.25],[.35,.75],[.5,.3],[.7,.65],[.85,.4]])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x,y)]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
   await page.locator('#remoteAccept').check();assert.equal(await page.locator('#remoteSign').isEnabled(),true);
   assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+1),true);
   await page.screenshot({path:path.join(output,`assinar-${width}.png`),fullPage:true});
   await page.locator('#remoteSign').click();await page.getByRole('heading',{name:'Assinatura registada',exact:true}).waitFor();
   await page.reload();await page.getByRole('heading',{name:'Assinatura registada',exact:true}).waitFor();return page;
  }
  if(sharedMode){
   const order=reverse?[['to',toName],['from',fromName]]:[['from',fromName],['to',toName]];
   await sign(editorHash,order[0][1],390,order[0][0]);
   assert.equal((await t.query('select * from rh_fleet_signature_receipts where handover_id=$1 and invalidated_at is null',[h.id])).length,1);
   await sign(editorHash,order[1][1],320,order[1][0]);
   await editor.reload();await editor.getByText('As duas assinaturas estão guardadas no servidor.',{exact:true}).waitFor();assert.equal(await editor.locator('[data-party-signature]').count(),0);
   await editor.setViewportSize({width:1440,height:1000});await editor.screenshot({path:path.join(output,'link-unico-completo-1440.png'),fullPage:true});
  }else{if(!giverAbsence)await sign(fromHash,fromName,390);if(!absenceMode)await sign(toHash,toName,320);}
  await admin.getByRole('button',{name:'Atualizar assinaturas',exact:true}).click();await admin.locator('[data-share-status]').getByText(new RegExp(giverAbsence?'^Recebe: '+toName:'^Entrega / devolve: '+fromName)).waitFor();
  if(reconfirmMode){
   const previous=(await t.query('select * from rh_fleet_handovers where id=$1',[h.id]))[0];
   await admin.locator('[name=notes]').fill('Nova versão observada e confirmada.');await admin.getByRole('button',{name:'Guardar rascunho',exact:true}).click();
   const newFrom=await makeLink('from'),newTo=await makeLink('to');
   for(const [fragment,role,name] of [[newFrom,'from',fromName],[newTo,'to',toName]]){
    const page=await mobile.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/auto-viatura.html'+fragment);
    await page.locator('#remoteReuse').waitFor();assert.equal(await page.locator('#remoteReuse').isChecked(),false);assert.equal(await page.locator('#remoteSign').isDisabled(),true);
    await page.locator('#remoteReuse').check();assert.equal(await page.locator('#remoteSignature').isVisible(),false);assert.equal(await page.locator('#remoteAccept').isChecked(),false);
    assert.equal(await page.locator('#remoteSign').isDisabled(),true);await page.locator('#remoteAccept').check();
    await page.screenshot({path:path.join(output,'reconfirmar-'+role+'-390.png'),fullPage:true});
    await page.getByRole('button',{name:'Confirmar nova versão',exact:true}).click();await page.getByRole('heading',{name:'Assinatura registada',exact:true}).waitFor();
    const latest=(await t.query('select * from rh_fleet_handovers where id=$1',[h.id]))[0];
    assert.equal(latest.data.signatures[role],previous.data.signatures[role]);assert.equal(latest.data.signature_receipts[role].method,'screen_reconfirmed');assert.equal(latest.data.signature_receipts[role].previous_receipt_id,previous.data.signature_receipts[role].id);
   }
   assert.equal((await t.query('select * from rh_fleet_signature_archive')).length,4);
   await admin.getByRole('button',{name:'Atualizar assinaturas',exact:true}).click();await admin.getByText('Assinaturas guardadas · 4',{exact:true}).waitFor();
  }
  if(absenceMode){
   await admin.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await admin.locator('[data-confirm-error]').getByText(/Faltam assinaturas/).waitFor();
   await admin.locator('[data-recipient-absent]').check();await admin.locator('[data-absence-reason]').fill('NA');
   await admin.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await admin.locator('[data-confirm-error]').getByText(/8 a 500/).waitFor();
   await admin.locator('[data-absence-reason]').fill('Destinatário ausente; assinatura não recolhida.');
   await admin.setViewportSize({width:390,height:844});await admin.locator('[data-recipient-absent]').scrollIntoViewIfNeeded();
   assert.equal(await admin.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+1),true);
   await admin.screenshot({path:path.join(output,'assinatura-nao-recolhida-390.png')});await admin.setViewportSize({width:1440,height:1000});
  }
  if(giverAbsence){
   await admin.getByRole('button',{name:regularization?'Confirmar regularização':'Confirmar entrega',exact:true}).click();await admin.locator('[data-confirm-error]').getByText(/Faltam assinaturas/).waitFor();
   await admin.locator('[data-giver-absent]').check();await admin.locator('[data-giver-absence-reason]').fill('NA');
   await admin.getByRole('button',{name:regularization?'Confirmar regularização':'Confirmar entrega',exact:true}).click();await admin.locator('[data-confirm-error]').getByText(/8 a 500/).waitFor();
   await admin.locator('[data-giver-absence-reason]').fill('Quem entrega está noutra estrutura; assinatura não recolhida à distância.');
   await admin.setViewportSize({width:390,height:844});await admin.locator('[data-giver-absence-reason]').scrollIntoViewIfNeeded();
   assert.equal(await admin.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+1),true);
   await admin.screenshot({path:path.join(output,'sem-assinatura-entrega-390.png')});await admin.setViewportSize({width:1440,height:1000});
  }
  if(!absenceMode){
   await admin.locator('[data-recipient-absent]').waitFor();
   assert.equal(await admin.locator('[data-recipient-absent]').isDisabled(),true);
   assert.equal(await admin.locator('[data-recipient-absent]').isChecked(),false);
   await admin.getByText('Assinatura de quem recebe já recolhida e válida.',{exact:true}).waitFor();
   // Simulate an old open form that still has the contradictory absence option selected.
   await admin.locator('[data-recipient-absent]').evaluate(el=>{el.disabled=false;el.checked=true;});
   await admin.locator('[data-absence-reason]').evaluate(el=>{el.value='Destinatário ausente; assinatura não recolhida.';});
  }
  if(signatureOnly){
   assert.equal((await t.query('select * from rh_fleet_signature_receipts where invalidated_at is null')).length,2);
   assert.equal((await t.query('select * from rh_fleet_custody')).length,0);
   assert.equal((await t.query('select status from rh_fleet_handovers where id=$1',[h.id]))[0].status,'draft');
   assert.equal(await admin.evaluate(()=>JSON.stringify(state)===window.hrBefore),true);assert.deepEqual(errors,[]);
   console.log(JSON.stringify({onlyInspectionAndPhotosRequired:true,emptyOptionalFields:true,missingMetadataPdfWorks:true,realApiToSql:true,bothFingerSignatures:true,noCustodyChange:true,hrUntouched:true,pageErrors:errors}));return;
  }
  await admin.getByRole('button',{name:regularization?'Confirmar regularização':'Confirmar entrega',exact:true}).click();await admin.waitForFunction(()=>!document.querySelector('.fleet-dialog'));
  const final=(await t.query('select * from rh_fleet_handovers where id=$1',[h.id]))[0];assert.equal(final.status,'confirmed');if(!giverAbsence)assert.ok(final.snapshot.operation.signatures.from);if(!absenceMode)assert.ok(final.snapshot.operation.signatures.to);
  if(absenceMode){assert.equal(final.snapshot.signature_absences.to.recorded_by,t.admin);assert.equal(final.snapshot.operation.signature_receipts.to,undefined);assert.equal((await t.query('select * from rh_fleet_signature_receipts where invalidated_at is null')).length,1);}
  else{if(!giverAbsence)assert.equal(final.snapshot.signature_absences,undefined);assert.ok(final.snapshot.operation.signature_receipts.to.id);}
  if(giverAbsence){assert.equal(final.snapshot.signature_absences.from.status,'not_collected');assert.equal(final.snapshot.signature_absences.to,undefined);assert.equal(final.snapshot.operation.signature_receipts.from,undefined);assert.equal((await t.query('select * from rh_fleet_signature_receipts where invalidated_at is null')).length,1);}
  assert.equal(final.snapshot.operation.driver_fields.from.name,fromName);assert.equal(final.snapshot.operation.driver_fields.to.name,toName);assert.equal(final.snapshot.to_person.id,external?null:initialState && !regularization?'b':'a');
  if(external){
   assert.equal(final.snapshot.to_person.name,toName);assert.equal(final.snapshot.to_person.structure,'Estrutura de Teste');
   const vehicle=(await t.query('select * from rh_fleet_vehicles where id=$1',[t.uuid(1)]))[0];assert.equal(vehicle.active,false);assert.equal(vehicle.habitual_person_id,null);
   assert.equal((await t.query('select * from rh_fleet_custody where vehicle_id=$1 and to_at is null',[t.uuid(1)])).length,0);
   assert.equal((await t.query('select * from rh_persons')).length,2);
   await admin.getByText('Entrega a outra estrutura',{exact:true}).waitFor();
   const beforeHistory=JSON.stringify(final);
   await admin.locator('[data-action=page][data-page=vehicles]').click();await admin.locator('[data-filter=archived]').uncheck();
   assert.equal(await admin.locator('[data-fleet-vehicle="'+t.uuid(1)+'"]').count(),0);
   await admin.locator('[data-action=page][data-page=handovers]').click();
   await admin.getByText('Viatura arquivada',{exact:true}).waitFor();assert.equal(await admin.locator('[data-filter=archived]').count(),0);
   await admin.locator('[data-filter=person]').selectOption('a');await admin.getByText('Entrega a outra estrutura',{exact:true}).waitFor();
   await admin.locator('[data-filter=search]').fill(fromName);await admin.getByText('Entrega a outra estrutura',{exact:true}).waitFor();
   await admin.setViewportSize({width:390,height:844});await admin.screenshot({path:path.join(output,'auto-arquivado-preservado-390.png'),fullPage:true});await admin.setViewportSize({width:1440,height:1000});
   await admin.locator('[data-action=page][data-page=history]').click();await admin.getByRole('columnheader',{name:'Auto de saída',exact:true}).waitFor();
   await admin.locator('[data-action=edit-handover][data-id="'+h.id+'"]').click();
   await admin.getByText('Confirmado · histórico preservado',{exact:true}).waitFor();await admin.getByText(fromName,{exact:true}).waitFor();
   assert.equal(await admin.locator('[data-action=confirm]').count(),0);
   await admin.locator('.fleet-dialog [data-action=close]').click();
   await admin.locator('[data-filter=person]').selectOption('');await admin.locator('[data-filter=search]').fill('');
   await admin.locator('[data-action=page][data-page=handovers]').click();await admin.getByText('Entrega a outra estrutura',{exact:true}).waitFor();
   assert.equal(JSON.stringify((await t.query('select * from rh_fleet_handovers where id=$1',[h.id]))[0]),beforeHistory);
  }
  if(regularization){
   assert.equal(final.snapshot.operation.purpose,'regularization');assert.equal(JSON.stringify(await t.query('select * from rh_fleet_custody where vehicle_id=$1',[t.uuid(1)])),originalCustody);
   await admin.locator('[data-action=page][data-page=history]').click();await admin.locator('[data-action=edit-handover][data-id="'+h.id+'"]').waitFor();await admin.locator('[data-action=page][data-page=handovers]').click();
  }else if(initialState){const rows=await t.query('select * from rh_fleet_custody where vehicle_id=$1 order by from_at nulls first',[t.uuid(1)]);assert.equal(rows.length,2);assert.equal(rows[0].origin,'initial_state');assert.equal(rows[0].from_at,null);assert.equal(rows[1].person_id,'b');}
  assert.equal(final.snapshot.operation.damage_markers.length,1);assert.ok(Math.abs(final.snapshot.operation.damage_markers[0].x-100)<=1);assert.ok(Math.abs(final.snapshot.operation.damage_markers[0].y-335)<=1);
  for(let i=0;i<50 && !archived;i++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(archived);assert.equal((await PDFDocument.load(archived)).getPageCount(),absenceMode || giverAbsence?5:4);
  fs.writeFileSync(path.join(output,giverAbsence?'auto-sem-assinatura-entrega-teste.pdf':absenceMode?'auto-sem-assinatura-recebe-teste.pdf':'auto-assinado-teste.pdf'),archived);
  assert.equal(await admin.evaluate(()=>JSON.stringify(state)===window.hrBefore),true);assert.deepEqual(errors,[]);
  if(deleteMode){
   const holder=(await t.query('select * from rh_fleet_custody where handover_id=$1',[h.id]))[0];
   let child=await t.call('rh_fleet_save_handover',[t.uuid(70),t.uuid(1),0,holder.id,{...t.data,kind:'return'}]);await t.call('rh_fleet_cancel_handover',[child.id,child.version]);
   child=(await t.query('select * from rh_fleet_handovers where id=$1',[child.id]))[0];
   await admin.locator('[data-action=reload]').click();
   await admin.locator('[data-action=delete-handover][data-id="'+h.id+'"]').click();
   await admin.locator('[data-action=confirm-delete-handover]').click();await admin.getByText('Escreve o número do auto e confirma a eliminação do teste.',{exact:true}).waitFor();
   await admin.locator('[data-delete-number]').fill('FRO-'+String(final.number).padStart(5,'0'));await admin.locator('[data-delete-confirm]').check();
   await admin.locator('[data-action=confirm-delete-handover]').click();await admin.getByText('Elimina primeiro os autos de teste dependentes: FRO-'+String(child.number).padStart(5,'0')+'.',{exact:true}).waitFor();
   await admin.setViewportSize({width:390,height:844});await admin.locator('.fleet-dialog').screenshot({path:path.join(output,'eliminar-auto-bloqueio-390.png')});
   await admin.locator('.fleet-dialog [data-action=close]').click();
   for(const item of [child,final]){
    await admin.locator('[data-action=delete-handover][data-id="'+item.id+'"]').click();
    await admin.locator('[data-delete-number]').fill('FRO-'+String(item.number).padStart(5,'0'));await admin.locator('[data-delete-confirm]').check();
    await admin.locator('.fleet-dialog').screenshot({path:path.join(output,'eliminar-auto-'+item.status+'-390.png')});
    await admin.locator('[data-action=confirm-delete-handover]').click();
    if(item.id===final.id){
     await admin.getByText('Auto eliminado. Os anexos aguardam limpeza; podes repetir no aviso acima.',{exact:true}).waitFor();assert.equal(objects.size,3);
     await admin.reload();await admin.getByRole('button',{name:'Tentar limpar anexos',exact:true}).waitFor();
     await admin.screenshot({path:path.join(output,'eliminacao-anexos-pendentes-390.png'),fullPage:true});
     await admin.getByRole('button',{name:'Tentar limpar anexos',exact:true}).click();await admin.getByRole('button',{name:'Tentar limpar anexos',exact:true}).waitFor({state:'detached'});
    }else await admin.getByText('Auto eliminado.',{exact:true}).waitFor();
   }
   assert.equal(objects.size,0);assert.equal((await t.query('select * from rh_fleet_handovers')).length,0);assert.equal((await t.call('rh_fleet_pending_deletions')).items.length,0);
   assert.equal((await t.query('select * from rh_fleet_custody where vehicle_id=$1 and to_at is null',[t.uuid(1)]))[0].person_id,'a');
   await admin.locator('[data-action=page][data-page=vehicles]').click();await admin.locator('[data-action=delete-vehicle][data-id="'+t.uuid(1)+'"]').click();
   await admin.locator('[data-delete-plate]').fill('AB-12-CD');await admin.locator('[data-delete-confirm]').check();
   await admin.locator('[data-action=confirm-delete-vehicle]').click();await admin.waitForFunction(()=>!document.querySelector('.fleet-dialog'));
   assert.equal((await t.query('select * from rh_fleet_vehicles where id=$1',[t.uuid(1)])).length,0);
   assert.equal((await t.query('select * from rh_fleet_vehicles where id=$1',[t.uuid(99)])).length,1);
   assert.equal(await admin.evaluate(()=>JSON.stringify(state)===window.hrBefore),true);assert.deepEqual(errors,[]);
  }
  const expired=await mobile.newPage();await expired.goto(base+'/auto-viatura.html#'+'x'.repeat(43));await expired.getByRole('heading',{name:'Ligação indisponível',exact:true}).waitFor();
  console.log(JSON.stringify({initialState,external,deleteMode,absenceMode,giverAbsence,regularization,reconfirmMode,editorWithoutRhAccess:true,mobileDraftSurvivesReload:true,driverNamesSaved:true,sameNamesForSigning:true,privatePhotoUpload:true,scopedLinks:true,signWithFinger390:!giverAbsence,signWithFinger320:!absenceMode,darkTheme:true,oneTimeReceipt:true,explicitAbsenceRequired:absenceMode || giverAbsence,pdfHasImagesAndReceipts:true,serverArchive:true,tokensNotInRequestUrls:true,hrUnchanged:true,pageErrors:errors}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await t.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
