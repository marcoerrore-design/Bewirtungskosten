// Klassisches Skript (kein ES-Modul), damit die App auch per Doppelklick (file://) läuft.
(function () {
'use strict';
const { parseReceipt, parseAmount } = window.Receipt;
const { COUNTRIES, lookup, suggestFromCache, isComplete, normalizeZip, remember } = window.Plz;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const num2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round(n * 100) / 100;
const todayIso = () => new Date().toISOString().slice(0, 10);
const deDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
// "2026-11-15" -> "Sonntag, 15.11.2026"
const deDateLong = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${deDate(iso)}`;
};

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
    settings: { company: '', street: '', zip: '', city: '', country: 'DE', logo: '', lastHostId: '', ...(s.settings || {}) },
  };
}
let store = loadStore();
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {} };

// ---------- Formularzustand ----------
let form = freshForm();
function freshForm() {
  return { pages: [], pdfText: '', guests: [], ocrTotal: null, signature: null, autoCity: true, locationId: null };
}

// ---------- Dialog ----------
// Eigene Dialoge statt alert/confirm: die sind in eingebetteten Vorschauen gesperrt.
function confirmDlg(title, text, okLabel = 'OK') {
  return ask(title, [], okLabel, `<p class="dlg-text">${esc(text)}</p>`).then((v) => v !== null);
}
function ask(title, fields, okLabel = 'Speichern', html = '') {
  const dlg = $('dlg');
  $('dlgTitle').textContent = title;
  $('dlgOk').textContent = okLabel;
  $('dlgOk').hidden = !okLabel;
  dlg.querySelector('button[value="cancel"]').textContent = okLabel ? 'Abbrechen' : 'Schließen';
  $('dlgBody').innerHTML = html + fields.map((f, i) => f.options
    ? `<label>${esc(f.label)}<select data-i="${i}">${f.options.map((o) => `<option value="${esc(o.value ?? o)}" ${(o.value ?? o) === f.value ? 'selected' : ''}>${esc(o.label ?? o)}</option>`).join('')}</select></label>`
    : `<label>${esc(f.label)}<input data-i="${i}" value="${esc(f.value || '')}" ${f.required ? 'required' : ''} autocomplete="off"></label>`).join('');
  dlg.showModal();
  setTimeout(() => dlg.querySelector('input')?.focus(), 30);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      resolve([...dlg.querySelectorAll('#dlgBody [data-i]')].map((x) => x.value.trim()));
    }, { once: true });
  });
}

// ---------- Auswahllisten ----------
function renderCountry() {
  $('fCountry').innerHTML = COUNTRIES.map((c) => `<option value="${c.code}">${c.code} – ${esc(c.name)}</option>`).join('');
  $('sCountry').innerHTML = $('fCountry').innerHTML;
}
// ---------- Location (bearbeitbares Dropdown) ----------
const PLACE_TYPES = ['Restaurant', 'Hotel', 'Sonstiges'];
let locOpen = false, locActive = -1;
const selectedLocation = () => store.places.find((p) => p.id === form.locationId) || null;
function locItems() {
  const q = $('fLocation').value.trim().toLowerCase();
  const sel = selectedLocation();
  const sorted = [...store.places].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (!q || (sel && sel.name.toLowerCase() === q)) return sorted;
  return sorted.filter((p) => `${p.name} ${p.city || ''} ${p.street || ''}`.toLowerCase().includes(q));
}
function renderLocList() {
  const items = locItems();
  if (locActive >= items.length) locActive = items.length - 1;
  $('locList').innerHTML = items.length
    ? items.map((p, i) => `<li role="option" data-id="${p.id}" class="${i === locActive ? 'active' : ''}${p.id === form.locationId ? ' current' : ''}">
        <span class="loc-main"><b>${esc(p.name)}</b><small>${esc(p.type || 'Restaurant')}${p.city ? ' · ' + esc([p.zip, p.city].filter(Boolean).join(' ')) : ''}</small></span>
        <button type="button" class="loc-act" data-edit="${p.id}" aria-label="bearbeiten" title="bearbeiten">✎</button>
        <button type="button" class="loc-act" data-del="${p.id}" aria-label="löschen" title="löschen">×</button></li>`).join('')
    : `<li class="empty">${store.places.length ? 'Kein Treffer. Adresse ergänzen und mit „Location speichern“ neu anlegen.' : 'Noch keine Locations gespeichert. Namen eintippen, Adresse ergänzen und „Location speichern“ klicken.'}</li>`;
}
function openLoc(open) {
  locOpen = open; locActive = -1;
  $('locList').hidden = !open;
  $('fLocation').setAttribute('aria-expanded', String(open));
  if (open) renderLocList();
}
function selectLocation(p) {
  form.locationId = p.id;
  fillPlace(p);
  openLoc(false);
  updateLocState();
  changed();
}
function updateLocState() {
  const p = selectedLocation();
  $('btnDelPlace').hidden = !p;
  $('btnSavePlace').textContent = p ? 'Änderungen speichern' : 'Location speichern';
  $('locState').textContent = p
    ? `Gespeicherte Location (${p.type || 'Restaurant'}).`
    : ($('fLocation').value.trim() ? 'Neue Location. Mit „Location speichern“ in die Liste aufnehmen.' : '');
}
async function editLocation(id) {
  const p = store.places.find((x) => x.id === id);
  if (!p) return;
  openLoc(false);
  const v = await ask('Location bearbeiten', [
    { label: 'Name', value: p.name, required: true },
    { label: 'Art', value: p.type || 'Restaurant', options: PLACE_TYPES },
    { label: 'Straße, Hausnummer', value: p.street },
    { label: 'Land', value: p.country || 'DE', options: COUNTRIES.map((c) => ({ value: c.code, label: `${c.code} – ${c.name}` })) },
    { label: 'PLZ', value: p.zip },
    { label: 'Ort (leer lassen = automatisch aus PLZ)', value: p.city },
  ]);
  if (!v || !v[0]) return;
  Object.assign(p, { name: v[0], type: v[1], street: v[2], country: v[3], zip: v[4], city: v[5] });
  if (!p.city && p.zip && isComplete(p.country, p.zip)) p.city = (await lookup(p.country, p.zip))[0] || '';
  remember(p.country, p.zip, p.city);
  save(); renderStamm();
  if (form.locationId === p.id) fillPlace(p);
  updateLocState();
  alertStatus(`✓ „${p.name}“ gespeichert`);
}
async function deleteLocation(id) {
  const p = store.places.find((x) => x.id === id);
  if (!p || !(await confirmDlg('Location löschen', `„${p.name}“ aus der Liste löschen?`, 'Löschen'))) return;
  store.places = store.places.filter((x) => x.id !== id);
  if (form.locationId === id) form.locationId = null;
  save(); renderStamm(); if (locOpen) renderLocList(); updateLocState();
  alertStatus(`„${p.name}“ gelöscht`);
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
  const key = (g) => (g.name + '|' + (g.company || '')).toLowerCase();
  const taken = new Set(form.guests.map(key));
  const avail = store.guests.map((g, i) => ({ g, i })).filter(({ g }) => !taken.has(key(g)))
    .sort((a, b) => (a.g.company || '').localeCompare(b.g.company || '', 'de') || a.g.name.localeCompare(b.g.name, 'de'));
  $('fGuestSel').innerHTML = `<option value="">${store.guests.length ? (avail.length ? '– Person auswählen –' : '– alle gespeicherten Personen gewählt –') : '– noch keine Personen gespeichert –'}</option>` +
    avail.map(({ g, i }) => `<option value="${i}">${esc(g.name)}${g.company ? ' – ' + esc(g.company) : ''}</option>`).join('');
}
function renderChips() {
  $('guestChips').innerHTML = form.guests.length
    ? form.guests.map((g, i) => `<span class="chip${g.company ? '' : ' warn-chip'}">${esc(g.name)}${g.company ? ` <small>${esc(g.company)}</small>` : ' <small>Firma fehlt</small>'}<button type="button" data-i="${i}" aria-label="entfernen">×</button></span>`).join('')
    : '<span class="hint">Noch keine Gäste eingetragen.</span>';
}
function renderStamm() {
  const block = (title, kind, items, label) => `
    <div><h3>${title}</h3>${items.length ? `<ul>${items.map((x, i) => `<li><span>${label(x)}</span><button type="button" class="x" data-kind="${kind}" data-i="${i}" aria-label="löschen">×</button></li>`).join('')}</ul>` : '<p class="hint">leer</p>'}</div>`;
  $('stammLists').innerHTML =
    block('Locations', 'places', store.places, (p) => `<button type="button" class="linkish" data-edit="${p.id}" title="bearbeiten">${esc(p.name)} ✎</button> <small>${esc(p.zip)} ${esc(p.city)}</small>`) +
    block('Gastgeber', 'hosts', store.hosts, (h) => `${esc(h.name)} <small>${esc(h.role || '')}</small>`) +
    block('Gäste', 'guests', store.guests, (g) => `${esc(g.name)} <small>${esc(g.company || '')}</small>`) +
    block('Anlässe', 'occasions', store.occasions, (o) => esc(o));
}
function renderAll() { updateLocState(); renderHosts(); renderOccasions(); renderGuestLists(); renderChips(); renderStamm(); }

// ---------- Ort / PLZ ----------
function placeFromFields() {
  return {
    type: $('fPlaceType').value, name: $('fLocation').value.trim(), street: $('fStreet').value.trim(),
    country: $('fCountry').value, zip: $('fZip').value.trim(), city: $('fCity').value.trim(),
  };
}
function fillPlace(p) {
  $('fPlaceType').value = p.type || 'Restaurant';
  $('fLocation').value = p.name || '';
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
    if (!cities.length) { $('plzStatus').textContent = window.Plz.offline() ? 'PLZ-Suche hier nicht erreichbar – Ort bitte von Hand eintragen.' : 'PLZ nicht gefunden – Ort bitte von Hand eintragen.'; return; }
    if (form.autoCity || !$('fCity').value.trim()) { $('fCity').value = cities[0]; form.autoCity = true; changed(); }
    $('plzStatus').textContent = cities.length > 1 ? `${cities.length} Orte zu dieser PLZ – Auswahl im Feld „Ort“.` : `✓ ${cities[0]}`;
  }, 250);
}
async function savePlace() {
  const p = placeFromFields();
  if (!p.name) { alertStatus('Bitte zuerst einen Namen bei „Location“ eintragen.'); $('fLocation').focus(); return; }
  if (!p.city && p.zip && isComplete(p.country, p.zip)) { p.city = (await lookup(p.country, p.zip))[0] || ''; $('fCity').value = p.city; }
  let existing = selectedLocation() ||
    store.places.find((x) => x.name.toLowerCase() === p.name.toLowerCase() && (x.city || '') === p.city);
  const isNew = !existing;
  if (existing) Object.assign(existing, p); else { existing = { id: uid(), ...p }; store.places.push(existing); }
  remember(p.country, p.zip, p.city);
  save(); renderStamm();
  form.locationId = existing.id;
  updateLocState();
  alertStatus(isNew ? `✓ „${p.name}“ in die Location-Liste aufgenommen` : `✓ „${p.name}“ aktualisiert`);
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
function pushGuest(g) {
  form.guests.push({ name: g.name, company: g.company || '' });
  renderChips(); renderGuestLists(); changed();
}
async function addGuest() {
  const v = await ask('Bewirtete Person hinzufügen', [{ label: 'Name *', required: true }, { label: 'Firma *', required: true }], 'Hinzufügen');
  if (!v) return;
  const [name, company] = v;
  if (!name || !company) { alertStatus('Name und Firma sind Pflichtfelder.'); return; }
  let known = store.guests.find((g) => g.name.toLowerCase() === name.toLowerCase() && (g.company || '').toLowerCase() === company.toLowerCase());
  if (!known) { known = { name, company }; store.guests.push(known); save(); renderStamm(); }
  pushGuest(known);
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
// Bibliotheken liegen als klassische Skripte in vendor/ und werden erst bei Bedarf geladen.
const loaded = {};
function loadScript(src) {
  return loaded[src] || (loaded[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Datei fehlt: ' + src)); };
    document.head.appendChild(s);
  }));
}
async function getPdfjs() {
  // pdf.worker im Hauptthread laden: funktioniert auch ohne Webserver
  await loadScript('vendor/pdf.worker.min.js');
  await loadScript('vendor/pdf.min.js');
  return window.pdfjsLib;
}
function fileToDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
// Bild verkleinern (Handyfotos sind oft > 10 MB) und korrekt drehen
async function normalizeImage(file) {
  const url = await fileToDataUrl(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const max = 2400, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  if (s === 1 && file.size < 2.5e6 && /^data:image\/(jpeg|png)/.test(url)) return url;
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
  renderThumbs(); changed();
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
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const blobUrl = (code) => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
function simdSupported() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch { return false; }
}
async function getWorker() {
  if (worker) return worker;
  $('ocrStatus').textContent = 'Texterkennung wird geladen …';
  await loadScript('vendor/tesseract.min.js');
  await Promise.all([loadScript('vendor/tess-worker.js'), loadScript(simdSupported() ? 'vendor/tess-core-simd.js' : 'vendor/tess-core.js'), loadScript('vendor/tess-deu.js')]);
  const emb = window.__EMB;
  worker = await window.Tesseract.createWorker([{ code: 'deu', data: b64ToBytes(emb.deu) }], 1, {
    // Kern und Worker in einen Blob: so muss der Worker nichts nachladen (geht auch unter file://)
    workerPath: blobUrl(emb.core + '\n;self.TesseractCore = typeof TesseractCore !== "undefined" ? TesseractCore : self.TesseractCore;\n' + emb.worker),
    workerBlobURL: false,
    cacheMethod: 'none',
    gzip: true,
    logger: (m) => {
      if (m.status === 'recognizing text') $('ocrStatus').textContent = `Lese Beleg … ${Math.round(m.progress * 100)} %`;
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
    selectLocation(saved);
    found.push(`Ort „${saved.name}“ (gespeichert)`);
  } else if (!form.locationId) {
    if (r.name && !$('fLocation').value) { $('fLocation').value = r.name; updateLocState(); }
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
  changed();
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
  const end = () => { if (drawing && dirty) { form.signature = cv.toDataURL('image/png'); changed(); } drawing = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  const clear = () => { ctx.clearRect(0, 0, cv.width, cv.height); form.signature = null; dirty = false; };
  $('btnSigClear').onclick = () => { clear(); changed(); };
  return {
    clear,
    set(src) {
      clear();
      if (!src) return;
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, cv.width, cv.height); };
      img.src = src; form.signature = src; dirty = true;
    },
  };
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
  else if (form.guests.some((g) => !g.company)) missing.push('Firma bei ' + form.guests.filter((g) => !g.company).map((g) => g.name).join(', '));
  if (!occasion) missing.push('Anlass');
  if (!c.gross) missing.push('Betrag');

  const pages = `
  <section class="p-page">
    <header class="p-head">
      ${store.settings.logo || company ? `<div class="p-firm">${store.settings.logo ? `<img class="p-logo" src="${store.settings.logo}" alt="">` : ''}${company ? `<div class="p-company">${esc(company)}</div>${companyLines().map((l) => `<div class="p-addr">${esc(l)}</div>`).join('')}` : ''}</div>` : ''}
      <div><h1>Bewirtungskosten-Abrechnung</h1>
      <div class="p-law">Angaben zum Nachweis der Höhe und der betrieblichen Veranlassung von Bewirtungsaufwendungen (§ 4 Abs. 5 Satz 1 Nr. 2 EStG)</div></div>
    </header>
    <table class="p-facts">
      <tr><th>Tag der Bewirtung</th><td>${esc(deDateLong($('fDate').value)) || '&nbsp;'}</td></tr>
      <tr><th>Ort der Bewirtung${p.type ? ` (${esc(p.type)})` : ''}</th><td><b>${esc(p.name)}</b><br>${esc(p.street)}${p.street ? '<br>' : ''}${esc(p.zip)} ${esc(p.city)}${country && p.country !== 'DE' ? ', ' + esc(country.name) : ''}</td></tr>
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
const PAGES_URL = 'https://marcoerrore-design.github.io/Bewirtungskosten/';
const inPreview = (() => { try { return window.self !== window.top; } catch { return true; } })();
function pdfData() {
  const c = updateAmounts();
  const p = placeFromFields();
  const host = store.hosts.find((h) => h.id === $('fHost').value);
  const country = COUNTRIES.find((x) => x.code === p.country);
  const hostAttends = $('fHostAttends').checked && host;
  const n = form.guests.length + (hostAttends ? 1 : 0);
  syncSignPlace();
  const signPlaceDate = [$('fSignPlace').value.trim(), deDate($('fSignDate').value)].filter(Boolean).join(', ');
  const safe = (t) => String(t || '').replace(/[^\wäöüÄÖÜß -]+/g, '').trim().replace(/\s+/g, '-');
  return {
    company: store.settings.company, companyLines: companyLines(), logo: store.settings.logo,
    date: deDate($('fDate').value),
    dateLong: deDateLong($('fDate').value),
    place: { ...p, countryName: country && p.country !== 'DE' ? country.name : '' },
    host: host ? host.name + (host.role ? `, ${host.role}` : '') : '',
    hostName: host ? host.name : '',
    guests: form.guests,
    participants: `${n} Person${n === 1 ? '' : 'en'}${hostAttends ? ' (einschließlich Gastgeber)' : ''}`,
    occasion: [$('fOccasion').value, $('fOccasionNote').value.trim()].filter(Boolean).join(' – '),
    calc: c,
    note: (form.pages.length ? 'Die Rechnung ist als Anlage beigefügt.' : 'Rechnung: bitte beifügen.') + (c.tip ? ' Das Trinkgeld ist nicht auf der Rechnung ausgewiesen und wird vom Gastgeber durch Unterschrift bestätigt.' : ''),
    signPlaceDate, signature: form.signature, pages: form.pages,
    fileName: `Bewirtungskosten-Abrechnung_${$('fDate').value || todayIso()}${p.name ? '_' + safe(p.name) : ''}.pdf`,
  };
}
let lastPdf = null;
async function doPrint() {
  const missing = buildPrint();
  if (inPreview) {
    await ask('PDF in der Vorschau nicht möglich', [], '', `<p class="dlg-text">Diese Vorschau darf keine Dateien speichern. Für das PDF bitte die Online-Version öffnen:</p><p><a href="${PAGES_URL}" target="_blank" rel="noopener">${PAGES_URL}</a></p>`);
    return;
  }
  if (missing.length && !(await confirmDlg('Angaben fehlen', `Es fehlen noch: ${missing.join(', ')}. Trotzdem ein PDF erstellen?`, 'Trotzdem erstellen'))) return;
  const btns = [$('btnPrint'), $('btnPrint2')];
  btns.forEach((b) => { b.disabled = true; });
  const label = $('btnPrint2').textContent;
  $('btnPrint2').textContent = 'PDF wird erstellt …';
  try {
    await loadScript('vendor/jspdf.umd.min.js');
    await loadScript('js/pdf-export.js');
    const d = pdfData();
    const blob = await window.PdfExport.build(d);
    if (lastPdf) URL.revokeObjectURL(lastPdf.url);
    lastPdf = { blob, name: d.fileName, url: URL.createObjectURL(blob) };
    current.status = 'pdf'; current.pdfAt = Date.now(); await saveNow();
    showPdfReady();
  } catch (e) {
    console.error(e);
    await ask('PDF konnte nicht erstellt werden', [], '', `<p class="dlg-text">${esc(e.message || e)}</p>`);
  } finally {
    btns.forEach((b) => { b.disabled = false; });
    $('btnPrint2').textContent = label;
  }
}
function showPdfReady() {
  const file = new File([lastPdf.blob], lastPdf.name, { type: 'application/pdf' });
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  const kb = Math.round(lastPdf.blob.size / 1024);
  const html = `<p class="dlg-text">${esc(lastPdf.name)} · ${kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'}</p>
    <div class="pdf-actions">
      ${canShare ? '<button type="button" class="primary" data-pdf="share">Teilen, drucken oder sichern</button>' : ''}
      <a class="btn-like ${canShare ? '' : 'primary'}" data-pdf="download" href="${lastPdf.url}" download="${esc(lastPdf.name)}">PDF herunterladen</a>
      <a class="btn-like" data-pdf="open" href="${lastPdf.url}" target="_blank" rel="noopener">PDF ansehen</a>
      ${window.matchMedia('(hover: hover)').matches ? '<button type="button" class="ghost" data-pdf="print">Direkt drucken (Browser)</button>' : ''}
    </div>
    ${canShare ? '<p class="hint">Im Teilen-Menü findest du „Drucken“, „In Dateien sichern“ und Mail.</p>' : ''}`;
  const dlg = $('dlg');
  ask('PDF ist fertig', [], '', html);
  $('dlgBody').querySelector('.pdf-actions').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-pdf]'); if (!t) return;
    if (t.dataset.pdf === 'share') {
      e.preventDefault();
      try { await navigator.share({ files: [file], title: lastPdf.name }); dlg.close(); } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
    } else if (t.dataset.pdf === 'print') {
      e.preventDefault(); dlg.close();
      const prev = document.title; document.title = lastPdf.name.replace(/\.pdf$/, '');
      window.print(); setTimeout(() => { document.title = prev; }, 500);
    }
  });
}

