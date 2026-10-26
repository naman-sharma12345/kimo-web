const STORE = 'media';
export interface CachedMedia {
  waveform?: Float32Array;
  timelinePeaks?: Float32Array;
  thumbnail?: Blob;
  frames?: Blob[];
}
let connection: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined')
    return Promise.reject(new Error('IndexedDB unavailable'));
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('kimo-media-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        connection = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      connection = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      connection = undefined;
      reject(new Error('Media cache blocked'));
    };
  });
  return connection;
}
export async function readMedia(
  localId: string,
): Promise<CachedMedia | undefined> {
  try {
    const db = await open();
    return await new Promise<CachedMedia | undefined>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(localId);
      request.onsuccess = () =>
        resolve(request.result as CachedMedia | undefined);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined;
  }
}
export async function writeMedia(
  localId: string,
  data: CachedMedia,
): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, localId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* Quota/private browsing must never block uploads. */
  }
}
export async function deleteMedia(localId: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(localId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* Best effort cache cleanup. */
  }
}
