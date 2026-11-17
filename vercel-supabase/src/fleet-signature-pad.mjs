export function signaturePad(canvas,{initial='',onChange=()=>{}}={}){
  const ctx=canvas.getContext('2d');ctx.lineWidth=2.8;ctx.strokeStyle='#17212c';ctx.lineCap='round';ctx.lineJoin='round';
  let drawing=false,moved=false,hasInk=!!initial;
  if(initial){const image=new Image();image.onload=()=>ctx.drawImage(image,0,0,canvas.width,canvas.height);image.src=initial;}
  const point=event=>{const box=canvas.getBoundingClientRect();return [(event.clientX-box.left)*canvas.width/box.width,(event.clientY-box.top)*canvas.height/box.height];};
  canvas.addEventListener('pointerdown',event=>{event.preventDefault();drawing=true;moved=false;canvas.setPointerCapture(event.pointerId);ctx.beginPath();ctx.moveTo(...point(event));});
  canvas.addEventListener('pointermove',event=>{if(drawing){moved=true;ctx.lineTo(...point(event));ctx.stroke();}});
  const end=()=>{if(!drawing)return;drawing=false;if(moved){hasInk=true;onChange(canvas.toDataURL('image/png'));}};
  canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
  return {clear(){hasInk=false;ctx.clearRect(0,0,canvas.width,canvas.height);onChange('');},value(){return hasInk?canvas.toDataURL('image/png'):'';}};
}
