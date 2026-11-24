// Erzeugt die Abrechnung als echtes PDF direkt im Browser (jsPDF), ohne Druckdialog.
// So funktioniert „PDF“ auch auf iPhone, Android und in installierten Web-Apps.
(function (root) {
'use strict';
const nf = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => nf.format(n || 0) + ' €';
const dash = (n) => (n ? nf.format(n) : '–');

function imageSize(src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res(null); i.src = src; });
}

async function build(d) {
  const { jsPDF } = root.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, M = 18, R = W - M, colL = M, colV = M + 60;
  let y = M;
  const ink = () => doc.setTextColor(20, 20, 20);
  const muted = () => doc.setTextColor(90, 90, 90);
  const line = (yy, w = 0.2, g = 170) => { doc.setDrawColor(g); doc.setLineWidth(w); doc.line(M, yy, R, yy); };

  // Kopf: Logo und Firmenadresse als Block oben rechts (rechtsbündig)
  let ry = M - 4;
  if (d.logo) {
    const s = await imageSize(d.logo);
    if (s) {
      const k = Math.min(50 / s.w, 18 / s.h), w = s.w * k, h = s.h * k;
      doc.addImage(d.logo, 'PNG', R - w, ry, w, h);
      ry += h + 4;
    }
  }
  if (d.company) {
    ry += 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); ink(); doc.text(d.company, R, ry, { align: 'right' }); ry += 4.4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); muted();
    for (const l of d.companyLines || []) { doc.text(l, R, ry, { align: 'right' }); ry += 4; }
  }
  y = Math.max(M, ry + 4);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); ink(); doc.text('Bewirtungskosten-Abrechnung', M, y + 2); y += 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); muted();
  const law = doc.splitTextToSize('Angaben zum Nachweis der Höhe und der betrieblichen Veranlassung von Bewirtungsaufwendungen (§ 4 Abs. 5 Satz 1 Nr. 2 EStG)', R - M);
  doc.text(law, M, y); y += law.length * 3.6 + 1;
  line(y, 0.6, 0); y += 6;

  // Angaben
  doc.setFontSize(10);
  const fact = (label, valueLines, boldFirst = false) => {
    doc.setFont('helvetica', 'bold'); ink();
    const lab = doc.splitTextToSize(label, colV - colL - 3); doc.text(lab, colL, y);
    let yy = y;
    valueLines.forEach((v, i) => {
      doc.setFont('helvetica', boldFirst && i === 0 ? 'bold' : 'normal');
      const parts = doc.splitTextToSize(v || ' ', R - colV);
      doc.text(parts, colV, yy); yy += parts.length * 4.6;
    });
    y = Math.max(y + lab.length * 4.6, yy) + 1.6;
    line(y - 3.4); y += 2;
  };
  const p = d.place;
  fact('Tag der Bewirtung', [d.dateLong || d.date || '']);
  fact('Ort der Bewirtung' + (p.type ? ` (${p.type})` : ''), [p.name, p.street, [p.zip, p.city].filter(Boolean).join(' ') + (p.countryName ? ', ' + p.countryName : '')].filter((x) => x && x.trim()), true);
  fact('Gastgeber', [d.host || '']);
  fact('Bewirtete Personen', d.guests.length ? d.guests.map((g, i) => `${i + 1}. ${g.name}${g.company ? ' – ' + g.company : ''}`) : ['']);
  fact('Teilnehmer gesamt', [d.participants]);
  fact('Anlass der Bewirtung', [d.occasion || '']);

  // Beträge
  y += 2;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); ink(); doc.text('Höhe der Aufwendungen', M, y); y += 6;
  const cx = [R - 62, R - 34, R]; // Netto, MwSt, Brutto (rechtsbündig)
  doc.setFontSize(8.5); doc.text('Netto', cx[0], y, { align: 'right' }); doc.text('MwSt', cx[1], y, { align: 'right' }); doc.text('Brutto', cx[2], y, { align: 'right' });
  y += 1.6; line(y, 0.3, 0); y += 4.6;
  const c = d.calc;
  const rows = [
    ['Speisen und Getränke 19 %', c.line[19].gross && c.line[19].net, c.line[19].gross && c.line[19].vat, c.line[19].gross],
    ['Speisen und Getränke 7 %', c.line[7].gross && c.line[7].net, c.line[7].gross && c.line[7].vat, c.line[7].gross],
    ['Steuerfrei / 0 %', c.line[0].gross, 0, c.line[0].gross],
    ['Trinkgeld', c.tip, 0, c.tip],
    ['Auslandseinsatzentgelt Karte', c.fee, 0, c.fee],
  ];
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  for (const [label, n, v, g] of rows) {
    doc.text(label, M, y); doc.text(dash(n), cx[0], y, { align: 'right' }); doc.text(dash(v), cx[1], y, { align: 'right' }); doc.text(dash(g), cx[2], y, { align: 'right' });
    y += 1.8; line(y, 0.15, 210); y += 4.4;
  }
  y -= 1.6; line(y, 0.4, 0); y += 4.8;
  doc.setFont('helvetica', 'bold');
  doc.text('Gesamtbetrag', M, y); doc.text(nf.format(c.net), cx[0], y, { align: 'right' }); doc.text(nf.format(c.vat), cx[1], y, { align: 'right' }); doc.text(money(c.gross), cx[2], y, { align: 'right' });
  y += 8;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  const split = [
    [`Vorsteuer${c.foreign ? ' (ausländische Rechnung, kein Vorsteuerabzug)' : ''}`, c.inputTax],
    [`Betriebsausgabe, abzugsfähig (70 % von ${nf.format(c.base7030)})`, c.deductible],
    ['Betriebsausgabe, nicht abzugsfähig (30 %)', c.nonDeductible],
  ];
  if (c.feeFull && c.fee) split.push(['Auslandseinsatzentgelt als Bankgebühr, voll abzugsfähig', c.fee]);
  for (const [l, v] of split) { doc.text(l, M, y); doc.text(money(v), R, y, { align: 'right' }); y += 5; }

  y += 3; doc.setFontSize(8.8); muted();
  const note = doc.splitTextToSize(d.note, R - M); doc.text(note, M, y); y += note.length * 3.8;

  // Unterschrift
  y = Math.max(y + 18, 238);
  const sx = M + 85;
  ink(); doc.setFontSize(10);
  if (d.signPlaceDate) doc.text(d.signPlaceDate, M, y - 2);
  if (d.signature) {
    const s = await imageSize(d.signature);
    if (s) { const h = 20, w = Math.min(R - sx, h * s.w / s.h); doc.addImage(d.signature, 'PNG', sx, y - h - 1, w, h); }
  }
  doc.setDrawColor(0); doc.setLineWidth(0.3);
  doc.line(M, y, M + 70, y); doc.line(sx, y, R, y);
  doc.setFontSize(8.5); muted();
  doc.text('Ort, Datum', M, y + 4);
  doc.text(`Unterschrift Gastgeber${d.host ? ' (' + d.hostName + ')' : ''}`, sx, y + 4);

  // Anlagen: Beleg-Seiten
  for (let i = 0; i < d.pages.length; i++) {
    doc.addPage();
    doc.setFontSize(8.5); muted();
    doc.text(`Anlage${d.pages.length > 1 ? ` ${i + 1}/${d.pages.length}` : ''} – Beleg vom ${d.date || ''}, ${p.name || ''}`, M, M);
    const src = d.pages[i].src;
    const s = await imageSize(src);
    if (!s) continue;
    const maxW = R - M, maxH = 297 - M - (M + 6);
    const k = Math.min(maxW / s.w, maxH / s.h);
    const w = s.w * k, h = s.h * k;
    const fmt = src.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    doc.addImage(src, fmt, M + (maxW - w) / 2, M + 4, w, h, undefined, 'FAST');
  }
  // Letzte Seite (nach den Belegen): Kürzung des Verpflegungsmehraufwands (Dienstreise, Mahlzeit vom Arbeitgeber/Unternehmen bezahlt)
  const v = d.vma;
  if (v) {
    doc.addPage(); y = M;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); ink(); doc.text('Kürzung des Verpflegungsmehraufwands', M, y + 2); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); muted();
    const sub = doc.splitTextToSize('Kürzung der Verpflegungspauschale bei Gestellung einer Mahlzeit während einer Dienstreise (§ 9 Abs. 4a Satz 8 EStG). Gehört zur Bewirtungskosten-Abrechnung vom ' + (d.date || '') + '.', R - M);
    doc.text(sub, M, y); y += sub.length * 3.6 + 1;
    line(y, 0.6, 0); y += 3;
    // Hinweis: nur intern
    doc.setFillColor(255, 244, 224); doc.setDrawColor(161, 92, 0); doc.setLineWidth(0.3);
    doc.rect(M, y, R - M, 8, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(161, 92, 0);
    doc.text('Nur zur Information und internen Verwendung', W / 2, y + 5.3, { align: 'center' });
    y += 14; ink(); doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    fact('Reisetag', [d.dateLong || d.date || '']);
    fact('Ort der Mahlzeit', [p.name, [p.zip, p.city].filter(Boolean).join(' ') + (v.countryFull ? ', ' + v.countryFull : '')].filter((x) => x && x.trim()), true);
    if (v.rate) fact('Maßgebliche Pauschale', [`${v.placeLabel} (Stand ${v.rate.year})`]);
    fact('Mahlzeit', [v.meal ? (v.meal === 'Brunch' ? 'Brunch (wird als Frühstück gekürzt)' : v.meal) : 'nicht angegeben']);

    if (!v.ok) {
      y += 2; doc.setFont('helvetica', 'bold'); doc.setTextColor(161, 92, 0);
      doc.text(doc.splitTextToSize(v.reason, R - M), M, y); y += 8;
    } else {
      y += 2;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); ink(); doc.text('Berechnung', M, y); y += 6;
      doc.setFontSize(8.5); doc.text('Betrag', R, y, { align: 'right' });
      y += 1.6; line(y, 0.3, 0); y += 4.6;
      doc.setFontSize(10);
      const row = (label, val, bold = false, thin = true) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal'); ink();
        doc.text(label, M, y); doc.text(val, R, y, { align: 'right' });
        y += 1.8; if (thin) line(y, 0.15, 210); y += 4.4;
      };
      row('Tagespauschale bei 24 Stunden Abwesenheit', money(v.rate.full));
      row('Pauschale An-/Abreisetag bzw. mehr als 8 Stunden', money(v.rate.partial));
      row(`Kürzungssatz ${v.mealKind}`, `${v.share * 100} % der Tagespauschale (24 h)`);
      y -= 1.6; line(y, 0.4, 0); y += 4.8;
      row(`Kürzung Verpflegungsmehraufwand (${v.mealKind})`, money(v.cut), true, false);
      y += 3;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); muted();
      const rest = [
        ['Verbleibende Pauschale an einem Tag mit 24 h Abwesenheit', v.restFull],
        ['Verbleibende Pauschale am An-/Abreisetag bzw. bei mehr als 8 h', v.restPartial],
      ];
      for (const [l, val] of rest) { doc.text(l, M, y); doc.text(money(val), R, y, { align: 'right' }); y += 5; }
      if (v.rate.night) { doc.text('Zur Information: Übernachtungspauschale', M, y); doc.text(money(v.rate.night), R, y, { align: 'right' }); y += 5; }
    }

    // Zur Information: durchschnittlicher Verzehr je teilnehmender Person
    if (d.persons > 0) {
      const food = c.line[19].gross + c.line[7].gross + c.line[0].gross;
      y += 4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); ink(); doc.text('Zur Information: Verzehr je Person', M, y); y += 2; line(y, 0.3, 0); y += 5;
      doc.setFontSize(10);
      const info = [
        ['Teilnehmende Personen', d.participants],
        ['Speisen und Getränke gesamt (brutto)', money(food)],
        ['Durchschnitt je Person', money(food / d.persons), true],
      ];
      if (c.tip) info.push(['Durchschnitt je Person einschließlich Trinkgeld', money((food + c.tip) / d.persons)]);
      for (const [l, val, b] of info) {
        doc.setFont('helvetica', b ? 'bold' : 'normal'); ink();
        doc.text(l, M, y); doc.text(val, R, y, { align: 'right' }); y += 1.8; line(y, 0.15, 210); y += 4.4;
      }
    }

    y += 4; doc.setFontSize(8.8); muted(); doc.setFont('helvetica', 'normal');
    const hints = [
      'Die Kürzung beträgt für ein Frühstück 20 % und für ein Mittag- oder Abendessen je 40 % der Pauschale für eine 24-stündige Abwesenheit an dem Ort, an dem die Mahlzeit stattfindet. Sie gilt auch an An- und Abreisetagen.',
      'Werden an einem Reisetag mehrere Mahlzeiten gestellt, werden die Kürzungen addiert. Die Verpflegungspauschale des Tages kann dadurch höchstens auf 0,00 € sinken.',
      'Grundlage: ' + (v.rate && v.rate.country !== 'DE' ? 'BMF-Schreiben vom 05.12.2025 zu den Pauschbeträgen für Auslandsdienstreisen ab 01.01.2026' : '§ 9 Abs. 4a EStG (Inlandspauschalen)') + '.' + (v.rate && !v.rate.exact ? ` Für das Jahr der Bewirtung ist noch keine Tabelle hinterlegt, verwendet wurden die Werte ${v.rate.year}.` : ''),
    ];
    for (const h of hints) { const t = doc.splitTextToSize(h, R - M); doc.text(t, M, y); y += t.length * 3.8 + 2; }
  }

  doc.setProperties({ title: d.fileName.replace(/\.pdf$/, ''), subject: 'Bewirtungskosten-Abrechnung', creator: 'Bewirtungskosten-Abrechnung (Web-App)' });
  return doc.output('blob');
}

root.PdfExport = { build };
})(window);
