module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try { require('../lib/preview-env.cjs').assertSafePreview(); }
  catch(error){res.statusCode=503;return res.end(JSON.stringify({error:error.message}));}
  res.end(JSON.stringify({
    supabaseUrl: process.env.SUPABASE_URL || 'https://vfmncuejbfcwrzrqzqnr.supabase.co',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'sb_publishable_QJM8W5vPsJOICxqw_FEUXA_suAywMLM'
  }));
};
