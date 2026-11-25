// Beleg zuschneiden und drehen. Arbeitet immer auf dem Originalbild, damit ein Zuschnitt
// später geändert oder zurückgesetzt werden kann.
// Crop.open(origSrc, crop) -> Promise<{ src, crop } | null>, crop = { rot: 0|90|180|270, x, y, w, h } (0..1 im gedrehten Bild)
(function (root) {
'use strict';
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

function rotated(img, rot, max = Infinity) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const side = rot === 90 || rot === 270;
  const cv = document.createElement('canvas');
  cv.width = side ? h : w; cv.height = side ? w : h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate(rot * Math.PI / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return cv;
}

// Hellen Bon auf dunklerem Untergrund finden: Otsu-Schwelle, größte helle Fläche, deren Rahmen.
function detect(cv) {
  const k = Math.min(1, 240 / Math.max(cv.width, cv.height));
  const w = Math.max(1, Math.round(cv.width * k)), h = Math.max(1, Math.round(cv.height * k));
  const sm = document.createElement('canvas'); sm.width = w; sm.height = h;
  const ctx = sm.getContext('2d'); ctx.drawImage(cv, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data, n = w * h, lum = new Uint8Array(n), hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) { const v = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000 | 0; lum[i] = v; hist[v]++; }
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; th = t; }
  }
  // Leichtes Schließen der Lücken (Schrift auf dem Bon ist dunkel): Pixel gilt als hell, wenn er oder ein Nachbar hell ist
  const bright = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let b = 0;
    for (let dy = -1; dy <= 1 && !b; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && lum[yy * w + xx] > th) { b = 1; break; }
    }
    bright[y * w + x] = b;
  }
  const seen = new Uint8Array(n), stack = new Int32Array(n);
  let bestBox = null, bestCount = 0;
  for (let s = 0; s < n; s++) {
    if (!bright[s] || seen[s]) continue;
    let top = 0, count = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[top++] = s; seen[s] = 1;
    while (top) {
      const p = stack[--top], x = p % w, y = (p / w) | 0; count++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && bright[q] && !seen[q]) { seen[q] = 1; stack[top++] = q; }
    }
    if (count > bestCount) { bestCount = count; bestBox = { x0, y0, x1, y1 }; }
  }
  if (!bestBox) return null;
  const m = 0.01;
  const box = {
    x: Math.max(0, bestBox.x0 / w - m), y: Math.max(0, bestBox.y0 / h - m),
    w: 0, h: 0,
  };
  box.w = Math.min(1, (bestBox.x1 + 1) / w + m) - box.x; box.h = Math.min(1, (bestBox.y1 + 1) / h + m) - box.y;
  const area = box.w * box.h;
  if (area < 0.08 || area > 0.96 || bestCount < n * 0.05) return null; // unsicher: ganzes Bild lassen
  return box;
}

const FULL = { x: 0, y: 0, w: 1, h: 1 };
function rotRect(r) { return { x: 1 - (r.y + r.h), y: r.x, w: r.h, h: r.w }; } // 90° im Uhrzeigersinn

async function render(origSrc, crop) {
  const img = await loadImg(origSrc);
  const rot = crop?.rot || 0, r = crop || FULL;
  const cv = rotated(img, rot, 2400);
  const sx = Math.round(r.x * cv.width), sy = Math.round(r.y * cv.height);
  const sw = Math.max(1, Math.round(r.w * cv.width)), sh = Math.max(1, Math.round(r.h * cv.height));
  const out = document.createElement('canvas'); out.width = sw; out.height = sh;
  out.getContext('2d').drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh);
  return out.toDataURL('image/jpeg', 0.9);
}