// ---------- Neu ----------
let sig;
function resetForm() {
  form = freshForm();
  for (const id of ['fDate', 'fLocation', 'fStreet', 'fZip', 'fCity', 'fOccasionNote', 'a19', 'a7', 'a0', 'aTip', 'aFee']) $(id).value = '';
  $('fPlaceType').value = 'Restaurant'; $('fCountry').value = 'DE'; $('fOccasion').value = '';
  $('fSignPlace').value = ''; $('fSignDate').value = todayIso();
  updateLocState(); openLoc(false); $('rawBox').hidden = true; $('ocrStatus').textContent = ''; $('plzStatus').textContent = '';
  $('fileInput').value = '';
  sig?.clear();
  renderThumbs(); renderChips(); updateAmounts();
  window.scrollTo({ top: 0 });
}

// ---------- Export / Import ----------
// Datei sichern: auf Handy/Tablet über das Teilen-Menü („In Dateien sichern“), sonst als Download
async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  const touch = window.matchMedia('(hover: none)').matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
function exportStore() {
  saveFile(new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' }), `bewirtung-stammdaten-${todayIso()}.json`);
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
function renderLogo() {
  const l = store.settings.logo;
  $('logoBox').innerHTML = l ? `<img src="${l}" alt="Firmenlogo">` : '<span class="hint">Kein Logo</span>';
  $('btnLogoDel').hidden = !l;
}
// Logo als PNG (Transparenz bleibt erhalten), höchstens 800 px breit/hoch
async function logoToDataUrl(file) {
  const url = await fileToDataUrl(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const w0 = img.naturalWidth || 800, h0 = img.naturalHeight || 300;
  const s = Math.min(1, 800 / Math.max(w0, h0));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w0 * s)); cv.height = Math.max(1, Math.round(h0 * s));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/png');
}
function companyLines() {
  const st = store.settings;
  const country = COUNTRIES.find((c) => c.code === st.country);
  return [st.street, [st.zip, st.city].filter(Boolean).join(' ') + (country && st.country !== 'DE' && (st.zip || st.city) ? ', ' + country.name : '')].filter((x) => x && x.trim());
}
const alertStatus = (t) => { $('plzStatus').textContent = t; };
function loadSettings() {
  for (const [id, k] of [['sCompany', 'company'], ['sStreet', 'street'], ['sZip', 'zip'], ['sCity', 'city'], ['sCountry', 'country']]) $(id).value = store.settings[k] || (k === 'country' ? 'DE' : '');
  renderLogo();
}

// ---------- Ereignisse ----------
function bind() {
  const fi = $('fileInput'), drop = $('drop');
  fi.addEventListener('change', () => { if (fi.files.length) addFiles([...fi.files]); fi.value = ''; });
  const cam = $('camInput');
  cam.addEventListener('change', () => { if (cam.files.length) addFiles([...cam.files]); cam.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
  $('thumbs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    form.pages.splice(Number(b.dataset.i), 1);
    if (!form.pages.length) form.pdfText = '';
    renderThumbs(); changed();
  });
  $('btnOcr').onclick = runOcr;

  const locInput = $('fLocation');
  locInput.addEventListener('input', () => {
    const sel = selectedLocation();
    if (sel && sel.name !== locInput.value.trim()) form.locationId = null;
    openLoc(true); updateLocState();
  });
  locInput.addEventListener('focus', () => openLoc(true));
  locInput.addEventListener('keydown', (e) => {
    const items = locItems();
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!locOpen) openLoc(true); locActive = Math.min(items.length - 1, locActive + 1); renderLocList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); locActive = Math.max(0, locActive - 1); renderLocList(); }
    else if (e.key === 'Enter') { if (locOpen && items[locActive]) { e.preventDefault(); selectLocation(items[locActive]); } }
    else if (e.key === 'Escape') openLoc(false);
  });
  $('btnLocToggle').onclick = () => { openLoc(!locOpen); if (locOpen) locInput.focus(); };
  $('locList').addEventListener('mousedown', (e) => e.preventDefault()); // Fokus im Feld lassen
  $('locList').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]'), li = e.target.closest('li[data-id]');
    if (ed) return editLocation(ed.dataset.edit);
    if (del) return deleteLocation(del.dataset.del);
    if (li) selectLocation(store.places.find((p) => p.id === li.dataset.id));
  });
  document.addEventListener('click', (e) => { if (locOpen && !$('locBox').contains(e.target)) openLoc(false); });
  $('fPlaceType').addEventListener('change', updateLocState);
  $('btnSavePlace').onclick = savePlace;
  $('btnDelPlace').onclick = () => { if (form.locationId) deleteLocation(form.locationId); };
  $('fZip').addEventListener('input', onZipInput);
  $('fCountry').addEventListener('change', () => { onZipInput(); updateAmounts(); });
  $('fCity').addEventListener('input', () => { form.autoCity = false; });

  $('fHost').onchange = () => { store.settings.lastHostId = $('fHost').value; save(); };
  $('btnAddHost').onclick = async () => {
    const v = await ask('Gastgeber anlegen', [{ label: 'Name', required: true }, { label: 'Funktion / Firma (optional)' }]);
    if (!v || !v[0]) return;
    const h = { id: uid(), name: v[0], role: v[1] };
    store.hosts.push(h); store.settings.lastHostId = h.id; save();
    renderHosts(); $('fHost').value = h.id; renderStamm(); changed();
  };
  $('btnAddGuest').onclick = addGuest;
  $('fGuestSel').addEventListener('change', async () => {
    const g = store.guests[Number($('fGuestSel').value)];
    $('fGuestSel').value = '';
    if (!g) return;
    if (!g.company) {
      const v = await ask(`Firma von ${g.name}`, [{ label: 'Firma *', required: true }], 'Übernehmen');
      if (!v || !v[0]) return;
      g.company = v[0]; save(); renderStamm();
    }
    pushGuest(g);
  });
  $('guestChips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    form.guests.splice(Number(b.dataset.i), 1); renderChips(); renderGuestLists(); changed();
  });
  $('btnAddOccasion').onclick = async () => {
    const v = await ask('Anlass hinzufügen', [{ label: 'Anlass', required: true }]);
    if (!v || !v[0]) return;
    if (!store.occasions.includes(v[0])) store.occasions.push(v[0]);
    save(); renderOccasions(); $('fOccasion').value = v[0]; renderStamm(); changed();
  };

  document.querySelectorAll('.amt').forEach((el) => {
    el.addEventListener('input', updateAmounts);
    el.addEventListener('blur', () => { const n = parseAmount(el.value); el.value = Number.isFinite(n) && el.value.trim() ? num2.format(n) : ''; updateAmounts(); });
  });
  $('fFeeFull').addEventListener('change', updateAmounts);

  for (const [id, k] of [['sCompany', 'company'], ['sStreet', 'street'], ['sZip', 'zip'], ['sCity', 'city'], ['sCountry', 'country']]) {
    $(id).addEventListener('change', () => { store.settings[k] = $(id).value.trim(); save(); });
  }
  $('sZip').addEventListener('input', async () => {
    const cc = $('sCountry').value, z = $('sZip').value;
    if (!isComplete(cc, z) || $('sCity').value.trim()) return;
    const cities = await lookup(cc, z);
    if (cities[0] && !$('sCity').value.trim()) { $('sCity').value = cities[0]; store.settings.city = cities[0]; save(); }
  });
  $('sLogo').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { store.settings.logo = await logoToDataUrl(f); save(); renderLogo(); }
    catch { alertStatus('Logo konnte nicht gelesen werden.'); }
  });
  $('btnLogoDel').onclick = () => { store.settings.logo = ''; save(); renderLogo(); };
  $('stammLists').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]'); if (ed) return editLocation(ed.dataset.edit);
    const b = e.target.closest('button.x'); if (!b) return;
    store[b.dataset.kind].splice(Number(b.dataset.i), 1); save(); renderAll();
  });
  $('btnExport').onclick = exportStore;
  $('importFile').addEventListener('change', (e) => { if (e.target.files[0]) importStore(e.target.files[0]); e.target.value = ''; });

  $('btnPrint').onclick = doPrint; $('btnPrint2').onclick = doPrint;
  $('btnNew').onclick = () => newReport();
  $('btnBack').onclick = async () => { await saveNow(); showList(); };
  $('btnSettings').onclick = () => showView('viewSettings');
  $('btnSettingsBack').onclick = () => showList();
  $('btnDeleteReport').onclick = deleteReport;
  $('btnBackup').onclick = backupAll;
  $('restoreFile').addEventListener('change', (e) => { if (e.target.files[0]) restoreAll(e.target.files[0]); e.target.value = ''; });
  $('reportList').addEventListener('click', (e) => { const li = e.target.closest('[data-id]'); if (li) openReport(li.dataset.id); });
  document.querySelectorAll('.step-head').forEach((h) => h.addEventListener('click', () => {
    const n = Number(h.closest('.step').dataset.step);
    openStep(openStepNo === n ? 0 : n);
  }));
  document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => openStep(Number(b.dataset.next), true)));
  $('viewEdit').addEventListener('input', (e) => { if (!/^fGuest/.test(e.target.id)) changed(); });
  $('viewEdit').addEventListener('change', (e) => { if (!/^fGuest/.test(e.target.id)) changed(); });
  window.addEventListener('beforeprint', () => { if (!$('print').innerHTML) buildPrint(); });
  window.addEventListener('afterprint', () => { $('print').innerHTML = ''; });
}

