// Erzeugt vendor/ aus node_modules. Alle Bibliotheken werden als klassische <script>-Dateien
// abgelegt, damit die App auch per Doppelklick (file://) ohne Webserver läuft.
import fs from 'node:fs';
const nm = 'node_modules/';
fs.rmSync('vendor', { recursive: true, force: true });
fs.mkdirSync('vendor', { recursive: true });
const wrap = (key, str) => `window.__EMB=window.__EMB||{};window.__EMB[${JSON.stringify(key)}]=${JSON.stringify(str)};\n`;
fs.copyFileSync(nm + 'tesseract.js/dist/tesseract.min.js', 'vendor/tesseract.min.js');
// Fix für tesseract.js 5: bei Sprachdaten als Objekt ({code, data}) muss der Sprachcode an Tesseract gehen, nicht die Daten.
const workerSrc = fs.readFileSync(nm + 'tesseract.js/dist/worker.min.js', 'utf8');
const patched = workerSrc.replace('return"string"==typeof t?t:t.data})).join("+")', 'return"string"==typeof t?t:t.code})).join("+")');
if (patched === workerSrc) throw new Error('tesseract worker patch not applied');
fs.writeFileSync('vendor/tess-worker.js', wrap('worker', patched));
fs.writeFileSync('vendor/tess-core-simd.js', wrap('core', fs.readFileSync(nm + 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'utf8')));
fs.writeFileSync('vendor/tess-core.js', wrap('core', fs.readFileSync(nm + 'tesseract.js-core/tesseract-core-lstm.wasm.js', 'utf8')));
fs.writeFileSync('vendor/tess-deu.js', wrap('deu', fs.readFileSync(nm + '@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz').toString('base64')));
fs.copyFileSync(nm + 'pdfjs-dist/legacy/build/pdf.min.js', 'vendor/pdf.min.js');
fs.copyFileSync(nm + 'pdfjs-dist/legacy/build/pdf.worker.min.js', 'vendor/pdf.worker.min.js');
for (const f of fs.readdirSync('vendor')) console.log(f, (fs.statSync('vendor/' + f).size / 1e6).toFixed(2) + ' MB');
