import { parseReceipt, parseAmount } from './receipt.js';
import { COUNTRIES, lookup, suggestFromCache, isComplete, normalizeZip, remember } from './plz.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const num2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round(n * 100) / 100;
const todayIso = () => new Date().toISOString().slice(0, 10);
const deDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '');

// ---------- Speicher (Stammdaten im Browser) ----------
const STORE_KEY = 'bewirtung.store.v1';
const DEFAULT_OCCASIONS = [
  'Geschäftsessen mit Kunden',
  'Akquise / Neukundengespräch',
  'Vertragsverhandlung',
  'Projektbesprechung',
  'Besprechung mit Lieferanten',
  'Besprechung mit Geschäftspartnern',
];
function loadStore() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch {}
  return {
    places: s.places || [],
    hosts: s.hosts || [],
    guests: s.guests || [],
    occasions: s.occasions || [...DEFAULT_OCCASIONS],
    settings: { company: '', signPlace: '', lastHostId: '', ...(s.settings || {}) },
  };
}
let store = loadStore();
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {} };

// ---------- Formularzustand ----------
let form = freshForm();
function freshForm() {
  return { pages: [], pdfText: '', guests: [], ocrTotal: null, signature: null, autoCity: true };
}

// ---------- Dialog ----------
function ask(title, fields, okLabel = 'Speichern') {
  const dlg = $('dlg');
  $('dlgTitle').textContent = title;
  $('dlgOk').textContent = okLabel;
  $('dlgBody').innerHTML = fields.map((f, i) =>
    `<label>${esc(f.label)}<input data-i="${i}" value="${esc(f.value || '')}" ${f.required ? 'required' : ''} autocomplete="off"></label>`).join('');
  dlg.showModal();
  setTimeout(() => dlg.querySelector('input')?.focus(), 30);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      resolve([...dlg.querySelectorAll('#dlgBody input')].map((x) => x.value.trim()));
    }, { once: true });
  });
}

// ---------- Auswahllisten ----------
function renderCountry() {
  $('fCountry').innerHTML = COUNTRIES.map((c) => `<option value="${c.code}">${c.code} – ${esc(c.name)}</option>`).join('');
}
function renderPlaces() {
  const sel = $('fPlaceSel'), cur = sel.value;
  const sorted = [...store.places].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  sel.innerHTML = '<option value="">– neuer Ort –</option>' +
    ['Restaurant', 'Hotel', 'Sonstiges'].map((t) => {
      const items = sorted.filter((p) => (p.type || 'Restaurant') === t);
      return items.length ? `<optgroup label="${t}">${items.map((p) => `<option value="${p.id}">${esc(p.name)}${p.city ? ' – ' + esc(p.city) : ''}</option>`).join('')}</optgroup>` : '';
    }).join('');
  sel.value = store.places.some((p) => p.id === cur) ? cur : '';
  $('btnDelPlace').hidden = !sel.value;
}
function renderHosts() {
  const sel = $('fHost'), cur = sel.value || store.settings.lastHostId;
  sel.innerHTML = store.hosts.length
    ? store.hosts.map((h) => `<option value="${h.id}">${esc(h.name)}${h.role ? ' (' + esc(h.role) + ')' : ''}</option>`).join('')
    : '<option value="">– bitte Gastgeber anlegen –</option>';
  if (store.hosts.some((h) => h.id === cur)) sel.value = cur;
}
function renderOccasions() {
  const sel = $('fOccasion'), cur = sel.value;
  sel.innerHTML = '<option value="">– bitte wählen –</option>' + store.occasions.map((o) => `<option>${esc(o)}</option>`).join('');
  if (store.occasions.includes(cur)) sel.value = cur;
}
function renderGuestLists() {
  $('guestList').innerHTML = store.guests.map((g) => `<option value="${esc(g.name)}">${esc(g.company || '')}</option>`).join('');
  const companies = [...new Set(store.guests.map((g) => g.company).filter(Boolean))];
  $('companyList').innerHTML = companies.map((c) => `<option value="${esc(c)}">`).join('');
}
function renderChips() {
  $('guestChips').innerHTML = form.guests.length
    ? form.guests.map((g, i) => `<span class="chip">${esc(g.name)}${g.company ? ` <small>${esc(g.company)}</small>` : ''}<button type="button" data-i="${i}" aria-label="entfernen">×</button></span>`).join('')
    : '<span class="hint">Noch keine Gäste eingetragen.</span>';
}
function renderStamm() {
  const block = (title, kind, items, label) => `
    <div><h3>${title}</h3>${items.length ? `<ul>${items.map((x, i) => `<li><span>${label(x)}</span><button type="button" class="x" data-kind="${kind}" data-i="${i}" aria-label="löschen">×</button></li>`).join('')}</ul>` : '<p class="hint">leer</p>'}</div>`;
  $('stammLists').innerHTML =
    block('Orte', 'places', store.places, (p) => `${esc(p.name)} <small>${esc(p.zip)} ${esc(p.city)}</small>`) +
    block('Gastgeber', 'hosts', store.hosts, (h) => `${esc(h.name)} <small>${esc(h.role || '')}</small>`) +
    block('Gäste', 'guests', store.guests, (g) => `${esc(g.name)} <small>${esc(g.company || '')}</small>`) +
    block('Anlässe', 'occasions', store.occasions, (o) => esc(o));
}
function renderAll() { renderPlaces(); renderHosts(); renderOccasions(); renderGuestLists(); renderChips(); renderStamm(); }

