const fs=require('node:fs/promises');
const path=require('node:path');
const {createCanvas,loadImage,GlobalFonts}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..');
let ready;
async function renderImage(info){
  if(!ready) ready=Promise.resolve().then(()=>{
    if(!GlobalFonts.registerFromPath(path.join(root,'assets/fonts/Roboto.ttf'),'Arial')) throw new Error('Fonte dos cartoes indisponivel.');
    return import('../src/anniversary-card.mjs');
  });
  const renderer=await ready;
  const image=async source=>{
    if(['viatel.svg','Logo_MEO.svg.webp'].includes(source)) return loadImage(await fs.readFile(path.join(root,'public',source)));
    if(typeof source!=='string' || source.length>14*1024*1024 || !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=\r\n]+$/.test(source)) throw new Error('Formato de foto invalido.');
    const result=await loadImage(Buffer.from(source.slice(source.indexOf(',')+1),'base64'));
    if(result.width*result.height>36e6) throw new Error('Foto demasiado grande.');
    return result;
  };
  const canvas=await renderer.renderAnniversaryCard(info,{createCanvas,loadImage:image});
  return canvas.toBuffer('image/png');
}
module.exports={renderImage};
