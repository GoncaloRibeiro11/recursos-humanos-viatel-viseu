const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 8080);
const host = '0.0.0.0';
const dataFile = path.join(root, 'mapa-coordenacao-2026.json');
const maxBodyBytes = 60 * 1024 * 1024;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function send(res, status, body, type = 'text/plain; charset=utf-8'){
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function safePath(urlPath){
  let pathname = decodeURIComponent(urlPath.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(root, pathname));
  if (!file.toLowerCase().startsWith(root.toLowerCase())) return null;
  return file;
}

function stamp(){
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function saveData(req, res){
  let size = 0;
  const chunks = [];
  req.on('data', chunk => {
    size += chunk.length;
    if (size > maxBodyBytes){
      send(res, 413, JSON.stringify({ ok: false, error: 'Ficheiro demasiado grande.' }), 'application/json; charset=utf-8');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.persons)){
        send(res, 400, JSON.stringify({ ok: false, error: 'Dados invalidos.' }), 'application/json; charset=utf-8');
        return;
      }
      if (fs.existsSync(dataFile)){
        const backup = path.join(root, `mapa-coordenacao-2026.backup-${stamp()}.json`);
        fs.copyFileSync(dataFile, backup);
      }
      const tmp = `${dataFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, dataFile);
      send(res, 200, JSON.stringify({
        ok: true,
        persons: data.persons.length,
        vacations: Array.isArray(data.vacations) ? data.vacations.length : 0,
        records: data.records ? Object.keys(data.records).length : 0,
      }), 'application/json; charset=utf-8');
    } catch (error){
      send(res, 500, JSON.stringify({ ok: false, error: error.message }), 'application/json; charset=utf-8');
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/save-data'){
    saveData(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD'){
    send(res, 405, 'Method not allowed');
    return;
  }

  const file = safePath(req.url);
  if (!file){
    send(res, 403, 'Forbidden');
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error){
      send(res, 404, 'Not found');
      return;
    }
    const type = contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') res.end();
    else res.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`Mapa de Recursos Humanos: http://localhost:${port}/`);
  console.log(`Na rede: http://IP-DO-PC:${port}/`);
});