// ---------- Ort / PLZ ----------
function placeFromFields() {
  return {
    type: $('fPlaceType').value, name: $('fPlaceName').value.trim(), street: $('fStreet').value.trim(),
    country: $('fCountry').value, zip: $('fZip').value.trim(), city: $('fCity').value.trim(),
  };
}
function fillPlace(p) {
  $('fPlaceType').value = p.type || 'Restaurant';
  $('fPlaceName').value = p.name || '';
  $('fStreet').value = p.street || '';
  $('fCountry').value = p.country || 'DE';
  $('fZip').value = p.zip || '';
  $('fCity').value = p.city || '';
  form.autoCity = false;
  updateAmounts();
}
let zipTimer;
async function onZipInput() {
  const country = $('fCountry').value, zip = $('fZip').value;
  const sugg = suggestFromCache(country, zip);
  $('zipList').innerHTML = sugg.map((s) => `<option value="${esc(s.zip)}">${esc(s.city)}</option>`).join('');
  clearTimeout(zipTimer);
  if (!isComplete(country, zip)) { $('plzStatus').textContent = ''; return; }
  zipTimer = setTimeout(async () => {
    $('plzStatus').textContent = 'Suche Ort …';
    const cities = await lookup(country, zip);
    if (normalizeZip(country, $('fZip').value) !== normalizeZip(country, zip)) return; // veraltet
    $('cityList').innerHTML = cities.map((c) => `<option value="${esc(c)}">`).join('');
    if (!cities.length) { $('plzStatus').textContent = 'PLZ nicht gefunden – Ort bitte von Hand eintragen.'; return; }
    if (form.autoCity || !$('fCity').value.trim()) { $('fCity').value = cities[0]; form.autoCity = true; }
    $('plzStatus').textContent = cities.length > 1 ? `${cities.length} Orte zu dieser PLZ – Auswahl im Feld „Ort“.` : `✓ ${cities[0]}`;
  }, 250);
}
function savePlace() {
  const p = placeFromFields();
  if (!p.name) { $('plzStatus').textContent = 'Bitte zuerst einen Namen eintragen.'; return; }
  const id = $('fPlaceSel').value;
  let existing = store.places.find((x) => x.id === id) ||
    store.places.find((x) => x.name.toLowerCase() === p.name.toLowerCase() && (x.city || '') === p.city);
  if (existing) Object.assign(existing, p); else { existing = { id: uid(), ...p }; store.places.push(existing); }
  remember(p.country, p.zip, p.city);
  save(); renderPlaces(); renderStamm();
  $('fPlaceSel').value = existing.id; $('btnDelPlace').hidden = false;
  $('plzStatus').textContent = `✓ „${p.name}“ gespeichert`;
}
function matchSavedPlace(name, zip) {
  if (!name && !zip) return null;
  const n = (name || '').toLowerCase().replace(/[^a-zäöüß0-9]/g, '');
  return store.places.find((p) => {
    const pn = p.name.toLowerCase().replace(/[^a-zäöüß0-9]/g, '');
    return (n && pn && (n.includes(pn) || pn.includes(n))) && (!zip || !p.zip || normalizeZip(p.country, p.zip) === normalizeZip(p.country, zip));
  }) || null;
}

