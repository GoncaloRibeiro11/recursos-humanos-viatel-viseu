import {discoverFiles,prepareFiles} from './commission-excel.mjs';
self.onmessage=async({data})=>{
 try{
  if(data.action==='discover')self.postMessage({result:discoverFiles(data.files).map(g=>({period:g.period,pay:g.pay.map(f=>f.name),detail:g.detail.map(f=>f.name),error:g.error}))});
  else self.postMessage({result:await prepareFiles(data.files,data.periods,data.knownNifs,data.coordinator,message=>self.postMessage({progress:message}),data.aliases)});
 }catch(error){self.postMessage({error:error.message||'Não foi possível ler os mapas Excel.'});}
};