// ---------- Abrechnungen speichern (IndexedDB) ----------
const FIELD_IDS = ['fDate', 'fPlaceType', 'fLocation', 'fStreet', 'fCountry', 'fZip', 'fCity', 'fHost', 'fOccasion', 'fOccasionNote',
  'a19', 'a7', 'a0', 'aTip', 'aFee', 'fSignPlace', 'fSignDate'];
const CHECK_IDS = ['fHostAttends', 'fFeeFull'];
const CUR_KEY = 'bewirtung.currentReport';
let current = null; // { id, createdAt, status }
let saveTimer = null, restoring = false;
const Reports = window.Reports;

function newCurrent() { return { id: 'r' + Date.now().toString(36) + uid(), createdAt: Date.now(), status: 'entwurf' }; }
function collectReport() {
  const fields = {}, checks = {};
  for (const id of FIELD_IDS) fields[id] = $(id).value;
  for (const id of CHECK_IDS) checks[id] = $(id).checked;
  const c = calc();
  return {
    ...current, updatedAt: Date.now(), fields, checks,
    guests: form.guests, pages: form.pages, pdfText: form.pdfText, signature: form.signature,
    ocrTotal: form.ocrTotal, locationId: form.locationId, rawText: $('rawText').textContent,
    summary: { date: fields.fDate, place: fields.fLocation, city: fields.fCity, gross: c.gross, guests: form.guests.length,
      host: store.hosts.find((h) => h.id === fields.fHost)?.name || '' },
  };
}
function isEmptyReport(r) {
  return !r.pages.length && !r.guests.length && !r.signature && !r.fields.fDate && !r.fields.fLocation && !r.summary.gross && !r.fields.fOccasion;
}
function syncSignPlace() { $('fSignPlace').value = $('fCity').value.trim(); }
function changed() {
  syncSignPlace();
  if (restoring || !current) return;
  updateSummaries();
  $('saveState').textContent = 'Speichert …';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!current || !Reports) return;
  const r = collectReport();
  if (isEmptyReport(r) && !current.saved) { $('saveState').textContent = ''; return; }
  try {
    await Reports.put(r);
    current.saved = true;
    try { localStorage.setItem(CUR_KEY, current.id); } catch {}
    $('saveState').textContent = '✓ Gespeichert';
  } catch (e) {
    console.error(e);
    $('saveState').textContent = 'Nicht gespeichert – Speicher voll?';
  }
}
// iPhone beendet Web-Apps im Hintergrund: beim Verlassen sofort sichern
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
window.addEventListener('pagehide', () => { saveNow(); });