// ---------- Gäste ----------
function addGuest() {
  const name = $('fGuestName').value.trim();
  if (!name) return;
  let company = $('fGuestCompany').value.trim();
  const known = store.guests.find((g) => g.name.toLowerCase() === name.toLowerCase());
  if (!company && known) company = known.company || '';
  form.guests.push({ name, company });
  if (!known) store.guests.push({ name, company });
  else if (company && !known.company) known.company = company;
  save();
  $('fGuestName').value = ''; $('fGuestCompany').value = '';
  $('fGuestName').focus();
  renderChips(); renderGuestLists(); renderStamm();
}

// ---------- Beträge ----------
const amt = (id) => { const n = parseAmount($(id).value); return Number.isFinite(n) ? n : 0; };
function calc() {
  const foreign = $('fCountry').value !== 'DE';
  const rows = { 19: amt('a19'), 7: amt('a7'), 0: amt('a0') };
  const tip = amt('aTip'), fee = amt('aFee'), feeFull = $('fFeeFull').checked;
  const line = {};
  for (const r of [19, 7, 0]) {
    const g = rows[r], n = r2(g / (1 + r / 100));
    line[r] = { gross: g, net: n, vat: r2(g - n) };
  }
  const gross = r2(rows[19] + rows[7] + rows[0] + tip + fee);
  const vat = r2(line[19].vat + line[7].vat);
  const net = r2(gross - vat);
  // Vorsteuer nur bei inländischen Rechnungen; ausländische USt wird Teil der Kosten.
  const inputTax = foreign ? 0 : vat;
  const base7030 = r2((foreign ? gross : net) - (feeFull ? fee : 0));
  const deductible = r2(base7030 * 0.7);
  return { line, tip, fee, feeFull, gross, vat, net, inputTax, base7030, deductible, nonDeductible: r2(base7030 - deductible), foreign };
}
function updateAmounts() {
  const c = calc();
  for (const r of [19, 7, 0]) {
    $('n' + r).textContent = c.line[r].gross ? num2.format(c.line[r].net) : '';
    $('v' + r).textContent = c.line[r].gross ? num2.format(c.line[r].vat) : '';
  }
  $('nTip').textContent = c.tip ? num2.format(c.tip) : '';
  $('nFee').textContent = c.fee ? num2.format(c.fee) : '';
  $('tGross').textContent = eur.format(c.gross);
  $('tNet').textContent = eur.format(c.net);
  $('tVat').textContent = eur.format(c.vat);
  $('split').innerHTML = `
    ${c.foreign ? '<p class="hint">Ausländische Rechnung: die ausländische Umsatzsteuer ist hier nicht als Vorsteuer abziehbar und wird den Kosten zugerechnet.</p>' : ''}
    <div><span>Vorsteuer</span><b>${eur.format(c.inputTax)}</b></div>
    <div><span>Betriebsausgabe abzugsfähig (70 %)</span><b>${eur.format(c.deductible)}</b></div>
    <div><span>nicht abzugsfähig (30 %)</span><b>${eur.format(c.nonDeductible)}</b></div>
    ${c.feeFull && c.fee ? `<div><span>Bankgebühr, voll abzugsfähig</span><b>${eur.format(c.fee)}</b></div>` : ''}`;
  const w = $('sumWarn');
  const sumReceipt = r2(c.line[19].gross + c.line[7].gross + c.line[0].gross);
  if (form.ocrTotal != null && Math.abs(form.ocrTotal - sumReceipt) > 0.05 && Math.abs(form.ocrTotal - r2(sumReceipt + c.tip)) > 0.05) {
    w.hidden = false;
    w.textContent = `Hinweis: Auf dem Beleg wurde als Summe ${eur.format(form.ocrTotal)} erkannt, die Aufteilung ergibt ${eur.format(sumReceipt)}. Bitte prüfen.`;
  } else w.hidden = true;
  return c;
}

