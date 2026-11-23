// Kürzung des Verpflegungsmehraufwands bei Mahlzeitengestellung (§ 9 Abs. 4a Satz 8 EStG).
// Frühstück (und Brunch) 20 %, Mittag- und Abendessen je 40 % der vollen Tagespauschale (24 h)
// des Landes bzw. Ortes, an dem die Mahlzeit stattfindet. Die Kürzung gilt auch an An- und Abreisetagen.
(function (root) {
'use strict';
// Beträge in €: full = 24 h, partial = An-/Abreisetag bzw. mehr als 8 h, night = Übernachtungspauschale
// Inland: § 9 Abs. 4a EStG. Ausland: BMF-Schreiben vom 05.12.2025 (gültig ab 01.01.2026).
const RATES = {
  2026: {
    source: 'BMF-Schreiben vom 05.12.2025 (Auslandsreisekosten ab 01.01.2026); Inland § 9 Abs. 4a EStG',
    countries: {
      DE: { full: 28, partial: 14, night: 20 },
      AT: { full: 50, partial: 33, night: 117 },
      CH: { full: 70, partial: 47, night: 195, label: 'übriges Land',
        cities: [
          { names: ['bern', 'berne'], label: 'Bern', full: 82, partial: 55, night: 195 },
          { names: ['genf', 'geneve', 'geneva', 'ginevra'], label: 'Genf', full: 70, partial: 47, night: 197 },
        ] },
      LI: { full: 57, partial: 38, night: 234 },
      NL: { full: 58, partial: 39, night: 167 },
      BE: { full: 59, partial: 40, night: 141 },
      LU: { full: 63, partial: 42, night: 139 },
      DK: { full: 75, partial: 50, night: 183 },
      SE: { full: 66, partial: 44, night: 140 },
      NO: { full: 75, partial: 50, night: 139 },
      FI: { full: 54, partial: 36, night: 171 },
      IS: { full: 62, partial: 41, night: 187 },
    },
  },
};
const SHARE = { 'Frühstück': 0.2, 'Brunch': 0.2, 'Mittagessen': 0.4, 'Abendessen': 0.4 };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const r2 = (n) => Math.round(n * 100) / 100;

function table(year) {
  const ys = Object.keys(RATES).map(Number).sort((a, b) => a - b);
  let y = ys[0];
  for (const k of ys) if (k <= year) y = k;
  return { year: y, ...RATES[y], exact: y === year };
}

// Liefert die maßgebliche Pauschale für Land/Ort und Jahr, oder null wenn das Land fehlt.
function rateFor(country, city, year) {
  const t = table(year || new Date().getFullYear());
  const c = t.countries[country];
  if (!c) return null;
  const n = norm(city);
  const hit = (c.cities || []).find((x) => x.names.some((m) => n === m || n.startsWith(m)));
  const r = hit || c;
  return { year: t.year, exact: t.exact, source: t.source, country, place: hit ? hit.label : (c.label || ''), full: r.full, partial: r.partial, night: r.night };
}

// Berechnet die Kürzung für eine Mahlzeit. meal: Frühstück | Brunch | Mittagessen | Abendessen
function compute({ country, city, date, meal }) {
  const year = date ? Number(String(date).slice(0, 4)) : new Date().getFullYear();
  const rate = rateFor(country || 'DE', city, year);
  const share = SHARE[meal];
  if (!rate) return { ok: false, reason: 'Für dieses Land ist keine Pauschale hinterlegt.' };
  if (!share) return { ok: false, rate, reason: 'Bitte unter „Tag und Ort“ die Mahlzeit auswählen.' };
  const mealKind = meal === 'Brunch' ? 'Frühstück' : meal;
  const cut = r2(rate.full * share);
  return {
    ok: true, rate, meal, mealKind, share, cut,
    // Verbleibender Verpflegungsmehraufwand für den Tag (nicht unter 0)
    restFull: Math.max(0, r2(rate.full - cut)),
    restPartial: Math.max(0, r2(rate.partial - cut)),
  };
}

root.Vma = { RATES, rateFor, compute };
})(typeof window !== 'undefined' ? window : globalThis);
