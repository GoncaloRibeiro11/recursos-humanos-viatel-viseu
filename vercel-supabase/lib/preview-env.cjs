const PRODUCTION_PROJECT='vfmncuejbfcwrzrqzqnr.supabase.co';
function assertSafePreview(env=process.env,{notifications=false}={}){
  if(env.VERCEL_ENV!=='preview')return;
  const fail=()=>{throw Object.assign(new Error('Preview isolada: configura explicitamente uma base Supabase de testes; produção bloqueada.'),{status:503});};
  if(notifications)throw Object.assign(new Error('Notificações externas desativadas em Preview.'),{status:503});
  if(!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY)fail();
  let url;try{url=new URL(env.SUPABASE_URL);}catch{fail();}
  if(url.protocol!=='https:' || url.hostname===PRODUCTION_PROJECT || url.username || url.password || url.pathname!=='/' || url.search || url.hash)fail();
}
module.exports={assertSafePreview};
