import { z } from 'zod';
import {
  editOutboxSchema,
  legacyOutboxSchema,
  validateOutbox,
  legacyOutboxKey,
  EditPersistenceError,
  type EditOutboxPersistence,
  type EditOutboxIdentity,
  type EditOutboxRecord,
} from './persistence';

const STORE = 'outboxes';
const envelopeSchema = z.object({
  owner: z.string().min(1),
  revision: z.number().int().nonnegative().safe(),
  record: editOutboxSchema.nullable(),
  migration: z.string().optional(),
});
type Envelope = z.infer<typeof envelopeSchema>;
/** Native seams are injectable for bounded unit tests; never a production polyfill. */
export interface EditIDBPlatform {
  indexedDB: IDBFactory;
  locks: Pick<LockManager, 'request'>;
  makeId(): string;
}
function failure(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
function openDatabase(
  factory: IDBFactory,
  signal: AbortSignal,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('kimo-editing-v2', 1);
    let ended = false;
    const stop = (cause: Error) => {
      if (ended) return;
      ended = true;
      signal.removeEventListener('abort', cancel);
      reject(cause);
    };
    const cancel = () => stop(new Error('Editing storage open cancelled'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    request.onupgradeneeded = () => {
      if (ended) {
        request.transaction?.abort();
        return;
      }
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onerror = () =>
      stop(request.error ?? new Error('Editing storage open failed'));
    request.onblocked = () =>
      stop(new Error('Editing storage upgrade blocked'));
    request.onsuccess = () => {
      if (ended) {
        request.result.close();
        return;
      }
      ended = true;
      signal.removeEventListener('abort', cancel);
      resolve(request.result);
    };
  });
}
/** No promises/await inside IDB callbacks: complete, not request success, commits. */
function transaction<T>(
  db: IDBDatabase,
  key: string[],
  mode: IDBTransactionMode,
  update: (raw: unknown) => { result: T; next?: Envelope },
): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      try {
        tx = db.transaction(STORE, mode, { durability: 'strict' });
      } catch (cause) {
        if (!(cause instanceof TypeError)) throw cause;
        tx = db.transaction(STORE, mode);
      }
    } catch (cause) {
      reject(failure(cause));
      return;
    }
    let result: T;
    let cause: Error | undefined;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () =>
      reject(
        cause ?? tx.error ?? new Error('Editing storage transaction failed'),
      );
    tx.onabort = () =>
      reject(
        cause ?? tx.error ?? new Error('Editing storage transaction aborted'),
      );
    const store = tx.objectStore(STORE);
    const get = store.get(key);
    get.onsuccess = () => {
      try {
        const outcome = update(get.result as unknown);
        result = outcome.result;
        if (outcome.next) store.put(outcome.next, key);
      } catch (error) {
        cause = failure(error);
        tx.abort();
      }
    };
  });
}
function parseEnvelope(raw: unknown, identity: EditOutboxIdentity): Envelope {
  try {
    const value = envelopeSchema.parse(raw);
    if (value.record) validateOutbox(value.record, identity);
    return value;
  } catch (cause) {
    throw new EditPersistenceError('unreadable', failure(cause).message);
  }
}
/** An exclusive lifetime Web Lock gates every owner, with IDB token/revision checks. */
export function createIndexedDBEditPersistence(
  platform?: EditIDBPlatform,
): EditOutboxPersistence {
  return {
    async open(identity, options) {
      const native =
        platform ??
        (typeof indexedDB !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        navigator.locks
          ? {
              indexedDB,
              locks: navigator.locks,
              makeId: () => crypto.randomUUID(),
            }
          : undefined);
      if (!native)
        throw new EditPersistenceError(
          'unavailable',
          'IndexedDB and exclusive editing locks are required',
        );
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      let acquired!: () => void;
      let denied!: (error: Error) => void;
      const acquisition = new Promise<void>((resolve, reject) => {
        acquired = resolve;
        denied = reject;
      });
      const lockTask = native.locks.request(
        JSON.stringify([
          'kimo-edit-outbox-v2',
          identity.sessionId,
          identity.projectId,
        ]),
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (options.signal.aborted) {
            denied(new Error('Editing storage cancelled'));
            return;
          }
          if (!lock) {
            denied(
              new EditPersistenceError(
                'locked',
                'This project is being edited in another tab',
              ),
            );
            return;
          }
          acquired();
          await hold;
        },
      );
      void lockTask.catch((cause) => denied(failure(cause)));
      try {
        await acquisition;
      } catch (cause) {
        release();
        throw cause;
      }
      let db: IDBDatabase | undefined;
      let closed = false;
      let closing = false;
      let tail: Promise<void> = Promise.resolve();
      let closeTask: Promise<void> | undefined;
      const close = () => {
        closing = true;
        closeTask ??= tail
          .catch(() => undefined)
          .then(async () => {
            closed = true;
            db?.close();
            release();
            await lockTask.catch(() => undefined);
          });
        return closeTask;
      };
      try {
        db = await openDatabase(native.indexedDB, options.signal);
        const database = db;
        db.onversionchange = () => {
          closed = true;
          database.close();
          options.onUnavailable(
            new Error('Editing storage changed; reload before editing'),
          );
          void close();
        };
        const key = [identity.sessionId, identity.projectId];
        const owner = native.makeId();
        const legacyKey = legacyOutboxKey(identity);
        // An inaccessible legacy store is NOT proof of an empty legacy outbox.
        if (!options.legacyStorage)
          throw new EditPersistenceError(
            'unavailable',
            'Legacy editing storage could not be checked',
          );
        const rawLegacy = options.legacyStorage.getItem(legacyKey);
        let imported: EditOutboxRecord | undefined;
        if (rawLegacy !== null) {
          try {
            imported = validateOutbox(
              { ...legacyOutboxSchema.parse(JSON.parse(rawLegacy)), format: 2 },
              identity,
            );
          } catch (cause) {
            throw new EditPersistenceError(
              'unreadable',
              failure(cause).message,
            );
          }
        }
        let envelope = await transaction(database, key, 'readwrite', (raw) => {
          const old =
            raw === undefined ? undefined : parseEnvelope(raw, identity);
          if (old && rawLegacy !== null && old.migration !== rawLegacy)
            throw new EditPersistenceError(
              'unreadable',
              'Legacy and IndexedDB edits conflict; both records retained',
            );
          const revision = (old?.revision ?? 0) + 1;
          if (!Number.isSafeInteger(revision))
            throw new Error('Editing storage revision exhausted');
          const next: Envelope = {
            owner,
            revision,
            record: old ? old.record : (imported ?? null),
            ...(old?.migration !== undefined
              ? { migration: old.migration }
              : imported
                ? { migration: rawLegacy ?? undefined }
                : {}),
          };
          return { result: next, next };
        });
        const verified = await transaction(
          database,
          key,
          'readonly',
          (raw) => ({ result: parseEnvelope(raw, identity) }),
        );
        if (JSON.stringify(verified) !== JSON.stringify(envelope))
          throw new Error('Editing storage verification failed');
        if (options.signal.aborted || closed)
          throw new Error('Editing storage cancelled');
        if (envelope.migration !== undefined) {
          if (!options.legacyStorage)
            throw new Error(
              'Legacy migration requires the original storage for verified cleanup',
            );
          const currentLegacy =
            options.legacyStorage?.getItem(legacyKey) ?? null;
          if (currentLegacy !== null && currentLegacy !== envelope.migration)
            throw new EditPersistenceError(
              'unreadable',
              'Legacy edits changed during migration; records retained',
            );
          if (currentLegacy !== null) {
            options.legacyStorage?.removeItem(legacyKey);
            if (options.legacyStorage?.getItem(legacyKey) !== null)
              throw new Error('Legacy edit cleanup failed');
          }
          envelope = await transaction(database, key, 'readwrite', (raw) => {
            const old = parseEnvelope(raw, identity);
            if (old.owner !== owner || old.revision !== envelope.revision)
              throw new Error('Editing ownership changed');
            const next: Envelope = {
              owner,
              revision: old.revision + 1,
              record: old.record,
            };
            return { result: next, next };
          });
        }
        if (options.signal.aborted || closed)
          throw new Error('Editing storage cancelled');
        const record = envelope.record;
        return {
          record,
          save(nextRecord) {
            if (closed || closing)
              return Promise.reject(new Error('Editing storage closed'));
            const copy = structuredClone(validateOutbox(nextRecord, identity));
            const save = tail.then(async () => {
              if (closed) throw new Error('Editing storage closed');
              envelope = await transaction(
                database,
                key,
                'readwrite',
                (raw) => {
                  const old = parseEnvelope(raw, identity);
                  if (old.owner !== owner || old.revision !== envelope.revision)
                    throw new Error('Editing ownership changed');
                  if (!Number.isSafeInteger(old.revision + 1))
                    throw new Error('Editing storage revision exhausted');
                  const next = {
                    owner,
                    revision: old.revision + 1,
                    record: copy,
                  };
                  return { result: next, next };
                },
              );
            });
            tail = save.catch((cause) => {
              closed = true;
              options.onUnavailable(failure(cause));
              throw cause;
            });
            // Rejection remains visible to caller, but the tail is also observed during close.
            void tail.catch(() => undefined);
            return tail;
          },
          close,
        };
      } catch (cause) {
        await close();
        throw cause;
      }
    },
  };
}