function showView(id) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== id;
  window.scrollTo({ top: 0 });
}
async function showList() {
  current = null;
  try { localStorage.removeItem(CUR_KEY); } catch {}
  showView('viewList');
  await renderReportList();
}
async function renderReportList() {
  let all = [];
  try { all = Reports ? await Reports.all() : []; } catch (e) { console.error(e); }
  all.sort((a, b) => (b.fields?.fDate || '').localeCompare(a.fields?.fDate || '') || b.updatedAt - a.updatedAt);
  const year = String(new Date().getFullYear());
  const thisYear = all.filter((r) => (r.fields?.fDate || '').startsWith(year));
  $('listStats').textContent = all.length
    ? `${all.length} Abrechnung${all.length === 1 ? '' : 'en'} · ${year}: ${eur.format(thisYear.reduce((s, r) => s + (r.summary?.gross || 0), 0))}`
    : '';
  $('reportList').innerHTML = all.length ? all.map((r) => {
    const s = r.summary || {};
    const thumb = r.pages?.[0]?.src;
    const done = r.status === 'pdf';
    return `<li><button type="button" class="report" data-id="${r.id}">
      <span class="r-thumb">${thumb ? `<img src="${thumb}" alt="">` : '<span aria-hidden="true">🧾</span>'}</span>
      <span class="r-main">
        <b>${esc(s.place || 'Ohne Location')}</b>
        <small>${s.date ? esc(deDate(s.date)) : 'ohne Datum'}${s.city ? ' · ' + esc(s.city) : ''}${s.guests ? ` · ${s.guests} Gast${s.guests === 1 ? '' : 'e'}` : ''}</small>
        <span class="pill ${done ? 'ok' : ''}">${done ? 'PDF erstellt' : 'Entwurf'}</span>
      </span>
      <span class="r-sum">${s.gross ? eur.format(s.gross) : '–'}</span>
    </button></li>`;
  }).join('') : `<li class="empty-list"><b>Noch keine Abrechnungen</b><span>Tippe auf „Neue Abrechnung“ und fotografiere den Beleg. Alles wird automatisch auf diesem Gerät gespeichert.</span></li>`;
}
function newReport() {
  resetForm();
  current = newCurrent();
  $('editTitle').textContent = 'Neue Abrechnung';
  $('saveState').textContent = '';
  $('btnDeleteReport').hidden = true;
  showView('viewEdit');
  updateSummaries();
  openStep(1);
}
async function openReport(id) {
  let r = null;
  try { r = await Reports.get(id); } catch {}
  if (!r) return showList();
  restoring = true;
  resetForm();
  current = { id: r.id, createdAt: r.createdAt, status: r.status || 'entwurf', saved: true };
  for (const fid of FIELD_IDS) if (r.fields && fid in r.fields) $(fid).value = r.fields[fid];
  for (const cid of CHECK_IDS) if (r.checks && cid in r.checks) $(cid).checked = r.checks[cid];
  form.guests = r.guests || []; form.pages = r.pages || []; form.pdfText = r.pdfText || '';
  form.ocrTotal = r.ocrTotal ?? null; form.locationId = r.locationId || null; form.autoCity = false;
  sig.set(r.signature || null);
  if (r.rawText) { $('rawText').textContent = r.rawText; $('rawBox').hidden = false; }
  renderThumbs(); renderChips(); updateAmounts(); updateLocState();
  restoring = false;
  try { localStorage.setItem(CUR_KEY, r.id); } catch {}
  $('editTitle').textContent = 'Abrechnung bearbeiten';
  $('saveState').textContent = '✓ Gespeichert';
  $('btnDeleteReport').hidden = false;
  showView('viewEdit');
  updateSummaries();
  openStep(firstOpenStep());
}
async function deleteReport() {
  if (!current) return;
  if (!(await confirmDlg('Abrechnung löschen', 'Diese Abrechnung mit allen Belegen endgültig von diesem Gerät löschen?', 'Löschen'))) return;
  clearTimeout(saveTimer);
  try { await Reports.remove(current.id); } catch {}
  showList();
}
async function startup() {
  Reports?.persist();
  let id = null;
  try { id = localStorage.getItem(CUR_KEY); } catch {}
  if (id) await openReport(id); else await showList();
}

