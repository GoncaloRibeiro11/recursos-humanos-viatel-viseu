import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createFleetShares,imageData,hash,safePatch}=require('../lib/fleet-shares.cjs');
const {createCanvas}=require('@napi-rs/canvas');
const id='10000000-0000-4000-8000-000000000002',token='a'.repeat(43),secret='server-only-test-key';
test('ligacoes opacas de 256 bits so guardam hash e exigem administrador',async()=>{
  const requests=[];
  const service=createFleetShares({env:{SUPABASE_SERVICE_ROLE_KEY:secret},fetcher:async(url,options)=>{
    const value=options.body?JSON.parse(options.body):null;requests.push({url,headers:options.headers,value});
    if(url.endsWith('/auth/v1/user'))return Response.json({id:'admin'});
    if(url.includes('/user_profiles?'))return Response.json([{role:'admin'}]);
    if(url.endsWith('/rh_fleet_prepare_share'))return Response.json({handover:{id,status:'draft'}});
    if(url.endsWith('/rh_fleet_create_share'))return Response.json({id:'share',purpose:value.p_purpose,expires_at:value.p_expires});
    if(url.endsWith('/rh_fleet_share_status'))return Response.json({handover:{id,status:'draft',version:2}});
    throw new Error('Unexpected request');
  }});
  await assert.rejects(service.manage({headers:{}},{action:'create',id,purpose:'editor'}),error=>error.status===401);
  const result=await service.manage({headers:{authorization:'Bearer administrator'}},{action:'create',id,purpose:'editor'});
  const raw=new URL(result.url).hash.slice(1);assert.match(raw,/^[A-Za-z0-9_-]{43}$/);
  const create=requests.find(value=>value.url.endsWith('/rh_fleet_create_share'));
  assert.equal(create.value.p_hash,hash(raw));assert.equal(JSON.stringify(create).includes(raw),false);
  assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(new URL(result.url).search,'');
  const denied=createFleetShares({env:{SUPABASE_SERVICE_ROLE_KEY:secret},fetcher:async url=>Response.json(url.endsWith('/auth/v1/user')?{id:'manager'}:[{role:'gestor'}])});
  await assert.rejects(denied.manage({headers:{authorization:'Bearer manager'}},{action:'create',id,purpose:'editor'}),error=>error.status===403);
});
test('assinaturas rejeitam imagens vazias, formatos falsos e dimensoes abusivas',async()=>{
  const canvas=createCanvas(900,360),ctx=canvas.getContext('2d');
  await assert.rejects(imageData(canvas.toDataURL('image/png'),true),/assinatura/);
  ctx.strokeStyle='#17212c';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(30,140);ctx.lineTo(100,70);ctx.lineTo(180,190);ctx.lineTo(290,90);ctx.stroke();
  const image=await imageData(canvas.toDataURL('image/png'),true);assert.match(image,/^data:image\/png;base64,/);
  const photo=await imageData(canvas.toDataURL('image/png'));assert.equal(photo[0],255);assert.equal(photo[1],216);
  await assert.rejects(imageData('data:image/png;base64,'+Buffer.from('not-a-png').toString('base64'),true),/Formato/);
  const excessive=createCanvas(1400,20).toDataURL('image/png');await assert.rejects(imageData(excessive,true),/Dimensões/);
});
test('pedido publico nao pode escolher outro auto, alterar intervenientes ou injetar assinaturas',async()=>{
  const patch=await safePatch({kind:'return',to_person_id:'hacked',zone_name:'hacked',signatures:{from:'forged'},notes:'Nota válida',inspection:{doc_dua:'Bom'},damage_markers:[{x:100,y:335,type:'R'}]});
  assert.equal(patch.kind,undefined);assert.equal(patch.signatures,undefined);assert.equal(patch.to_person_id,undefined);assert.equal(patch.zone_name,undefined);assert.equal(patch.notes,'Nota válida');
  await assert.rejects(safePatch({damage_markers:[{x:600,y:1,type:'X'}]}),/Dano/);
  await assert.rejects(safePatch({inspection:{doc_dua:'unknown'}}),/inspeção/);
  const requests=[];
  const current={link_id:'only-this-link',purpose:'from',status:'open',handover:{id,version:1},payload:{}};
  const service=createFleetShares({env:{SUPABASE_SERVICE_ROLE_KEY:secret},fetcher:async(url,options)=>{requests.push({url,value:JSON.parse(options.body)});return Response.json(current);}});
  await assert.rejects(service.remote({action:'read',token:'bad'}),error=>error.status===400);assert.equal(requests.length,0);
  const result=await service.remote({action:'read',token,id:'someone-elses-auto'});assert.equal(result.handover.id,id);assert.deepEqual(requests[0].value,{p_hash:hash(token)});
  await assert.rejects(service.remote({action:'save',token,version:1,data:{notes:'hacked'}}),error=>error.status===403);
  await assert.rejects(service.remote({action:'upload',token,image:'invalid'}),error=>error.status===403);
  await assert.rejects(service.remote({action:'file',token,name:'../../private.pdf'}),error=>error.status===404);
});
