import fs from 'node:fs';
import vm from 'node:vm';
const ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(new URL('../js/receipt.js', import.meta.url), 'utf8'), ctx);
const { parseReceipt, parseAmount } = ctx.Receipt;
import assert from 'node:assert/strict';
const a = `Ristorante Da Mario
Hauptstraße 12
80331 München
Tel. 089 123456
Rechnung Nr. 4711   Tisch 5
15.11.2026 20:14
2 Pizza Margherita      19,80
1 Wasser 0,75            6,50
2 Espresso               5,00
SUMME EUR               31,30
MwSt   Netto  MwSt  Brutto
19%    26,30  5,00   31,30
Kartenzahlung           31,30`;
let r = parseReceipt(a);
console.log(r);
assert.equal(r.date, '2026-11-15'); assert.equal(r.total, 31.3); assert.equal(r.gross[19], 31.3);
assert.equal(r.zip, '80331'); assert.equal(r.city, 'München'); assert.equal(r.name, 'Ristorante Da Mario');
const b = `Hotel Seeblick GmbH
Seestr. 4
D-78462 Konstanz
Datum: 03.11.26
Übernachtung Frühstück 2x       30,00
Abendessen 3 Pers.              89,50
Gesamtbetrag                   119,50
A = 7%  Netto 28,04 MwSt 1,96 Brutto 30,00
B = 19% Netto 75,21 MwSt 14,29 Brutto 89,50
Trinkgeld 10,00`;
r = parseReceipt(b); console.log(r);
assert.equal(r.gross[7], 30); assert.equal(r.gross[19], 89.5); assert.equal(r.tip, 10); assert.equal(r.total, 119.5); assert.equal(r.date,'2026-11-03');
const c = `Café Central
Herrengasse 14
1010 Wien
Gesamt 48,20
inkl. 19% MwSt 7,70`;
r = parseReceipt(c); console.log(r); assert.equal(r.gross[19], 48.2);
assert.equal(parseAmount('1.234,56'), 1234.56); assert.equal(parseAmount('12.50'), 12.5);
console.log('OK');
