const {createHash}=require('node:crypto');
const fail=message=>Object.assign(new Error(message),{status:503});
const photoName=name=>typeof name==='string' && name.length<=250 && !/[\\/\u0000-\u001f]/.test(name) && /\.(jpe?g|png|webp)$/i.test(name);
async function loadFleetPhotos(request,id,paths){
  let files=[];
  if(paths!==undefined){
    if(!Array.isArray(paths))throw fail('Lista de fotografias inválida.');
    files=paths.map(key=>{
      if(typeof key!=='string' || !key.startsWith(id+'/') || !photoName(key.slice(id.length+1)))throw fail('Fotografia fora deste auto.');
      return {name:key.slice(id.length+1)};
    });
  }else{
    for(let offset=0;;offset+=100){
      const response=await request('/storage/v1/object/list/rh-fleet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefix:id,limit:100,offset,sortBy:{column:'name',order:'asc'}})});
      if(!response.ok)throw fail('Não foi possível consultar as fotografias do auto.');
      const rows=await response.json();if(!Array.isArray(rows))throw fail('Lista de fotografias inválida.');
      files.push(...rows.filter(row=>photoName(row.name)));
      if(files.length>100 || offset>=1000)throw fail('Há demasiados anexos neste auto para gerar o PDF.');
      if(rows.length<100)break;
    }
  }
  if(files.length>100)throw fail('O PDF suporta até 100 fotografias por auto.');
  const photos=[];let total=0;
  for(const file of files){
    const response=await request('/storage/v1/object/authenticated/rh-fleet/'+encodeURIComponent(id+'/'+file.name));
    if(!response.ok)throw fail('Não foi possível carregar a fotografia '+file.name+'. Nenhuma fotografia foi omitida do PDF.');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;total+=chunk.length;if(size>10*1024*1024 || total>80*1024*1024)throw fail('As fotografias excedem o tamanho suportado pelo PDF.');chunks.push(chunk);}
    if(!size)throw fail('A fotografia '+file.name+' está vazia.');
    photos.push({name:file.name,created_at:file.created_at || null,bytes:Buffer.concat(chunks)});
  }
  return photos;
}
function photoArchivePath(id,document,photos){
  const hash=createHash('sha256').update('fleet-photo-annex-v1').update(document);
  for(const photo of photos)hash.update(JSON.stringify([photo.name,photo.created_at])).update(photo.bytes);
  return id+'/auto-fotos-v1-'+hash.digest('hex')+'.pdf';
}
module.exports={loadFleetPhotos,photoArchivePath};
