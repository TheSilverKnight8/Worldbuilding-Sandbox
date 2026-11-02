import type { WorldBlob, WorldDoc, WorldMeta } from './world/types';

// The app's storage in this browser (IndexedDB). Nothing leaves the computer.
//
//   worlds  WorldMeta by world ID: the small list Home shows
//   docs    { id, version, doc } by world ID: the whole world except its blobs
//   blobs   WorldBlob by [world ID, blob ID]: images, the map backdrop, map layers
//
// Blob keys start with the world ID, so two worlds can never clash and a whole world's
// blobs can be found or removed in one range.

const DB_NAME = 'worldbuilding-sandbox';
const DB_VERSION = 1;

export interface StoredDoc {
  id: string;
  /** The world format version the doc was saved in (see world/format.ts). */
  version: number;
  doc: WorldDoc;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('This browser has no IndexedDB storage.'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: ['worldId', 'id'] });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab with a newer version of the app needs to upgrade the database.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The app is open in another tab with an older version. Close that tab and reload.'));
  });
  opening.catch(() => (opening = null));
  return opening;
}

function result<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('The save was cancelled.', 'AbortError'));
  });
}

/** Every blob key for one world: [worldId, anything]. Arrays sort after strings, so [worldId, []] is past the last one. */
const worldRange = (worldId: string) => IDBKeyRange.bound([worldId], [worldId, []]);

export async function listWorlds(): Promise<WorldMeta[]> {
  const db = await open();
  return result(db.transaction('worlds').objectStore('worlds').getAll() as IDBRequest<WorldMeta[]>);
}

export async function readDoc(id: string): Promise<StoredDoc | undefined> {
  const db = await open();
  return result(db.transaction('docs').objectStore('docs').get(id) as IDBRequest<StoredDoc | undefined>);
}

/** Saves a world's list entry and doc together, so they never disagree. */
export async function writeWorld(meta: WorldMeta, stored: StoredDoc): Promise<void> {
  const db = await open();
  const tx = db.transaction(['worlds', 'docs'], 'readwrite');
  tx.objectStore('worlds').put(meta);
  tx.objectStore('docs').put(stored);
  return finished(tx);
}

/** Adds a whole world at once (import), blobs included. Either all of it is saved or none of it. */
export async function addWorld(meta: WorldMeta, stored: StoredDoc, blobs: WorldBlob[]): Promise<void> {
  const db = await open();
  const tx = db.transaction(['worlds', 'docs', 'blobs'], 'readwrite');
  tx.objectStore('worlds').add(meta);
  tx.objectStore('docs').add(stored);
  for (const b of blobs) tx.objectStore('blobs').put(b);
  return finished(tx);
}

export async function deleteWorldData(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(['worlds', 'docs', 'blobs'], 'readwrite');
  tx.objectStore('worlds').delete(id);
  tx.objectStore('docs').delete(id);
  tx.objectStore('blobs').delete(worldRange(id));
  return finished(tx);
}

export async function putBlob(blob: WorldBlob): Promise<void> {
  const db = await open();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put(blob);
  return finished(tx);
}

export async function getBlob(worldId: string, id: string): Promise<WorldBlob | undefined> {
  const db = await open();
  return result(db.transaction('blobs').objectStore('blobs').get([worldId, id]) as IDBRequest<WorldBlob | undefined>);
}

export async function deleteBlob(worldId: string, id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').delete([worldId, id]);
  return finished(tx);
}

export async function listBlobs(worldId: string): Promise<WorldBlob[]> {
  const db = await open();
  return result(db.transaction('blobs').objectStore('blobs').getAll(worldRange(worldId)) as IDBRequest<WorldBlob[]>);
}

/** Turns storage errors into a sentence a person can act on. */
export function storageMessage(e: unknown): string {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'QuotaExceededError') return 'The browser has no more room for this site. Free up disk space, or delete a world.';
  return err?.message || 'Unknown storage error.';
}