// ---------- Beleg laden ----------
let pdfjs;
async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}
function fileToDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
// Bild verkleinern (Handyfotos sind oft > 10 MB) und korrekt drehen
async function normalizeImage(file) {
  const url = await fileToDataUrl(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const max = 2400, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  if (s === 1 && file.size < 2.5e6) return url;
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.88);
}
async function addFiles(files) {
  $('ocrStatus').textContent = 'Lade Beleg …';
  try {
    for (const f of files) {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        const lib = await getPdfjs();
        const doc = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
        for (let p = 1; p <= Math.min(doc.numPages, 10); p++) {
          const page = await doc.getPage(p);
          const tc = await page.getTextContent();
          form.pdfText += textFromPdfItems(tc.items) + '\n';
          const vp = page.getViewport({ scale: 2 });
          const cv = document.createElement('canvas');
          cv.width = vp.width; cv.height = vp.height;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          form.pages.push({ name: `${f.name} – Seite ${p}`, src: cv.toDataURL('image/jpeg', 0.9) });
        }
      } else if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name)) {
        form.pages.push({ name: f.name, src: await normalizeImage(f) });
      }
    }
    $('ocrStatus').textContent = form.pages.length ? '' : 'Dateiformat nicht erkannt.';
  } catch (e) {
    console.error(e);
    $('ocrStatus').textContent = 'Beleg konnte nicht gelesen werden: ' + (e.message || e);
  }
  renderThumbs();
  if (form.pages.length) runOcr();
}
// pdf.js liefert Textstücke; zu Zeilen zusammensetzen (gleiche y-Position)
function textFromPdfItems(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str?.trim()) continue;
    const y = Math.round(it.transform[5]);
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) rows.push(row = { y, parts: [] });
    row.parts.push({ x: it.transform[4], s: it.str });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ')).join('\n');
}
function renderThumbs() {
  $('thumbs').innerHTML = form.pages.map((p, i) => `<figure><img src="${p.src}" alt="${esc(p.name)}"><button type="button" data-i="${i}" aria-label="entfernen">×</button></figure>`).join('');
  $('btnOcr').disabled = !form.pages.length;
}

