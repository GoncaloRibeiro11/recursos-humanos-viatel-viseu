const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../public');
const originalHtml = fs.readFileSync(path.join(root, 'mapa-recursos-humanos.html'), 'utf8');
const html = originalHtml.replace(/^initSupabaseApp\(\);\r?$/m, 'window.photoTestReady = true;');

const server = http.createServer((req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (file === 'test.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(html);
  }
  const target = path.resolve(root, file);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(target, (error, contents) => {
    if (error) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
    res.end(contents);
  });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel:'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
    page.on('console', message => { if (message.type() === 'error') console.log('BROWSER:', message.text()); });
    await page.route('**/supabase-js**', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/test.html`);
    await page.waitForFunction(() => window.photoTestReady);
    const regression = await page.evaluate(async () => {
      const source = document.createElement('canvas');
      source.width = 300; source.height = 450;
      const ctx = source.getContext('2d');
      ctx.fillStyle = '#e8ab7c'; ctx.fillRect(80, 50, 140, 120);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(40, 170, 220, 280);
      const file = await canvasToBlob(source);
      const photos = await buildPersonPhoto(file);
      const cutout = await loadImageFromUrl(photos.photoCutout);
      const avatar = await loadImageFromUrl(photos.photo);
      const results = { cutoutTransparent: hasPhotoTransparency(cutout), avatarTransparent: hasPhotoTransparency(avatar) };
      state = { persons: [normalizePerson({ id:'test', name:'Colaborador Teste', role:'vendedor', ...photos })], vacations: [], records: { 'test|2026-09-21':'P' } };
      requireAdminAction = () => true;
      let calls = [];
      supabaseReady = true;
      supabaseClient = { from(table){
        calls.push(table);
        return {
          select(){
            return { eq(){
              return { async single(){
                return { data:{ data:{ name:'Nome no servidor', telefone:'912345678' } } };
              } };
            } };
          },
          update(updates){ calls.push(updates); return { async eq(){ return {}; } }; }
        };
      } };
      await persistPersonPhoto(state.persons[0], photos);
      results.tables = calls.filter(call => typeof call === 'string');
      results.currentFieldsPreserved = calls.find(call => typeof call === 'object').data.telefone === '912345678';
      results.attendancePreserved = state.records['test|2026-09-21'] === 'P';
      await drawIdCardCanvas(state.persons[0]);
      const pixel = document.getElementById('idCardCanvas').getContext('2d').getImageData(610, 40, 1, 1).data;
      results.cardBackground = Array.from(pixel);
      const before = state.persons[0].photo;
      const build = buildPersonPhoto;
      buildPersonPhoto = async () => { throw new Error('Test: removal unavailable'); };
      window.alert = () => {};
      await setPhotoFromFile(file, 'test');
      results.failureKeepsPhoto = state.persons[0].photo === before;
      results.failureShown = document.getElementById('photoProcessStatus').textContent.includes('foto anterior');
      buildPersonPhoto = build;
      currentProfile = { role:'admin' };
      document.body.classList.add('authenticated');
      document.getElementById('authOverlay').style.display = 'none';
      document.getElementById('idCardModal').classList.add('open');
      syncIdCardPhotoControls(state.persons[0]);
      return results;
    });
    assert.equal(regression.cutoutTransparent, true);
    assert.equal(regression.avatarTransparent, false);
    assert.deepEqual(regression.tables, ['rh_persons', 'rh_persons']);
    assert.equal(regression.currentFieldsPreserved, true);
    assert.equal(regression.attendancePreserved, true);
    assert.deepEqual(regression.cardBackground, [8, 43, 131, 255]);
    assert.equal(regression.failureKeepsPhoto, true);
    assert.equal(regression.failureShown, true);
    await page.screenshot({ path: path.join(root, '../../../../recovery/photo-card-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(root, '../../../../recovery/photo-card-mobile.png') });
    console.log(JSON.stringify({ regression }, null, 2));

    page.on('console', message => { if (message.type() === 'error') console.log('BROWSER:', message.text()); });
    const inference = await page.evaluate(async () => {
      const input = await (await fetch('maria-peixoto-foto-cartao.jpg')).blob();
      const start = performance.now();
      const output = await removeImageBackground(input);
      const image = await loadImageFromFile(output);
      const person = state.persons[0];
      person.photoOriginal = resizePhotoDataUrl(await loadImageFromFile(input), 'image/jpeg');
      person.photoCutout = cropPhotoCutout(image);
      person.photo = await composeBlueAvatarFromImage(image, true);
      person.name = 'Foto de teste';
      setPhotoProcessStatus('Fundo removido.');
      await drawIdCardCanvas(person);
      return { format:output.type, transparent:hasPhotoTransparency(image), ms:Math.round(performance.now()-start), width:image.width, height:image.height };
    });
    assert.equal(inference.format, 'image/png');
    assert.equal(inference.transparent, true);
    console.log(JSON.stringify({ inference }, null, 2));
    await page.setViewportSize({ width:1280, height:900 });
    await page.screenshot({ path:path.join(root, '../../../../recovery/photo-card-inference.png') });
    await page.setViewportSize({ width:390, height:844 });
    await page.screenshot({ path:path.join(root, '../../../../recovery/photo-card-inference-mobile.png') });
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
