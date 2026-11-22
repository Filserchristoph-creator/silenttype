import type { Recording } from "./types.ts";

/**
 * Local persistence using IndexedDB.
 *
 * All recordings are stored ONLY in the browser on this device. Nothing is
 * uploaded anywhere. The user can export (JSON/CSV) or clear everything.
 *
 * We store the reduced landmark time-series, never raw video (video is only
 * kept transiently in memory and only if the user ticks the extra consent box;
 * see the recorder view).
 */

const DB_NAME = "silenttype";
const DB_VERSION = 1;
const STORE = "recordings";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("commandId", "commandId", { unique: false });
        store.createIndex("sessionId", "sessionId", { unique: false });
        store.createIndex("device", "device", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecording(rec: Recording): Promise<void> {
  const db = await openDb();
  await tx(db, "readwrite", (store) => store.put(rec));
  db.close();
}

export async function getAllRecordings(): Promise<Recording[]> {
  const db = await openDb();
  const result = await req<Recording[]>(
    (await getStore(db, "readonly")).getAll(),
  );
  db.close();
  return result;
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await openDb();
  await tx(db, "readwrite", (store) => store.delete(id));
  db.close();
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  await tx(db, "readwrite", (store) => store.clear());
  db.close();
}

export async function countByCommand(): Promise<Record<string, number>> {
  const all = await getAllRecordings();
  const counts: Record<string, number> = {};
  for (const r of all) counts[r.commandId] = (counts[r.commandId] ?? 0) + 1;
  return counts;
}

// --- small IndexedDB helpers -------------------------------------------------

async function getStore(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): Promise<IDBObjectStore> {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    op(store);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
