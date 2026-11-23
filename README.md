# Bewirtungskosten

Kleine Web-App für Bewirtungskostenbelege nach § 4 Abs. 5 Satz 1 Nr. 2 EStG.

- Beleg als Foto oder PDF hochladen, Texterkennung läuft lokal im Browser (Tesseract.js, deutsches Sprachmodell; bei digitalen PDFs wird der Textlayer direkt gelesen).
- Datum, Ort, Beträge nach 19 % / 7 % / 0 % und Trinkgeld werden vorgeschlagen und bleiben änderbar.
- PLZ-Suche für DE, AT, CH, LI, NL, BE, LU, DK, SE, NO, FI, IS (zippopotam.us, Rückfall openplzapi.org).
- Locations (Restaurants/Hotels) als bearbeitbares Dropdown, dazu, Gastgeber, Gäste und Anlässe (lokal im Browser, Export/Import als JSON).
- Auslandseinsatzentgelt, Vorsteuer, 70/30-Aufteilung, Unterschrift per Finger/Maus.
- Druckansicht A4 mit Beleg als Anlage; „Als PDF speichern“ im Druckdialog.

## Starten

`index.html` per Doppelklick öffnen. Es wird kein Webserver gebraucht, alle Bibliotheken liegen in `vendor/`.
Für die PLZ-Suche braucht der Browser Internet. Später kann der Ordner unverändert auf GitHub Pages liegen.

## Aufbau

- `index.html`, `css/app.css` – Oberfläche und Druck-Layout
- `js/app.js` – Formular, Stammdaten, Druckansicht
- `js/receipt.js` – Auslesen von Bons (Heuristiken), Tests: `node test/receipt.test.mjs`
- `js/plz.js` – Postleitzahlen-Suche
- `vendor/` – Tesseract.js 5 mit deutschem Sprachmodell und pdf.js 3, als klassische Skripte eingebettet; neu erzeugen mit `npm install && npm run build:vendor`
