/** Test-only async persistence. NOT IndexedDB or a production durability fallback. */
import {
  EditPersistenceError,
  legacyOutboxKey,
  legacyOutboxSchema,
  validateOutbox,
  type EditOutboxRecord,
  type EditOutboxPersistence,
} from './persistence';
export function testPersistence() {
  const records = new Map<string, EditOutboxRecord>();
  const active = new Set<string>();
  const writes: EditOutboxRecord[] = [];
  let beforeSave: (() => Promise<void>) | undefined;
  const persistence: EditOutboxPersistence = {
    async open(identity, options) {
      await Promise.resolve();
      const key = JSON.stringify(identity);
      if (active.has(key))
        throw new EditPersistenceError(
          'locked',
          'Another editor owns this project',
        );
      const raw = options.legacyStorage?.getItem(legacyOutboxKey(identity));
      if (!records.has(key) && raw) {
        try {
          records.set(
            key,
            validateOutbox(
              { ...legacyOutboxSchema.parse(JSON.parse(raw)), format: 2 },
              identity,
            ),
          );
        } catch (cause) {
          throw new EditPersistenceError('unreadable', String(cause));
        }
      }
      active.add(key);
      let closed = false;
      return {
        record: structuredClone(records.get(key) ?? null),
        async save(record) {
          const copy = structuredClone(record);
          await beforeSave?.();
          if (closed) throw new Error('Test storage closed');
          records.set(key, copy);
          writes.push(copy);
        },
        async close() {
          closed = true;
          active.delete(key);
        },
      };
    },
  };
  return {
    persistence,
    writes,
    records,
    setBeforeSave(fn?: () => Promise<void>) {
      beforeSave = fn;
    },
  };
}
