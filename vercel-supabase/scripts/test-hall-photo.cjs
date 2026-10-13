const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../public');
const output = path.resolve(root, '../../../../recovery');
const headers = JSON.parse(fs.readFileSync(path.join(root, '../vercel.json'), 'utf8')).headers[0].headers;
const original = fs.readFileSync(path.join(root, 'mapa-recursos-humanos.html'), 'utf8');
const fixture = `
  function fixturePhoto(cutout){
    const canvas = document.createElement('canvas');
    canvas.width = cutout ? 900 : 320;
    canvas.height = cutout ? 1200 : 320;
    const ctx = canvas.getContext('2d');
    if (cutout){
      ctx.fillStyle = '#f4c6a1'; ctx.beginPath(); ctx.arc(450, 200, 155, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#cf234a'; ctx.fillRect(110, 370, 340, 830);
      ctx.fillStyle = '#353f49'; ctx.fillRect(450, 370, 340, 830);
    } else {
      ctx.fillStyle = '#2c9bd8'; ctx.fillRect(0, 0, 320, 320);
      ctx.fillStyle = '#cf234a'; ctx.fillRect(50, 80, 100, 240);
      ctx.fillStyle = '#353f49'; ctx.fillRect(150, 80, 100, 240);
    }
    return canvas.toDataURL('image/png');
  }
  state = { persons:[
    { id:'seller', name:'Teste Hall de Fama', role:'vendedor', ativo:true, color:'#0284c7', photo:fixturePhoto(false), photoCutout:fixturePhoto(true), photoMirror:true },
    { id:'legacy', name:'Foto antiga', role:'vendedor', ativo:true, color:'#0284c7', photo:fixturePhoto(false) },
    { id:'empty', name:'Sem foto', role:'vendedor', ativo:true, color:'#0284c7' },
    { id:'leader', name:'Gestor de equipa', role:'chefe_equipa', ativo:true, color:'#0284c7', photo:fixturePhoto(false) },
    { id:'broken', name:'Foto indisponivel', role:'vendedor', ativo:true, color:'#0284c7', photo:'data:image/png;base64,aW52YWxpZA==' }
  ], vacations:[{ id:'vac-test', personId:'seller', start:'2026-12-01', end:'2026-12-02' }], records:{ 'seller|2026-10-12':'P' } };
  currentProfile = { role:'admin', display_name:'Teste', person_id:'seller' };
  window.testInitialState = JSON.stringify(state);
  Object.defineProperty(window, 'testState', { get:() => state });
  document.body.classList.add('authenticated');
  document.getElementById('authOverlay').classList.remove('open');
  window.printCalls = 0;
  window.print = () => { window.printCalls++; };
  renderAll();
`;
assert.match(original, /^initSupabaseApp\(\);\r?$/m);
const html = original.replace(/^initSupabaseApp\(\);\r?$/m, fixture);
let writes = 0;
const server = http.createServer((req, res) => {
  for (const header of headers) res.setHeader(header.key, header.value);
  if (req.method !== 'GET'){ writes++; res.writeHead(405); return res.end(); }
  const file = new URL(req.url, 'http://localhost').pathname;
  if (file === '/test.html'){ res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
  const target = path.resolve(root, file.slice(1));
  if (!target.startsWith(root + path.sep)){ res.writeHead(403); return res.end(); }
  fs.readFile(target, (error, data) => {
    if (error){ res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.webp') ? 'image/webp' : 'application/octet-stream');
    res.end(data);
  });
});

(async () => {
  fs.mkdirSync(output, { recursive:true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true, channel:'chrome' });
  try {
    const page = await browser.newPage({ viewport:{ width:1440, height:900 }, acceptDownloads:true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/supabase-js**', route => route.fulfill({ body:'window.supabase={};', contentType:'application/javascript' }));
    await page.goto(`http://127.0.0.1:${server.address().port}/test.html`);
    await page.waitForFunction(() => document.body.classList.contains('authenticated'));
    assert.equal(await page.locator('#viewRH .hall-photo-action').count(), 4);
    assert.equal(await page.locator('.hall-photo-action[onclick*="empty"]').isDisabled(), true);
    assert.equal(await page.locator('.hall-photo-action[onclick*="leader"]').count(), 0);
    await page.locator('.hall-photo-action[onclick*="seller"]').click();
    await page.waitForFunction(() => !document.getElementById('hallPhotoDownload').disabled);
    const pixels = await page.evaluate(() => {
      const canvas = document.getElementById('hallPhotoCanvas');
      const ctx = canvas.getContext('2d');
      return { size:[canvas.width, canvas.height], background:Array.from(ctx.getImageData(0,0,1,1).data), left:Array.from(ctx.getImageData(300,600,1,1).data), right:Array.from(ctx.getImageData(800,600,1,1).data) };
    });
    assert.deepEqual(pixels.size, [1181,1181]);
    assert.deepEqual(pixels.background, [44,155,216,255]);
    assert.equal(pixels.left[0] < 100, true);
    assert.equal(pixels.right[0] > 150 && pixels.right[1] < 100, true);
    await page.screenshot({ path:path.join(output, 'hall-photo-desktop.png') });
    await page.evaluate(() => setThemePreference('dark'));
    await page.screenshot({ path:path.join(output, 'hall-photo-dark.png') });
    await page.evaluate(() => setThemePreference('light'));
    await page.setViewportSize({ width:390, height:844 });
    await page.screenshot({ path:path.join(output, 'hall-photo-mobile.png') });
    const modal = await page.locator('.hall-photo-modal').boundingBox();
    assert.equal(modal.x >= 0 && modal.x + modal.width <= 390, true);
    assert.equal(await page.locator('#hallPhotoDownload').isVisible(), true);
    await page.setViewportSize({ width:320, height:568 });
    await page.locator('#hallPhotoDownload').scrollIntoViewIfNeeded();
    const smallButton = await page.locator('#hallPhotoDownload').boundingBox();
    await page.screenshot({ path:path.join(output, 'hall-photo-small-mobile.png') });
    assert.ok(smallButton.y >= 0 && smallButton.y + smallButton.height <= 569);
    await page.setViewportSize({ width:390, height:844 });
    const beforeZoom = await page.evaluate(() => document.getElementById('hallPhotoCanvas').toDataURL());
    await page.locator('#hallPhotoZoom').fill('125');
    await page.locator('#hallPhotoZoom').dispatchEvent('input');
    assert.notEqual(await page.evaluate(() => document.getElementById('hallPhotoCanvas').toDataURL()), beforeZoom);
    await page.locator('#hallPhotoHeight').fill('5');
    await page.locator('#hallPhotoHeight').dispatchEvent('input');
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#hallPhotoDownload').click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), 'hall-of-fame-teste-hall-de-fama-10x10cm.jpg');
    const jpegFile = path.join(output, 'hall-photo-test-10x10cm.jpg');
    await download.saveAs(jpegFile);
    const jpeg = fs.readFileSync(jpegFile);
    const jfif = jpeg.indexOf(Buffer.from('JFIF\0'));
    assert.equal(jpeg[jfif + 7], 1);
    assert.equal(jpeg.readUInt16BE(jfif + 8), 300);
    assert.equal(jpeg.readUInt16BE(jfif + 10), 300);
    const decoded = await page.evaluate(async data => {
      const image = await loadImageFromUrl(data);
      return [image.width, image.height];
    }, 'data:image/jpeg;base64,' + jpeg.toString('base64'));
    assert.deepEqual(decoded, [1181,1181]);
    await page.locator('#hallPhotoPrint').click();
    await page.waitForFunction(() => window.printCalls === 1);
    await page.emulateMedia({ media:'print' });
    const print = await page.evaluate(() => {
      const image = document.querySelector('#hallPhotoPrintSheet img');
      return { width:image.getBoundingClientRect().width, height:image.getBoundingClientRect().height, visible:Array.from(document.body.children).filter(el => getComputedStyle(el).display !== 'none').map(el => el.id) };
    });
    assert.ok(Math.abs(print.width - 100 * 96 / 25.4) < .1);
    assert.ok(Math.abs(print.height - print.width) < .01);
    assert.deepEqual(print.visible, ['hallPhotoPrintSheet']);
    const pdf = await page.pdf({ path:path.join(output, 'hall-photo-test-print.pdf'), preferCSSPageSize:true, printBackground:true });
    const mediaBox = pdf.toString('latin1').match(/\/MediaBox\s*\[([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)\]/);
    assert.ok(mediaBox);
    assert.ok(Math.abs(Number(mediaBox[3]) - 100 * 72 / 25.4) < 1);
    assert.ok(Math.abs(Number(mediaBox[4]) - Number(mediaBox[3])) < .1);
    assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.evaluate(() => document.body.classList.contains('hall-photo-print')), false);
    assert.equal(await page.locator('#hallPhotoPageSize').count(), 0);
    await page.emulateMedia({ media:'screen' });
    await page.evaluate(() => closeModal('hallPhotoModal'));
    await page.evaluate(() => openIdCard('seller'));
    assert.equal(await page.locator('#idCardHallPhoto').isVisible(), true);
    await page.locator('#idCardHallPhoto').click();
    await page.waitForFunction(() => !document.getElementById('hallPhotoDownload').disabled);
    assert.equal(await page.locator('#hallPhotoZoom').inputValue(), '100');
    await page.evaluate(() => closeModal('hallPhotoModal'));
    await page.evaluate(() => closeModal('idCardModal'));
    await page.evaluate(() => openIdCard('leader'));
    assert.equal(await page.locator('#idCardHallPhoto').isVisible(), false);
    await page.evaluate(() => closeModal('idCardModal'));
    await page.evaluate(() => openHallPhoto('legacy'));
    await page.waitForFunction(() => !document.getElementById('hallPhotoDownload').disabled);
    await page.evaluate(() => closeModal('hallPhotoModal'));
    await page.evaluate(() => openHallPhoto('broken'));
    await page.waitForFunction(() => document.getElementById('hallPhotoStatus').classList.contains('error'));
    assert.equal(await page.locator('#hallPhotoDownload').isDisabled(), true);
    assert.equal(await page.locator('#hallPhotoCanvas').isVisible(), false);
    assert.equal(await page.evaluate(() => JSON.stringify(window.testState) === window.testInitialState), true);
    assert.equal(writes, 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ jpegPixels:decoded, jpegDpi:300, printedCentimetres:10, printPages:1, mirrorPreserved:true, mobile:'passed', legacyPhoto:'passed', missingPhoto:'disabled', invalidPhoto:'handled', stateUnchanged:true, serverWrites:writes, pageErrors:errors }, null, 2));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
