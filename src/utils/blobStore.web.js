// Audio recordings of the web version: Blobs kept in the browser's IndexedDB (a WAV of a meeting is too big for localStorage).
const DB = 'dualcast-audio';
const STORE = 'blobs';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const run = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

export const putBlob = (key, blob) => run('readwrite', (s) => s.put(blob, key));
export const getBlob = (key) => run('readonly', (s) => s.get(key));
export const deleteBlob = (key) => run('readwrite', (s) => s.delete(key));
