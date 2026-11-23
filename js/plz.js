// Postleitzahlen-Suche für DACH, Benelux und Skandinavien.
// Quelle: zippopotam.us (frei, ohne API-Key, CORS-fähig); für DE/AT/CH/LI zusätzlich openplzapi.org als Rückfallebene.
// Ergebnisse werden lokal zwischengespeichert, damit bekannte PLZ auch offline sofort gefunden werden.
(function (root) {
'use strict';
const COUNTRIES = [
  { code: 'DE', name: 'Deutschland', len: [5], re: /^\d{5}$/ },
  { code: 'AT', name: 'Österreich', len: [4], re: /^\d{4}$/ },
  { code: 'CH', name: 'Schweiz', len: [4], re: /^\d{4}$/ },
  { code: 'LI', name: 'Liechtenstein', len: [4], re: /^\d{4}$/ },
  { code: 'NL', name: 'Niederlande', len: [4], re: /^\d{4}$/ },
  { code: 'BE', name: 'Belgien', len: [4], re: /^\d{4}$/ },
  { code: 'LU', name: 'Luxemburg', len: [4], re: /^\d{4}$/ },
  { code: 'DK', name: 'Dänemark', len: [4], re: /^\d{4}$/ },
  { code: 'SE', name: 'Schweden', len: [5], re: /^\d{5}$/ },
  { code: 'NO', name: 'Norwegen', len: [4], re: /^\d{4}$/ },
  { code: 'FI', name: 'Finnland', len: [5], re: /^\d{5}$/ },
  { code: 'IS', name: 'Island', len: [3], re: /^\d{3}$/ },
];

const CACHE_KEY = 'bewirtung.plzcache.v1';
let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { cache = {}; }
const saveCache = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {} };

// "1012 AB" -> "1012", "114 55" -> "11455"
function normalizeZip(country, zip) {
  let z = String(zip || '').toUpperCase().replace(/^(D|A|CH|NL|DK|S|SE|N|NO|FI|L|B|FL|IS)-/, '');
  if (country === 'NL') z = z.replace(/\s*[A-Z]{2}$/, '');
  return z.replace(/\s+/g, '');
}

function isComplete(country, zip) {
  const c = COUNTRIES.find((x) => x.code === country);
  return !!c && c.re.test(normalizeZip(country, zip));
}

// Vorschläge aus dem lokalen Cache für eine angefangene PLZ (z. B. "803" -> 80331 München, 80333 München …)
function suggestFromCache(country, prefix) {
  const p = normalizeZip(country, prefix);
  if (!p) return [];
  const out = [];
  for (const [key, cities] of Object.entries(cache)) {
    const [cc, zip] = key.split(':');
    if (cc === country && zip.startsWith(p)) for (const city of cities) out.push({ zip, city });
    if (out.length > 30) break;
  }
  return out.sort((a, b) => a.zip.localeCompare(b.zip));
}

let lastNetworkError = false;
async function fetchJson(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { lastNetworkError = true; return null; } finally { clearTimeout(t); }
}

async function lookup(country, zip) {
  const z = normalizeZip(country, zip);
  const key = `${country}:${z}`;
  if (cache[key]) return cache[key];
  lastNetworkError = false;
  let cities = [];
  const zp = await fetchJson(`https://api.zippopotam.us/${country.toLowerCase()}/${encodeURIComponent(country === 'SE' ? z.slice(0, 3) + ' ' + z.slice(3) : z)}`)
    || (country === 'SE' ? await fetchJson(`https://api.zippopotam.us/se/${z}`) : null);
  if (zp && Array.isArray(zp.places)) cities = zp.places.map((p) => p['place name']);
  if (!cities.length && ['DE', 'AT', 'CH', 'LI'].includes(country)) {
    const op = await fetchJson(`https://openplzapi.org/${country.toLowerCase()}/Localities?postalCode=${z}`);
    if (Array.isArray(op)) cities = op.map((p) => p.name);
  }
  cities = [...new Set(cities.filter(Boolean))];
  if (cities.length) { cache[key] = cities; saveCache(); }
  return cities;
}

// Bekannte PLZ (z. B. aus gespeicherten Orten) in den Cache übernehmen
function remember(country, zip, city) {
  const z = normalizeZip(country, zip);
  if (!z || !city) return;
  const key = `${country}:${z}`;
  const list = cache[key] || [];
  if (!list.includes(city)) { cache[key] = [...list, city]; saveCache(); }
}

root.Plz = { offline: () => lastNetworkError, COUNTRIES, lookup, suggestFromCache, isComplete, normalizeZip, remember };
})(typeof window !== 'undefined' ? window : globalThis);