// ---------- Texterkennung ----------
let worker;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Skript nicht ladbar: ' + src)); document.head.appendChild(s); });
}
async function getWorker() {
  if (worker) return worker;
  if (!window.Tesseract) await loadScript(new URL('../vendor/tesseract/tesseract.min.js', import.meta.url).href);
  const base = new URL('../vendor/', import.meta.url).href;
  worker = await window.Tesseract.createWorker('deu', 1, {
    workerPath: base + 'tesseract/worker.min.js',
    corePath: base + 'tesseract/',
    langPath: base + 'lang',
    gzip: true,
    logger: (m) => {
      if (m.status === 'recognizing text') $('ocrStatus').textContent = `Lese Beleg … ${Math.round(m.progress * 100)} %`;
      else if (m.status) $('ocrStatus').textContent = 'Texterkennung wird vorbereitet …';
    },
  });
  await worker.setParameters({ preserve_interword_spaces: '1' });
  return worker;
}
async function runOcr() {
  $('btnOcr').disabled = true;
  try {
    let text = form.pdfText.trim();
    if (text.replace(/\s/g, '').length < 40) {
      const w = await getWorker();
      text = '';
      for (const p of form.pages) {
        const { data } = await w.recognize(p.src);
        text += data.text + '\n';
      }
    }
    $('rawText').textContent = text;
    $('rawBox').hidden = false;
    applyParsed(parseReceipt(text));
  } catch (e) {
    console.error(e);
    $('ocrStatus').textContent = 'Texterkennung fehlgeschlagen. Bitte Werte von Hand eintragen.';
  } finally {
    $('btnOcr').disabled = !form.pages.length;
  }
}
function applyParsed(r) {
  const found = [];
  if (r.date) { $('fDate').value = r.date; found.push('Datum'); }
  const setAmt = (id, v) => { $(id).value = v ? num2.format(v) : ''; };
  if (r.gross[19] || r.gross[7] || r.gross[0]) {
    setAmt('a19', r.gross[19]); setAmt('a7', r.gross[7]); setAmt('a0', r.gross[0]);
    found.push('Beträge');
  }
  if (r.tip) { setAmt('aTip', r.tip); found.push('Trinkgeld'); }
  form.ocrTotal = r.total;
  const saved = matchSavedPlace(r.name, r.zip);
  if (saved) {
    $('fPlaceSel').value = saved.id; $('btnDelPlace').hidden = false; fillPlace(saved);
    found.push(`Ort „${saved.name}“ (gespeichert)`);
  } else if (!$('fPlaceSel').value) {
    if (r.name && !$('fPlaceName').value) $('fPlaceName').value = r.name;
    if (r.street && !$('fStreet').value) $('fStreet').value = r.street;
    if (r.city && !$('fCity').value) { $('fCity').value = r.city; form.autoCity = false; }
    if (r.zip && !$('fZip').value) {
      const z = r.zip;
      if (/^\d{4}\s?[A-Z]{2}$/.test(z)) $('fCountry').value = 'NL';
      $('fZip').value = z; onZipInput();
    }
    if (/hotel/i.test(r.name || '')) $('fPlaceType').value = 'Hotel';
    if (r.name || r.city) found.push('Ort');
  }
  updateAmounts();
  $('ocrStatus').textContent = found.length ? `✓ Erkannt: ${found.join(', ')}. Bitte prüfen.` : 'Nichts Sicheres erkannt – bitte Werte eintragen.';
}

// ---------- Unterschrift ----------
function initSignature() {
  const cv = $('sigPad'), ctx = cv.getContext('2d');
  let drawing = false, dirty = false;
  ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#13254a';
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.addEventListener('pointerdown', (e) => { drawing = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); e.preventDefault(); });
  cv.addEventListener('pointermove', (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); dirty = true; });
  const end = () => { if (drawing && dirty) form.signature = cv.toDataURL('image/png'); drawing = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  $('btnSigClear').onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); form.signature = null; dirty = false; };
  return () => $('btnSigClear').onclick();
}

