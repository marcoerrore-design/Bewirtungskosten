// Heuristisches Auslesen von Kassenbons / Rechnungen (Text aus OCR oder PDF).
// Alles, was hier erkannt wird, landet nur als Vorschlag im Formular und bleibt änderbar.
(function (root) {
'use strict';
const AMOUNT_RE = /(?<![\d,.])-?\d{1,3}(?:[.\s']\d{3})*[,.]\d{2}(?![\d%])/g;

function parseAmount(s) {
  if (s == null) return NaN;
  let t = String(s).trim().replace(/[€\s']/g, '');
  if (!t) return NaN;
  const lastComma = t.lastIndexOf(','), lastDot = t.lastIndexOf('.');
  const dec = Math.max(lastComma, lastDot);
  if (dec >= 0 && t.length - dec - 1 <= 2) {
    t = t.slice(0, dec).replace(/[.,]/g, '') + '.' + t.slice(dec + 1);
  } else {
    t = t.replace(/[.,]/g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function amountsIn(line) {
  return (line.match(AMOUNT_RE) || []).map(parseAmount).filter((n) => Number.isFinite(n));
}

const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const r2 = (n) => Math.round(n * 100) / 100;

// Ermittelt aus den Zahlen einer MwSt-Zeile den Bruttobetrag für den Satz `rate`.
function grossFromVatLine(nums, rate, line = '') {
  const f = rate / 100;
  const n = nums.filter((x) => x > 0);
  // Tripel Netto + Steuer = Brutto
  for (let i = 0; i < n.length; i++)
    for (let j = 0; j < n.length; j++)
      for (let k = 0; k < n.length; k++)
        if (i !== j && j !== k && i !== k && near(n[i] + n[j], n[k]) && near(n[i] * f, n[j], Math.max(0.03, n[k] * 0.002)))
          return r2(n[k]);
  // Paare
  for (let i = 0; i < n.length; i++)
    for (let j = 0; j < n.length; j++) {
      if (i === j) continue;
      const a = n[i], b = n[j];
      if (near(a * f, b, 0.03) && a > b) return r2(a + b); // Netto, Steuer
      if (near(b * f / (1 + f), a, 0.03) && b > a) return r2(b); // Steuer, Brutto
      if (near(a * (1 + f), b, 0.03) && b > a) return r2(b); // Netto, Brutto
    }
  if (n.length === 1) {
    const x = n[0];
    if (/netto|net\b/i.test(line)) return r2(x * (1 + f));
    if (/brutto|umsatz|gesamt/i.test(line)) return r2(x);
  }
  return null;
}

const RATE_RES = [
  { rate: 19, re: /(?<![\d,.])19(?:[,.]0{1,2})?\s*%|mwst\.?\s*19\b|ust\.?\s*19\b/i },
  { rate: 7, re: /(?<![\d,.])7(?:[,.]0{1,2})?\s*%|mwst\.?\s*7\b|ust\.?\s*7\b/i },
];

// Zuordnung "A = 19 %" / "B = 7 %" wie auf vielen Kassenbons
function letterRateMap(lines) {
  const map = {};
  for (const l of lines) {
    const m = [...l.matchAll(/\b([A-D])\s*[=:]?\s*(19|7|0)(?:[,.]0{1,2})?\s*%/g)];
    for (const x of m) map[x[1]] = Number(x[2]);
  }
  return map;
}

const TOTAL_KEYS = [
  /zu\s*zahlen|endbetrag|gesamtbetrag|rechnungsbetrag|summe\s*eur|total\s*eur|gesamt\s*eur/i,
  /\bsumme\b|\bgesamt\b|\btotal\b|\btotaal\b|\bsumma\b|\bi\s*alt\b|\byhteens/i,
  /\bbar\b|\bec[- ]?karte|kartenzahlung|girocard|visa|mastercard|amex|\bkarte\b|\bbetrag\b/i,
];
const TIP_RE = /trinkgeld|\btip\b|gratuity|\bfooi\b|dricks|drikkepenger|tippi/i;
const HEADER_WORDS = /^(rechnung|quittung|beleg|bon|kassenbon|bewirtung|kopie|duplikat|willkommen|herzlich|tisch|table|bedienung|kasse)/i;

function parseDate(text) {
  let m = text.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})\b/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    const dd = Number(d), mm = Number(mo);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function parseReceipt(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const res = { date: parseDate(text || ''), total: null, tip: null, gross: { 19: null, 7: null, 0: null }, name: null, street: null, zip: null, city: null };

  // Kopf: Name, Straße, PLZ/Ort
  const head = lines.slice(0, 12);
  for (const l of head) {
    const pm = l.match(/\b(?:(?:D|A|CH|NL|DK|S|SE|N|NO|FI|L|B)[- ])?(\d{4,5}|\d{3}\s\d{2}|\d{4}\s?[A-Z]{2})\s+([A-ZÄÖÜÅØÆ][A-Za-zÄÖÜäöüßÅØÆåøæéè .'\/-]{1,40})$/);
    if (pm && !res.zip && !/tel|fax|uid|ust|steuer|st-?nr/i.test(l)) { res.zip = pm[1].replace(/\s+(?=[A-Z])/, ' '); res.city = pm[2].trim(); continue; }
    if (!res.street && /(str\.|straße|strasse|weg\b|platz\b|gasse\b|allee\b|ring\b|damm\b|ufer\b|markt\b|gade\b|gatan\b|gata\b|straat\b|laan\b|plein\b|gracht\b|vej\b|veien\b)/i.test(l) && /\d/.test(l)) { res.street = l; continue; }
  }
  for (const l of head.slice(0, 5)) {
    const letters = (l.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
    if (letters >= 3 && !HEADER_WORDS.test(l) && !/\d{4,}/.test(l) && l !== res.street) { res.name = l.replace(/[*_=~]+/g, '').trim(); break; }
  }

  // Trinkgeld
  for (const l of lines) if (TIP_RE.test(l)) { const a = amountsIn(l); if (a.length) { res.tip = a[a.length - 1]; break; } }

  // Gesamtsumme
  outer: for (const re of TOTAL_KEYS) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (!re.test(l) || TIP_RE.test(l) || /netto|mwst|ust|steuer|zwischen|rückgeld|gegeben|change/i.test(l)) continue;
      let a = amountsIn(l);
      if (!a.length && lines[i + 1]) a = amountsIn(lines[i + 1]);
      if (a.length) { res.total = Math.max(...a); break outer; }
    }
  }
  if (res.total == null) {
    const all = lines.flatMap(amountsIn);
    if (all.length) res.total = Math.max(...all);
  }

  // MwSt-Aufteilung
  const letters = letterRateMap(lines);
  for (const l of lines) {
    if (TIP_RE.test(l)) continue;
    let rate = null;
    for (const { rate: r, re } of RATE_RES) if (re.test(l)) { rate = r; break; }
    if (rate == null) {
      const lm = l.match(/^([A-D])\s+(?:=\s*)?\d/);
      if (lm && letters[lm[1]] != null && /mwst|ust|netto|brutto|steuer|%/i.test(lines.join(' '))) rate = letters[lm[1]];
    }
    if (rate == null || rate === 0 || res.gross[rate] != null) continue;
    const nums = amountsIn(l.replace(/(?<![\d,.])(19|7)(?:[,.]0{1,2})?\s*%/g, ' '));
    const g = grossFromVatLine(nums, rate, l);
    if (g != null) res.gross[rate] = g;
  }

  // Fallbacks
  const base = res.total != null ? r2(res.total - (res.tip && res.total > res.tip * 2 && lines.some((l) => TIP_RE.test(l)) && tipIncluded(lines) ? res.tip : 0)) : null;
  const known = (res.gross[19] || 0) + (res.gross[7] || 0);
  if (base != null) {
    if (!known) res.gross[19] = base;
    else if (base - known > 0.05) res.gross[0] = r2(base - known);
  }
  return res;
}

// Wurde das Trinkgeld in die erkannte Summe eingerechnet (Trinkgeld-Zeile vor der Summe)?
function tipIncluded(lines) {
  const tipIdx = lines.findIndex((l) => TIP_RE.test(l));
  const sumIdx = lines.findIndex((l) => TOTAL_KEYS[0].test(l) || TOTAL_KEYS[1].test(l));
  return tipIdx >= 0 && sumIdx > tipIdx;
}

root.Receipt = { parseReceipt, parseAmount, parseDate, grossFromVatLine };
})(typeof window !== 'undefined' ? window : globalThis);
