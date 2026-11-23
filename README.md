# Bewirtungskosten

Kleine Web-App für Bewirtungskostenbelege nach § 4 Abs. 5 Satz 1 Nr. 2 EStG.

- Beleg als Foto oder PDF hochladen, Texterkennung läuft lokal im Browser (Tesseract.js, deutsches Sprachmodell; bei digitalen PDFs wird der Textlayer direkt gelesen).
- Datum, Ort, Beträge nach 19 % / 7 % / 0 % und Trinkgeld werden vorgeschlagen und bleiben änderbar.
- PLZ-Suche für DE, AT, CH, LI, NL, BE, LU, DK, SE, NO, FI, IS (zippopotam.us, Rückfall openplzapi.org).
- Gespeicherte Restaurants/Hotels, Gastgeber, Gäste und Anlässe (lokal im Browser, Export/Import als JSON).
- Auslandseinsatzentgelt, Vorsteuer, 70/30-Aufteilung, Unterschrift per Finger/Maus.
- Druckansicht A4 mit Beleg als Anlage; „Als PDF speichern“ im Druckdialog.

## Starten

Keine Build-Schritte. Der Ordner muss nur über einen Webserver ausgeliefert werden (wegen Web-Worker):

    python3 -m http.server 8000
    # dann http://localhost:8000 öffnen

Oder direkt auf GitHub Pages / Netlify / jedem statischen Hosting ablegen.

## Aufbau

- `index.html`, `css/app.css` – Oberfläche und Druck-Layout
- `js/app.js` – Formular, Stammdaten, Druckansicht
- `js/receipt.js` – Auslesen von Bons (Heuristiken), Tests: `node test/receipt.test.mjs`
- `js/plz.js` – Postleitzahlen-Suche
- `vendor/` – Tesseract.js 5, deutsches Sprachmodell, pdf.js 4 (lokal, kein CDN)
