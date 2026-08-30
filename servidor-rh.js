const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 8080);
// Seguro por defeito: para expor na LAN e obrigatorio definir HOST=0.0.0.0 e RH_PASSWORD.
const host = process.env.HOST || '127.0.0.1';
const authUser = process.env.RH_USER || 'rh';
const authPassword = process.env.RH_PASSWORD || '';
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
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(body);
}

function isAuthorized(req){
  if (!authPassword && (host === '127.0.0.1' || host === 'localhost' || host === '::1')) return true;
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return false;
    const user = Buffer.from(decoded.slice(0, separator));
    const password = Buffer.from(decoded.slice(separator + 1));
    const expectedUser = Buffer.from(authUser);
    const expectedPassword = Buffer.from(authPassword);
    return user.length === expectedUser.length && password.length === expectedPassword.length
      && require('crypto').timingSafeEqual(user, expectedUser)
      && require('crypto').timingSafeEqual(password, expectedPassword);
  } catch (error){
    return false;
  }
}

function safePath(urlPath){
  try {
    let pathname = decodeURIComponent(urlPath.split('?')[0]);
    if (pathname === '/') pathname = '/index.html';
    const file = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return file;
  } catch (error){
    return null;
  }
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
  if (!isAuthorized(req)){
    res.setHeader('WWW-Authenticate', 'Basic realm="Mapa Recursos Humanos"');
    send(res, 401, 'Autenticacao necessaria.');
    return;
  }
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
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    });
    if (req.method === 'HEAD') res.end();
    else res.end(data);
  });
});

if (!authPassword && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
  throw new Error('RH_PASSWORD e obrigatoria quando o servidor e exposto na rede.');
}

server.listen(port, host, () => {
  console.log(`Mapa de Recursos Humanos: http://localhost:${port}/`);
  console.log(`Na rede: http://IP-DO-PC:${port}/`);
});
