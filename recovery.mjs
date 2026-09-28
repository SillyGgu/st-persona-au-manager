const DB_NAME = 'st-persona-au-manager-recovery';
const keyFor = (handle, slot) => `${handle}:${slot}`;

function openDatabase() {
    return new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) return reject(new Error('IndexedDB unavailable'));
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function writeRecoverySnapshot(handle, snapshot) {
    const db = await openDatabase();
    try {
        await new Promise((resolve, reject) => {
            const transaction = db.transaction('snapshots', 'readwrite');
            transaction.objectStore('snapshots').put(snapshot, keyFor(handle, 'latest'));
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    } finally { db.close(); }
}

export async function readRecoverySnapshot(handle) {
    const db = await openDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction('snapshots', 'readonly');
            const request = transaction.objectStore('snapshots').get(keyFor(handle, 'latest'));
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error);
        });
    } finally { db.close(); }
}

export async function preserveRecoverySnapshot(handle, snapshot) {
    const db = await openDatabase();
    try {
        await new Promise((resolve, reject) => {
            const transaction = db.transaction('snapshots', 'readwrite');
            const store = transaction.objectStore('snapshots');
            const request = store.get(keyFor(handle, 'unresolved'));
            request.onsuccess = () => { if (!request.result) store.put(snapshot, keyFor(handle, 'unresolved')); };
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    } finally { db.close(); }
}

export async function readUnresolvedRecoverySnapshot(handle) {
    const db = await openDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const request = db.transaction('snapshots', 'readonly').objectStore('snapshots').get(keyFor(handle, 'unresolved'));
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error);
        });
    } finally { db.close(); }
}

export async function readLegacyRecoverySnapshots() {
    const db = await openDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction('snapshots', 'readonly');
            const store = transaction.objectStore('snapshots');
            const latest = store.get('latest');
            const unresolved = store.get('unresolved');
            transaction.oncomplete = () => resolve({ latest: latest.result ?? null, unresolved: unresolved.result ?? null });
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    } finally { db.close(); }
}