// ---------- Druckansicht ----------
function buildPrint() {
  const c = updateAmounts();
  const p = placeFromFields();
  const host = store.hosts.find((h) => h.id === $('fHost').value);
  const country = COUNTRIES.find((x) => x.code === p.country);
  const occasion = [$('fOccasion').value, $('fOccasionNote').value.trim()].filter(Boolean).join(' – ');
  const participants = form.guests.length + ($('fHostAttends').checked && host ? 1 : 0);
  const row = (label, g, n, v) => `<tr><td>${label}</td><td>${n}</td><td>${v}</td><td>${g}</td></tr>`;
  const f = (x) => (x ? num2.format(x) : '–');
  const company = store.settings.company;
  const missing = [];
  if (!$('fDate').value) missing.push('Tag der Bewirtung');
  if (!p.name) missing.push('Ort der Bewirtung');
  if (!host) missing.push('Gastgeber');
  if (!form.guests.length) missing.push('bewirtete Personen');
  if (!occasion) missing.push('Anlass');
  if (!c.gross) missing.push('Betrag');

  const pages = `
  <section class="p-page">
    <header class="p-head">
      <div>${company ? `<div class="p-company">${esc(company)}</div>` : ''}<h1>Bewirtungskostenbeleg</h1>
      <div class="p-law">Angaben zum Nachweis der Höhe und der betrieblichen Veranlassung von Bewirtungsaufwendungen (§ 4 Abs. 5 Satz 1 Nr. 2 EStG)</div></div>
    </header>
    <table class="p-facts">
      <tr><th>Tag der Bewirtung</th><td>${esc(deDate($('fDate').value)) || '&nbsp;'}</td></tr>
      <tr><th>Ort der Bewirtung</th><td><b>${esc(p.name)}</b>${p.type ? ` <span class="p-muted">(${esc(p.type)})</span>` : ''}<br>${esc(p.street)}${p.street ? '<br>' : ''}${esc(p.zip)} ${esc(p.city)}${country && p.country !== 'DE' ? ', ' + esc(country.name) : ''}</td></tr>
      <tr><th>Gastgeber</th><td>${host ? esc(host.name) + (host.role ? `, ${esc(host.role)}` : '') : '&nbsp;'}</td></tr>
      <tr><th>Bewirtete Personen</th><td>${form.guests.length ? `<ol>${form.guests.map((g) => `<li>${esc(g.name)}${g.company ? ` <span class="p-muted">– ${esc(g.company)}</span>` : ''}</li>`).join('')}</ol>` : '&nbsp;'}</td></tr>
      <tr><th>Teilnehmer gesamt</th><td>${participants} Person${participants === 1 ? '' : 'en'}${$('fHostAttends').checked && host ? ' (einschließlich Gastgeber)' : ''}</td></tr>
      <tr><th>Anlass der Bewirtung</th><td>${esc(occasion) || '&nbsp;'}</td></tr>
    </table>

    <h2>Höhe der Aufwendungen</h2>
    <table class="p-amounts">
      <thead><tr><th></th><th>Netto</th><th>MwSt</th><th>Brutto</th></tr></thead>
      <tbody>
        ${row('Speisen und Getränke 19 %', f(c.line[19].gross), f(c.line[19].gross && c.line[19].net), f(c.line[19].gross && c.line[19].vat))}
        ${row('Speisen und Getränke 7 %', f(c.line[7].gross), f(c.line[7].gross && c.line[7].net), f(c.line[7].gross && c.line[7].vat))}
        ${row('Steuerfrei / 0 %', f(c.line[0].gross), f(c.line[0].gross), '–')}
        ${row('Trinkgeld', f(c.tip), f(c.tip), '–')}
        ${row('Auslandseinsatzentgelt Karte', f(c.fee), f(c.fee), '–')}
      </tbody>
      <tfoot><tr><td>Gesamtbetrag</td><td>${num2.format(c.net)}</td><td>${num2.format(c.vat)}</td><td>${eur.format(c.gross)}</td></tr></tfoot>
    </table>
    <table class="p-split">
      <tr><td>Vorsteuer${c.foreign ? ' (ausländische Rechnung, kein Vorsteuerabzug)' : ''}</td><td>${eur.format(c.inputTax)}</td></tr>
      <tr><td>Betriebsausgabe, abzugsfähig (70 % von ${num2.format(c.base7030)})</td><td>${eur.format(c.deductible)}</td></tr>
      <tr><td>Betriebsausgabe, nicht abzugsfähig (30 %)</td><td>${eur.format(c.nonDeductible)}</td></tr>
      ${c.feeFull && c.fee ? `<tr><td>Auslandseinsatzentgelt als Bankgebühr, voll abzugsfähig</td><td>${eur.format(c.fee)}</td></tr>` : ''}
    </table>
    <p class="p-note">${form.pages.length ? 'Die Rechnung ist als Anlage beigefügt.' : 'Rechnung: bitte beifügen.'}${c.tip ? ' Das Trinkgeld ist nicht auf der Rechnung ausgewiesen und wird vom Gastgeber durch Unterschrift bestätigt.' : ''}</p>

    <div class="p-sign">
      <div class="p-sign-field"><div class="p-sign-val">${esc($('fSignPlace').value)}${$('fSignPlace').value && $('fSignDate').value ? ', ' : ''}${esc(deDate($('fSignDate').value))}</div><div class="p-line">Ort, Datum</div></div>
      <div class="p-sign-field"><div class="p-sign-val sig">${form.signature ? `<img src="${form.signature}" alt="Unterschrift">` : ''}</div><div class="p-line">Unterschrift Gastgeber${host ? ` (${esc(host.name)})` : ''}</div></div>
    </div>
  </section>
  ${form.pages.map((pg, i) => `
  <section class="p-page p-receipt">
    <div class="p-receipt-h">Anlage ${form.pages.length > 1 ? `${i + 1}/${form.pages.length} ` : ''}– Beleg vom ${esc(deDate($('fDate').value))}, ${esc(p.name)}</div>
    <img src="${pg.src}" alt="Beleg">
  </section>`).join('')}`;
  $('print').innerHTML = pages;
  return missing;
}
async function doPrint() {
  const missing = buildPrint();
  if (missing.length && !confirmMissing(missing)) return;
  await Promise.all([...$('print').querySelectorAll('img')].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));
  const prevTitle = document.title;
  const p = placeFromFields();
  document.title = `Bewirtung ${$('fDate').value || ''} ${p.name || ''}`.trim();
  window.print();
  setTimeout(() => { document.title = prevTitle; }, 500);
}
function confirmMissing(missing) {
  return window.confirm(`Es fehlen noch Angaben: ${missing.join(', ')}.\n\nTrotzdem drucken?`);
}

