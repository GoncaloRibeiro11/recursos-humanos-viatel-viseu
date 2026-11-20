import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PDFDocument,PDFName}=require('pdf-lib');
const {createCanvas}=require('@napi-rs/canvas');
const {renderFleetPdf,appendFleetPhotos,compressPhotoForPdf}=require('../lib/fleet-pdf.cjs');
const {loadFleetPhotos,photoArchivePath}=require('../lib/fleet-photos.cjs');
const {createFleetApi}=require('../api/fleet-auto.js');
const {createFleetShares}=require('../lib/fleet-shares.cjs');
const id='10000000-0000-4000-8000-000000000001';
const handover={id,number:24,status:'confirmed',confirmed_at:'2026-11-20T09:00:00Z',snapshot:{template_version:1,vehicle:{plate:'AB-12-CD'},from_person:{name:'Entrega Teste'},to_person:{name:'Recebe Teste'},operation:{kind:'return',at:'2026-11-20T09:00:00Z',signatures:{},inspection:{},notes:'EXEMPLO FICTÍCIO'}}};
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.value=value;}});
test('conversor automatico reduz fotos grandes e mantem todas no PDF abaixo de 4 MB',async()=>{
 const c=createCanvas(1600,1200),ctx=c.getContext('2d'),pixels=ctx.createImageData(1600,1200);let seed=13579;
 for(let i=0;i<pixels.data.length;i+=4){for(let k=0;k<3;k++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i+k]=seed>>>24;}pixels.data[i+3]=255;}ctx.putImageData(pixels,0,0);
 const bytes=c.toBuffer('image/jpeg',95),photos=Array.from({length:8},(_,i)=>({name:'foto-grande-'+i+'.jpg',bytes})),before=Buffer.from(bytes);
 const converted=await compressPhotoForPdf(photos[0],180000);assert.ok(converted.length<=180000);
 const {imageSize}=require('image-size'),size=imageSize(converted);assert.ok(Math.abs(size.width/size.height-4/3)<.01);
 assert.ok(bytes.length*photos.length>4*1024*1024);
 const base=await renderFleetPdf(handover),final=await appendFleetPhotos(base,handover,photos),pdf=await PDFDocument.load(final);
 assert.ok(final.length<=4*1024*1024);assert.equal(pdf.getPageCount(),6);assert.deepEqual(bytes,before);
 for(const page of pdf.getPages().slice(2))assert.equal(page.node.Resources().lookup(PDFName.of('XObject')).entries().length,2);
});
function picture(name,width=600,height=400,type='image/jpeg'){
 const c=createCanvas(width,height),ctx=c.getContext('2d');ctx.fillStyle='#e8f1f5';ctx.fillRect(0,0,width,height);ctx.fillStyle='#006a94';ctx.fillRect(width*.1,height*.2,width*.8,height*.55);ctx.fillStyle='#273743';ctx.fillRect(width*.15,height*.7,width*.15,height*.15);ctx.fillRect(width*.7,height*.7,width*.15,height*.15);
 return {name,created_at:'2026-11-20T08:50:00Z',bytes:c.toBuffer(type)};
}
test('anexo inclui todas as fotos em duas por pagina, sem cortar retratos nem paisagens',async()=>{
 const base=await renderFleetPdf(handover),photos=[picture('frente.jpg'),picture('lateral.png',400,800,'image/png'),picture('traseira.webp',800,400,'image/webp')];
 const final=await appendFleetPhotos(base,handover,photos),pdf=await PDFDocument.load(final),original=await PDFDocument.load(base);
 assert.equal(pdf.getPageCount(),original.getPageCount()+2);assert.equal(pdf.getTitle(),original.getTitle());
 assert.equal(pdf.getPage(pdf.getPageCount()-2).node.Resources().lookup(PDFName.of('XObject')).entries().length,2);
 assert.equal(pdf.getPage(pdf.getPageCount()-1).node.Resources().lookup(PDFName.of('XObject')).entries().length,1);
 assert.equal(await appendFleetPhotos(base,handover,[]),base);
 await assert.rejects(appendFleetPhotos(base,handover,[{name:'broken.jpg',bytes:Buffer.from('bad')}]),/broken.jpg/);
 await assert.rejects(appendFleetPhotos(base,handover,[{name:'fake.jpg',bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>')}]),/fake.jpg/);
});
test('carrega fotos privadas com paginacao e nao inclui PDFs nem outros autos',async()=>{
 const photo=picture('viatura.jpg'),calls=[];
 const list=Array.from({length:99},(_,i)=>({name:'documento-'+i+'.pdf'}));list.push({name:'primeira.jpg'});
 const photos=await loadFleetPhotos(async(route,options)=>{
  calls.push({route,options});if(route.endsWith('/list/rh-fleet')){const q=JSON.parse(options.body);assert.equal(q.prefix,id);return Response.json(q.offset===0?list:[{name:'segunda.jpg'}]);}
  assert.ok([id+'/primeira.jpg',id+'/segunda.jpg'].some(name=>route.endsWith(encodeURIComponent(name))));return new Response(photo.bytes);
 },id);
 assert.deepEqual(photos.map(p=>p.name),['primeira.jpg','segunda.jpg']);assert.equal(calls.length,4);
 await assert.rejects(loadFleetPhotos(()=>{throw new Error('must not fetch');},id,['other/secret.jpg']),/fora deste auto/);
 await assert.rejects(loadFleetPhotos(()=>{throw new Error('must not fetch');},id,[id+'/../secret.jpg']),/fora deste auto/);
 await assert.rejects(loadFleetPhotos(async()=>new Response('',{status:404}),id,[id+'/missing.jpg']),/Nenhuma fotografia foi omitida/);
});
test('auto ja arquivado recebe fotos sem substituir original; repetir reutiliza anexo e fotos novas criam outra versao',async()=>{
 const base=await renderFleetPdf(handover),files=[picture('primeira.jpg')],objects=new Map([[id+'/auto-v1.pdf',base]]),uploads=[];
 let renders=0;
 const api=createFleetApi({env:{},render:()=>{renders++;throw new Error('must preserve original');},fetcher:async(url,options={})=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'admin'});
  if(url.includes('/user_profiles?'))return Response.json([{role:'admin'}]);
  if(url.includes('/rh_fleet_handovers?'))return Response.json([handover]);
  if(url.endsWith('/list/rh-fleet'))return Response.json(files.map(({name,created_at})=>({name,created_at})));
  const key=decodeURIComponent(url.split('/rh-fleet/')[1]);
  if(options.method==='POST'){assert.equal(options.headers['x-upsert'],undefined);assert.ok(!objects.has(key));uploads.push(key);objects.set(key,Buffer.from(options.body));return Response.json({});}
  const photo=files.find(file=>key===id+'/'+file.name),bytes=objects.get(key) || photo?.bytes;return bytes?new Response(bytes):new Response('',{status:404});
 }});
 const req={method:'POST',headers:{authorization:'Bearer admin-session'},body:{id}};
 const first=response();await api(req,first);assert.equal(first.statusCode,200);assert.equal((await PDFDocument.load(first.value)).getPageCount(),3);
 const second=response();await api(req,second);assert.deepEqual(second.value,first.value);assert.equal(uploads.length,1);
 files.push({...picture('segunda.png',400,800,'image/png'),created_at:'2026-11-20T10:00:00Z'});
 const third=response();await api(req,third);assert.equal(third.statusCode,200);assert.equal(uploads.length,2);assert.notEqual(uploads[0],uploads[1]);assert.deepEqual(objects.get(id+'/auto-v1.pdf'),base);assert.equal(renders,0);
 assert.ok(uploads.every(name=>name.startsWith(id+'/auto-fotos-v1-')));assert.equal(objects.size,3);
 assert.notEqual(photoArchivePath(id,base,files),photoArchivePath(id,base,files.slice(0,1)));
});
test('PDF remoto inclui apenas fotos do conteudo autorizado pelo token, sem aceitar id ou nomes do pedido',async()=>{
 const photo=picture('permitida.jpg'),calls=[];
 const service=createFleetShares({env:{SUPABASE_SERVICE_ROLE_KEY:'test-only'},fetcher:async(url,options={})=>{
  calls.push(url);
  if(url.endsWith('/rh_fleet_read_share'))return Response.json({status:'open',purpose:'from',number:24,handover:{id,data:{}},payload:{...handover.snapshot,photos:[id+'/permitida.jpg']}});
  assert.ok(url.endsWith(encodeURIComponent(id+'/permitida.jpg')));return new Response(photo.bytes);
 }});
 const result=await service.remote({action:'pdf',token:'x'.repeat(43),id:'other-auto',photos:['private/secret.jpg']});
 assert.equal((await PDFDocument.load(result.binary)).getPageCount(),3);assert.equal(calls.length,2);assert.ok(!calls.some(route=>route.includes('secret')));
});
