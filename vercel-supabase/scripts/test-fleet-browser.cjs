const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root=path.resolve(__dirname,'../public'),output=path.resolve(__dirname,'../../../../recovery/viaturas-implementacao');
const admin='00000000-0000-4000-8000-000000000001';
const fixture=`
  state={persons:[{id:'a',name:'Gestor A',role:'chefe_equipa',chefeId:'a',ativo:true,entrada:'2020-01-01',telefone:'900100200'},{id:'b',name:'Colaborador B',role:'vendedor',chefeId:'a',ativo:true,entrada:'2020-01-01',telefone:'900300400'}],vacations:[{id:'v1',personId:'a',start:'2026-12-01',end:'2026-12-08'}],records:{'a|2026-11-02':'P'}};
  currentProfile={role:'admin',display_name:'Admin de teste'};currentUserId='${admin}';supabaseReady=true;
  document.body.classList.add('authenticated','is-admin');document.getElementById('authOverlay').classList.remove('open');bolsaOutcomeDismissed=true;
  window.originalHR=JSON.stringify(state);window.getFleet=()=>fleetApp;
  const send=async value=>(await fetch('/test-fleet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).json();
  supabaseClient={rpc:(name,args)=>send({rpc:name,args}),auth:{getSession:async()=>({data:{session:{access_token:'test-only'}}})},
    from(table){const q={table,ordering:[],filters:[]};const chain={select(){return chain;},order(field){q.ordering.push(field);return chain;},range(a,b){q.range=[a,b];return send(q);}};return chain;},
    storage:{from(){return {list:async()=>({data:[]}),upload:async()=>({}),download:async()=>({data:new Blob(['test'])})};}}};
  switchTab('fleet');
`;
const html=fs.readFileSync(path.join(root,'mapa-recursos-humanos.html'),'utf8').replace(/^initSupabaseApp\(\);\r?$/m,fixture);
const db=new PGlite();let pauseSave=false,waiting=[];let writes=[];
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/test-fleet'){
      let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);let result;
      if(value.rpc){
        if(pauseSave && value.rpc==='rh_fleet_save_handover')await new Promise(resolve=>waiting.push(resolve));
        const names=['rh_fleet_version','rh_fleet_save_vehicle','rh_fleet_save_handover','rh_fleet_confirm_handover','rh_fleet_cancel_handover'];
        assert.ok(names.includes(value.rpc));if(value.rpc!=='rh_fleet_version')writes.push(value.rpc);
        const args=Object.values(value.args);try{result={data:(await query(`select to_jsonb(public.${value.rpc}(${args.map((_,i)=>'$'+(i+1)).join(',')})) as value`,args))[0].value};}catch(error){result={error:{message:error.message}};}
      }else{
        assert.ok(['rh_fleet_vehicles','rh_fleet_handovers','rh_fleet_custody'].includes(value.table));
        const all=await query('select * from public.'+value.table);all.sort((a,b)=>{for(const key of value.ordering){const cmp=String(a[key]).localeCompare(String(b[key]));if(cmp)return cmp;}return 0;});
        result={data:all.slice(value.range[0],value.range[1]+1),count:all.length};
      }
      res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));
    }
    if(url.pathname==='/api/fleet-auto'){
      if(req.method==='GET'){res.setHeader('Content-Type','image/png');return res.end(fs.readFileSync(path.join(root,'../assets/fleet/modri-94-01-page2.png')));}
      res.setHeader('Content-Type','application/pdf');return res.end(Buffer.from('%PDF-test'));
    }
    if(url.pathname==='/test.html'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
    const file=path.resolve(root,url.pathname.slice(1));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
    const type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream';
    res.setHeader('Content-Type',type);fs.readFile(file,(error,data)=>{if(error){res.statusCode=404;res.end();}else res.end(data);});
  }catch(error){res.statusCode=500;res.end(error.message);}
});
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
    create function auth.uid() returns uuid language sql as $$ select '${admin}'::uuid $$;
    create function public.is_rh_admin() returns boolean language sql as $$ select true $$;
    create table rh_persons(id text primary key,name text,entrada date,saida date,ativo boolean default true,data jsonb default '{}');
    insert into rh_persons(id,name,entrada,data) values('a','Gestor A','2020-01-01','{"telefone":"900100200"}'),('b','Colaborador B','2020-01-01','{"telefone":"900300400"}');
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
  await db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261117_fleet.sql'),'utf8'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const page=await context.newPage();
    await page.route('**/supabase-js**',route=>route.fulfill({body:'window.supabase={}',contentType:'application/javascript'}));
    const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}/test.html`);
    await page.getByText('Sem viaturas nesta seleção.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Adicionar viatura',exact:true}).click();
    await page.locator('[name=plate]').fill('AB-12-CD');await page.locator('[name=make_model]').fill('Renault Clio');await page.locator('[name=cartrack_number]').fill('000145');
    await page.locator('[name=company]').fill('Viatel');await page.locator('[name=habitual_person_id]').selectOption('a');await page.locator('[name=odometer]').fill('100');
    await page.getByRole('button',{name:'Guardar viatura',exact:true}).click();
    await page.locator('[data-fleet-vehicle]').waitFor();assert.match(await page.locator('#fleetRoot').textContent(),/000145/);
    assert.equal((await query('select * from rh_fleet_custody')).length,0);
    await page.getByRole('button',{name:'Registar entrega inicial',exact:true}).click();
    await page.locator('[name=at_input]').fill('2026-11-01T09:00');await page.locator('[name=odometer]').fill('120');await page.locator('[name=fuel]').selectOption('Cheio');
    await page.getByRole('button',{name:'Confirmar entrega',exact:true}).click();assert.match(await page.locator('[data-fleet-message]').last().textContent(),/inspeção/);
    const complete=async()=>{
      for(const group of await page.locator('[data-batch]').all()){
        const id=await group.getAttribute('data-batch');
        await group.locator('xpath=ancestor::details').locator('summary').click();
        await group.selectOption('NA');await page.locator(`[data-action=batch][data-group=${id}]`).click();
      }
      await page.locator('[name=checked]').check();
    };
    await complete();await page.getByRole('button',{name:'Guardar rascunho',exact:true}).click();
    await page.getByText('Rascunho guardado no servidor',{exact:true}).waitFor();
    assert.equal((await query('select * from rh_fleet_custody')).length,0);
    await page.getByRole('button',{name:'Confirmar entrega',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.fleet-dialog'));
    assert.equal((await query('select * from rh_fleet_custody where to_at is null'))[0].person_id,'a');
    await page.locator('[data-action=page][data-page=vehicles]').click();await page.getByRole('button',{name:'Passar ou devolver viatura',exact:true}).click();
    await page.locator('[name=to_person_id]').selectOption('b');await page.locator('[name=at_input]').fill('2026-11-10T09:00');await page.locator('[name=expected_input]').fill('2026-12-01T09:00');
    await page.locator('[name=odometer]').fill('180');await page.locator('[name=fuel]').selectOption('3/4');await complete();
    await page.locator('[data-damage-details] summary').click();await page.waitForFunction(()=>document.querySelector('.fleet-damage-canvas')?.onclick);
    const damage=page.locator('.fleet-damage-canvas');const box=await damage.boundingBox();await damage.click({position:{x:box.width*100/595,y:box.height*335/842}});
    await page.locator('[name=damage_notes]').fill('Risco na porta esquerda.');
    await page.getByRole('button',{name:'Guardar rascunho',exact:true}).click();await page.getByText('Rascunho guardado no servidor',{exact:true}).waitFor();
    await page.reload();await page.getByRole('button',{name:'Retomar rascunho local',exact:true}).click();
    assert.equal(await page.locator('[name=to_person_id]').inputValue(),'b');assert.equal(await page.locator('[name=odometer]').inputValue(),'180');
    assert.equal(await page.locator('[name=damage_notes]').inputValue(),'Risco na porta esquerda.');
    await page.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.fleet-dialog'));
    assert.equal((await query('select * from rh_fleet_custody where to_at is null'))[0].person_id,'b');
    assert.equal((await query('select habitual_person_id from rh_fleet_vehicles'))[0].habitual_person_id,'a');
    await page.locator('[data-action=page][data-page=vehicles]').click();
    await page.screenshot({path:path.join(output,'frota-site-desktop.png'),fullPage:true});
    for(const width of [820,390,320]){
      await page.setViewportSize({width,height:900});assert.equal(await page.locator('#fleetRoot').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
      await page.getByRole('button',{name:'Passar ou devolver viatura',exact:true}).click();
      assert.equal(await page.locator('.fleet-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
      await page.locator('[name=kind]').selectOption('return');assert.equal(await page.locator('[data-receiver]').isVisible(),false);
      await page.locator('.fleet-dialog').screenshot({path:path.join(output,`frota-form-${width}.png`)});
      await page.getByRole('button',{name:'Fechar',exact:true}).click();
      await page.screenshot({path:path.join(output,`frota-site-${width}.png`),fullPage:true});
    }
    await page.evaluate(()=>setThemePreference('dark'));await page.screenshot({path:path.join(output,'frota-site-dark.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});await page.locator('[data-action=page][data-page=history]').click();
    assert.equal(await page.locator('.fleet-table-wrap tbody tr').count(),2);
    await page.screenshot({path:path.join(output,'frota-history.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>JSON.stringify(state)===window.originalHR),true);assert.deepEqual(errors,[]);
    assert.equal(writes.every(name=>name.startsWith('rh_fleet_')),true);
    console.log(JSON.stringify({vehicleAndCartrack:true,initialHandover:true,temporaryHandover:true,inspectionRequired:true,serverDraftSurvivesReload:true,damageMarkerSaved:true,historyPreserved:true,hrDataUntouched:true,mobile320:true,mobile390:true,darkTheme:true,pageErrors:errors}));
  }finally{pauseSave=false;waiting.splice(0).forEach(resolve=>resolve());await browser.close();await new Promise(resolve=>server.close(resolve));await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
