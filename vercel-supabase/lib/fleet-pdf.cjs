const fs=require('node:fs/promises');
const path=require('node:path');
const {PDFDocument,rgb}=require('pdf-lib');
const fontkit=require('@pdf-lib/fontkit');
const asset=name=>path.join(__dirname,'../assets/fleet',name);
const clean=value=>String(value ?? '').replace(/[\u0000-\u0009\u000b-\u001f]/g,' ').slice(0,8000);
async function renderFleetPdf(handover){
  const {INSPECTION_GROUPS,CONDITIONS,handoverLabel,driverName}=await import('../src/rh-fleet-model.mjs');
  const s=handover.snapshot;if(!s || s.template_version!==1)throw new Error('Versão do modelo de auto indisponível.');
  const op=s.operation,v=s.vehicle;
  const pdf=await PDFDocument.load(await fs.readFile(asset('modri-94-01-v1.pdf')));
  pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(await fs.readFile(path.join(__dirname,'../assets/fonts/Roboto.ttf')),{subset:true});
  const pages=pdf.getPages();
  const ink=rgb(.05,.18,.3),white=rgb(1,1,1);
  const overflow=[];
  function text(page,value,x,top,width,size=8.5,erase=false){
    let label=clean(value).replace(/\n/g,' ');if(!label)return;
    if(erase)page.drawRectangle({x,y:page.getHeight()-top-11,width,height:13,color:white});
    let fitted=Math.min(size,width/font.widthOfTextAtSize(label,1));
    if(fitted<5){overflow.push(label);while(label && font.widthOfTextAtSize(label+'...',5)>width)label=label.slice(0,-1);label+='...';fitted=5;}
    page.drawText(label,{x,y:page.getHeight()-top-9,size:Math.max(5,fitted),font,color:ink});
  }
  const day=new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(op.at));
  const time=new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(op.at));
  text(pages[0],op.place,83,103,309,8.5,true);text(pages[0],day,426,103,98,8.5,true);
  text(pages[0],v.plate,99,146,62,8.5,true);text(pages[0],v.make_model,228,147,143,8.5,true);text(pages[0],op.odometer==='' || op.odometer==null?'':Number(op.odometer).toLocaleString('pt-PT'),424,147,103,8.5,true);
  for(const [kind,person,top] of [['from',s.from_person,190],['to',s.to_person,222.4]]){
    const fields=op.driver_fields?.[kind] || {};
    text(pages[0],driverName(op,kind,person),129,top,216,8,true);text(pages[0],fields.number || person.number,362,top,47,8,true);text(pages[0],fields.phone || person.phone,444,top,81,8,true);
    text(pages[0],fields.bi,82,top+14,129,8,true);text(pages[0],fields.nif,240,top+14,115,8,true);text(pages[0],fields.license,406,top+14,119,8,true);
  }
  for(const group of INSPECTION_GROUPS){
    const codes=group.page===1?CONDITIONS.filter(value=>value!=='NE'):CONDITIONS;
    for(const item of group.items){
      const index=codes.indexOf(op.inspection?.[item.key]);if(index<0)continue;
      text(pages[group.page],'X',group.columns[index]-2.5,item.top-3.4,8,8);
    }
  }
  for(const [value,top] of [[v.insurance_until,294.8],[v.inspection_until,308],[v.transport_until,334.4]]){
    text(pages[0],value?value.split('-').reverse().join(' / '):'',225,top,67,7,true);
  }
  for(const mark of op.damage_markers || []){
    if(!['R','A','P'].includes(mark.type) || !Number.isFinite(mark.x) || !Number.isFinite(mark.y) || mark.x<50 || mark.x>537 || mark.y<260 || mark.y>622)continue;
    pages[1].drawText(mark.type,{x:mark.x-4,y:842-mark.y-4,size:12,font,color:rgb(.8,.05,.05)});
  }
  const missingSignatures=['from','to','zone'].filter(key=>!op.signatures?.[key]);
  const number='FRO-'+String(handover.number || 'RASCUNHO').padStart(5,'0');
  const metadata=[number,handoverLabel(op),time,'Cartrack: '+(v.cartrack_number || '—'),'Combustível: '+(op.fuel || '—'),op.destination==='external_structure'?'Estrutura de destino: '+op.external_structure:''].filter(Boolean).join(' | ');
  const note=[metadata,op.reason,op.damage_notes,op.notes,...overflow.map(value=>'Dados completos: '+value)].filter(Boolean).join('\n');
  function wrap(value,maxWidth,size){
    const lines=[];for(const paragraph of clean(value).split(/\n/)){
      let line='';const words=[];for(const raw of paragraph.split(/\s+/)){let chunk='';for(const character of raw){if(font.widthOfTextAtSize(chunk+character,size)>maxWidth){words.push(chunk);chunk='';}chunk+=character;}if(chunk)words.push(chunk);}
      for(const word of words){
        if(font.widthOfTextAtSize((line?line+' ':'')+word,size)>maxWidth && line){lines.push(line);line=word;}else line+=(line?' ':'')+word;
      }if(line)lines.push(line);
    }return lines;
  }
  const noteLines=wrap(note,468,7);
  noteLines.slice(0,6).forEach((line,index)=>text(pages[1],line,65,643+index*7.5,465,7));
  const names={from:driverName(op,'from',s.from_person),to:driverName(op,'to',s.to_person),zone:op.zone_name};
  for(const [index,key] of ['from','to','zone'].entries()){
    const top=701+index*26;text(pages[1],names[key],154,top,200,8,true);
    const signature=op.signatures?.[key];
    if(signature && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) && signature.length<180000){
      const image=await pdf.embedPng(signature);const scale=Math.min(112/image.width,21/image.height);
      pages[1].drawImage(image,{x:415,y:842-top-12,width:image.width*scale,height:image.height*scale});
    }
  }
  for(const [index,page] of pages.entries()){
    text(page,number+' | '+(handover.status==='confirmed'?'Entrega confirmada':'RASCUNHO')+(missingSignatures.length?' | Por assinar':''),240,811,303,7);
    if(handover.status!=='confirmed')text(page,'RASCUNHO - NÃO CONFIRMA ENTREGA',52,45,488,10);
  }
  if(noteLines.length>6){
    let page=pdf.addPage([595,842]),top=58;
    text(page,number+' - Observações (continuação)',52,top,490,12);top+=28;
    for(const line of noteLines.slice(6)){
      if(top>770){page=pdf.addPage([595,842]);top=58;}
      text(page,line,52,top,490,9);top+=13;
    }
  }
  const receipts=Object.entries(op.signature_receipts || {}).filter(([role,value])=>['from','to'].includes(role) && value?.signed_at);
  if(receipts.length){
    const page=pdf.addPage([595,842]);text(page,number+' - Registo de assinaturas',52,55,490,14);
    text(page,v.plate+' | '+time,52,82,490,10);let top=118;
    for(const [role,receipt] of receipts){
      text(page,role==='from'?'Quem entrega / devolve':'Quem recebe',52,top,490,11);top+=24;
      text(page,'Nome indicado: '+receipt.signer_name,52,top,490,10);top+=20;
      text(page,'Assinado em: '+new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',dateStyle:'long',timeStyle:'medium'}).format(new Date(receipt.signed_at)),52,top,490,9);top+=20;
      text(page,'Metodo: assinatura manuscrita em ecra',52,top,490,9);top+=20;
      text(page,'Referencia do registo: '+receipt.id,52,top,490,8);top+=20;
      text(page,'Versao do conteudo (SHA-256):',52,top,490,9);top+=16;text(page,receipt.content_hash,52,top,490,8);top+=45;
    }
    text(page,'As assinaturas correspondem ao conteudo identificado acima.',52,top,490,9);
  }
  const captured=new Date(s.captured_at || handover.created_at);
  pdf.setTitle(number+' - '+v.plate);pdf.setAuthor('RH Viatel Viseu');pdf.setCreationDate(captured);pdf.setModificationDate(captured);
  return Buffer.from(await pdf.save());
}
module.exports={renderFleetPdf,asset};
