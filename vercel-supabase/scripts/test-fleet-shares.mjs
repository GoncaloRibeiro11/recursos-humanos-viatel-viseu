import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createFleetShares,imageData,hash,safePatch}=require('../lib/fleet-shares.cjs');
const {createCanvas}=require('@napi-rs/canvas');
const id='10000000-0000-4000-8000-000000000002',token='a'.repeat(43),secret='server-only-test-key';
test('mesma ligacao guarda cada papel no servidor sem permitir editar o conteudo depois de concluir',async()=>{
  const calls=[],canvas=createCanvas(900,360),ctx=canvas.getContext('2d');ctx.fillRect(30,40,150,20);
  let current={shared_signing:true,purpose:'both',status:'open',content_hash:'version-hash',handover:{id,version:3},payload:{}};
  const service=createFleetShares({env:{SUPABASE_SERVICE_ROLE_KEY:secret},fetcher:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,body});
    if(url.endsWith('/rh_fleet_read_share'))return Response.json(current);
    if(url.endsWith('/rh_fleet_remote_shared_sign'))return Response.json({...current,receipts:{[body.p_role]:{signer_name:body.p_name}}});
    if(url.endsWith('/rh_fleet_submit_shared'))return Response.json(current);
    throw new Error('Unexpected route '+url);
  }});
  for(const role of ['from','to']){
    const result=await service.remote({action:'sign',token,role,name:'Pessoa teste',signature:canvas.toDataURL('image/png'),content_hash:'version-hash',accept:true,id:'another-auto'});
    assert.equal(result.receipts[role].signer_name,'Pessoa teste');const sent=calls.at(-1).body;assert.equal(sent.p_role,role);assert.equal(sent.p_hash,hash(token));assert.equal(sent.p_id,undefined);
  }
  await assert.rejects(service.remote({action:'sign',token,role:'zone'}),error=>error.status===400);
  for(const action of ['save','upload','reconfirm'])await assert.rejects(service.remote({action,token,version:3,data:{notes:'change'}}),error=>error.status===403);
  await service.remote({action:'submit',token,version:3,data:{notes:'unchanged',signatures:{from:'injected'}}});assert.equal(calls.at(-1).body.p_patch.signatures,undefined);
  current={...current,purpose:'editor'};await assert.rejects(service.remote({action:'sign',token,role:'to'}),error=>error.status===403);
  current={...current,purpose:'both',status:'closed'};await assert.rejects(service.remote({action:'sign',token,role:'to'}),error=>error.status===403);
});
test('ligacao partilhada tem 30 dias, e so o administrador a pode gerar',async()=>{
  const calls=[],now=new Date('2026-11-23T12:00:00Z');
  const service=createFleetShares({env:{SUPABASE_SERVICE_ROLE_KEY:secret},now:()=>now,fetcher:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,body});
    if(url.endsWith('/auth/v1/user'))return Response.json({id:'admin'});
    if(url.includes('/user_profiles?'))return Response.json([{role:'admin'}]);
    if(url.endsWith('/rh_fleet_prepare_share'))return Response.json({handover:{id,status:'draft',data:{}}});
    if(url.endsWith('/rh_fleet_create_shared_share'))return Response.json({id:'link',purpose:'editor',expires_at:body.p_expires});
    if(url.endsWith('/rh_fleet_share_status'))return Response.json({handover:{id,status:'draft',version:2}});
    throw new Error('Unexpected route');
  }});
  const result=await service.manage({headers:{authorization:'Bearer admin'}},{action:'create',id,purpose:'editor',shared:true});
  const sent=calls.find(call=>call.url.endsWith('/rh_fleet_create_shared_share')).body;
  assert.equal(sent.p_expires,'2026-12-23T12:00:00.000Z');assert.equal(sent.p_editable,true);assert.equal(sent.p_hash,hash(new URL(result.url).hash.slice(1)));
  await assert.rejects(service.manage({headers:{}},{action:'create',id,purpose:'both'}),error=>error.status===401);
});
test('reconfirmar assinatura exige aceitacao e envia apenas a referencia, nunca uma imagem escolhida pelo cliente',async()=>{
  let purpose='to',status='open';const calls=[];
  const service=createFleetShares({env:{SUPABASE_SERVICE_ROLE_KEY:secret},fetcher:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,body});
    if(url.endsWith('/rh_fleet_read_share'))return Response.json({purpose,status,handover:{id}});
    if(url.endsWith('/rh_fleet_remote_reconfirm'))return Response.json({status:'signed'});
    throw new Error('Unexpected route');
  }});
  const value={action:'reconfirm',token,previous_receipt_id:id,name:'Pessoa teste',content_hash:'current-hash',accept:true,signature:'injected'};
  await assert.rejects(service.remote({...value,accept:false}),error=>error.status===400);
  assert.equal((await service.remote(value)).status,'signed');const sent=calls.at(-1).body;
  assert.equal(sent.p_previous,id);assert.equal(sent.p_signature,undefined);assert.equal(sent.p_accept,true);assert.equal(sent.p_content_hash,'current-hash');
  status='signed';assert.equal((await service.remote(value)).status,'signed');purpose='editor';await assert.rejects(service.remote(value),error=>error.status===403);
});
test('assinaturas exigem apenas avaliacao e fotografias, nao os campos da confirmacao de entrega',async()=>{
  const {INSPECTION_ITEMS,validateSignatureRequest}=await import('../src/rh-fleet-model.mjs');
  const data={inspection:Object.fromEntries(INSPECTION_ITEMS.map(i=>[i.key,'NA'])),at:'',odometer:'',fuel:'',place:'',reason:'',zone_name:'',expected_return:'',checked:false,damage_notes:''};
  data.inspection.doc_dua='Mau';assert.deepEqual(validateSignatureRequest(data,1),[]);
  let photos=[id+'/viatura.jpg'],creates=0;
  const service=createFleetShares({env:{SUPABASE_SERVICE_ROLE_KEY:secret},fetcher:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;
    if(url.endsWith('/auth/v1/user'))return Response.json({id:'admin'});
    if(url.includes('/user_profiles?'))return Response.json([{role:'admin'}]);
    if(url.endsWith('/rh_fleet_prepare_share'))return Response.json({handover:{id,status:'draft',data},payload:{vehicle:{id:'vehicle'},photos}});
    if(url.endsWith('/rh_fleet_create_share')){creates++;return Response.json({id:'link',purpose:body.p_purpose,expires_at:body.p_expires});}
    if(url.endsWith('/rh_fleet_share_status'))return Response.json({handover:{id,status:'draft',data,version:2}});
    throw new Error('Unexpected request');
  }}),req={headers:{authorization:'Bearer administrator'}};
  for(const purpose of ['from','to'])assert.ok((await service.manage(req,{action:'create',id,purpose})).url);
  assert.equal(creates,2);photos=[id+'/documento.pdf'];
  await assert.rejects(service.manage(req,{action:'create',id,purpose:'from',photos:[id+'/inventada.jpg']}),/fotografia/);assert.equal(creates,2);
  photos=[id+'/viatura.jpg'];delete data.inspection.doc_dua;
  await assert.rejects(service.manage(req,{action:'create',id,purpose:'from'}),/Documentos/);assert.equal(creates,2);
  assert.ok((await service.manage(req,{action:'create',id,purpose:'editor'})).url,'preenchimento pode ser delegado antes das fotos e avaliacao');
});
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
test('preenchimento remoto preserva os dois nomes completos sem inventar nomes antigos',async()=>{
  const patch=await safePatch({driver_fields:{from:{name:'  Manuel de Entrega Teste  '},to:{name:'Ana de Rececao Teste'}}});
  assert.equal(patch.driver_fields.from.name,'Manuel de Entrega Teste');assert.equal(patch.driver_fields.to.name,'Ana de Rececao Teste');
  assert.equal(Object.hasOwn((await safePatch({driver_fields:{from:{},to:{}}})).driver_fields.from,'name'),false);
  await assert.rejects(safePatch({driver_fields:{from:{name:'A'.repeat(121)}}}),/condutor/);
  await assert.rejects(safePatch({driver_fields:{from:{name:'Nome\nerrado'}}}),/condutor/);
});
test('eliminacao exige admin e confirmacao, limpa apenas anexos do auto e permite repetir uma falha',async()=>{
  const deleted={id,entity:'handover',number:1,version:3,files_pending:true},objects=new Set([id+'/photo.jpg',id+'/auto-v1.pdf','other-auto/keep.jpg']);
  let failDelete=true,deleteCalls=0;const requests=[];
  const service=createFleetShares({env:{SUPABASE_SERVICE_ROLE_KEY:secret},fetcher:async(url,options={})=>{
    const value=options.body?JSON.parse(options.body):null;requests.push({url,method:options.method,value});
    if(url.endsWith('/auth/v1/user'))return Response.json({id:'admin'});
    if(url.includes('/user_profiles?'))return Response.json([{role:'admin'}]);
    if(url.endsWith('/rh_fleet_delete_handover')){deleteCalls++;if(value.p_number!=='FRO-00001')return Response.json({code:'P0001',message:'O número indicado não corresponde ao auto.'},{status:400});return Response.json(deleted);}
    if(url.endsWith('/rh_fleet_deleted_info'))return Response.json(deleted);
    if(url.endsWith('/rh_fleet_pending_deletions'))return Response.json({items:[deleted]});
    if(url.endsWith('/storage/v1/object/list/rh-fleet')){assert.equal(value.prefix,id);return Response.json([...objects].filter(key=>key.startsWith(id+'/')).map(key=>({name:key.slice(id.length+1)})));}
    if(options.method==='DELETE'){
      if(failDelete)return Response.json({error:'temporarily unavailable'},{status:503});
      for(const name of value.prefixes){assert.ok(name.startsWith(id+'/'));objects.delete(name);}return Response.json({});
    }
    if(url.endsWith('/rh_fleet_mark_deleted_files')){assert.ok(![...objects].some(key=>key.startsWith(id+'/')));return Response.json(true);}
    throw new Error('Unexpected request '+url);
  }}),req={headers:{authorization:'Bearer admin'}};
  await assert.rejects(service.manage({headers:{}},{action:'delete',id,version:3,number:'FRO-00001',test:true}),error=>error.status===401);
  await assert.rejects(service.manage(req,{action:'delete',id,version:3,number:'FRO-00001',test:false}),error=>error.status===400);assert.equal(deleteCalls,0);
  await assert.rejects(service.manage(req,{action:'delete',id,version:3,number:'FRO-99999',test:true}),error=>error.status===409);assert.equal(objects.size,3);
  const pending=await service.manage(req,{action:'delete',id,version:3,number:'FRO-00001',test:true});assert.equal(pending.deleted,true);assert.equal(pending.filesPending,true);
  failDelete=false;const done=await service.manage(req,{action:'cleanup-deleted',id});assert.equal(done.filesPending,false);assert.deepEqual([...objects],['other-auto/keep.jpg']);
  assert.equal((await service.manage(req,{action:'pending-deletions'})).items[0].id,id);
  const denied=createFleetShares({env:{SUPABASE_SERVICE_ROLE_KEY:secret},fetcher:async url=>Response.json(url.endsWith('/auth/v1/user')?{id:'manager'}:[{role:'gestor'}])});
  await assert.rejects(denied.manage({headers:{authorization:'Bearer manager'}},{action:'cleanup-deleted',id}),error=>error.status===403);
});
