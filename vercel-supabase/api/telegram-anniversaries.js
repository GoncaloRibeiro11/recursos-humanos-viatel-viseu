const {createTelegramService,cronAuthorized,send}=require('../lib/rh-telegram.cjs');
module.exports=async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return send(res,405,{error:'Método não permitido.'});}
  if(!cronAuthorized(req,process.env)) return send(res,401,{error:'Não autorizado.'});
  try{
    const result=await createTelegramService().run();
    return send(res,result.failed || result.uncertain?503:200,result);
  }catch(error){return send(res,503,{error:error.message || 'Envio indisponível.'});}
};
