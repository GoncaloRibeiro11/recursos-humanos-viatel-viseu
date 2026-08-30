const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vfmncuejbfcwrzrqzqnr.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_QJM8W5vPsJOICxqw_FEUXA_suAywMLM';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MAX_BODY_BYTES = 16 * 1024;
const MIN_PASSWORD_LENGTH = 12;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Pedido demasiado grande.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function supabaseFetch(path, options = {}, service = false) {
  const key = service ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch(e) { data = text; }
  if (!res.ok) {
    const error = new Error(typeof data === 'string' ? data : (data && data.message) || 'Erro Supabase');
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function getCaller(token) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) return null;
  return res.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Metodo nao permitido.' });
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return send(res, 500, { error: 'SUPABASE_SERVICE_ROLE_KEY nao configurada no Vercel.' });
  }
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return send(res, 401, { error: 'Sessao em falta.' });

    const caller = await getCaller(token);
    if (!caller || !caller.id) return send(res, 401, { error: 'Sessao invalida.' });

    const profiles = await supabaseFetch(
      `/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(caller.id)}&select=role`,
      { method: 'GET' },
      true
    );
    if (!profiles.some(profile => profile.role === 'admin')) {
      return send(res, 403, { error: 'Apenas admin pode criar acessos.' });
    }

    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const personId = String(body.personId || '').trim();
    const displayName = String(body.displayName || '').trim();
    const role = body.role === 'admin' ? 'admin' : 'gestor';

    if (!email || !password || !displayName || (role !== 'admin' && !personId)) {
      return send(res, 400, { error: 'Email, password, nome e colaborador sao obrigatorios.' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return send(res, 400, { error: `A password deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    }

    const created = await supabaseFetch('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName }
      })
    }, true);

    await supabaseFetch('/rest/v1/user_profiles?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: created.id,
        role,
        person_id: role === 'admin' ? null : personId,
        display_name: displayName
      })
    }, true);

    return send(res, 200, { ok: true, userId: created.id });
  } catch (error) {
    const message = error.status === 422
      ? 'Esse email ja existe no Supabase.'
      : error.message || 'Erro ao criar acesso.';
    return send(res, error.status || 500, { error: message });
  }
};
