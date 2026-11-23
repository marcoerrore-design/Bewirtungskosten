// Dauerhafte Ablage der Abrechnungen inkl. Belegbilder in IndexedDB (bleibt auf dem Gerät).
(function (root) {
'use strict';
const DB_NAME = 'bewirtung', STORE = 'reports';
let dbp;
function open() {
  if (!root.indexedDB) return Promise.reject(new Error('Kein Speicher verfügbar'));
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  }));
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Speichern abgebrochen'));
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const Reports = {
  put: (rep) => tx('readwrite', (s) => { s.put(rep); }),
  get: (id) => tx('readonly', (s) => req(s.get(id))),
  remove: (id) => tx('readwrite', (s) => { s.delete(id); }),
  all: () => tx('readonly', (s) => req(s.getAll())),
  // Browser bitten, die Daten nicht automatisch zu löschen
  persist: async () => { try { return await navigator.storage?.persist?.(); } catch { return false; } },
};
root.Reports = Reports;
})(window);
