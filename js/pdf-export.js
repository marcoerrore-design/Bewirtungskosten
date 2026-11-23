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
  const W = 210, M = 18, R = W - M, colL = M, colV = M + 52;
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
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); ink(); doc.text('Bewirtungskostenbeleg', M, y + 2); y += 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); muted();
  const law = doc.splitTextToSize('Angaben zum Nachweis der Höhe und der betrieblichen Veranlassung von Bewirtungsaufwendungen (§ 4 Abs. 5 Satz 1 Nr. 2 EStG)', R - M);
  doc.text(law, M, y); y += law.length * 3.6 + 1;
  line(y, 0.6, 0); y += 6;

  // Angaben
  doc.setFontSize(10);
  const fact = (label, valueLines, boldFirst = false) => {
    doc.setFont('helvetica', 'bold'); ink(); doc.text(label, colL, y);
    let yy = y;
    valueLines.forEach((v, i) => {
      doc.setFont('helvetica', boldFirst && i === 0 ? 'bold' : 'normal');
      const parts = doc.splitTextToSize(v || ' ', R - colV);
      doc.text(parts, colV, yy); yy += parts.length * 4.6;
    });
    y = Math.max(y + 4.6, yy) + 1.6;
    line(y - 3.4); y += 2;
  };
  const p = d.place;
  fact('Tag der Bewirtung', [d.date || '']);
  fact('Ort der Bewirtung', [p.name + (p.type ? ` (${p.type})` : ''), p.street, [p.zip, p.city].filter(Boolean).join(' ') + (p.countryName ? ', ' + p.countryName : '')].filter((x) => x && x.trim()), true);
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
  doc.setProperties({ title: d.fileName.replace(/\.pdf$/, ''), subject: 'Bewirtungskostenbeleg', creator: 'Bewirtungskosten Web-App' });
  return doc.output('blob');
}

root.PdfExport = { build };
})(window);
