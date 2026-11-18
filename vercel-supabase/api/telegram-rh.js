const {createTelegramService,send,body}=require('../lib/rh-telegram.cjs');
module.exports=async function handler(req,res){
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return send(res,405,{error:'Método não permitido.'});}
  try{
    require('../lib/preview-env.cjs').assertSafePreview(process.env,{notifications:true});
    const service=createTelegramService(),adminId=await service.admin(req);
    return send(res,200,req.method==='GET'?await service.status():await service.action((await body(req)).action,adminId));
  }catch(error){return send(res,error.status || 503,{error:error.message || 'Serviço Telegram indisponível.'});}
};
