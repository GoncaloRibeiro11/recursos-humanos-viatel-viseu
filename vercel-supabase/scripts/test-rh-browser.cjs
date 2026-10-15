const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const testVacationSync = require('./test-vacation-sync.cjs');

const root = path.resolve(__dirname,'../public');
const headers = JSON.parse(fs.readFileSync(path.join(root,'../vercel.json'),'utf8')).headers[0].headers;
const person = { id:'test-person', name:'Teste de gravação', role_code:'vendedor', carga:'20h', ativo:true, entrada:'2020-01-01', data:{ id:'test-person', name:'Teste de gravação', color:'#0284c7', role:'vendedor', carga:'20h', ativo:true, entrada:'2020-01-01' } };
const database = {
  user_profiles:[{ user_id:'test-admin', role:'admin', person_id:'test-person', display_name:'Teste' }],
  rh_persons:[person],
  rh_vacations:[{ id:'vacation-test', person_id:'test-person', start_date:'2026-12-01', end_date:'2026-12-03', data:{} }],
  rh_attendance_records:Array.from({ length:1105 },(_,i) => ({ person_id:'test-person', record_date:new Date(Date.UTC(2020,0,i+1)).toISOString().slice(0,10), code:'P' }))
};
let paused = true;
const waiting = [];
const writes = [];

function MockClient(base,fetcher){
  this.auth = {
    getSession:async () => ({ data:{ session:{ access_token:'test-only' } } }),
    getUser:async () => ({ data:{ user:{ id:'test-admin' } } }),
    signOut:async () => ({})
  };
  this.from = table => {
    const query = { table, mode:'select', filters:[], ordering:[] };
    const execute = () => fetcher(base + '/test-query', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(query) }).then(response => response.json());
    const builder = {
      select(){ return builder; },
      eq(field,value){ query.filters.push([field,value]); return builder; },
      order(field){ query.ordering.push(field); return builder; },
      range(from,to){ query.range = [from,to]; return execute(); },
      single(){ query.single = true; return execute(); },
      maybeSingle(){ query.single = true; return execute(); },
      update(value){ query.mode = 'update'; query.value = value; return builder; },
      delete(){ query.mode = 'delete'; return builder; },
      upsert(value){ query.mode = 'upsert'; query.value = value; return builder; },
      then(resolve,reject){ return execute().then(resolve,reject); }
    };
    return builder;
  };
}

const sdk = `window.supabase={createClient:(url,key,config)=>new (${MockClient.toString()})(url,config.global.fetch)};`;
const original = fs.readFileSync(path.join(root,'mapa-recursos-humanos.html'),'utf8');
const html = original.replace(/^initSupabaseApp\(\);\r?$/m,"Object.defineProperty(window,'testState',{get:()=>state}); initSupabaseApp();");

const server = http.createServer(async (req,res) => {
  for (const header of headers) res.setHeader(header.key,header.value);
  const file = new URL(req.url,'http://localhost').pathname;
  if (file === '/api/config'){
    res.setHeader('Content-Type','application/json');
    return res.end(JSON.stringify({ supabaseUrl:`http://127.0.0.1:${server.address().port}`, supabaseAnonKey:'test-only' }));
  }
  if (file === '/test-query'){
    let body = ''; for await (const chunk of req) body += chunk;
    const query = JSON.parse(body);
    const matches = row => query.filters.every(([field,value]) => row[field] === value);
    let response;
    if (query.mode === 'select'){
      const rows = database[query.table].filter(matches).map(row => structuredClone(row));
      rows.sort((a,b) => { for (const field of query.ordering){ const result = String(a[field]).localeCompare(String(b[field])); if (result) return result; } return 0; });
      response = { data:query.single ? rows[0] || null : query.range ? rows.slice(query.range[0],query.range[1]+1) : rows, count:rows.length };
    } else {
      writes.push(query);
      if (paused) await new Promise(resolve => waiting.push(resolve));
      if (query.mode === 'delete') database[query.table] = database[query.table].filter(row => !matches(row));
      else if (query.mode === 'update') database[query.table].filter(matches).forEach(row => Object.assign(row,query.value));
      else {
        for (const row of Array.isArray(query.value) ? query.value : [query.value]){
          const current = database[query.table].find(value => query.table === 'rh_attendance_records'
            ? value.person_id === row.person_id && value.record_date === row.record_date : value.id === row.id);
          if (current) Object.assign(current,row);
          else database[query.table].push(row);
        }
      }
      response = {};
    }
    res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(response));
  }
  if (file === '/test.html') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(html); }
  const target = path.resolve(root,file.slice(1));
  if (!target.startsWith(root + path.sep)){ res.writeHead(403); return res.end(); }
  fs.readFile(target,(error,data) => {
    if (error){ res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type',file.endsWith('.js') ? 'application/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.webp') ? 'image/webp' : 'application/octet-stream');
    res.end(data);
  });
});

