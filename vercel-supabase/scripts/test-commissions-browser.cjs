const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const createDb=require('./oop-test-db.cjs');
(async()=>{
 const t=await createDb({installOop:false}),updates=[],writes=[],errors=[],external=[];
 let server,browser;
 try{
  await t.install('20261124_commissions.sql');await t.install('20261126_commissions_permissions.sql');
  const seller=t.uuid(90),empty=t.uuid(91);await t.query('insert into auth.users(id) values($1),($2)',[seller,empty]);
  await t.query("insert into user_profiles(user_id,role,person_id,display_name) values($1,'vendedor','a','Comercial teste'),($2,'vendedor','b','Sem pagamentos')",[seller,empty]);
  await t.query("insert into rh_commission_identities values('100000001','a','Comercial teste')");
  const payment={period:'2026-11-01',owner_nif:'100000001',chief_nif:null,source_name:'Comercial teste',total:20,payload:{period:'Novembro 2026',people:[{id:'p100000001',total:20,rubrics:[{label:'Comissão',amount:20}]}],records:[],productionVdd:[],productionChe:[],adjustments:[],checks:[]}};
  await t.query('insert into rh_commissions values($1,$2,$3,$4,$5,$6)',Object.values(payment));
  const before=JSON.stringify(await t.query('select * from rh_commissions'));
  const users={seller,empty,admin:t.users.admin},root=path.resolve(__dirname,'../public');
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
    if(req.method==='POST'){
     let raw='';for await(const chunk of req)raw+=chunk;const q=JSON.parse(raw);assert.ok(users[q.user]);
     if(url.pathname==='/__password'){
      assert.deepEqual(Object.keys(q).sort(),['fail','password','user']);updates.push({user:q.user,length:q.password.length});
      await new Promise(resolve=>setTimeout(resolve,200));return res.end(JSON.stringify(q.fail?{error:{message:'Falha temporária de teste.'}}:{data:{user:{id:users[q.user]}}}));
     }
     assert.equal(url.pathname,'/__db');assert.ok(tables[q.table]);
     if(q.write){writes.push(q.table);return res.end(JSON.stringify({error:{message:'Este teste não permite importar pagamentos.'}}));}
     const columns=q.columns==='*'?tables[q.table]:q.columns.split(',');for(const col of columns)assert.ok(tables[q.table].includes(col));
     const params=[],where=q.eq.map(([key,value])=>{assert.ok(tables[q.table].includes(key));params.push(value);return key+'=$'+params.length;});
     const order=q.order.map(([key,direction])=>{assert.ok(tables[q.table].includes(key));assert.ok(['asc','desc'].includes(direction));return key+' '+direction;});
     let sql='select '+columns.join(',')+' from '+q.table+(where.length?' where '+where.join(' and '):'')+(order.length?' order by '+order.join(','):'');
     if(!q.single){assert.ok(Number.isInteger(q.from)&&Number.isInteger(q.to));sql+=' limit '+(q.to-q.from+1)+' offset '+q.from;}
     const result=await t.run(users[q.user],()=>t.db.query(sql,params));return res.end(JSON.stringify({data:q.single?result.rows[0]:result.rows}));
    }
    if(url.pathname==='/api/config')return res.end(JSON.stringify({supabaseUrl:'https://test.invalid',supabaseAnonKey:'test-only'}));
    const file=path.resolve(root,url.pathname.slice(1));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html; charset=utf-8':'text/plain');res.end(fs.readFileSync(file));
   }catch(error){res.statusCode=500;res.end(JSON.stringify({error:{message:error.message}}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js'))return route.fulfill({body:sdk,contentType:'application/javascript'});if(/^https?:/.test(url)&&!url.startsWith(origin)){external.push(url);return route.abort();}return route.continue();});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  const page=await context.newPage();await page.goto(origin+'/comissoes.html');await page.locator('#reports article').waitFor();
  assert.equal(await page.locator('#admin').isVisible(),false);assert.match(await page.locator('#summary').innerText(),/20,00/);
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
  await page.getByText('Password alterada.',{exact:true}).waitFor();assert.equal(updates.length,2);assert.equal(await page.locator('#newPassword').inputValue(),'');assert.equal(await page.locator('#confirmPassword').inputValue(),'');assert.equal(await page.locator('#reports article').count(),1);
  await page.getByRole('button',{name:'Fechar',exact:true}).click();await page.getByRole('button',{name:'Terminar sessão',exact:true}).click();assert.equal(await page.locator('#passwordOpen').isVisible(),false);assert.equal(await page.locator('#reports article').count(),0);
  const emptyPage=await context.newPage();await emptyPage.goto(origin+'/comissoes.html?as=empty');await emptyPage.getByText('Ainda não existem comissões disponíveis para este acesso.',{exact:true}).waitFor();await emptyPage.getByRole('button',{name:'Alterar password',exact:true}).click();await emptyPage.locator('#passwordDialog').waitFor();
  const admin=await context.newPage();await admin.goto(origin+'/comissoes.html?as=admin');await admin.locator('#reports article').waitFor();await admin.locator('#admin summary').click();
  const invalid={version:1,identities:[{nif:'100000001',source_name:'Comercial teste'}],rows:[structuredClone(payment)]};invalid.rows[0].payload.people[0].rubrics=[{label:'Sem valor'}];
  await admin.locator('#importFile').setInputFiles({name:'invalid-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});await admin.getByText('Cada rubrica deve ter um valor numérico válido.',{exact:true}).waitFor();assert.equal(await admin.locator('#importSave').isVisible(),false);assert.deepEqual(writes,[]);
  assert.equal(JSON.stringify(await t.query('select * from rh_commissions')),before);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify({passwordOwnAccount:true,shortAndMismatchBlocked:true,retryAndDoubleSubmitSafe:true,passwordFieldsCleared:true,logoutClears:true,availableWithoutPayments:true,malformedImportBlockedBeforeWrite:true,desktopAndMobile:true,paymentsUnchanged:true,externalRequests:external,pageErrors:errors}));
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await t.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