// ---------- Schritte ----------
let openStepNo = 0;
function openStep(n, scroll) {
  openStepNo = n;
  for (const s of document.querySelectorAll('.step')) {
    const on = Number(s.dataset.step) === n;
    s.classList.toggle('open', on);
    s.querySelector('.step-head').setAttribute('aria-expanded', String(on));
  }
  const el = document.querySelector(`.step[data-step="${n}"]`);
  if (el && scroll) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
}
function stepState() {
  const host = store.hosts.find((h) => h.id === $('fHost').value);
  const c = calc();
  const occ = $('fOccasion').value;
  return {
    1: { done: form.pages.length > 0, sum: form.pages.length ? `${form.pages.length} Seite${form.pages.length === 1 ? '' : 'n'}` : 'Foto oder PDF hinzufügen' },
    2: { done: !!($('fDate').value && $('fLocation').value.trim()), sum: [deDate($('fDate').value), $('fLocation').value.trim(), $('fCity').value.trim()].filter(Boolean).join(' · ') || 'Datum und Location' },
    3: { done: !!(host && form.guests.length && occ), sum: [host?.name, form.guests.length ? `${form.guests.length} Gast${form.guests.length === 1 ? '' : 'e'}` : '', occ].filter(Boolean).join(' · ') || 'Gastgeber, Gäste, Anlass' },
    4: { done: c.gross > 0, sum: c.gross ? `${eur.format(c.gross)} brutto` : 'Beträge prüfen' },
    5: { done: !!form.signature, sum: form.signature ? `unterschrieben${$('fSignPlace').value ? ', ' + $('fSignPlace').value : ''}` : 'optional, sonst von Hand' },
  };
}
function updateSummaries() {
  const st = stepState();
  for (const [n, s] of Object.entries(st)) {
    const el = document.querySelector(`.step[data-step="${n}"]`);
    if (!el) continue;
    el.classList.toggle('done', s.done);
    $('sum' + n).textContent = s.sum;
  }
}
function firstOpenStep() {
  const st = stepState();
  for (const n of [1, 2, 3, 4]) if (!st[n].done) return n;
  return 0;
}

