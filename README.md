# Bewirtungskosten

Kleine Web-App für Bewirtungskostenbelege nach § 4 Abs. 5 Satz 1 Nr. 2 EStG.

- Ein oder mehrere Belege je Abrechnung als Foto oder PDF hochladen, Texterkennung läuft lokal im Browser (Tesseract.js, deutsches Sprachmodell; bei digitalen PDFs wird der Textlayer direkt gelesen).
- Jeder Beleg hat einen eigenen Betrag, die Gesamtsumme aller Belege wird mit der Aufteilung nach Steuersätzen abgeglichen.
- Belegfotos zuschneiden und drehen (`js/crop.js`, automatische Erkennung des Bons, Original bleibt erhalten); Belege einzeln oder zusammen als PDF sichern.
- Datum, Ort, Beträge nach 19 % / 7 % / 0 % und Trinkgeld werden vorgeschlagen und bleiben änderbar.
- PLZ-Suche für DE, AT, CH, LI, NL, BE, LU, DK, SE, NO, FI, IS (zippopotam.us, Rückfall openplzapi.org).
- Locations (Restaurants/Hotels) als bearbeitbares Dropdown, dazu, Gastgeber, Gäste und Anlässe (lokal im Browser, Export/Import als JSON).
- Auslandseinsatzentgelt, Vorsteuer, 70/30-Aufteilung, Unterschrift per Finger/Maus.
- Druckansicht A4 mit Beleg als Anlage; „Als PDF speichern“ im Druckdialog.

## Auf Handy und Tablet

Die App ist eine installierbare Web-App (PWA) für iPhone/iPad (Safari) und Android (Chrome):
- iPhone/iPad: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.
- Android: Chrome bietet „App installieren“ an (oder Menü → „Zum Startbildschirm hinzufügen“).

Nach dem ersten Öffnen läuft sie auch offline (Service Worker `sw.js`). Bei Änderungen an der App
in `sw.js` die `VERSION` erhöhen, damit installierte Apps das Update laden.

## Starten

`index.html` per Doppelklick öffnen. Es wird kein Webserver gebraucht, alle Bibliotheken liegen in `vendor/`.
Für die PLZ-Suche braucht der Browser Internet. Später kann der Ordner unverändert auf GitHub Pages liegen.

## Aufbau

- `index.html`, `css/app.css` – Oberfläche und Druck-Layout
- `js/app.js` – Formular, Stammdaten, Druckansicht
- `js/receipt.js` – Auslesen von Bons (Heuristiken), Tests: `node test/receipt.test.mjs`
- `js/crop.js` – Zuschneiden und Drehen der Belegfotos
- `js/plz.js` – Postleitzahlen-Suche
- `vendor/` – Tesseract.js 5 mit deutschem Sprachmodell und pdf.js 3, als klassische Skripte eingebettet; neu erzeugen mit `npm install && npm run build:vendor`
