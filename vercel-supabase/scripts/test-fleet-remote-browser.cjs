const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const createDb=require('./fleet-share-test-db.cjs');const {createFleetShares}=require('../lib/fleet-shares.cjs');const {createFleetApi}=require('../api/fleet-auto.js');
const {PDFDocument}=require('pdf-lib');const {createCanvas}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'../public'),output=path.resolve(__dirname,'../../../../recovery/fleet-remote-tests');
const fromName='Manuel de Entrega Teste',toName='Ana de Rececao Teste';
(async()=>{
 const t=await createDb(),objects=new Map(),secret='local-test-server-key';let base,archived;
 const h=await t.draft(2);
 const fetcher=async(url,options={})=>{
  const u=new URL(url),body=options.body && !Buffer.isBuffer(options.body)?JSON.parse(options.body):null;
  if(u.pathname==='/auth/v1/user')return Response.json({id:t.admin});
  if(u.pathname.includes('/user_profiles'))return Response.json([{role:'admin'}]);
  if(u.pathname.startsWith('/rest/v1/rpc/')){
   const name=u.pathname.split('/').pop();try{return Response.json(await t.call(name,Object.values(body),options.headers.Authorization==='Bearer '+secret?'service_role':'authenticated'));}
   catch(error){return Response.json({code:error.code || 'P0001',message:error.message},{status:400});}
  }
  if(u.pathname==='/storage/v1/object/list/rh-fleet')return Response.json([...objects.keys()].filter(key=>key.startsWith(body.prefix+'/')).map(key=>({name:key.split('/').pop()})));
  if(u.pathname.startsWith('/storage/v1/object/')){
   const objectPath=decodeURIComponent(u.pathname.split('/rh-fleet/')[1]);
   if(options.method==='POST'){
    if(objects.has(objectPath))return Response.json({error:'exists'},{status:409});
    objects.set(objectPath,Buffer.from(options.body));await t.query('insert into storage.objects(bucket_id,name) values($1,$2)',['rh-fleet',objectPath]);
    if(objectPath.endsWith('/auto-v1.pdf'))archived=Buffer.from(options.body);return Response.json({Key:objectPath});
   }
   return objects.has(objectPath)?new Response(objects.get(objectPath),{headers:{'Content-Type':objectPath.endsWith('.pdf')?'application/pdf':'image/jpeg'}}):Response.json({error:'missing'},{status:404});
  }
  if(u.pathname.startsWith('/rest/v1/rh_fleet_handovers'))return Response.json(await t.query('select * from rh_fleet_handovers where id=$1',[u.searchParams.get('id').slice(3)]));
  throw new Error('Unexpected server route '+u.pathname);
 };
 const service=createFleetShares({env:{SUPABASE_SERVICE_ROLE_KEY:secret},fetcher});const pdfApi=createFleetApi({env:{},fetcher});
 const fixture=`
  state={persons:[{id:'a',name:'Gestor A',role:'chefe_equipa',ativo:true,entrada:'2020-01-01'}],vacations:[],records:{}};currentProfile={role:'admin',display_name:'Admin de teste'};currentUserId='${t.admin}';supabaseReady=true;
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
  await admin.goto(base+'/test.html');await admin.locator('[data-action=page][data-page=handovers]').click();await admin.locator('[data-action=edit-handover]').click();
  async function makeLink(role){const ready=admin.waitForResponse(response=>response.url().endsWith('/api/fleet-share') && response.request().postDataJSON()?.action==='create' && response.request().postDataJSON()?.purpose===role);await admin.locator(`[data-action=create-link][data-purpose=${role}]`).click();const response=await ready,value=await response.json();assert.equal(response.status(),200,JSON.stringify(value));await admin.waitForFunction(url=>document.querySelector('[data-share-url]')?.value===url,value.url);return new URL(value.url).hash;}
  const editorHash=await makeLink('editor');
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});const editor=await mobile.newPage();editor.on('pageerror',error=>errors.push(error.message));
  const requestUrls=[];editor.on('request',request=>requestUrls.push(request.url()));
  await editor.goto(base+'/auto-viatura.html'+editorHash);await editor.locator('[name=odometer]').waitFor();
  assert.equal(await editor.locator('[name=kind]').isDisabled(),true);assert.equal(await editor.locator('[data-sharing]').count(),0);assert.equal(await editor.locator('[data-signature]').count(),0);
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
  await editor.getByRole('button',{name:'Concluir preenchimento',exact:true}).click();await editor.getByRole('heading',{name:'Preenchimento enviado ao RH',exact:true}).waitFor();
  assert.ok(requestUrls.every(url=>!url.includes(editorHash.slice(1))));
  await admin.getByRole('button',{name:'Atualizar assinaturas',exact:true}).click();await admin.locator('[data-sharing]').waitFor();
  await admin.waitForFunction(()=>document.querySelector('[name=odometer]')?.value==='145');
  assert.equal(await admin.locator('[name=odometer]').inputValue(),'145');
  const fromHash=await makeLink('from'),toHash=await makeLink('to');
  await admin.locator('[data-sharing]').screenshot({path:path.join(output,'rh-ligacoes.png')});
  async function sign(fragment,name,width){
   const page=await mobile.newPage();page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width,height:900});await page.goto(base+'/auto-viatura.html'+fragment);
   await page.locator('#remoteSignerName').waitFor();assert.equal(await page.locator('#remoteSignerName').inputValue(),name);assert.equal(await page.locator('#remoteSign').isDisabled(),true);
   assert.match(await page.locator('.remote-facts').innerText(),new RegExp(fromName));assert.match(await page.locator('.remote-facts').innerText(),new RegExp(toName));
   await page.waitForFunction(()=>document.querySelector('#remotePhotos img')?.naturalWidth>0);
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
  await sign(fromHash,fromName,390);await sign(toHash,toName,320);
  await admin.getByRole('button',{name:'Atualizar assinaturas',exact:true}).click();await admin.locator('[data-share-status]').getByText(new RegExp(fromName)).waitFor();
  await admin.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await admin.waitForFunction(()=>!document.querySelector('.fleet-dialog'));
  const final=(await t.query('select * from rh_fleet_handovers where id=$1',[h.id]))[0];assert.equal(final.status,'confirmed');assert.ok(final.snapshot.operation.signatures.from);assert.ok(final.snapshot.operation.signatures.to);
  assert.equal(final.snapshot.operation.driver_fields.from.name,fromName);assert.equal(final.snapshot.operation.driver_fields.to.name,toName);assert.equal(final.snapshot.to_person.id,'a');
  assert.equal(final.snapshot.operation.damage_markers.length,1);assert.ok(Math.abs(final.snapshot.operation.damage_markers[0].x-100)<=1);assert.ok(Math.abs(final.snapshot.operation.damage_markers[0].y-335)<=1);
  for(let i=0;i<50 && !archived;i++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(archived);assert.equal((await PDFDocument.load(archived)).getPageCount(),3);
  fs.writeFileSync(path.join(output,'auto-assinado-teste.pdf'),archived);
  assert.equal(await admin.evaluate(()=>JSON.stringify(state)===window.hrBefore),true);assert.deepEqual(errors,[]);
  const expired=await mobile.newPage();await expired.goto(base+'/auto-viatura.html#'+'x'.repeat(43));await expired.getByRole('heading',{name:'Ligação indisponível',exact:true}).waitFor();
  console.log(JSON.stringify({editorWithoutRhAccess:true,mobileDraftSurvivesReload:true,driverNamesSaved:true,sameNamesForSigning:true,privatePhotoUpload:true,scopedLinks:true,signWithFinger390:true,signWithFinger320:true,darkTheme:true,oneTimeReceipt:true,bothSignaturesRequired:true,pdfHasImagesAndReceipts:true,serverArchive:true,tokensNotInRequestUrls:true,hrUnchanged:true,pageErrors:errors}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await t.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
