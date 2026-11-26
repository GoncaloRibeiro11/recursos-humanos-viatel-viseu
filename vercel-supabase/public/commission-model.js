(function(root){
 'use strict';
 function validateImport(data){
  if(data?.version!==1||!Array.isArray(data.rows)||!Array.isArray(data.identities))throw Error('Formato de importação inválido.');
  const keys=new Set(),ids=new Set();
  for(const i of data.identities){
   if(!/^\d{9}$/.test(i.nif)||!i.source_name||ids.has(i.nif))throw Error('Identidade inválida ou repetida.');
   ids.add(i.nif);
  }
  const fields=['records','productionVdd','productionChe','adjustments','checks'];
  for(const r of data.rows){
   const k=r.period+'|'+r.owner_nif,p=r.payload,owner='p'+r.owner_nif;
   if(!/^\d{4}-(0[1-9]|1[012])-01$/.test(r.period)||!ids.has(r.owner_nif)||!Number.isFinite(r.total)||keys.has(k))throw Error('Pagamento mensal inválido ou repetido.');
   keys.add(k);
   if(r.chief_nif!==null&&!ids.has(r.chief_nif))throw Error('Chefe de equipa sem identidade.');
   if(p?.people?.length!==1||p.people[0].id!==owner||p.people[0].total!==r.total)throw Error('O pagamento não corresponde à pessoa.');
   if(!Array.isArray(p.people[0].rubrics)||Math.abs(p.people[0].rubrics.reduce((s,x)=>s+x.amount,0)-r.total)>.005)throw Error('As rubricas não correspondem ao total.');
   for(const f of fields)if(!Array.isArray(p[f])||p[f].some(x=>x.owner!==owner))throw Error('O detalhe contém dados de outra pessoa.');
  }
  return data;
 }
 root.CommissionModel={validateImport};
 if(typeof module!=='undefined')module.exports=root.CommissionModel;
})(typeof window!=='undefined'?window:globalThis);
