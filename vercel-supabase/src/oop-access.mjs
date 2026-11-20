const validTeam=id=>typeof id==='string' && id.trim().length>0 && id.length<=180 && !/[\u0000-\u001f\u007f]/.test(id);
export function analysisLink(base,team){
  if(!validTeam(team))throw new Error('Equipa inválida.');
  const url=new URL(base);
  if(!['https:','http:'].includes(url.protocol) || url.username || url.password)throw new Error('Endereço inválido.');
  url.search='';url.hash='';url.searchParams.set('view','oop');url.searchParams.set('ce',team);
  return url.href;
}
export function analysisEntry(address){
  const url=new URL(address);
  if(url.searchParams.get('view')!=='oop')return null;
  const team=url.searchParams.get('ce');
  if(team && !validTeam(team))return null;
  return {team:team || null};
}
export function validateAnalysisEntry(entry,profile,teams=[]){
  if(!entry?.team)return null;
  if(profile?.role!=='admin' && (profile?.role!=='gestor' || profile.person_id!==entry.team))throw new Error('Esta ligação pertence a outra equipa. Entra com a conta do CE correspondente.');
  if(profile.role==='admin' && !teams.some(t=>t.id===entry.team))throw new Error('A equipa desta ligação já não está disponível.');
  return entry.team;
}
