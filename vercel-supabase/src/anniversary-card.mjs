function initials(name){ const p = name.trim().split(/\s+/); return p.length===1 ? p[0].slice(0,2).toUpperCase() : (p[0][0]+p[p.length-1][0]).toUpperCase(); }

function canvasRoundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCenteredText(ctx, text, x, y, maxWidth, font, color){
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = Number((font.match(/(\d+)px/) || [0, 28])[1]);
  while (ctx.measureText(text).width > maxWidth && size > 16){
    size -= 2;
    ctx.font = font.replace(/\d+px/, size + 'px');
  }
  ctx.fillText(text, x, y);
}

function drawWrappedCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines){
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach(word => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line){
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) visible[visible.length - 1] = visible[visible.length - 1].replace(/\s+\S*$/, '') + '...';
  visible.forEach((ln, idx) => ctx.fillText(ln, x, y + idx * lineHeight));
}

function drawImageCover(ctx, img, x, y, w, h, focusX = 0.5, focusY = 0.43, zoom = 1, mirror = false){
  const sourceRatio = img.width / img.height;
  const targetRatio = w / h;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (sourceRatio > targetRatio){
    sw = img.height * targetRatio;
    sx = (img.width - sw) * focusX;
  } else {
    sh = img.width / targetRatio;
    sy = (img.height - sh) * focusY;
  }
  if (zoom > 1){
    const zw = sw / zoom;
    const zh = sh / zoom;
    sx += (sw - zw) * focusX;
    sy += (sh - zh) * focusY;
    sw = zw;
    sh = zh;
  }
  sx = Math.max(0, Math.min(sx, img.width - sw));
  sy = Math.max(0, Math.min(sy, img.height - sh));
  if (mirror){
    ctx.save();
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }
}

export async function renderAnniversaryCard(info,{createCanvas,loadImage}){
  const canvas = createCanvas(1080,1080);
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  const navy = '#082b83';
  const blue = '#2c9bd8';
  const green = '#96ff13';
  const purple = '#3026ff';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
  grad.addColorStop(0, '#eff6ff');
  grad.addColorStop(0.55, '#ffffff');
  grad.addColorStop(1, '#dcfce7');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#ffffff';
  canvasRoundRect(ctx, 70, 70, 940, 940, 44);
  ctx.fill();
  ctx.strokeStyle = '#bfdbfe';
  ctx.lineWidth = 4;
  ctx.stroke();

  try {
    const viatelLogo = await loadImage('viatel.svg');
    ctx.drawImage(viatelLogo, 125, 126, 190, 66);
  } catch(e){
    drawCenteredText(ctx, 'VIATEL', 220, 158, 190, '900 42px Segoe UI, Arial', navy);
  }

  ctx.fillStyle = green;
  canvasRoundRect(ctx, 690, 120, 275, 82, 41);
  ctx.fill();
  drawCenteredText(ctx, 'Parabéns', 828, 161, 230, '800 38px Segoe UI, Arial', navy);

  ctx.save();
  ctx.beginPath();
  ctx.arc(540, 405, 156, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = blue;
  ctx.fill();
  ctx.clip();
  if (info.person.photo){
    try {
      const photo = await loadImage(info.person.photo);
      drawImageCover(ctx, photo, 384, 249, 312, 312, 0.5, 0.38, 1.08, !!info.person.photoMirror);
    } catch(e){
      drawCenteredText(ctx, initials(info.person.name || ''), 540, 405, 230, '800 92px Segoe UI, Arial', '#ffffff');
    }
  } else {
    drawCenteredText(ctx, initials(info.person.name || ''), 540, 405, 230, '800 92px Segoe UI, Arial', '#ffffff');
  }
  ctx.restore();

  ctx.strokeStyle = purple;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(540, 405, 166, 0, Math.PI * 2);
  ctx.stroke();

  drawCenteredText(ctx, info.person.name || 'Colaborador', 540, 625, 780, '900 64px Segoe UI, Arial', navy);
  drawCenteredText(ctx, info.imageSubtitle || `${info.years} ${info.years===1?'ano':'anos'} de casa`, 540, 700, 660, '800 44px Segoe UI, Arial', blue);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '400 34px Segoe UI, Arial';
  ctx.fillStyle = '#334155';
  drawWrappedCanvasText(ctx, info.imageMessage || 'Obrigado pelo teu compromisso, dedicação e por fazeres parte da equipa.', 540, 770, 720, 46, 3);

  ctx.fillStyle = navy;
  canvasRoundRect(ctx, 250, 925, 580, 74, 37);
  ctx.fill();
  drawCenteredText(ctx, 'humaniza-te', 540, 962, 360, '400 34px Segoe UI, Arial', '#ffffff');

  try {
    const logo = await loadImage('Logo_MEO.svg.webp');
    ctx.drawImage(logo, 126, 905, 112, 112);
  } catch(e){
    ctx.fillStyle = purple;
    ctx.beginPath();
    ctx.arc(182, 961, 56, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}
