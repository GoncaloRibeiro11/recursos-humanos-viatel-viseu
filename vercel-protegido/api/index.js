const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_USER = 'rh';
const AUTH_PASSWORD_SHA256 = '5e753dc8b68b74567c3899c426bfd623f38bea0d5a03b4a92404427455a65398';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function passwordHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function unauthorized(res) {
  res.setHeader('WWW-Authenticate', 'Basic realm="Mapa Recursos Humanos"');
  res.statusCode = 401;
  res.end('Autenticacao necessaria.');
}

function isAuthorized(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return user === AUTH_USER && passwordHash(password) === AUTH_PASSWORD_SHA256;
  } catch (error) {
    return false;
  }
}

module.exports = (req, res) => {
  if (!isAuthorized(req)) {
    unauthorized(res);
    return;
  }

  const url = new URL(req.url, 'https://local');
  const pathname = decodeURIComponent(url.pathname === '/' ? '/mapa-recursos-humanos.html' : url.pathname);

  if (req.method === 'POST' && pathname === '/api/save-data') {
    res.statusCode = 501;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      ok: false,
      error: 'Nesta versao Vercel simples os dados ficam apenas no navegador. A gravacao online sera feita no upgrade Supabase.'
    }));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end('Metodo nao permitido.');
    return;
  }

  const publicRoot = path.resolve(process.cwd(), 'public');
  const filePath = path.resolve(publicRoot, '.' + pathname);
  if (!filePath.startsWith(publicRoot + path.sep)) {
    res.statusCode = 403;
    res.end('Acesso negado.');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.statusCode = 404;
      res.end('Nao encontrado.');
      return;
    }
    res.setHeader('Content-Type', MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'HEAD') res.end();
    else res.end(data);
  });
};
