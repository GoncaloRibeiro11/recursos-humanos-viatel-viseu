const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const createDb=require('./oop-test-db.cjs');
(async()=>{
 const t=await createDb({installOop:false}),updates=[],writes=[],monthlyWrites=[],errors=[],external=[];
 let server,browser,allowFixtureImport=false;
 try{
  await t.install('20261124_commissions.sql');await t.install('20261126_commissions_permissions.sql');
  const seller=t.uuid(90),empty=t.uuid(91);await t.query('insert into auth.users(id) values($1),($2)',[seller,empty]);
  await t.query("insert into user_profiles(user_id,role,person_id,display_name) values($1,'vendedor','a','Comercial teste'),($2,'vendedor','b','Sem pagamentos')",[seller,empty]);
  await t.query("insert into rh_commission_identities values('100000001','a','Comercial teste'),('100000010','ce1','Chefe teste')");
  const payment={period:'2026-11-01',owner_nif:'100000001',chief_nif:'100000010',source_name:'Comercial teste',total:20,payload:{period:'Novembro 2026',people:[{id:'p100000001',name:'Comercial teste',role:'Gestor Comercial',team:'Equipa teste',total:20,rubrics:[{label:'Comissão',amount:20}]}],records:[],productionVdd:[],productionChe:[],adjustments:[],checks:[]}};
  await t.query('insert into rh_commissions values($1,$2,$3,$4,$5,$6)',Object.values(payment));
  const october=structuredClone(payment);october.period='2026-10-01';october.payload.period='Outubro 2026';october.total=30;october.payload.people[0].total=30;october.payload.people[0].rubrics[0].amount=30;
  const previous=structuredClone(payment);previous.period='2025-12-01';previous.payload.period='Dezembro 2025';previous.total=10;previous.payload.people[0].total=10;previous.payload.people[0].rubrics[0].amount=10;
  const chief=structuredClone(payment);chief.owner_nif='100000010';chief.source_name='Chefe teste';chief.total=10;chief.payload.people[0]={...chief.payload.people[0],id:'p100000010',name:'Chefe teste',total:10,rubrics:[{label:'Comissão CE',amount:10}]};
  const record={owner:'p100000001',ownerName:'Comercial teste',period:'Novembro 2026',nif:'200000001',client:'Cliente <img src=x onerror=alert(1)>',service:'TV',sale:'OV-1',origin:'Comissão',seller:'Comercial teste',amount:15,line:1,credits:2};
  payment.payload.records=[record,{...record,service:'Energia',amount:5,line:2,credits:-.5},{...record,amount:0,line:3,credits:0}];
  await t.query('update rh_commissions set payload=$1 where owner_nif=$2 and period=$3',[payment.payload,payment.owner_nif,payment.period]);
  for(const item of [october,previous,chief])await t.query('insert into rh_commissions values($1,$2,$3,$4,$5,$6)',Object.values(item));
  const retained=structuredClone(payment);Object.assign(retained,{owner_nif:'100000099',chief_nif:null,source_name:'Retido teste',total:0});retained.payload.people=[{id:'p100000099',name:'Retido teste',role:'Gestor Comercial',team:'Teste',total:0,rubrics:[{label:'Comissão',amount:1000},{label:'Retenção CB',amount:-150},{label:'Retenção Pagam',amount:-850}]}];retained.payload.records=[];
  const zero=structuredClone(retained);zero.period='2026-10-01';zero.payload.period='Outubro 2026';zero.payload.people[0].rubrics=[];
  const negative=structuredClone(retained);negative.owner_nif='100000098';negative.source_name='Negativo teste';negative.total=-50;negative.payload.people[0]={...negative.payload.people[0],id:'p100000098',name:'Negativo teste',total:-50,rubrics:[{label:'Acerto',amount:-50}]};
  for(const item of [retained,zero,negative])await t.query('insert into rh_commissions values($1,$2,$3,$4,$5,$6)',Object.values(item));
  const before=JSON.stringify(await t.query('select * from rh_commissions'));
  const users={seller,empty,admin:t.users.admin,chief:t.users.ce1},root=path.resolve(__dirname,'../public');
  const sdk=`window.supabase={createClient(){
   let user=new URL(location.href).searchParams.get('as') || 'seller',listener;const ids=${JSON.stringify(users)};
   const post=async(path,body)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user,...body})});return response.json();};
   return {auth:{getSession:async()=>({data:{session:user?{user:{id:ids[user]}}:null}}),onAuthStateChange:fn=>{listener=fn;},signOut:async()=>{user=null;listener?.('SIGNED_OUT');return {};},updateUser:args=>post('/__password',{...args,fail:window.failPassword===true}),signInWithPassword:async()=>{user='seller';return {data:{user:{id:ids.seller}}};}},from(table){
    const q={table,eq:[],order:[]};const run=()=>post('/__db',q);const chain={select(columns){q.columns=columns;return chain;},eq(key,value){q.eq.push([key,value]);return chain;},order(key,options){q.order.push([key,options?.ascending===false?'desc':'asc']);return chain;},range(from,to){q.from=from;q.to=to;return run();},single(){q.single=true;return run();},upsert(data){q.write=data;return run();}};return chain;
   }};
  }};`;
  const tables={user_profiles:['user_id','role','person_id'],rh_commissions:['period','owner_nif','chief_nif','source_name','total','payload'],rh_persons:['id','name'],rh_commission_identities:['nif','person_id','source_name']};
  server=http.createServer(async(req,res)=>{
   try{
    const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
    const productionHeaders=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../vercel.json'),'utf8')).headers[0].headers;
    for(const header of productionHeaders)res.setHeader(header.key,header.value.replace(/; upgrade-insecure-requests/,''));
    if(req.method==='POST'){
     let raw='';for await(const chunk of req)raw+=chunk;const q=JSON.parse(raw);assert.ok(users[q.user]);
     if(url.pathname==='/__password'){
      assert.deepEqual(Object.keys(q).sort(),['fail','password','user']);updates.push({user:q.user,length:q.password.length});
      await new Promise(resolve=>setTimeout(resolve,200));return res.end(JSON.stringify(q.fail?{error:{message:'Falha temporária de teste.'}}:{data:{user:{id:users[q.user]}}}));
     }
     assert.equal(url.pathname,'/__db');assert.ok(tables[q.table]);
     if(q.write){
      assert.ok(allowFixtureImport&&q.user==='admin'&&['rh_commissions','rh_commission_identities'].includes(q.table));writes.push(q.table);
      const columns=tables[q.table],keys=q.table==='rh_commissions'?['period','owner_nif']:['nif'];
      const values=q.write.flatMap(row=>columns.map(c=>row[c])),sql='insert into '+q.table+'('+columns.join(',')+') values '+q.write.map((_,i)=>'('+columns.map((_,j)=>'$'+(i*columns.length+j+1)).join(',')+')').join(',')+' on conflict('+keys.join(',')+') do update set '+columns.filter(c=>!keys.includes(c)).map(c=>c+'=excluded.'+c).join(',');
      if(q.table==='rh_commissions'){assert.equal(new Set(q.write.map(r=>r.period)).size,1);monthlyWrites.push(q.write.length);}
      await t.run(users[q.user],()=>t.db.query(sql,values));
      return res.end(JSON.stringify({data:[]}));
     }
     const expression={"team:payload->people->0->>team":"payload->'people'->0->>'team' as team"};
     const columns=q.columns==='*'?tables[q.table]:q.columns.split(',');for(const col of columns)assert.ok(tables[q.table].includes(col)||(q.table==='rh_commissions'&&expression[col]));
     const params=[],where=q.eq.map(([key,value])=>{assert.ok(tables[q.table].includes(key));params.push(value);return key+'=$'+params.length;});
     const order=q.order.map(([key,direction])=>{assert.ok(tables[q.table].includes(key));assert.ok(['asc','desc'].includes(direction));return key+' '+direction;});
     let sql='select '+columns.map(c=>expression[c]||c).join(',')+' from '+q.table+(where.length?' where '+where.join(' and '):'')+(order.length?' order by '+order.join(','):'');
     if(!q.single){assert.ok(Number.isInteger(q.from)&&Number.isInteger(q.to));sql+=' limit '+(q.to-q.from+1)+' offset '+q.from;}
     const result=await t.run(users[q.user],()=>t.db.query(sql,params));for(const row of result.rows){if(row.period)row.period=(row.period instanceof Date?row.period.toISOString():String(row.period)).slice(0,10);if(row.total!==undefined)row.total=Number(row.total);}return res.end(JSON.stringify({data:q.single?result.rows[0]:result.rows}));
    }
    if(url.pathname==='/api/config')return res.end(JSON.stringify({supabaseUrl:'https://test.invalid',supabaseAnonKey:'test-only'}));
    const file=path.resolve(root,url.pathname.slice(1));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/plain');res.end(fs.readFileSync(file));
   }catch(error){res.statusCode=500;res.end(JSON.stringify({error:{message:error.message}}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js'))return route.fulfill({body:sdk,contentType:'application/javascript'});if(/^https?:/.test(url)&&!url.startsWith(origin)){external.push(url);return route.abort();}return route.continue();});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  const page=await context.newPage();await page.goto(origin+'/comissoes.html');try{await page.frameLocator('#reportFrame').locator('#total').filter({hasText:'20,00'}).waitFor({timeout:8000});}catch(error){const frame=page.frames().find(f=>f!==page.mainFrame());const inspect=el=>{const out=[];for(let x=el;x;x=x.parentElement){const box=x.getBoundingClientRect();out.push({tag:x.tagName,id:x.id,hidden:x.hidden,display:getComputedStyle(x).display,visibility:getComputedStyle(x).visibility,width:box.width,height:box.height});}return out;};console.error(JSON.stringify({status:await page.locator('#status').innerText(),errors,parent:await page.locator('#reportFrame').evaluate(inspect),ancestors:frame?await frame.locator('#total').evaluate(inspect):[]}));throw error;}
  assert.equal(await page.locator('#admin').isVisible(),false);assert.match(await page.frameLocator('#reportFrame').locator('#total').innerText(),/20,00/);
  const report=page.frameLocator('#reportFrame');assert.equal(await report.locator('#clients img').count(),0);assert.match(await report.locator('#clients').innerText(),/1,5 créditos VP/);
  const reportFrame=page.frames().find(f=>f!==page.mainFrame());assert.equal(await reportFrame.evaluate(()=>{try{return !!parent.document.body;}catch{return false;}}),false);
  await report.locator('#period').selectOption('all');assert.match(await report.locator('#total').innerText(),/50,00/);await report.locator('#year').selectOption('2025');assert.match(await report.locator('#total').innerText(),/10,00/);await report.locator('#year').selectOption('2026');
  await report.locator('#sign').selectOption('negative');assert.equal(await report.locator('.client').count(),0);await report.locator('#reset').click();await report.locator('#search').fill('TV');assert.match(await report.locator('#filteredTotal').innerText(),/15,00/);await report.locator('#reset').click();
  const csvDownload=page.waitForEvent('download');await report.locator('#csv').click();const csv=await csvDownload;assert.match(fs.readFileSync(await csv.path(),'utf8'),/OV-1/);
  const htmlDownload=page.waitForEvent('download');await report.getByRole('button',{name:'Exportar pessoa selecionada · HTML',exact:true}).click();const html=fs.readFileSync(await(await htmlDownload).path(),'utf8');assert.ok(!html.includes('Chefe teste'));assert.ok(!/<script[^>]+src=/.test(html));
  const offline=await context.newPage();await offline.setContent(html);await offline.locator('#total').filter({hasText:'20,00'}).waitFor();await offline.close();
  const screenshots=path.resolve(__dirname,'../../../../recovery/commissions-tests');fs.mkdirSync(screenshots,{recursive:true});
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});assert.equal(await report.locator('body').evaluate(el=>el.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(screenshots,'historico-'+width+'.png')});}
  await page.getByRole('button',{name:'Alterar password',exact:true}).click();await page.locator('#passwordDialog').waitFor();
  assert.equal(await page.locator('#newPassword').evaluate(el=>el===document.activeElement),true);
  await page.locator('#newPassword').fill('short');await page.locator('#confirmPassword').fill('short');
  await page.locator('#passwordForm').evaluate(form=>form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));await page.getByText('A password deve ter pelo menos 12 caracteres.',{exact:true}).waitFor();assert.equal(updates.length,0);
  await page.locator('#newPassword').fill('Example-test-pass-123');await page.locator('#confirmPassword').fill('Example-test-pass-456');await page.getByRole('button',{name:'Guardar password',exact:true}).click();await page.getByText('As passwords não coincidem.',{exact:true}).waitFor();assert.equal(updates.length,0);
  const output=path.resolve(__dirname,'../../../../recovery/commissions-tests');fs.mkdirSync(output,{recursive:true});
  await page.locator('#passwordForm').evaluate(form=>form.reset());await page.locator('#passwordStatus').evaluate(el=>el.textContent='');
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('#passwordDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await page.screenshot({path:path.join(output,'password-'+width+'.png')});}
  await page.locator('#newPassword').fill('Example-test-pass-123');await page.locator('#confirmPassword').fill('Example-test-pass-123');await page.evaluate(()=>window.failPassword=true);
  await page.getByRole('button',{name:'Guardar password',exact:true}).click();await page.getByText('Falha temporária de teste.',{exact:true}).waitFor();assert.equal(await page.locator('#passwordSave').isEnabled(),true);assert.equal((await page.locator('#newPassword').inputValue()).length,21);
  await page.evaluate(()=>window.failPassword=false);await page.locator('#passwordForm').evaluate(form=>{form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));});
  await page.getByText('Password alterada.',{exact:true}).waitFor();assert.equal(updates.length,2);assert.equal(await page.locator('#newPassword').inputValue(),'');assert.equal(await page.locator('#confirmPassword').inputValue(),'');assert.match(await page.frameLocator('#reportFrame').locator('#total').innerText(),/20,00/);
  await page.getByRole('button',{name:'Fechar',exact:true}).click();await page.getByRole('button',{name:'Terminar sessão',exact:true}).click();assert.equal(await page.locator('#passwordOpen').isVisible(),false);assert.equal(await page.locator('#reportFrame').getAttribute('srcdoc'),'');
  const emptyPage=await context.newPage();await emptyPage.goto(origin+'/comissoes.html?as=empty');await emptyPage.getByText('Ainda não existem comissões disponíveis para este acesso.',{exact:true}).waitFor();await emptyPage.getByRole('button',{name:'Alterar password',exact:true}).click();await emptyPage.locator('#passwordDialog').waitFor();await emptyPage.getByRole('button',{name:'Fechar',exact:true}).click();
  const chiefPage=await context.newPage();await chiefPage.goto(origin+'/comissoes.html?as=chief');await chiefPage.frameLocator('#reportFrame').locator('#total').filter({hasText:'30,00'}).waitFor();assert.equal(await chiefPage.locator('#reportScope').inputValue(),'team:100000010');assert.equal(await chiefPage.locator('#admin').isVisible(),false);await chiefPage.close();
  const publicPage=await context.newPage();await publicPage.goto(origin+'/commission-report.html');await publicPage.getByText('Sem dados de relatório.',{exact:true}).waitFor();assert.equal(await publicPage.locator('#report-data').textContent(),'{}');await publicPage.close();
  const admin=await context.newPage();await admin.goto(origin+'/comissoes.html?as=admin');await admin.bringToFront();const adminReport=admin.frameLocator('#reportFrame');await adminReport.locator('#total').waitFor({state:'attached'});
  await adminReport.locator('#total').filter({hasText:'30,00'}).waitFor({timeout:8000});
  for(let i=0;i<2;i++){await admin.locator('#reportScope').selectOption('person:100000001');await adminReport.locator('#total').filter({hasText:'20,00'}).waitFor({timeout:8000});await admin.locator('#reportScope').selectOption('team:100000010');await adminReport.locator('#total').filter({hasText:'30,00'}).waitFor({timeout:8000});}
  await adminReport.locator('#person').selectOption('p100000001');const ownDownload=admin.waitForEvent('download');await adminReport.getByRole('button',{name:'Exportar pessoa selecionada · HTML',exact:true}).click();const ownHtml=fs.readFileSync(await(await ownDownload).path(),'utf8');assert.equal(ownHtml.includes('p100000010'),false,'team export cannot contain another person, including cached annual data');
  await admin.locator('#reportScope').selectOption('person:100000099');await adminReport.locator('#total').filter({hasText:'850,00'}).waitFor();
  assert.match(await adminReport.locator('#cbRetention').innerText(),/-150,00/);assert.match(await adminReport.locator('#paymentRetention').innerText(),/-850,00/);assert.match(await adminReport.locator('#paymentFinal').innerText(),/0,00/);
  const positiveBar=adminReport.locator('[data-month="11"] .month-plot i');assert.ok((await positiveBar.boundingBox()).height>100);
  const {createCanvas,loadImage}=require('@napi-rs/canvas'),barImage=await loadImage(await positiveBar.screenshot()),canvas=createCanvas(barImage.width,barImage.height),ctx=canvas.getContext('2d');ctx.drawImage(barImage,0,0);assert.deepEqual([...ctx.getImageData(Math.floor(barImage.width/2),Math.floor(barImage.height/2),1,1).data],[0,125,134,255]);
  for(const width of [1440,390,320]){await admin.setViewportSize({width,height:1000});assert.equal(await adminReport.locator('body').evaluate(el=>el.scrollWidth<=innerWidth+1),true);await admin.screenshot({path:path.join(screenshots,'retencao-'+width+'.png')});}
  await adminReport.locator('input[name="chartMetric"][value="final"]').check();await adminReport.locator('#chartEmpty').waitFor({state:'visible'});assert.equal(await adminReport.locator('[data-month="11"]').getAttribute('data-value'),'0');assert.match(await adminReport.locator('#total').innerText(),/850,00/);
  await adminReport.locator('input[name="chartMetric"][value="afterCB"]').check();assert.ok((await positiveBar.boundingBox()).height>100);await adminReport.locator('#period').selectOption('all');assert.match(await adminReport.locator('#total').innerText(),/850,00/);
  await admin.locator('#reportScope').selectOption('person:100000098');await adminReport.locator('#total').filter({hasText:'-50,00'}).waitFor();const negativeBar=adminReport.locator('[data-month="11"] .month-plot i');assert.equal(await negativeBar.evaluate(el=>el.style.top),'10px');assert.ok((await negativeBar.boundingBox()).height>100);
  await admin.locator('#reportScope').selectOption('person:100000001');await adminReport.locator('#total').filter({hasText:'20,00'}).waitFor();
  await admin.locator('#admin summary').click();
  const invalid={version:1,identities:[{nif:'100000001',source_name:'Comercial teste'},{nif:'100000010',source_name:'Chefe teste'}],rows:[structuredClone(payment)]};invalid.rows[0].payload.people[0].rubrics=[{label:'Sem valor'}];
  await admin.locator('#importFile').setInputFiles({name:'invalid-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});await admin.getByText('Cada rubrica deve ter um valor numérico válido.',{exact:true}).waitFor();assert.equal(await admin.locator('#importSave').isVisible(),false);assert.deepEqual(writes,[]);
  assert.equal(JSON.stringify(await t.query('select * from rh_commissions')),before);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await admin.locator('#reportSearch').fill('teste Comerçial');await admin.waitForFunction(()=>document.getElementById('reportScope').options.length===1);await adminReport.locator('#total').filter({hasText:'20,00'}).waitFor();await admin.locator('#reportSearch').fill('');await admin.locator('#reportScope option').filter({hasText:'Equipa Chefe teste'}).waitFor({state:'attached'});
  const fixture=require('./commission-excel-fixture.cjs'),X=require('xlsx'),folder=path.join(screenshots,'excel-fixture');fs.mkdirSync(folder,{recursive:true});
  for(const month of ['2026-11-01','2026-12-01']){const f=fixture(month);for(let i=0;i<19;i++){const row=[];Object.assign(row,{4:100000100+i,5:'Comercial novo '+i,6:'Vendedor',7:'Equipa teste',8:'Coord Teste',13:'TAB_VDD',17:40,59:40});X.utils.sheet_add_aoa(f.payBook.Sheets.Pagamento,[row],{origin:{r:10+i,c:0}});}fs.writeFileSync(path.join(folder,f.payName),X.write(f.payBook,{type:'buffer',bookType:'xlsx'}));fs.writeFileSync(path.join(folder,f.detailName),X.write(f.detailBook,{type:'buffer',bookType:'xlsx'}));}
  await admin.locator('#syncOpen').click();await admin.locator('#syncFolder').setInputFiles(folder);await admin.getByText('1 meses novos encontrados.',{exact:true}).waitFor();
  assert.equal(await admin.locator('[data-period="2026-11-01"]').isChecked(),false);assert.equal(await admin.locator('[data-period="2026-12-01"]').isChecked(),true);
  await admin.locator('#syncPrepare').click();await admin.locator('#importReview').waitFor({state:'visible'});assert.match(await admin.locator('#importSummary').innerText(),/2026-12/);assert.deepEqual(writes,[]);
  for(const width of [1440,390,320]){await admin.setViewportSize({width,height:1000});assert.equal(await admin.locator('body').evaluate(el=>el.scrollWidth<=innerWidth+1),true);await admin.screenshot({path:path.join(screenshots,'sincronizar-'+width+'.png')});}
  allowFixtureImport=true;await admin.locator('#importSave').click();await admin.getByText('Importação concluída.',{exact:true}).waitFor();await adminReport.locator('#total').filter({hasText:'40,00'}).waitFor();
  const oldRows=await t.query("select * from rh_commissions where period<'2026-12-01'");assert.equal(JSON.stringify(oldRows),before,'existing payments stay byte-for-byte unchanged');
  assert.equal((await t.query("select * from rh_commissions where period='2026-12-01'")).length,21);assert.deepEqual(monthlyWrites,[21],'a month is sent in one transaction, not split after twenty people');assert.equal((await t.query('select * from rh_commission_identities')).length,2,'new people are not automatically linked to accounts');
  await admin.locator('#syncOpen').click();await admin.locator('#syncFolder').setInputFiles(folder);await admin.getByText('0 meses novos encontrados.',{exact:true}).waitFor();await admin.locator('[data-period="2026-12-01"]').check();await admin.locator('#syncPrepare').click();await admin.locator('#importReview').waitFor({state:'visible'});
  const previousWrites=writes.length,cancelled=admin.waitForEvent('dialog'),cancelClick=admin.locator('#importSave').click();await(await cancelled).dismiss();await cancelClick;await admin.waitForFunction(()=>!document.getElementById('importSave').disabled);assert.equal(writes.length,previousWrites,'replacement can be cancelled');
  const accepted=admin.waitForEvent('dialog'),acceptClick=admin.locator('#importSave').click();await(await accepted).accept();await acceptClick;await admin.getByText('Importação concluída.',{exact:true}).waitFor();assert.equal((await t.query("select * from rh_commissions where period='2026-12-01'")).length,21,'repeat never duplicates payments');
  assert.equal(JSON.stringify(await t.query("select * from rh_commissions where period<'2026-12-01'")),before);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify({historyTemplate:true,yearMonthAndAnnual:true,clientFilters:true,vpDeduplicated:true,csvExport:true,personalInteractiveExport:true,iframeCannotAccessSession:true,passwordOwnAccount:true,shortAndMismatchBlocked:true,retryAndDoubleSubmitSafe:true,passwordFieldsCleared:true,logoutClears:true,availableWithoutPayments:true,malformedImportBlockedBeforeWrite:true,desktopAndMobile:true,existingPaymentsUnchanged:true,excelFolderImport:true,monthlyAtomicWrite:true,existingMonthsUnselected:true,replacementCanBeCancelled:true,repeatNoDuplicates:true,accentInsensitiveSearch:true,noNewAccessMappings:true,retentionsSeparated:true,visibleChartPixels:true,negativeBarsBelowZero:true,zeroChartExplained:true,externalRequests:external,pageErrors:errors}));
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await t.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
