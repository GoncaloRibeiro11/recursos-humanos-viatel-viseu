const fs=require('node:fs/promises');
const {renderFleetPdf,asset}=require('../lib/fleet-pdf.cjs');
const DEFAULT_URL='https://vfmncuejbfcwrzrqzqnr.supabase.co';
const DEFAULT_ANON='sb_publishable_QJM8W5vPsJOICxqw_FEUXA_suAywMLM';
const fail=(message,status=503)=>Object.assign(new Error(message),{status});
function createFleetApi({env=process.env,fetcher=fetch,render=renderFleetPdf}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try{
      require('../lib/preview-env.cjs').assertSafePreview(env);
      if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');throw fail('Método não permitido.',405);}
      const token=String(req.headers.authorization || '');if(!/^Bearer \S+$/.test(token))throw fail('Inicia sessão no RH.',401);
      const url=(env.SUPABASE_URL || DEFAULT_URL).replace(/\/$/,''),headers={apikey:env.SUPABASE_ANON_KEY || DEFAULT_ANON,Authorization:token};
      const call=async(route,options={})=>{
        let response;try{response=await fetcher(url+route,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(20000)});}catch{throw fail('Não foi possível contactar o servidor.');}
        return response;
      };
      const user=await call('/auth/v1/user');if(!user.ok)throw fail('Sessão inválida.',401);
      const identity=await user.json();if(!identity.id)throw fail('Sessão inválida.',401);
      const profile=await call('/rest/v1/user_profiles?user_id=eq.'+encodeURIComponent(identity.id)+'&select=role');
      if(!profile.ok || !(await profile.json()).some(value=>value.role==='admin'))throw fail('Apenas o administrador pode consultar os autos.',403);
      if(req.method==='GET' && req.query?.diagram==='1'){
        res.statusCode=200;res.setHeader('Content-Type','image/png');return res.end(await fs.readFile(asset('modri-94-01-page2.png')));
      }
      if(req.method==='GET' && req.query?.template==='1'){
        res.statusCode=200;res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="modelo-auto-viaturas.pdf"');return res.end(await fs.readFile(asset('modri-94-01-v1.pdf')));
      }
      let body=req.body;
      if(!body){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>2048)throw fail('Pedido demasiado grande.',413);}try{body=JSON.parse(text);}catch{throw fail('Pedido inválido.',400);}}
      if(typeof body==='string'){try{body=JSON.parse(body);}catch{throw fail('Pedido inválido.',400);}}
      if(!/^[a-f0-9-]{36}$/i.test(body?.id || ''))throw fail('Auto inválido.',400);
      const result=await call('/rest/v1/rh_fleet_handovers?id=eq.'+encodeURIComponent(body.id)+'&select=*');
      if(!result.ok)throw fail('Não foi possível carregar o auto.');
      const row=(await result.json())[0];if(!row || row.status==='cancelled')throw fail('Auto não encontrado.',404);
      let document;
      const objectPath=encodeURIComponent(row.id+'/auto-v1.pdf');
      if(row.status==='confirmed'){
        const cached=await call('/storage/v1/object/authenticated/rh-fleet/'+objectPath);
        if(cached.ok)document=Buffer.from(await cached.arrayBuffer());
        else if(![400,404].includes(cached.status))throw fail('Não foi possível consultar o arquivo do auto.');
      }else{
        const vehicle=await call('/rest/v1/rh_fleet_vehicles?id=eq.'+row.vehicle_id+'&select=*');if(!vehicle.ok)throw fail('Viatura indisponível.');
        const v=(await vehicle.json())[0];if(!v)throw fail('Viatura não encontrada.',404);
        const custody=await call('/rest/v1/rh_fleet_custody?vehicle_id=eq.'+row.vehicle_id+'&to_at=is.null&select=*');if(!custody.ok)throw fail('Histórico indisponível.');
        const holder=(await custody.json())[0];
        const persons=await call('/rest/v1/rh_persons?select=id,name,data');if(!persons.ok)throw fail('Colaboradores indisponíveis.');
        const all=await persons.json();
        const person=id=>{const p=all.find(p=>p.id===id);return {id,name:p?.name || 'Empresa / parque',phone:p?.data?.telefone || p?.data?.phone || '',number:p?.data?.numero || ''};};
        row.snapshot={template_version:1,vehicle:v,from_person:person(holder?.person_id),to_person:person(row.data.to_person_id),operation:row.data,captured_at:row.created_at};
      }
      if(!document){
        document=await render(row);
        if(row.status==='confirmed'){
          const uploaded=await call('/storage/v1/object/rh-fleet/'+objectPath,{method:'POST',headers:{'Content-Type':'application/pdf','Cache-Control':'no-store'},body:document});
          if(!uploaded.ok){
            const existing=await call('/storage/v1/object/authenticated/rh-fleet/'+objectPath);
            if(!existing.ok)throw fail('A entrega ficou confirmada, mas o PDF ainda não foi arquivado. Volta a carregar em Auto PDF.');
            document=Buffer.from(await existing.arrayBuffer());
          }
        }
      }
      res.statusCode=200;res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${row.status==='draft'?'rascunho-':''}auto-${row.number}.pdf"`);res.end(document);
    }catch(error){res.statusCode=error.status || 503;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({error:error.status?error.message:'Não foi possível gerar o auto. Tenta novamente.'}));}
  };
}
module.exports=createFleetApi();module.exports.createFleetApi=createFleetApi;