(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({ headless:true, channel:'chrome' });
  try {
    const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
    const pageErrors = []; page.on('pageerror',error => pageErrors.push(error.message));
    await page.route('**/supabase-js**',route => route.fulfill({ body:sdk, contentType:'application/javascript' }));
    await page.goto(`http://127.0.0.1:${server.address().port}/test.html`);
    await page.waitForFunction(() => document.body.classList.contains('authenticated'));
    assert.equal(await page.evaluate(() => Object.keys(window.testState.records).length),1105);
    await page.getByRole('button',{ name:'🗓️ Assiduidade', exact:true }).click();
    const selector = 'td.day-cell[onclick*="2026-10-12"]';
    await page.locator(selector).click();
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('rh-pending-v1:')).length),1);
    page.on('dialog',dialog => dialog.accept());
    await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('authenticated'));
    assert.equal(await page.evaluate(() => window.testState.records['test-person|2026-10-12']),'P');
    paused = false; waiting.splice(0).forEach(resolve => resolve());
    await page.waitForFunction(() => document.getElementById('syncStatus').textContent === 'Guardado');
    assert.equal(database.rh_attendance_records.length,1106);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('rh-pending-v1:')).length),0);
    await page.reload(); await page.waitForFunction(() => document.body.classList.contains('authenticated'));
    assert.equal(await page.evaluate(() => window.testState.records['test-person|2026-10-12']),'P');
    await page.getByRole('button',{ name:'🗓️ Assiduidade', exact:true }).click();
    await page.locator(selector).click();
    await page.waitForFunction(() => document.getElementById('syncStatus').textContent === 'Guardado');
    await page.reload(); await page.waitForFunction(() => document.body.classList.contains('authenticated'));
    assert.equal(await page.evaluate(() => window.testState.records['test-person|2026-10-12'] || ''),'');
    assert.equal(database.rh_attendance_records.length,1105);
    assert.equal(database.rh_vacations.length,1);
    assert.equal(writes.every(query => query.table === 'rh_attendance_records'),true);
    await testVacationSync(page, database, writes);
    assert.deepEqual(pageErrors,[]);
    await page.getByRole('button',{ name:'🗓️ Assiduidade', exact:true }).click();
    await page.screenshot({ path:path.resolve(root,'../../../../recovery/immediate-save-desktop.png') });
    await page.setViewportSize({ width:390, height:844 });
    await page.screenshot({ path:path.resolve(root,'../../../../recovery/immediate-save-mobile.png') });
    console.log(JSON.stringify({ loadedRecords:1105, reloadBeforeAcknowledgement:'preserved', reloadAfterAcknowledgement:'preserved', targetedCellClear:'passed', vacationsPreserved:true, pageErrors },null,2));
  } finally {
    paused = false; waiting.splice(0).forEach(resolve => resolve());
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); paused = false; waiting.splice(0).forEach(resolve => resolve()); server.close(); process.exitCode = 1; });