// ---------- Komplett-Backup ----------
async function backupAll() {
  $('backupStatus').textContent = 'Backup wird erstellt …';
  try {
    if (current) await saveNow();
    const reports = await Reports.all();
    const data = { app: 'bewirtungskosten', version: 1, exportedAt: new Date().toISOString(), store, reports };
    const ok = await saveFile(new Blob([JSON.stringify(data)], { type: 'application/json' }), `bewirtung-backup-${todayIso()}.json`);
    $('backupStatus').textContent = ok ? `✓ Backup mit ${reports.length} Abrechnung${reports.length === 1 ? '' : 'en'} erstellt.` : '';
  } catch (e) { $('backupStatus').textContent = 'Backup fehlgeschlagen: ' + (e.message || e); }
}
async function restoreAll(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.store) await importStore(new File([JSON.stringify(data.store)], 's.json'));
    else if (!data.reports) { await importStore(file); return; }
    let n = 0;
    for (const r of data.reports || []) {
      const have = await Reports.get(r.id);
      if (!have || (r.updatedAt || 0) > (have.updatedAt || 0)) { await Reports.put(r); n++; }
    }
    $('backupStatus').textContent = `✓ Backup eingespielt: ${n} Abrechnung${n === 1 ? '' : 'en'} übernommen.`;
  } catch (e) { $('backupStatus').textContent = 'Das ist keine gültige Backup-Datei.'; }
}

