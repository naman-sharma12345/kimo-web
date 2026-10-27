/** Bounded IDB event/transaction double for unit tests, NOT browser conformance. */
import type { EditIDBPlatform } from './indexeddb';
export function idbTestPlatform() {
  const rows = new Map<string, unknown>();
  const locks = new Set<string>();
  let abortNextPut = false;
  let commitGate: Promise<void> | undefined;
  let openBlocked = false;
  let revision = 0;
  let tail = Promise.resolve();
  const handles: Array<{ onversionchange?: () => void; close(): void }> = [];
  let closeCount = 0;
  const factory = {
    open() {
      const request: {
        result?: unknown;
        onupgradeneeded?: () => void;
        onsuccess?: () => void;
        onblocked?: () => void;
      } = {};
      const database = {
        objectStoreNames: { contains: () => true },
        onversionchange: undefined as (() => void) | undefined,
        close() {
          closeCount++;
        },
        transaction(_name: string, mode: IDBTransactionMode) {
          const initial = tail;
          let release!: () => void;
          tail = new Promise<void>((resolve) => {
            release = resolve;
          });
          let aborted = false;
          let pendingPut: { key: string; value: unknown } | undefined;
          const tx: {
            oncomplete?: () => void;
            onerror?: () => void;
            onabort?: () => void;
            objectStore(): unknown;
            abort(): void;
          } = {
            abort() {
              if (aborted) return;
              aborted = true;
              tx.onabort?.();
              release();
            },
            objectStore() {
              return {
                get(key: string[]) {
                  const get: { result?: unknown; onsuccess?: () => void } = {};
                  void initial.then(() => {
                    get.result = structuredClone(rows.get(JSON.stringify(key)));
                    get.onsuccess?.();
                    const gate = commitGate;
                    void Promise.resolve(gate).then(() => {
                      if (aborted) return;
                      if (pendingPut)
                        rows.set(pendingPut.key, pendingPut.value);
                      tx.oncomplete?.();
                      release();
                    });
                  });
                  return get;
                },
                put(value: unknown, key: string[]) {
                  if (mode !== 'readwrite')
                    throw new Error('Readonly transaction');
                  if (abortNextPut) {
                    abortNextPut = false;
                    tx.abort();
                    return;
                  }
                  pendingPut = {
                    key: JSON.stringify(key),
                    value: structuredClone(value),
                  };
                },
              };
            },
          };
          return tx;
        },
      };
      handles.push(database);
      queueMicrotask(() => {
        request.result = database;
        if (openBlocked) request.onblocked?.();
        // Also exercise late successful open after a blocked rejection.
        request.onsuccess?.();
      });
      return request;
    },
  };
  const platform: EditIDBPlatform = {
    indexedDB: factory as unknown as IDBFactory,
    locks: {
      request: async (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => Promise<void>,
      ) => {
        if (_options.signal && _options.ifAvailable)
          throw new Error('Web Locks forbids signal with ifAvailable');
        if (locks.has(name)) {
          await callback(null);
          return;
        }
        locks.add(name);
        try {
          await callback({ name, mode: 'exclusive' } as Lock);
        } finally {
          locks.delete(name);
        }
      },
    } as unknown as Pick<LockManager, 'request'>,
    makeId: () => `owner-${++revision}`,
  };
  return {
    platform,
    rows,
    locks,
    abortNextPut() {
      abortNextPut = true;
    },
    gateCommits(gate?: Promise<void>) {
      commitGate = gate;
    },
    blockOpen() {
      openBlocked = true;
    },
    versionChange() {
      for (const handle of handles) handle.onversionchange?.();
    },
    closedHandles: () => closeCount,
  };
}