// ---------- Neu ----------
let clearSig;
function resetForm() {
  form = freshForm();
  for (const id of ['fDate', 'fPlaceName', 'fStreet', 'fZip', 'fCity', 'fOccasionNote', 'a19', 'a7', 'a0', 'aTip', 'aFee', 'fGuestName', 'fGuestCompany']) $(id).value = '';
  $('fPlaceSel').value = ''; $('fPlaceType').value = 'Restaurant'; $('fCountry').value = 'DE'; $('fOccasion').value = '';
  $('fSignPlace').value = store.settings.signPlace; $('fSignDate').value = todayIso();
  $('btnDelPlace').hidden = true; $('rawBox').hidden = true; $('ocrStatus').textContent = ''; $('plzStatus').textContent = '';
  $('fileInput').value = '';
  clearSig?.();
  renderThumbs(); renderChips(); updateAmounts();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Export / Import ----------
function exportStore() {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `bewirtung-stammdaten-${todayIso()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importStore(file) {
  try {
    const s = JSON.parse(await file.text());
    const mergeBy = (a, b, key) => { for (const x of b || []) if (!a.some((y) => key(y) === key(x))) a.push(x); };
    mergeBy(store.places, s.places, (p) => p.id || p.name + p.city);
    mergeBy(store.hosts, s.hosts, (h) => h.id || h.name);
    mergeBy(store.guests, s.guests, (g) => g.name + '|' + (g.company || ''));
    for (const o of s.occasions || []) if (!store.occasions.includes(o)) store.occasions.push(o);
    if (s.settings) store.settings = { ...s.settings, ...Object.fromEntries(Object.entries(store.settings).filter(([, v]) => v)) };
    save(); renderAll(); loadSettings();
    alertStatus('✓ Stammdaten importiert');
  } catch { alertStatus('Import fehlgeschlagen: keine gültige Datei.'); }
}
const alertStatus = (t) => { $('plzStatus').textContent = t; };
function loadSettings() {
  $('sCompany').value = store.settings.company || '';
  $('sSignPlace').value = store.settings.signPlace || '';
}

// ---------- Ereignisse ----------
function bind() {
  const fi = $('fileInput'), drop = $('drop');
  fi.addEventListener('change', () => { if (fi.files.length) addFiles([...fi.files]); });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
  $('thumbs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    form.pages.splice(Number(b.dataset.i), 1);
    if (!form.pages.length) form.pdfText = '';
    renderThumbs();
  });
  $('btnOcr').onclick = runOcr;

  $('fPlaceSel').onchange = () => {
    const p = store.places.find((x) => x.id === $('fPlaceSel').value);
    $('btnDelPlace').hidden = !p;
    if (p) fillPlace(p);
  };
  $('btnSavePlace').onclick = savePlace;
  $('btnDelPlace').onclick = () => {
    const id = $('fPlaceSel').value;
    store.places = store.places.filter((p) => p.id !== id); save(); renderPlaces(); renderStamm();
    alertStatus('Ort gelöscht');
  };
  $('fZip').addEventListener('input', onZipInput);
  $('fCountry').addEventListener('change', () => { onZipInput(); updateAmounts(); });
  $('fCity').addEventListener('input', () => { form.autoCity = false; });

  $('fHost').onchange = () => { store.settings.lastHostId = $('fHost').value; save(); };
  $('btnAddHost').onclick = async () => {
    const v = await ask('Gastgeber anlegen', [{ label: 'Name', required: true }, { label: 'Funktion / Firma (optional)' }]);
    if (!v || !v[0]) return;
    const h = { id: uid(), name: v[0], role: v[1] };
    store.hosts.push(h); store.settings.lastHostId = h.id; save();
    renderHosts(); $('fHost').value = h.id; renderStamm();
  };
  $('btnAddGuest').onclick = addGuest;
  for (const id of ['fGuestName', 'fGuestCompany']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addGuest(); } });
  $('fGuestName').addEventListener('change', () => {
    const g = store.guests.find((x) => x.name.toLowerCase() === $('fGuestName').value.trim().toLowerCase());
    if (g && !$('fGuestCompany').value) $('fGuestCompany').value = g.company || '';
  });
  $('guestChips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    form.guests.splice(Number(b.dataset.i), 1); renderChips();
  });
  $('btnAddOccasion').onclick = async () => {
    const v = await ask('Anlass hinzufügen', [{ label: 'Anlass', required: true }]);
    if (!v || !v[0]) return;
    if (!store.occasions.includes(v[0])) store.occasions.push(v[0]);
    save(); renderOccasions(); $('fOccasion').value = v[0]; renderStamm();
  };

  document.querySelectorAll('.amt').forEach((el) => {
    el.addEventListener('input', updateAmounts);
    el.addEventListener('blur', () => { const n = parseAmount(el.value); el.value = Number.isFinite(n) && el.value.trim() ? num2.format(n) : ''; updateAmounts(); });
  });
  $('fFeeFull').addEventListener('change', updateAmounts);

  $('sCompany').addEventListener('change', () => { store.settings.company = $('sCompany').value.trim(); save(); });
  $('sSignPlace').addEventListener('change', () => {
    store.settings.signPlace = $('sSignPlace').value.trim(); save();
    if (!$('fSignPlace').value) $('fSignPlace').value = store.settings.signPlace;
  });
  $('stammLists').addEventListener('click', (e) => {
    const b = e.target.closest('button.x'); if (!b) return;
    store[b.dataset.kind].splice(Number(b.dataset.i), 1); save(); renderAll();
  });
  $('btnExport').onclick = exportStore;
  $('importFile').addEventListener('change', (e) => { if (e.target.files[0]) importStore(e.target.files[0]); e.target.value = ''; });

  $('btnPrint').onclick = doPrint; $('btnPrint2').onclick = doPrint;
  $('btnNew').onclick = () => { if (!form.pages.length && !form.guests.length || window.confirm('Aktuelle Abrechnung verwerfen und neu beginnen?')) resetForm(); };
  window.addEventListener('beforeprint', () => { if (!$('print').innerHTML) buildPrint(); });
  window.addEventListener('afterprint', () => { $('print').innerHTML = ''; });
}

// ---------- Start ----------
renderCountry();
loadSettings();
renderAll();
bind();
clearSig = initSignature();
$('fDate').value = '';
$('fSignDate').value = todayIso();
$('fSignPlace').value = store.settings.signPlace;
updateAmounts();
// Bekannte Orte in den PLZ-Cache übernehmen
for (const p of store.places) remember(p.country, p.zip, p.city);

// Für Tests
window.__bewirtung = { parseReceipt, applyParsed, buildPrint, calc };