// ---------- Start ----------
renderCountry();
loadSettings();
renderAll();
bind();
sig = initSignature();
$('fDate').value = '';
$('fSignDate').value = todayIso();
updateAmounts();
startup();
// Bekannte Orte in den PLZ-Cache übernehmen
for (const p of store.places) remember(p.country, p.zip, p.city);

// Offline-Fähigkeit und Installation als App (nur über https, nicht per Doppelklick)
if ('serviceWorker' in navigator && location.protocol === 'https:' && !inPreview) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Hinweis „Zum Home-Bildschirm“ (iPhone/iPad) bzw. Installieren-Knopf (Android/Chrome)
(function installHint() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let dismissed = false;
  try { dismissed = localStorage.getItem('bewirtung.installHint') === 'off'; } catch {}
  if (standalone || dismissed || inPreview || location.protocol !== 'https:') return;
  const bar = $('installBar');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    $('installText').innerHTML = 'Als App nutzen: in Safari auf <b>Teilen</b> <span aria-hidden="true">⬆︎</span> tippen, dann <b>„Zum Home-Bildschirm“</b>.';
    bar.hidden = false;
  }
  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e;
    $('installText').textContent = 'Bewirtungskosten als App auf diesem Gerät installieren?';
    $('btnInstall').hidden = false; bar.hidden = false;
  });
  $('btnInstall').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; bar.hidden = true; };
  $('btnInstallClose').onclick = () => { bar.hidden = true; try { localStorage.setItem('bewirtung.installHint', 'off'); } catch {} };
})();

// Für Tests
window.__bewirtung = { parseReceipt, applyParsed, buildPrint, calc, pdfData: () => pdfData(), saveNow: () => saveNow(), get form() { return form; }, get current() { return current; } };
})();
