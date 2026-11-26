const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../public'),authOrigin='https://mobile-fixture.supabase.co';
const user={id:'10000000-0000-4000-8000-000000000001',email:'mobile@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{}};
const payment={period:'2026-11-01',owner_nif:'100000001',chief_nif:null,source_name:'Mobile test',total:20,payload:{period:'Novembro 2026',people:[{id:'p100000001',name:'Mobile test',role:'Gestor Comercial',team:'Teste',total:20,rubrics:[{label:'Comissao',amount:20}]}],records:[],productionVdd:[],productionChe:[],adjustments:[],checks:[]}};
const token=()=>Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.dGVzdC1vbmx5';
(async()=>{
 const sdkResponse=await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');assert.ok(sdkResponse.ok);const sdk=await sdkResponse.text();
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
  const headers=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../vercel.json'),'utf8')).headers[0].headers;
  for(const header of headers)res.setHeader(header.key,header.value.replace(/; upgrade-insecure-requests/,''));
  if(url.pathname==='/api/config'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({supabaseUrl:authOrigin,supabaseAnonKey:'fixture-public-key'}));}
  const file=path.resolve(root,url.pathname.slice(1));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,results=[];
 try{
  for(const [engine,device] of [[chromium,'Pixel 7'],[webkit,'iPhone 13']]){
   const browser=await engine.launch({headless:true,...(engine===chromium?{channel:'chrome'}:{})});
   try{
    for(const scenario of (process.env.AUTH_SCENARIOS?.split(',')||['commissions','rh-keyboard','vendor-redirect','legacy-dialog','report','bad-login','rh-bad-login'])){
     const context=await browser.newContext({...devices[device]}),page=await context.newPage(),errors=[],unexpected=[],requests=[];
     page.on('pageerror',e=>errors.push(e.message));
     if(scenario==='legacy-dialog')await context.addInitScript(()=>{if(window.HTMLDialogElement){HTMLDialogElement.prototype.close=undefined;HTMLDialogElement.prototype.showModal=undefined;}});
     await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('@supabase/supabase-js'))return route.fulfill({contentType:'application/javascript',body:sdk});
      if(url.origin===authOrigin){
       requests.push(url.pathname);
       let data;
       if(url.pathname==='/auth/v1/token'){
        const input=request.postDataJSON();assert.equal(input.email,user.email);assert.equal(input.password,'Fictional-mobile-test-123');
        if(scenario.endsWith('bad-login'))return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'invalid_credentials',msg:'Invalid login credentials'})});
        data={access_token:token(),refresh_token:'fictional-refresh-token',expires_in:3600,token_type:'bearer',user};
       }else if(url.pathname==='/auth/v1/user')data=user;
       else if(url.pathname==='/rest/v1/user_profiles')data={user_id:user.id,role:scenario==='vendor-redirect'?'vendedor':'admin',person_id:null,display_name:'Mobile test'};
       else if(url.pathname.startsWith('/rest/v1/rpc/'))return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'PGRST202',message:'Not installed in fixture'})});
       else if(url.pathname==='/rest/v1/rh_commissions'&&scenario==='report')data=Number(url.searchParams.get('offset')||0)>0?[]:[payment];
       else if(url.pathname.startsWith('/rest/v1/')&&request.method()==='GET')data=[];
       else throw Error('Unexpected fixture request '+url.pathname);
       return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      }
      if(url.origin===origin)return route.continue();unexpected.push(url.origin);return route.abort();
     });
     const main=scenario.startsWith('rh-')||scenario==='vendor-redirect';
     await page.goto(origin+(main?'/mapa-recursos-humanos.html':'/comissoes.html'));
     const email=page.locator(main?'#authEmail':'#email'),password=page.locator(main?'#authPassword':'#password');
     await email.waitFor({state:'visible',timeout:5000});await email.fill(user.email);await password.fill('Fictional-mobile-test-123');
     if(main&&scenario==='vendor-redirect')await page.getByRole('button',{name:'Entrar',exact:true}).tap();else await password.press('Enter');
     if(scenario.endsWith('bad-login')){
      await page.locator(main?'#authError':'#status').filter({hasText:main?'Email ou password incorretos.':'Invalid login credentials'}).waitFor({timeout:6000});
      assert.equal(await page.locator(main?'#authSubmit':'#loginSubmit').isEnabled(),true);
      assert.equal(await page.locator(main?'#authOverlay':'#login').isVisible(),true);
      assert.equal(await page.locator(main?'#rhView':'#app').isVisible(),false);
     }else if(scenario==='report'){
      const report=page.frameLocator('#reportFrame');await report.locator('#total').filter({hasText:'20,00'}).waitFor({timeout:6000});
      assert.equal(await report.locator('body').evaluate(el=>el.scrollWidth<=innerWidth+1),true);
      const output=path.resolve(__dirname,'../../../../recovery/commissions-tests');fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'login-report-'+engine.name()+'.png')});
      await page.reload();await report.locator('#total').filter({hasText:'20,00'}).waitFor({timeout:6000});
     }else if(scenario==='rh-keyboard'){
      await page.waitForFunction(()=>document.body.classList.contains('authenticated'),{},{timeout:6000});
      await page.reload();await page.waitForFunction(()=>document.body.classList.contains('authenticated'),{},{timeout:6000});
     }
     else await page.getByText('Ainda não existem comissões disponíveis para este acesso.',{exact:true}).waitFor({timeout:6000});
     assert.ok(requests.includes('/auth/v1/token'));assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
     if(scenario==='legacy-dialog'){await page.getByRole('button',{name:'Alterar password',exact:true}).tap();await page.locator('#newPassword').waitFor({state:'visible'});await page.getByRole('button',{name:'Fechar',exact:true}).tap();assert.equal(await page.locator('#passwordDialog').isVisible(),false);}
     results.push({device,scenario,passed:true});console.log(JSON.stringify(results.at(-1)));await context.close();
    }
   }finally{await browser.close();}
  }
  console.log(JSON.stringify({sdkVersion:sdkResponse.headers.get('x-jsd-version'),results}));
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
