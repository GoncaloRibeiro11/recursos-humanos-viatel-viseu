const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root=path.resolve(__dirname,'../public');
const output=path.resolve(root,'../../../../recovery');
const headers=JSON.parse(fs.readFileSync(path.join(root,'../vercel.json'),'utf8')).headers[0].headers;
const original=fs.readFileSync(path.join(root,'mapa-recursos-humanos.html'),'utf8');
const fixture=`
  const avatar=document.createElement('canvas'); avatar.width=64;avatar.height=64;
  const ctx=avatar.getContext('2d');ctx.fillStyle='#2c9bd8';ctx.fillRect(0,0,64,64);ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(32,22,10,0,Math.PI*2);ctx.fill();ctx.fillRect(18,34,28,30);
  const photo=avatar.toDataURL('image/png');
  state={persons:[
    {id:'a',name:'Equipa A',role:'chefe_equipa',chefeId:'a',ativo:true,entrada:'2017-01-01',photo},
    {id:'b',name:'Gestora de Equipa Com Um Nome Bastante Comprido',role:'chefe_equipa',chefeId:'b',ativo:true,entrada:'2017-01-01',photo},
    {id:'c',name:'Equipa C',role:'chefe_equipa',chefeId:'c',ativo:true,entrada:'2017-01-01',photo},
    ...Array.from({length:19},(_,i)=>({id:'entry-'+i,name:'Colaborador '+i,chefeId:i<9?'a':i<18?'b':'',role:'vendedor',ativo:true,entrada:'2026-'+String(i%10+1).padStart(2,'0')+'-01'})),
    ...Array.from({length:9},(_,i)=>({id:'exit-'+i,name:'Saida '+i,chefeId:'c',role:'vendedor',ativo:false,entrada:'2025-01-01',saida:'2026-06-'+String(i+1).padStart(2,'0')}))
  ],vacations:[],records:{}};
  currentProfile={role:'admin',display_name:'Teste'};
  document.body.classList.add('authenticated','is-admin');document.getElementById('authOverlay').classList.remove('open');
  window.originalState=JSON.stringify(state);Object.defineProperty(window,'testState',{get:()=>state});
  switchTab('dashboard');
`;
const html=original.replace(/^initSupabaseApp\(\);\r?$/m,fixture);
assert.notEqual(html,original);
let writes=0;
const server=http.createServer((req,res)=>{
  for (const header of headers) res.setHeader(header.key,header.value);
  if(req.method!=='GET'){writes++;res.writeHead(405);return res.end();}
  const file=new URL(req.url,'http://localhost').pathname;
  if(file==='/test.html'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  const target=path.resolve(root,file.slice(1));
  if(!target.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(target,(error,data)=>{
    if(error){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.webp')?'image/webp':'application/octet-stream');
    res.end(data);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/supabase-js**',route=>route.fulfill({body:'window.supabase={};',contentType:'application/javascript'}));
    await page.goto(`http://127.0.0.1:${server.address().port}/test.html`);
    const panel=page.locator('#dashAnnualMovements');
    await panel.waitFor();
    const total=key=>page.locator(`[data-movement-total="${key}"]`).textContent();
    assert.equal(await total('entries'),'19');assert.equal(await total('exits'),'9');assert.equal(await total('balance'),'+10');
    assert.equal(await panel.locator('.dash-movement-month').count(),12);
    assert.equal(await panel.locator('tbody tr').count(),4);
    assert.equal(await panel.locator('[data-movement-team="c"] td').last().textContent(),'-9');
    assert.equal(await panel.locator('tbody img').count(),3);
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({path:path.join(output,'dashboard-annual-movements-desktop.png')});
    await page.locator('#dashboardMovementTeam').selectOption('a');
    assert.equal(await total('entries'),'9');assert.equal(await total('exits'),'0');assert.equal(await total('balance'),'+9');
    assert.equal(await panel.locator('tr.is-selected').getAttribute('data-movement-team'),'a');
    await page.locator('#dashboardMovementTeam').selectOption('c');
    assert.equal(await total('entries'),'0');assert.equal(await total('exits'),'9');assert.equal(await total('balance'),'-9');
    assert.match(await page.locator('[data-movement-total="balance"]').getAttribute('class'),/negative/);
    await page.locator('#dashboardMovementTeam').selectOption('');
    assert.equal(await total('balance'),'+1');
    await page.locator('#dashboardMovementTeam').selectOption('*');
    assert.equal(await total('balance'),'+10');
    for(const width of [820,390,320]){
      await page.setViewportSize({width,height:844});
      await panel.scrollIntoViewIfNeeded();
      const box=await panel.boundingBox();
      if(box.x<0 || box.x+box.width>width+1){
        console.log(JSON.stringify(await panel.evaluate(el=>{
          const chain=[];
          for(let parent=el;parent;parent=parent.parentElement){
            const rect=parent.getBoundingClientRect(),style=getComputedStyle(parent);
            chain.push({tag:parent.tagName,id:parent.id,className:parent.className,x:rect.x,width:rect.width,scroll:parent.scrollWidth,minWidth:style.minWidth,columns:style.gridTemplateColumns});
          }
          return chain;
        }),null,2));
        await page.screenshot({path:path.join(output,`dashboard-annual-movements-overflow-${width}.png`)});
      }
      assert.ok(box.x>=0 && box.x+box.width<=width+1);
      assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
      const labels=await panel.locator('thead th').evaluateAll(cells=>cells.map(cell=>({width:cell.clientWidth,scroll:cell.scrollWidth})));
      assert.ok(labels.every(cell=>cell.scroll<=cell.width+1));
      await panel.screenshot({path:path.join(output,`dashboard-annual-movements-mobile-${width}.png`)});
    }
    await page.evaluate(()=>setThemePreference('dark'));
    assert.equal(await panel.locator('.dash-movement-entry').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 197, 94)');
    assert.equal(await panel.locator('.dash-movement-exit').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(239, 68, 68)');
    await panel.screenshot({path:path.join(output,'dashboard-annual-movements-dark.png')});
    assert.equal(await page.evaluate(()=>JSON.stringify(state)===window.originalState),true);
    assert.equal(writes,0);
    await page.evaluate(()=>{state={persons:[],vacations:[],records:{}};renderDashboard();});
    assert.equal(await total('balance'),'0');assert.equal(await total('entries'),'0');assert.equal(await total('exits'),'0');
    assert.match(await panel.textContent(),/Sem equipas registadas/);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({entries:19,exits:9,annualBalance:10,teamFilter:'passed',negativeBalance:'passed',unassignedTeam:'passed',managerPhotos:true,mobile320:true,mobile390:true,darkTheme:true,emptyState:true,stateUnchanged:true,serverWrites:writes,pageErrors:errors},null,2));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