let dlg;
function ensureDialog() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'crop-dlg';
  dlg.innerHTML = `
    <h3>Beleg zuschneiden</h3>
    <div class="crop-stage"><div class="crop-inner"><canvas></canvas>
      <div class="crop-box">${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<span class="h ${h}" data-h="${h}"></span>`).join('')}</div>
    </div></div>
    <p class="hint crop-hint">Rahmen an den Ecken oder Kanten auf den Beleg ziehen.</p>
    <div class="crop-tools">
      <button type="button" class="ghost small" data-a="left" aria-label="nach links drehen">↺ Drehen</button>
      <button type="button" class="ghost small" data-a="right" aria-label="nach rechts drehen">↻ Drehen</button>
      <button type="button" class="ghost small" data-a="auto">Automatisch</button>
      <button type="button" class="ghost small" data-a="full">Ganzes Bild</button>
    </div>
    <div class="dlg-actions">
      <button type="button" class="ghost" data-a="cancel">Abbrechen</button>
      <button type="button" class="primary" data-a="ok">Übernehmen</button>
    </div>`;
  document.body.appendChild(dlg);
  return dlg;
}

async function open(origSrc, crop) {
  const d = ensureDialog();
  const img = await loadImg(origSrc);
  const cv = d.querySelector('canvas'), box = d.querySelector('.crop-box'), inner = d.querySelector('.crop-inner'), stage = d.querySelector('.crop-stage');
  let rot = crop?.rot || 0, src, r;
  const draw = () => {
    src = rotated(img, rot, 1400);
    cv.width = src.width; cv.height = src.height; cv.getContext('2d').drawImage(src, 0, 0);
    // Anzeige: ins Fenster einpassen
    const maxW = (stage.clientWidth || 388) - 28, maxH = Math.max(220, Math.min(window.innerHeight * 0.62, 640));
    const k = Math.min(maxW / src.width, maxH / src.height);
    inner.style.width = Math.round(src.width * k) + 'px'; inner.style.height = Math.round(src.height * k) + 'px';
  };
  const place = () => {
    box.style.left = r.x * 100 + '%'; box.style.top = r.y * 100 + '%';
    box.style.width = r.w * 100 + '%'; box.style.height = r.h * 100 + '%';
  };
  d.showModal();
  draw();
  r = crop ? { x: crop.x, y: crop.y, w: crop.w, h: crop.h } : (detect(src) || { ...FULL });
  place();

  const MIN = 0.05;
  let drag = null;
  const onDown = (e) => {
    const h = e.target.dataset.h || (e.target === box ? 'move' : null);
    if (!h) return;
    e.preventDefault();
    const rect = inner.getBoundingClientRect();
    drag = { h, sx: e.clientX, sy: e.clientY, r0: { ...r }, W: rect.width, H: rect.height, id: e.pointerId };
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const dx = (e.clientX - drag.sx) / drag.W, dy = (e.clientY - drag.sy) / drag.H, o = drag.r0;
    let { x, y, w, h } = o;
    if (drag.h === 'move') {
      x = Math.min(1 - w, Math.max(0, o.x + dx)); y = Math.min(1 - h, Math.max(0, o.y + dy));
    } else {
      if (drag.h.includes('w')) { const nx = Math.min(o.x + o.w - MIN, Math.max(0, o.x + dx)); w = o.w + (o.x - nx); x = nx; }
      if (drag.h.includes('e')) w = Math.min(1 - o.x, Math.max(MIN, o.w + dx));
      if (drag.h.includes('n')) { const ny = Math.min(o.y + o.h - MIN, Math.max(0, o.y + dy)); h = o.h + (o.y - ny); y = ny; }
      if (drag.h.includes('s')) h = Math.min(1 - o.y, Math.max(MIN, o.h + dy));
    }
    r = { x, y, w, h }; place();
  };
  const onUp = () => { drag = null; };
  inner.addEventListener('pointerdown', onDown);
  inner.addEventListener('pointermove', onMove);
  inner.addEventListener('pointerup', onUp);
  inner.addEventListener('pointercancel', onUp);

  return new Promise((resolve) => {
    const finish = async (ok) => {
      inner.removeEventListener('pointerdown', onDown); inner.removeEventListener('pointermove', onMove);
      inner.removeEventListener('pointerup', onUp); inner.removeEventListener('pointercancel', onUp);
      d.removeEventListener('click', onClick); d.removeEventListener('cancel', onCancel);
      d.close();
      if (!ok) return resolve(null);
      const c = { rot, ...r };
      resolve({ src: await render(origSrc, c), crop: c });
    };
    const onCancel = (e) => { e.preventDefault(); finish(false); };
    const onClick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'ok') return finish(true);
      if (a === 'cancel') return finish(false);
      if (a === 'right' || a === 'left') {
        const turns = a === 'right' ? 1 : 3;
        for (let i = 0; i < turns; i++) r = rotRect(r);
        rot = (rot + (a === 'right' ? 90 : 270)) % 360; draw(); place();
      }
      if (a === 'auto') { r = detect(src) || { ...FULL }; place(); }
      if (a === 'full') { r = { ...FULL }; place(); }
    };
    d.addEventListener('click', onClick);
    d.addEventListener('cancel', onCancel);
  });
}

// Automatisch zuschneiden ohne Dialog (für den Fall, dass der Bon klar erkennbar ist)
async function auto(origSrc) {
  const img = await loadImg(origSrc);
  const r = detect(rotated(img, 0, 1400));
  if (!r) return null;
  const c = { rot: 0, ...r };
  return { src: await render(origSrc, c), crop: c };
}

root.Crop = { open, render, auto, detect, rotated };
})(window);
