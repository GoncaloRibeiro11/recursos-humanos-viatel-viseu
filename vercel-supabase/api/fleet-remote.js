const {createFleetShares,body,reply}=require('../lib/fleet-shares.cjs');
module.exports=async(req,res)=>{
  if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(res,405,{error:'Método não permitido.'});}
  try{const result=await createFleetShares().remote(await body(req));return reply(res,200,result.binary || result,result.type);}
  catch(error){return reply(res,error.status || 503,{error:error.status?error.message:'Não foi possível concluir o pedido. Volta a abrir a ligação.'});}
};
