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
  return { belege: [], guests: [], signature: null, autoCity: true, locationId: null, autoAmounts: null };
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
// Bewirtete Personen: Kunden/Geschäftspartner (kind leer) und Mitarbeiter (kind 'mitarbeiter')
const isEmp = (g) => g.kind === 'mitarbeiter';
const guestKey = (g) => ((isEmp(g) ? 'm|' : 'k|') + g.name + '|' + (g.company || '')).toLowerCase();
const hostName = () => (store.hosts.find((h) => h.id === $('fHost').value)?.name || '').toLowerCase();
function availableGuests(emp) {
  const taken = new Set(form.guests.map(guestKey));
  return store.guests.map((g, i) => ({ g, i }))
    .filter(({ g }) => isEmp(g) === emp && !taken.has(guestKey(g)) && !(emp && g.name.toLowerCase() === hostName()))
    .sort((a, b) => (emp ? 0 : (a.g.company || '').localeCompare(b.g.company || '', 'de')) || a.g.name.localeCompare(b.g.name, 'de'));
}
function renderGuestLists() {
  const fill = (id, emp, word) => {
    const all = store.guests.filter((g) => isEmp(g) === emp).length, avail = availableGuests(emp);
    $(id).innerHTML = `<option value="">${all ? (avail.length ? `– ${word} auswählen –` : `– alle ${emp ? 'Mitarbeiter' : 'Kunden'} gewählt –`) : `– noch keine ${emp ? 'Mitarbeiter' : 'Kunden'} gespeichert –`}</option>` +
      avail.map(({ g, i }) => `<option value="${i}">${esc(g.name)}${g.company && !emp ? ' – ' + esc(g.company) : ''}</option>`).join('');
    return avail.length;
  };
  fill('fGuestSel', false, 'Kunden');
  const n = fill('fEmpSel', true, 'Mitarbeiter');
  $('btnAllEmp').disabled = !n;
  $('btnAllEmp').textContent = n ? `Alle Mitarbeiter hinzufügen (${n})` : 'Alle Mitarbeiter hinzufügen';
}
function renderChips() {
  $('guestChips').innerHTML = form.guests.length
    ? form.guests.map((g, i) => `<span class="chip${isEmp(g) ? ' emp-chip' : (g.company ? '' : ' warn-chip')}">${esc(g.name)}${isEmp(g) ? ' <small>Mitarbeiter</small>' : (g.company ? ` <small>${esc(g.company)}</small>` : ' <small>Firma fehlt</small>')}<button type="button" data-i="${i}" aria-label="entfernen">×</button></span>`).join('')
    : '<span class="hint">Noch keine Gäste eingetragen.</span>';
}
// Stammdaten in den Einstellungen: jede Liste einzeln aufklappbar (Zustand bleibt beim Neuzeichnen erhalten)
const stammOpen = new Set();
function renderStamm() {
  const block = (title, kind, items, label) => `
    <details class="card fold" data-fold="${kind}" ${stammOpen.has(kind) ? 'open' : ''}>
      <summary><span><b>${title}</b><small>${items.length} ${items.length === 1 ? 'Eintrag' : 'Einträge'}</small></span></summary>
      <div class="fold-body">${items.length ? `<ul>${items.map((x, i) => `<li><span>${label(x)}</span><button type="button" class="x" data-kind="${kind}" data-i="${i}" aria-label="löschen">×</button></li>`).join('')}</ul>` : '<p class="hint">Noch keine Einträge.</p>'}</div>
    </details>`;
  const blockIdx = (title, kind, fold, items, label, extra = '') => `
    <details class="card fold" data-fold="${fold}" ${stammOpen.has(fold) ? 'open' : ''}>
      <summary><span><b>${title}</b><small>${items.length} ${items.length === 1 ? 'Eintrag' : 'Einträge'}</small></span></summary>
      <div class="fold-body">${items.length ? `<ul>${items.map(({ g, i }) => `<li><span>${label(g)}</span><span class="li-actions"><button type="button" class="ghost small move" data-move="${i}" title="${isEmp(g) ? 'zu Kunden verschieben' : 'zu Mitarbeitern verschieben'}">⇄ ${isEmp(g) ? 'Kunde' : 'Mitarbeiter'}</button><button type="button" class="x" data-kind="${kind}" data-i="${i}" aria-label="löschen">×</button></span></li>`).join('')}</ul>` : '<p class="hint">Noch keine Einträge.</p>'}${extra ? `<div class="row-actions start mt-s">${extra}</div>` : ''}</div>
    </details>`;
  $('stammLists').innerHTML =
    block('Locations', 'places', store.places, (p) => `<button type="button" class="linkish" data-edit="${p.id}" title="bearbeiten">${esc(p.name)} ✎</button> <small>${esc(p.zip)} ${esc(p.city)}</small>`) +
    block('Gastgeber', 'hosts', store.hosts, (h) => `${esc(h.name)} <small>${esc(h.role || '')}</small>`) +
    blockIdx('Kunden / Geschäftspartner', 'guests', 'kunden', store.guests.map((g, i) => ({ g, i })).filter(({ g }) => !isEmp(g)), (g) => `${esc(g.name)} <small>${esc(g.company || '')}</small>`) +
    blockIdx('Mitarbeiter', 'guests', 'mitarbeiter', store.guests.map((g, i) => ({ g, i })).filter(({ g }) => isEmp(g)), (g) => `${esc(g.name)} <small>${esc(g.company || '')}</small>`, '<button type="button" class="ghost small" data-add-emp>+ Mitarbeiter hinzufügen</button>') +
    block('Anlässe', 'occasions', store.occasions, (o) => esc(o));
  const f = store.settings;
  if ($('firmaSum')) $('firmaSum').textContent = [f.company, f.city].filter(Boolean).join(', ') || 'Logo, Name und Adresse';
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
// Für Ausdruck und PDF: erst Kunden, dann Mitarbeiter
const sortedGuests = () => [...form.guests.filter((g) => !isEmp(g)), ...form.guests.filter(isEmp)];
function pushGuest(g) {
  if (!g) return;
  form.guests.push(isEmp(g) ? { name: g.name, company: g.company || store.settings.company || '', kind: 'mitarbeiter' } : { name: g.name, company: g.company || '' });
  renderChips(); renderGuestLists(); changed();
}
async function addGuest(emp = false) {
  const own = store.settings.company || '';
  const v = emp
    ? await ask('Mitarbeiter hinzufügen', [{ label: 'Name *', required: true }, { label: 'Firma', value: own }], 'Hinzufügen')
    : await ask('Kunde / Geschäftspartner hinzufügen', [{ label: 'Name *', required: true }, { label: 'Firma *', required: true }], 'Hinzufügen');
  if (!v) return null;
  const [name, company] = v;
  if (!name || (!emp && !company)) { alertStatus(emp ? 'Bitte einen Namen eintragen.' : 'Name und Firma sind Pflichtfelder.'); return null; }
  const g0 = emp ? { name, company: company || own, kind: 'mitarbeiter' } : { name, company };
  let known = store.guests.find((g) => guestKey(g) === guestKey(g0));
  if (!known) { known = g0; store.guests.push(known); save(); renderStamm(); }
  return known;
}
// Falsch zugeordnete Person zwischen Kunden und Mitarbeitern verschieben (nur Stammdaten)
async function moveGuest(i) {
  const g = store.guests[i]; if (!g) return;
  const own = store.settings.company || '';
  if (isEmp(g)) {
    const v = await ask(`${g.name} zu Kunden verschieben`, [{ label: 'Firma des Kunden *', required: true, value: g.company && g.company !== own ? g.company : '' }], 'Verschieben');
    if (!v || !v[0]) return;
    delete g.kind; g.company = v[0];
  } else {
    if (!(await confirmDlg('Zu Mitarbeitern verschieben', `${g.name} zu den Mitarbeitern verschieben? Als Firma wird ${own ? '„' + own + '“' : 'die eigene Firma'} eingetragen.`, 'Verschieben'))) return;
    g.kind = 'mitarbeiter'; g.company = own;
  }
  // Doppelte Einträge zusammenführen
  const dup = store.guests.findIndex((x, j) => j !== i && guestKey(x) === guestKey(g));
  if (dup >= 0) store.guests.splice(i, 1);
  stammOpen.add(isEmp(g) ? 'mitarbeiter' : 'kunden');
  save(); renderStamm(); renderGuestLists();
  alertStatus(`✓ ${g.name} ist jetzt ${isEmp(g) ? 'Mitarbeiter' : 'Kunde'}`);
}
function addAllEmployees() {
  const list = availableGuests(true);
  for (const { g } of list) form.guests.push({ name: g.name, company: g.company || store.settings.company || '', kind: 'mitarbeiter' });
  renderChips(); renderGuestLists(); changed();
  alertStatus(`✓ ${list.length} Mitarbeiter hinzugefügt`);
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
function vmaNow() {
  return window.Vma ? Vma.compute({ country: $('fCountry').value, city: $('fCity').value, date: $('fDate').value, meal: $('fMeal').value }) : null;
}
function vmaPlace(r) {
  const cn = (COUNTRIES.find((x) => x.code === r.country) || {}).name || r.country;
  return r.country === 'DE' ? 'Inland' : cn + (r.place ? ` – ${r.place}` : '');
}
function vmaHtml() {
  const v = vmaNow();
  if (!v) return '';
  if (!v.ok) return `<p class="hint vma-hint">Kürzung Verpflegungsmehraufwand: ${esc(v.reason)}</p>`;
  return `<div class="vma"><span>Kürzung Verpflegungsmehraufwand<small>${esc(v.mealKind)} ${v.share * 100} % von ${eur.format(v.rate.full)} (${esc(vmaPlace(v.rate))})</small></span><b>− ${eur.format(v.cut)}</b></div>`;
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
    ${c.foreign ? '<p class="hint">Ausländische Rechnung: Die ausländische Umsatzsteuer ist hier nicht als Vorsteuer abziehbar und wird den Kosten zugerechnet.</p>' : ''}
    <div><span>Vorsteuer</span><b>${eur.format(c.inputTax)}</b></div>
    <div><span>Betriebsausgabe abzugsfähig (70 %)</span><b>${eur.format(c.deductible)}</b></div>
    <div><span>nicht abzugsfähig (30 %)</span><b>${eur.format(c.nonDeductible)}</b></div>
    ${c.feeFull && c.fee ? `<div><span>Bankgebühr, voll abzugsfähig</span><b>${eur.format(c.fee)}</b></div>` : ''}
    ${vmaHtml()}`;
  // Abgleich mit der Gesamtsumme der Belege
  const w = $('sumWarn'), chk = $('belegCheck');
  const food = r2(c.line[19].gross + c.line[7].gross + c.line[0].gross);
  const n = form.belege.length;
  w.hidden = true; chk.hidden = true;
  if (hasTotals()) {
    const t = belegSum();
    const ok = [food, r2(food + c.tip), r2(food + c.tip + c.fee)].some((v) => Math.abs(v - t) <= 0.05);
    chk.hidden = false;
    chk.innerHTML = `<span>Gesamtsumme laut ${n === 1 ? 'Beleg' : plural(n, 'Beleg', 'Belegen')}</span><b>${eur.format(t)}${ok ? ' ✓' : ''}</b>`;
    if (!ok) {
      w.hidden = false;
      w.innerHTML = food
        ? `Hinweis: Die ${n === 1 ? 'Summe auf dem Beleg' : 'Belege ergeben zusammen'} ${eur.format(t)}, die Aufteilung ergibt ${eur.format(food)}${c.tip ? ` (mit Trinkgeld ${eur.format(r2(food + c.tip))})` : ''}. Bitte prüfen.`
        : `Bitte die Gesamtsumme von ${eur.format(t)} nach Steuersätzen aufteilen.<span class="take"><button type="button" class="small" data-take="7">Ganz als 7 % übernehmen</button><button type="button" class="small" data-take="19">Ganz als 19 % übernehmen</button></span>`;
    }
  }
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
// ---------- Belege (mehrere je Abrechnung, jeder mit eigenen Seiten und Betrag) ----------
const allPages = () => form.belege.flatMap((b) => b.pages);
const newBeleg = () => ({ id: uid(), pages: [], pdfText: '', text: '', total: null, totalAuto: true, parsed: null });
const findBeleg = (id) => form.belege.find((b) => b.id === id);
const hasTotals = () => form.belege.some((b) => b.total != null);
const belegSum = () => r2(form.belege.reduce((s, b) => s + (b.total || 0), 0));
const hasPdfText = (b) => b.pdfText.replace(/\s/g, '').length >= 40;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Ältere Abrechnungen hatten nur eine Seitenliste: als einen Beleg übernehmen
function belegeFromReport(r) {
  if (Array.isArray(r.belege)) return r.belege.map((b) => ({ ...newBeleg(), ...b, pages: b.pages || [] }));
  if (r.pages?.length) return [{ ...newBeleg(), pages: r.pages, pdfText: r.pdfText || '', text: r.rawText || '', total: r.ocrTotal ?? null }];
  return [];
}

async function readFile(f) {
  const out = { pages: [], pdfText: '' };
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
    const lib = await getPdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
    for (let p = 1; p <= Math.min(doc.numPages, 10); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      out.pdfText += textFromPdfItems(tc.items) + '\n';
      const vp = page.getViewport({ scale: 2 });
      const cv = document.createElement('canvas');
      cv.width = vp.width; cv.height = vp.height;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.pages.push({ name: `${f.name} – Seite ${p}`, src: cv.toDataURL('image/jpeg', 0.9), pdf: true });
    }
  } else if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name)) {
    out.pages.push({ name: f.name, src: await normalizeImage(f) });
  }
  return out;
}
// Jede Datei wird ein eigener Beleg. Mit target werden die Seiten an diesen Beleg angehängt.
async function addFiles(files, { target = null, crop = false } = {}) {
  $('ocrStatus').textContent = 'Lade Beleg …';
  const touched = [], added = [];
  try {
    for (const f of files) {
      const r = await readFile(f);
      if (!r.pages.length) continue;
      let b = target && findBeleg(target);
      if (!b) { b = newBeleg(); form.belege.push(b); }
      b.pages.push(...r.pages); b.pdfText += r.pdfText;
      if (!r.pdfText.trim()) added.push(...r.pages.map((pg) => [b, pg]));
      // Alle Seiten in Schwarz-Weiß mit mehr Kontrast; das farbige Original bleibt für späteres Zuschneiden
      if (window.Crop) for (const pg of r.pages) {
        try { pg.orig = pg.src; pg.src = await window.Crop.render(pg.orig, null); } catch (e) { console.warn(e); delete pg.orig; }
      }
      if (!touched.includes(b)) touched.push(b);
    }
    $('ocrStatus').textContent = touched.length ? '' : 'Dateiformat nicht erkannt.';
  } catch (e) {
    console.error(e);
    $('ocrStatus').textContent = 'Beleg konnte nicht gelesen werden: ' + (e.message || e);
  }
  renderBelege(); changed();
  if (!touched.length) return;
  // Foto mit der Kamera: gleich zuschneiden, damit die Texterkennung nur den Bon sieht.
  // Fotos aus Dateien: automatisch zuschneiden, wenn der Bon klar erkennbar ist (änderbar über „Zuschnitt“).
  if (crop) for (const [b, pg] of added) await cropPage(b.id, b.pages.indexOf(pg), false);
  else if (window.Crop && added.length) {
    $('ocrStatus').textContent = 'Schneide Beleg zu …';
    for (const [, pg] of added) {
      try { const c = await window.Crop.auto(pg.orig || pg.src); if (c) { if (!pg.orig) pg.orig = pg.src; pg.src = await window.Crop.render(pg.orig, c); pg.crop = c; } } catch (e) { console.warn(e); }
    }
    renderBelege(); changed();
  }
  runOcr(touched);
}
async function cropPage(bid, pi, rerun = true) {
  const b = findBeleg(bid), pg = b?.pages[pi];
  if (!pg || !window.Crop) return false;
  let res;
  try { res = await window.Crop.open(pg.orig || pg.src, pg.crop); } catch (e) { console.error(e); return false; }
  if (!res) return false;
  const c = res.crop;
  if (!c.rot && c.x <= 0.001 && c.y <= 0.001 && c.w >= 0.999 && c.h >= 0.999) {
    if (!pg.orig) pg.orig = pg.src;
    pg.src = res.src; delete pg.crop;
  } else {
    if (!pg.orig) pg.orig = pg.src;
    pg.src = res.src; pg.crop = c;
  }
  renderBelege(); changed();
  if (rerun && !(pg.pdf && hasPdfText(b))) runOcr([b]);
  return true;
}
function renderBelege() {
  const n = form.belege.length;
  $('belege').innerHTML = form.belege.map((b, bi) => `
    <div class="beleg" data-b="${b.id}">
      <div class="beleg-head"><b>Beleg ${bi + 1}</b><small>${plural(b.pages.length, 'Seite', 'Seiten')}</small>
        <button type="button" class="ghost small danger" data-act="del">Entfernen</button></div>
      <div class="thumbs">${b.pages.map((p, pi) => `<figure><img src="${p.src}" alt="${esc(p.name)}">
          <button type="button" class="x" data-act="delpage" data-p="${pi}" aria-label="Seite entfernen">×</button>
          <button type="button" class="crop" data-act="crop" data-p="${pi}">✂︎ ${p.crop ? 'Zuschnitt' : 'Zuschneiden'}</button></figure>`).join('')}
        <button type="button" class="add-page" data-act="addpage" aria-label="Seite zu Beleg ${bi + 1} hinzufügen"><span aria-hidden="true">＋</span>Seite</button></div>
      <div class="beleg-foot">
        <label>Betrag laut Beleg (brutto)<input class="btotal" inputmode="decimal" placeholder="0,00" value="${b.total != null ? num2.format(b.total) : ''}"></label>
        <button type="button" class="ghost small" data-act="pdf">Als PDF sichern</button>
      </div>
    </div>`).join('');
  renderBelegSum();
  $('btnOcr').disabled = !n;
  $('btnOcr').textContent = n > 1 ? 'Belege auslesen' : 'Beleg auslesen';
}
function renderBelegSum() {
  const n = form.belege.length, el = $('belegSum');
  el.hidden = !n;
  if (!n) return;
  el.innerHTML = `<span>Gesamtsumme ${n > 1 ? plural(n, 'Beleg', 'Belege') : 'Beleg'}</span><b>${hasTotals() ? eur.format(belegSum()) : '–'}</b>
    ${n > 1 ? '<button type="button" class="ghost small" data-act="pdfall">Alle Belege als ein PDF</button>' : ''}`;
}
const AMT_AUTO = ['a19', 'a7', 'a0', 'aTip'];
const amtSnap = () => AMT_AUTO.map((id) => $(id).value).join('|');
// Nach dem Entfernen eines Belegs die Beträge neu zusammenrechnen, solange niemand sie von Hand geändert hat
function reaggregate() {
  if (form.autoAmounts == null || amtSnap() !== form.autoAmounts) return;
  const m = mergeParsed();
  const setAmt = (id, v) => { $(id).value = v ? num2.format(v) : ''; };
  setAmt('a19', m.gross[19]); setAmt('a7', m.gross[7]); setAmt('a0', m.gross[0]); setAmt('aTip', m.tip);
  form.autoAmounts = amtSnap();
}
async function removeBeleg(bid) {
  const i = form.belege.findIndex((b) => b.id === bid);
  if (i < 0) return;
  if (!(await confirmDlg('Beleg entfernen', `Beleg ${i + 1} mit ${plural(form.belege[i].pages.length, 'Seite', 'Seiten')} aus dieser Abrechnung entfernen?`, 'Entfernen'))) return;
  form.belege.splice(i, 1);
  reaggregate(); renderRaw(); renderBelege(); changed();
}
function removePage(bid, pi) {
  const b = findBeleg(bid); if (!b) return;
  b.pages.splice(pi, 1);
  if (!b.pages.length) { form.belege.splice(form.belege.indexOf(b), 1); reaggregate(); renderRaw(); }
  renderBelege(); changed();
}
const imgSize = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res(null); i.src = src; });
const safeName = (t) => String(t || '').replace(/[^\wäöüÄÖÜß -]+/g, '').trim().replace(/\s+/g, '-');
// Belege (zugeschnitten) als eigenes PDF ablegen: eine A4-Seite je Belegseite
async function saveBelegePdf(list) {
  if (inPreview) {
    await ask('PDF in der Vorschau nicht möglich', [], '', `<p class="dlg-text">Diese Vorschau darf keine Dateien speichern. Für das PDF bitte die Online-Version öffnen:</p><p><a href="${PAGES_URL}" target="_blank" rel="noopener">${PAGES_URL}</a></p>`);
    return;
  }
  $('ocrStatus').textContent = 'PDF wird erstellt …';
  try {
    await loadScript('vendor/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const M = 10, maxW = 210 - 2 * M, maxH = 297 - 2 * M;
    let first = true;
    for (const b of list) for (const pg of b.pages) {
      const s = await imgSize(pg.src); if (!s) continue;
      if (!first) doc.addPage(); first = false;
      const k = Math.min(maxW / s.w, maxH / s.h), w = s.w * k, h = s.h * k;
      doc.addImage(pg.src, pg.src.startsWith('data:image/png') ? 'PNG' : 'JPEG', M + (maxW - w) / 2, M, w, h, undefined, 'FAST');
    }
    const p = $('fLocation').value.trim();
    const no = list.length === 1 && form.belege.length > 1 ? '_' + (form.belege.indexOf(list[0]) + 1) : '';
    const name = `${list.length > 1 ? 'Belege' : 'Beleg'}_${$('fDate').value || todayIso()}${p ? '_' + safeName(p) : ''}${no}.pdf`;
    doc.setProperties({ title: name.replace(/\.pdf$/, ''), creator: 'Bewirtungskosten-Abrechnung (Web-App)' });
    const ok = await saveFile(doc.output('blob'), name);
    $('ocrStatus').textContent = ok ? `✓ ${name} gesichert.` : '';
  } catch (e) {
    console.error(e);
    $('ocrStatus').textContent = 'PDF konnte nicht erstellt werden: ' + (e.message || e);
  }
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
function renderRaw() {
  const n = form.belege.length;
  const text = form.belege.filter((b) => b.text).map((b) => (n > 1 ? `––– Beleg ${form.belege.indexOf(b) + 1} –––\n` : '') + b.text.trim()).join('\n\n');
  $('rawText').textContent = text;
  $('rawBox').hidden = !text;
}
// Ergebnisse aller Belege zusammenführen: Beträge addieren, Datum und Ort vom ersten Beleg, der sie enthält
function mergeParsed() {
  const ps = form.belege.map((b) => b.parsed).filter(Boolean);
  const loc = ps.find((p) => p.name || p.city) || {};
  const gross = { 19: 0, 7: 0, 0: 0 }; let tip = 0;
  for (const p of ps) {
    for (const r of [19, 7, 0]) gross[r] = r2(gross[r] + (p.gross?.[r] || 0));
    tip = r2(tip + (p.tip || 0));
  }
  return { date: (ps.find((p) => p.date) || {}).date || null, name: loc.name || null, street: loc.street || null, zip: loc.zip || null, city: loc.city || null,
    gross, tip, total: hasTotals() ? belegSum() : null };
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
      if (m.status === 'recognizing text') $('ocrStatus').textContent = `${ocrLabel} … ${Math.round(m.progress * 100)} %`;
    },
  });
  await worker.setParameters({ preserve_interword_spaces: '1' });
  return worker;
}
let ocrLabel = 'Lese Beleg';
async function runOcr(list) {
  if (!Array.isArray(list)) list = form.belege; // auch als Klick-Handler
  list = list.filter((b) => form.belege.includes(b));
  if (!list.length) return;
  $('btnOcr').disabled = true;
  try {
    for (const b of list) {
      const no = form.belege.indexOf(b) + 1;
      ocrLabel = form.belege.length > 1 ? `Lese Beleg ${no} von ${form.belege.length}` : 'Lese Beleg';
      // Digitale PDFs: Textlayer direkt; Fotos (und PDF-Scans ohne Text) per Texterkennung
      const usePdf = hasPdfText(b);
      let text = usePdf ? b.pdfText.trim() + '\n' : '';
      for (const p of b.pages) {
        if (usePdf && p.pdf) continue;
        const { data } = await (await getWorker()).recognize(p.src);
        text += data.text + '\n';
      }
      b.text = text;
      b.parsed = parseReceipt(text);
      if (b.totalAuto || b.total == null) { b.total = b.parsed.total ?? null; b.totalAuto = true; }
    }
    renderRaw();
    renderBelege();
    applyParsed(mergeParsed());
  } catch (e) {
    console.error(e);
    $('ocrStatus').textContent = 'Texterkennung fehlgeschlagen. Bitte Werte von Hand eintragen.';
  } finally {
    $('btnOcr').disabled = !form.belege.length;
  }
}
function applyParsed(r) {
  const found = [];
  if (r.date) { $('fDate').value = r.date; found.push('Datum'); }
  // Mahlzeit aus der Uhrzeit auf dem Beleg ableiten (nur wenn noch nichts gewählt)
  const tm = ($('rawText').textContent.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/) || [])[1];
  if (tm != null && !$('fMeal').value) {
    const hr = Number(tm);
    if (hr >= 5 && hr < 11) $('fMeal').value = 'Frühstück';
    if (hr >= 11 && hr < 16) $('fMeal').value = 'Mittagessen';
    else if (hr >= 17) $('fMeal').value = 'Abendessen';
  }
  const setAmt = (id, v) => { $(id).value = v ? num2.format(v) : ''; };
  if (r.gross[19] || r.gross[7] || r.gross[0]) {
    setAmt('a19', r.gross[19]); setAmt('a7', r.gross[7]); setAmt('a0', r.gross[0]);
    found.push('Beträge');
  }
  if (r.tip) { setAmt('aTip', r.tip); found.push('Trinkgeld'); }
  if (r.total != null) found.push(form.belege.length > 1 ? 'Gesamtsumme' : 'Summe');
  form.autoAmounts = amtSnap();
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
  else if (form.guests.some((g) => !isEmp(g) && !g.company)) missing.push('Firma bei ' + form.guests.filter((g) => !isEmp(g) && !g.company).map((g) => g.name).join(', '));
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
      <tr><th>Tag der Bewirtung</th><td>${esc([deDateLong($('fDate').value), $('fMeal').value].filter(Boolean).join(' – ')) || '&nbsp;'}</td></tr>
      <tr><th>Ort der Bewirtung${p.type ? ` (${esc(p.type)})` : ''}</th><td><b>${esc(p.name)}</b><br>${esc(p.street)}${p.street ? '<br>' : ''}${esc(p.zip)} ${esc(p.city)}${country && p.country !== 'DE' ? ', ' + esc(country.name) : ''}</td></tr>
      <tr><th>Gastgeber</th><td>${host ? esc(host.name) + (host.role ? `, ${esc(host.role)}` : '') : '&nbsp;'}</td></tr>
      ${(() => {
        const li = (arr) => `<ol>${arr.map((g) => `<li>${esc(g.name)}${g.company ? ` <span class="p-muted">– ${esc(g.company)}</span>` : ''}</li>`).join('')}</ol>`;
        const k = form.guests.filter((g) => !isEmp(g)), m = form.guests.filter(isEmp);
        if (!k.length && !m.length) return '<tr><th>Bewirtete Personen</th><td>&nbsp;</td></tr>';
        return (k.length ? `<tr><th>Bewirtete Kunden / Gäste</th><td>${li(k)}</td></tr>` : '') + (m.length ? `<tr><th>Bewirtete Mitarbeiter</th><td>${li(m)}</td></tr>` : '');
      })()}
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
    <p class="p-note">${esc(noteText(c))}</p>

    <div class="p-sign">
      <div class="p-sign-field"><div class="p-sign-val">${esc($('fSignPlace').value)}${$('fSignPlace').value && $('fSignDate').value ? ', ' : ''}${esc(deDate($('fSignDate').value))}</div><div class="p-line">Ort, Datum</div></div>
      <div class="p-sign-field"><div class="p-sign-val sig">${form.signature ? `<img src="${form.signature}" alt="Unterschrift">` : ''}</div><div class="p-line">Unterschrift Gastgeber${host ? ` (${esc(host.name)})` : ''}</div></div>
    </div>
  </section>
  ${anlagen(p.name).map((pg) => `
  <section class="p-page p-receipt">
    <div class="p-receipt-h">${esc(pg.label)}</div>
    <img src="${pg.src}" alt="Beleg">
  </section>`).join('')}`;
  $('print').innerHTML = pages;
  return missing;
}
const PAGES_URL = 'https://marcoerrore-design.github.io/Bewirtungskosten/';
const inPreview = (() => { try { return window.self !== window.top; } catch { return true; } })();
// Text unter den Beträgen
function noteText(c) {
  const n = form.belege.length;
  const base = !n ? 'Rechnung: bitte beifügen.'
    : n === 1 ? 'Die Rechnung ist als Anlage beigefügt.'
    : `Die ${n} Belege sind als Anlage beigefügt${hasTotals() ? ` (zusammen ${eur.format(belegSum())})` : ''}.`;
  return base + (c.tip ? ' Das Trinkgeld ist nicht auf der Rechnung ausgewiesen und wird vom Gastgeber durch Unterschrift bestätigt.' : '');
}
// Alle Belegseiten als Anlagen, mit Überschrift je Seite
function anlagen(placeName) {
  const N = allPages().length, many = form.belege.length > 1, date = deDate($('fDate').value);
  const out = [];
  let k = 0;
  form.belege.forEach((b, bi) => b.pages.forEach((pg, pi) => {
    k++;
    const which = many ? `Beleg ${bi + 1}` : 'Beleg';
    const pageNo = b.pages.length > 1 ? ` (Seite ${pi + 1}/${b.pages.length})` : '';
    const amount = many && b.total != null && pi === 0 ? ` · ${eur.format(b.total)}` : '';
    out.push({ src: pg.src, label: `Anlage ${N > 1 ? `${k}/${N} ` : ''}– ${which}${pageNo} vom ${date}, ${placeName || ''}${amount}` });
  }));
  return out;
}
function pdfData() {
  const c = updateAmounts();
  const p = placeFromFields();
  const host = store.hosts.find((h) => h.id === $('fHost').value);
  const country = COUNTRIES.find((x) => x.code === p.country);
  const hostAttends = $('fHostAttends').checked && host;
  const n = form.guests.length + (hostAttends ? 1 : 0);
  syncSignPlace();
  const signPlaceDate = [$('fSignPlace').value.trim(), deDate($('fSignDate').value)].filter(Boolean).join(', ');
  return {
    company: store.settings.company, companyLines: companyLines(), logo: store.settings.logo,
    date: deDate($('fDate').value),
    dateLong: [deDateLong($('fDate').value), $('fMeal').value].filter(Boolean).join(' – '),
    place: { ...p, countryName: country && p.country !== 'DE' ? country.name : '' },
    host: host ? host.name + (host.role ? `, ${host.role}` : '') : '',
    hostName: host ? host.name : '',
    guests: sortedGuests(),
    persons: n,
    participants: `${n} Person${n === 1 ? '' : 'en'}${hostAttends ? ' (einschließlich Gastgeber)' : ''}`,
    occasion: [$('fOccasion').value, $('fOccasionNote').value.trim()].filter(Boolean).join(' – '),
    calc: c,
    note: noteText(c),
    signPlaceDate, signature: form.signature, pages: anlagen(p.name),
    vma: (() => { const v = vmaNow(); if (v && v.rate) v.placeLabel = vmaPlace(v.rate); if (v) { v.city = p.city; v.countryFull = country ? country.name : p.country; } return v; })(),
    fileName: `Bewirtungskosten-Abrechnung_${$('fDate').value || todayIso()}${p.name ? '_' + safeName(p.name) : ''}.pdf`,
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
  $('fPlaceType').value = 'Restaurant'; $('fMeal').value = ''; $('fCountry').value = 'DE'; $('fOccasion').value = '';
  $('fSignPlace').value = ''; $('fSignDate').value = todayIso();
  updateLocState(); openLoc(false); $('rawBox').hidden = true; $('ocrStatus').textContent = ''; $('plzStatus').textContent = '';
  $('fileInput').value = '';
  sig?.clear();
  renderBelege(); renderChips(); updateAmounts();
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
// ---------- Stammdaten als Excel-Datei (CSV) ----------
// Eine Datei für alle Stammdaten; Spalte „Typ“ sagt, was die Zeile ist. Semikolon + UTF-8 mit BOM, damit Excel (DE) sie direkt öffnet.
const CSV_COLS = ['Typ', 'Name', 'Firma', 'Funktion', 'Straße', 'PLZ', 'Ort', 'Land', 'Art'];
const CSV_TYPES = { firma: 'Firma', gastgeber: 'Gastgeber', gast: 'Kunde', mitarbeiter: 'Mitarbeiter', location: 'Location', anlass: 'Anlass' };
const typeKey = (t) => {
  const n = String(t || '').toLowerCase().replace(/[^a-zäöüß]/g, '');
  if (/^(firma|unternehmen|company|eigenefirma)$/.test(n)) return 'firma';
  if (/^(gastgeber|host)/.test(n)) return 'gastgeber';
  if (/^(mitarbeiter(in|innen)?|employees?|staff|kollegen?|kollegin)$/.test(n)) return 'mitarbeiter';
  if (/^(kunden?|kundin|geschäftspartner(in)?|geschaeftspartner|customers?|bewirteteperson(en)?|gast|gäste|gaeste|guests?|person(en)?)$/.test(n)) return 'gast';
  if (/^(locations?|ort|orte|restaurant|hotel|place)$/.test(n)) return 'location';
  if (/^(anlass|anlässe|anlaesse|occasions?)$/.test(n)) return 'anlass';
  return '';
};
const csvCell = (v) => { v = String(v ?? ''); return /[;"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const csvText = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
const countryCode = (v) => {
  const t = String(v || '').trim(); if (!t) return '';
  const c = COUNTRIES.find((x) => x.code.toLowerCase() === t.toLowerCase() || x.name.toLowerCase() === t.toLowerCase());
  return c ? c.code : t.toUpperCase().slice(0, 2);
};
function stammRows() {
  const f = store.settings, rows = [CSV_COLS];
  if (f.company || f.street || f.city) rows.push([CSV_TYPES.firma, f.company, '', '', f.street, f.zip, f.city, f.country || 'DE', '']);
  for (const h of store.hosts) rows.push([CSV_TYPES.gastgeber, h.name, '', h.role || '', '', '', '', '', '']);
  for (const g of store.guests.filter((x) => !isEmp(x))) rows.push([CSV_TYPES.gast, g.name, g.company || '', '', '', '', '', '', '']);
  for (const g of store.guests.filter(isEmp)) rows.push([CSV_TYPES.mitarbeiter, g.name, g.company || '', '', '', '', '', '', '']);
  for (const p of store.places) rows.push([CSV_TYPES.location, p.name, '', '', p.street, p.zip, p.city, p.country || 'DE', p.type || 'Restaurant']);
  for (const o of store.occasions) rows.push([CSV_TYPES.anlass, o, '', '', '', '', '', '', '']);
  return rows;
}
function exportStore() {
  const rows = stammRows();
  saveFile(new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8' }), `bewirtung-stammdaten-${todayIso()}.csv`)
    .then((ok) => { if (ok) $('csvStatus').textContent = `✓ ${rows.length - 1} Einträge exportiert.`; });
}
function downloadTemplate() {
  const rows = [CSV_COLS,
    ['# Vorlage: Zeilen mit # werden beim Import ignoriert. Beispielzeilen kopieren, # in der Spalte Typ entfernen und Werte ersetzen.'],
    ['# Typ = Firma, Gastgeber, Kunde, Mitarbeiter, Location oder Anlass. Land als Kürzel (DE, AT, CH …). Art = Restaurant, Hotel oder Sonstiges.'],
    ['#Firma', 'Muster GmbH', '', '', 'Hauptstraße 1', '20095', 'Hamburg', 'DE', ''],
    ['#Gastgeber', 'Erika Muster', '', 'Geschäftsführerin', '', '', '', '', ''],
    ['#Kunde', 'Max Beispiel', 'Beispiel AG', '', '', '', '', '', ''],
    ['#Mitarbeiter', 'Anna Muster', 'Muster GmbH', '', '', '', '', '', ''],
    ['#Location', 'Restaurant Beispiel', '', '', 'Marktplatz 3', '80331', 'München', 'DE', 'Restaurant'],
    ['#Anlass', 'Projektbesprechung', '', '', '', '', '', '', ''],
  ];
  saveFile(new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8' }), 'bewirtung-stammdaten-vorlage.csv');
}
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = [';', ',', '\t'].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
function importCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('leer');
  const norm = (h) => h.toLowerCase().replace(/[^a-zäöüß]/g, '');
  const head = rows[0].map(norm);
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const ix = { typ: col('typ', 'type', 'art der daten'), name: col('name'), firma: col('firma', 'company', 'unternehmen'), funktion: col('funktion', 'rolle', 'role', 'position'),
    strasse: col('straße', 'strasse', 'street', 'straßehausnummer'), plz: col('plz', 'postleitzahl', 'zip'), ort: col('ort', 'stadt', 'city'), land: col('land', 'country'), art: col('art', 'kategorie') };
  if (ix.typ < 0 || ix.name < 0) throw new Error('Spalten „Typ“ und „Name“ fehlen');
  const get = (r, k) => (ix[k] >= 0 ? String(r[ix[k]] ?? '').trim() : '');
  const n = { firma: 0, gastgeber: 0, gast: 0, mitarbeiter: 0, location: 0, anlass: 0 }; let skipped = 0;
  for (const r of rows.slice(1)) {
    const typRaw = String(r[ix.typ] ?? '').trim();
    if (!typRaw || typRaw.startsWith('#')) continue;
    const t = typeKey(typRaw), name = get(r, 'name');
    if (!t || (!name && t !== 'firma')) { skipped++; continue; }
    if (t === 'firma') {
      const f = store.settings;
      for (const [k, v] of [['company', name], ['street', get(r, 'strasse')], ['zip', get(r, 'plz')], ['city', get(r, 'ort')], ['country', countryCode(get(r, 'land'))]]) if (v) f[k] = v;
      n.firma++;
    } else if (t === 'gastgeber') {
      const h = store.hosts.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (h) { if (get(r, 'funktion')) h.role = get(r, 'funktion'); } else { store.hosts.push({ id: uid(), name, role: get(r, 'funktion') }); n.gastgeber++; }
    } else if (t === 'gast' || t === 'mitarbeiter') {
      const emp = t === 'mitarbeiter';
      const g0 = emp ? { name, company: get(r, 'firma') || store.settings.company || '', kind: 'mitarbeiter' } : { name, company: get(r, 'firma') };
      if (!store.guests.some((g) => guestKey(g) === guestKey(g0))) { store.guests.push(g0); n[t]++; }
    } else if (t === 'location') {
      const p = { type: get(r, 'art') || 'Restaurant', name, street: get(r, 'strasse'), country: countryCode(get(r, 'land')) || 'DE', zip: get(r, 'plz'), city: get(r, 'ort') };
      const ex = store.places.find((x) => x.name.toLowerCase() === name.toLowerCase() && (x.city || '').toLowerCase() === p.city.toLowerCase());
      if (ex) { for (const k of Object.keys(p)) if (p[k]) ex[k] = p[k]; } else { store.places.push({ id: uid(), ...p }); n.location++; }
      if (p.zip && p.city) remember(p.country, p.zip, p.city);
    } else if (t === 'anlass') {
      if (!store.occasions.some((o) => o.toLowerCase() === name.toLowerCase())) { store.occasions.push(name); n.anlass++; }
    }
  }
  return { n, skipped };
}
async function importStore(file) {
  const st = $('csvStatus');
  try {
    const text = await file.text();
    if (/^\s*[{[]/.test(text.replace(/^﻿/, ''))) { importJson(JSON.parse(text)); st.textContent = '✓ Stammdaten importiert'; return; }
    const { n, skipped } = importCsv(text);
    save(); renderAll(); loadSettings();
    const parts = [n.gastgeber && `${n.gastgeber} Gastgeber`, n.gast && `${n.gast} Kunde${n.gast === 1 ? '' : 'n'}`, n.mitarbeiter && `${n.mitarbeiter} Mitarbeiter`, n.location && `${n.location} Location${n.location === 1 ? '' : 's'}`, n.anlass && `${n.anlass} Anlass${n.anlass === 1 ? '' : 'e'}`.replace('Anlasse', 'Anlässe'), n.firma && 'Firmendaten'].filter(Boolean);
    st.textContent = (parts.length ? `✓ Importiert: ${parts.join(', ')}.` : 'Keine neuen Einträge gefunden.') + (skipped ? ` ${skipped} Zeile${skipped === 1 ? '' : 'n'} übersprungen (Typ unbekannt oder Name fehlt).` : '');
  } catch (e) { st.textContent = 'Import fehlgeschlagen: ' + (e.message && e.message !== 'leer' ? e.message : 'keine gültige Datei') + '.'; }
}
// Älteres JSON-Format (und Komplett-Backup) weiterhin lesbar
function importJson(s) {
  const mergeBy = (a, b, key) => { for (const x of b || []) if (!a.some((y) => key(y) === key(x))) a.push(x); };
  mergeBy(store.places, s.places, (p) => p.id || p.name + p.city);
  mergeBy(store.hosts, s.hosts, (h) => h.id || h.name);
  mergeBy(store.guests, s.guests, (g) => g.name + '|' + (g.company || ''));
  for (const o of s.occasions || []) if (!store.occasions.includes(o)) store.occasions.push(o);
  if (s.settings) store.settings = { ...s.settings, ...Object.fromEntries(Object.entries(store.settings).filter(([, v]) => v)) };
  save(); renderAll(); loadSettings();
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
  cam.addEventListener('change', () => { if (cam.files.length) addFiles([...cam.files], { crop: true }); cam.value = ''; });
  const pi = $('pageInput');
  let pageTarget = null;
  pi.addEventListener('change', () => { if (pi.files.length) addFiles([...pi.files], { target: pageTarget }); pi.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
  $('belege').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]'), el = e.target.closest('[data-b]'); if (!btn || !el) return;
    const bid = el.dataset.b, p = Number(btn.dataset.p), act = btn.dataset.act;
    if (act === 'del') removeBeleg(bid);
    else if (act === 'delpage') removePage(bid, p);
    else if (act === 'crop') cropPage(bid, p);
    else if (act === 'addpage') { pageTarget = bid; pi.click(); }
    else if (act === 'pdf') saveBelegePdf([findBeleg(bid)]);
  });
  $('belege').addEventListener('input', (e) => {
    if (!e.target.classList.contains('btotal')) return;
    const b = findBeleg(e.target.closest('[data-b]').dataset.b); if (!b) return;
    const n = parseAmount(e.target.value);
    b.total = e.target.value.trim() && Number.isFinite(n) ? r2(n) : null; b.totalAuto = false;
    renderBelegSum(); updateAmounts();
  });
  $('belege').addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('btotal')) return;
    const b = findBeleg(e.target.closest('[data-b]').dataset.b);
    if (b) e.target.value = b.total != null ? num2.format(b.total) : '';
  });
  $('belegSum').addEventListener('click', (e) => { if (e.target.closest('[data-act="pdfall"]')) saveBelegePdf(form.belege); });
  $('sumWarn').addEventListener('click', (e) => {
    const t = e.target.closest('[data-take]'); if (!t) return;
    const fee = amt('aFee'), tip = amt('aTip');
    $('a' + t.dataset.take).value = num2.format(Math.max(0, r2(belegSum() - tip - fee)));
    changed();
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
  $('btnAddGuest').onclick = async () => pushGuest(await addGuest(false));
  $('btnAddEmp').onclick = async () => pushGuest(await addGuest(true));
  $('btnAllEmp').onclick = addAllEmployees;
  $('fEmpSel').addEventListener('change', () => { const g = store.guests[Number($('fEmpSel').value)]; $('fEmpSel').value = ''; pushGuest(g); });
  $('fHost').addEventListener('change', renderGuestLists);
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
    $(id).addEventListener('change', () => { store.settings[k] = $(id).value.trim(); save(); renderStamm(); });
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
    const mv = e.target.closest('[data-move]'); if (mv) return moveGuest(Number(mv.dataset.move));
    if (e.target.closest('[data-add-emp]')) { stammOpen.add('mitarbeiter'); return addGuest(true).then(() => { renderGuestLists(); renderStamm(); }); }
    const b = e.target.closest('button.x'); if (!b) return;
    store[b.dataset.kind].splice(Number(b.dataset.i), 1); save(); renderAll();
  });
  $('btnExport').onclick = exportStore;
  $('btnTemplate').onclick = downloadTemplate;
  $('stammLists').addEventListener('toggle', (e) => { const d = e.target.closest('[data-fold]'); if (d) d.open ? stammOpen.add(d.dataset.fold) : stammOpen.delete(d.dataset.fold); }, true);
  $('importFile').addEventListener('change', (e) => { if (e.target.files[0]) importStore(e.target.files[0]); e.target.value = ''; });

  $('btnPrint').onclick = doPrint; $('btnPrint2').onclick = doPrint;
  $('btnNew').onclick = () => newReport();
  $('btnBack').onclick = async () => { await saveNow(); showList(); };
  $('btnSettings').onclick = () => { $('foldFirma').open = !store.settings.company; showView('viewSettings'); renderYears(); };
  $('btnYearBackup').onclick = () => backupAll($('delYear').value);
  $('btnDelYear').onclick = deleteYear;
  $('btnSettingsBack').onclick = () => showList();
  $('btnDeleteReport').onclick = deleteReport;
  $('btnBackup').onclick = () => backupAll();
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
const FIELD_IDS = ['fDate', 'fPlaceType', 'fMeal', 'fLocation', 'fStreet', 'fCountry', 'fZip', 'fCity', 'fHost', 'fOccasion', 'fOccasionNote',
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
    guests: form.guests, belege: form.belege, signature: form.signature,
    locationId: form.locationId, rawText: $('rawText').textContent, autoAmounts: form.autoAmounts,
    summary: { date: fields.fDate, place: fields.fLocation, city: fields.fCity, gross: c.gross, guests: form.guests.length,
      host: store.hosts.find((h) => h.id === fields.fHost)?.name || '' },
  };
}
function isEmptyReport(r) {
  return !r.belege.length && !r.guests.length && !r.signature && !r.fields.fDate && !r.fields.fLocation && !r.summary.gross && !r.fields.fOccasion;
}
function syncSignPlace() { $('fSignPlace').value = $('fCity').value.trim(); }
function changed() {
  syncSignPlace();
  updateAmounts();
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
    const thumb = (r.belege?.[0]?.pages?.[0] || r.pages?.[0])?.src;
    const done = r.status === 'pdf';
    return `<li><button type="button" class="report" data-id="${r.id}">
      <span class="r-thumb">${thumb ? `<img src="${thumb}" alt="">` : '<span aria-hidden="true">🧾</span>'}</span>
      <span class="r-main">
        <b>${esc(s.place || 'Ohne Location')}</b>
        <small>${s.date ? esc(deDate(s.date)) : 'ohne Datum'}${s.city ? ' · ' + esc(s.city) : ''}${s.guests ? ` · ${s.guests} ${s.guests === 1 ? 'Gast' : 'Gäste'}` : ''}</small>
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
  form.guests = r.guests || []; form.belege = belegeFromReport(r);
  form.locationId = r.locationId || null; form.autoCity = false; form.autoAmounts = r.autoAmounts ?? null;
  sig.set(r.signature || null);
  if (r.rawText) { $('rawText').textContent = r.rawText; $('rawBox').hidden = false; }
  renderBelege(); renderChips(); updateAmounts(); updateLocState();
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
  // Beim Öffnen der App immer mit der Übersicht beginnen
  try { localStorage.removeItem(CUR_KEY); } catch {}
  await showList();
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
    1: { done: form.belege.length > 0, sum: form.belege.length ? [plural(form.belege.length, 'Beleg', 'Belege'), hasTotals() ? eur.format(belegSum()) : ''].filter(Boolean).join(' · ') : 'Foto oder PDF hinzufügen' },
    2: { done: !!($('fDate').value && $('fLocation').value.trim()), sum: [deDate($('fDate').value), $('fMeal').value, $('fLocation').value.trim(), $('fCity').value.trim()].filter(Boolean).join(' · ') || 'Datum und Location' },
    3: { done: !!(host && form.guests.length && occ), sum: [host?.name, form.guests.length ? `${form.guests.length} ${form.guests.length === 1 ? 'Gast' : 'Gäste'}` : '', occ].filter(Boolean).join(' · ') || 'Gastgeber, Gäste, Anlass' },
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
// year: undefined = alles, '' = ohne Datum, '2025' = nur dieses Jahr
const yearOf = (r) => (r.fields?.fDate || '').slice(0, 4);
const yearName = (y) => y || 'ohne Datum';
async function backupAll(year) {
  const one = typeof year === 'string';
  const st = one ? $('delYearStatus') : $('backupStatus');
  st.textContent = 'Backup wird erstellt …';
  try {
    if (current) await saveNow();
    let reports = await Reports.all();
    if (one) reports = reports.filter((r) => yearOf(r) === year);
    const data = { app: 'bewirtungskosten', version: 1, exportedAt: new Date().toISOString(), store, reports };
    const name = `bewirtung-backup-${one ? (year || 'ohne-datum') + '-' : ''}${todayIso()}.json`;
    const ok = await saveFile(new Blob([JSON.stringify(data)], { type: 'application/json' }), name);
    st.textContent = ok ? `✓ Backup mit ${reports.length} Abrechnung${reports.length === 1 ? '' : 'en'}${one ? ' (' + yearName(year) + ')' : ''} erstellt.` : '';
    if (ok && one) lastYearBackup = year;
  } catch (e) { st.textContent = 'Backup fehlgeschlagen: ' + (e.message || e); }
}
let lastYearBackup = null;
async function renderYears() {
  let all = [];
  try { all = await Reports.all(); } catch {}
  const counts = {};
  for (const r of all) { const y = yearOf(r); counts[y] = (counts[y] || 0) + 1; }
  const years = Object.keys(counts).sort((a, b) => (b || '0').localeCompare(a || '0'));
  const sel = $('delYear'), keep = sel.value;
  sel.innerHTML = years.length
    ? years.map((y) => `<option value="${esc(y)}">${esc(yearName(y))} (${counts[y]})</option>`).join('')
    : '<option value="" disabled>keine Abrechnungen</option>';
  if (years.includes(keep)) sel.value = keep;
  $('btnDelYear').disabled = $('btnYearBackup').disabled = !years.length;
}
async function deleteYear() {
  const year = $('delYear').value;
  let list = [];
  try { list = (await Reports.all()).filter((r) => yearOf(r) === year); } catch {}
  if (!list.length) return;
  const sum = list.reduce((s, r) => s + (r.summary?.gross || 0), 0);
  const label = yearName(year);
  const confirmWord = year || 'LÖSCHEN';
  const html = `<p class="dlg-text">${list.length} Abrechnung${list.length === 1 ? '' : 'en'} aus <b>${esc(label)}</b> (zusammen ${eur.format(sum)}) werden mit allen Belegen und Unterschriften endgültig von diesem Gerät gelöscht. Das kann nicht rückgängig gemacht werden.</p>
    <p class="dlg-text">Stammdaten, Gastgeber, bewirtete Personen, Locations und Anlässe bleiben erhalten.</p>
    ${lastYearBackup === year ? '<p class="dlg-text">✓ Ein Backup dieses Jahres wurde gerade erstellt.</p>' : '<p class="dlg-text warn-text">Für dieses Jahr wurde in dieser Sitzung noch kein Backup erstellt. Bitte vorher „Backup dieses Jahres“ tippen.</p>'}
    <p class="dlg-text">Zur Bestätigung bitte <b>${esc(confirmWord)}</b> eingeben:</p>`;
  const v = await ask('Abrechnungen löschen', [{ label: 'Bestätigung' }], 'Endgültig löschen', html);
  if (v === null) return;
  if ((v[0] || '').toUpperCase() !== confirmWord.toUpperCase()) { $('delYearStatus').textContent = 'Nicht gelöscht: Die Bestätigung stimmte nicht.'; return; }
  let curId = null;
  try { curId = localStorage.getItem(CUR_KEY); } catch {}
  let n = 0;
  for (const r of list) { try { await Reports.remove(r.id); n++; } catch (e) { console.error(e); } }
  if (current && list.some((r) => r.id === current.id)) { clearTimeout(saveTimer); current = null; }
  if (curId && list.some((r) => r.id === curId)) { try { localStorage.removeItem(CUR_KEY); } catch {} }
  $('delYearStatus').textContent = `✓ ${n} Abrechnung${n === 1 ? '' : 'en'} aus ${label} gelöscht.`;
  await renderYears();
  await renderReportList();
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
  window.addEventListener('load', async () => {
    let reg;
    try { reg = await navigator.serviceWorker.register('sw.js'); } catch { return; }
    // Installierte Apps werden auf dem iPhone oft nur fortgesetzt statt neu geladen:
    // bei jeder Rückkehr in die App nach einem Update suchen und dann neu laden.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      saveNow().finally(() => location.reload());
    });
    const check = () => { reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  });
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
