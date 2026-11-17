const {createFleetShares,body,reply}=require('../lib/fleet-shares.cjs');
module.exports=async(req,res)=>{
  if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(res,405,{error:'Método não permitido.'});}
  try{return reply(res,200,await createFleetShares().manage(req,await body(req,4096)));}
  catch(error){return reply(res,error.status || 503,{error:error.status?error.message:'Não foi possível gerir a ligação.'});}
};
