import { describe, expect, it, vi } from 'vitest';
import { createIndexedDBEditPersistence } from './indexeddb';
import { idbTestPlatform } from './indexeddb-test-platform';
import {
  validateOutbox,
  editIdentity,
  legacyOutboxKey,
  type EditOutboxRecord,
} from './persistence';
import { deferred, memoryStorage } from './test-fixtures';
const identity = { sessionId: 's', projectId: 'p' };
const empty: EditOutboxRecord = {
  format: 2,
  ...identity,
  baseVersion: 0,
  groups: [],
};
const legacy = JSON.stringify({ ...empty, format: 1 });
const options = () => ({
  signal: new AbortController().signal,
  onUnavailable: vi.fn(),
  legacyStorage: memoryStorage(),
});
const ticks = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve();
};
describe('native IndexedDB edit persistence adapter (bounded event double)', () => {
  it('retains strict restore guards through legacy import, transaction readback and reopen', async () => {
    const fake = idbTestPlatform();
    const storage = memoryStorage();
    const record: EditOutboxRecord = {
      ...empty,
      groups: [
        {
          id: 'strict',
          source: 'history',
          label: 'restore',
          status: 'unknown',
          baseVersion: 0,
          ops: [{ op: 'clip.remove', id: 'c' }],
          strictGuard: {
            ...identity,
            version: 0,
            projectIdentity: 'reviewed-project',
            assetsIdentity: 'reviewed-assets',
            opsIdentity: editIdentity([{ op: 'clip.remove', id: 'c' }]),
          },
        },
      ],
    };
    storage.setItem(
      legacyOutboxKey(identity),
      JSON.stringify({ ...record, format: 1 }),
    );
    const adapter = createIndexedDBEditPersistence(fake.platform);
    const binding = await adapter.open(identity, {
      ...options(),
      legacyStorage: storage,
    });
    expect(binding.record).toEqual(record);
    await binding.save(record);
    await binding.close();
    const recovered = await adapter.open(identity, options());
    expect(recovered.record?.groups[0]?.strictGuard).toEqual(
      record.groups[0]?.strictGuard,
    );
    expect(recovered.record?.groups[0]?.status).toBe('unknown');
    await recovered.close();
  });
  it('waits for transaction complete and rejects an abort without overwriting data', async () => {
    const fake = idbTestPlatform();
    const adapter = createIndexedDBEditPersistence(fake.platform);
    const binding = await adapter.open(identity, options());
    const gate = deferred<undefined>();
    fake.gateCommits(gate.promise);
    let finished = false;
    const save = binding.save(empty).then(() => {
      finished = true;
    });
    await ticks();
    expect(finished).toBe(false);
    fake.gateCommits();
    gate.resolve(undefined);
    await save;
    expect(finished).toBe(true);
    const before = structuredClone(fake.rows);
    fake.abortNextPut();
    await expect(binding.save({ ...empty, baseVersion: 1 })).rejects.toThrow(
      'aborted',
    );
    expect(fake.rows).toEqual(before);
    await binding.close();
  });
  it('excludes a secondary owner, isolates project keys, and releases after close', async () => {
    const fake = idbTestPlatform();
    const adapter = createIndexedDBEditPersistence(fake.platform);
    const first = await adapter.open(identity, options());
    await expect(adapter.open(identity, options())).rejects.toMatchObject({
      status: 'locked',
    });
    const other = await adapter.open(
      { ...identity, projectId: 'other' },
      options(),
    );
    await other.close();
    await first.close();
    const next = await adapter.open(identity, options());
    await next.close();
    expect(fake.locks.size).toBe(0);
  });
  it('imports then read-back verifies before deleting the exact legacy bytes', async () => {
    const fake = idbTestPlatform();
    const storage = memoryStorage();
    const key = legacyOutboxKey(identity);
    storage.setItem(key, legacy);
    const remove = vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      const row = fake.rows.get(JSON.stringify(['s', 'p'])) as {
        record: EditOutboxRecord;
        migration?: string;
      };
      expect(row.record).toEqual(empty);
      expect(row.migration).toBe(legacy);
      expect(row.record.groups).toEqual([]);
      // Delegate deletion without bypassing the read-back assertion.
      storage.setItem(key, '');
    });
    // This intentionally failed cleanup retains the migration receipt.
    await expect(
      createIndexedDBEditPersistence(fake.platform).open(identity, {
        ...options(),
        legacyStorage: storage,
      }),
    ).rejects.toThrow('cleanup');
    expect(remove).toHaveBeenCalledOnce();
    storage.setItem(key, legacy);
    remove.mockRestore();
    const binding = await createIndexedDBEditPersistence(fake.platform).open(
      identity,
      { ...options(), legacyStorage: storage },
    );
    expect(binding.record).toEqual(empty);
    expect(storage.getItem(key)).toBeNull();
    expect(fake.rows.get(JSON.stringify(['s', 'p']))).not.toHaveProperty(
      'migration',
    );
    await binding.close();
  });
  it('never deletes malformed, mismatched or aborted imports', async () => {
    for (const raw of [
      '{broken',
      JSON.stringify({ ...empty, format: 1, projectId: 'wrong' }),
    ]) {
      const fake = idbTestPlatform();
      const storage = memoryStorage();
      storage.setItem(legacyOutboxKey(identity), raw);
      await expect(
        createIndexedDBEditPersistence(fake.platform).open(identity, {
          ...options(),
          legacyStorage: storage,
        }),
      ).rejects.toMatchObject({ status: 'unreadable' });
      expect(storage.getItem(legacyOutboxKey(identity))).toBe(raw);
      expect(fake.rows.size).toBe(0);
    }
    const fake = idbTestPlatform();
    fake.abortNextPut();
    const storage = memoryStorage();
    storage.setItem(legacyOutboxKey(identity), legacy);
    await expect(
      createIndexedDBEditPersistence(fake.platform).open(identity, {
        ...options(),
        legacyStorage: storage,
      }),
    ).rejects.toThrow('aborted');
    expect(storage.getItem(legacyOutboxKey(identity))).toBe(legacy);
  });
  it('retains conflicts and prevents an empty durable tombstone resurrecting legacy', async () => {
    const fake = idbTestPlatform();
    const adapter = createIndexedDBEditPersistence(fake.platform);
    const binding = await adapter.open(identity, options());
    await binding.save(empty);
    await binding.close();
    const before = structuredClone(fake.rows);
    const storage = memoryStorage();
    storage.setItem(legacyOutboxKey(identity), legacy);
    await expect(
      adapter.open(identity, { ...options(), legacyStorage: storage }),
    ).rejects.toMatchObject({ status: 'unreadable' });
    expect(fake.rows).toEqual(before);
    expect(storage.getItem(legacyOutboxKey(identity))).toBe(legacy);
  });
  it('fences owner-token/revision changes instead of overwriting a newer owner', async () => {
    const fake = idbTestPlatform();
    const optionsForOpen = options();
    const binding = await createIndexedDBEditPersistence(fake.platform).open(
      identity,
      optionsForOpen,
    );
    const key = JSON.stringify(['s', 'p']);
    fake.rows.set(key, { owner: 'new-owner', revision: 999, record: empty });
    await expect(binding.save(empty)).rejects.toThrow('ownership');
    expect(fake.rows.get(key)).toMatchObject({
      owner: 'new-owner',
      revision: 999,
    });
    expect(optionsForOpen.onUnavailable).toHaveBeenCalledOnce();
    await binding.close();
  });
  it('handles versionchange and blocked/late successful opens without leaked handles', async () => {
    const fake = idbTestPlatform();
    const config = options();
    const binding = await createIndexedDBEditPersistence(fake.platform).open(
      identity,
      config,
    );
    fake.versionChange();
    expect(config.onUnavailable).toHaveBeenCalledOnce();
    await expect(binding.save(empty)).rejects.toThrow('closed');
    await binding.close();
    expect(fake.locks.size).toBe(0);
    const blocked = idbTestPlatform();
    blocked.blockOpen();
    await expect(
      createIndexedDBEditPersistence(blocked.platform).open(
        identity,
        options(),
      ),
    ).rejects.toThrow('blocked');
    expect(blocked.closedHandles()).toBe(1);
    expect(blocked.locks.size).toBe(0);
  });
  it('retains changed legacy bytes and corrupt durable rows without deleting either', async () => {
    const fake = idbTestPlatform();
    const storage = memoryStorage();
    const key = legacyOutboxKey(identity);
    storage.setItem(key, legacy);
    const read = storage.getItem;
    let count = 0;
    vi.spyOn(storage, 'getItem').mockImplementation((k) => {
      if (++count === 2)
        storage.setItem(
          key,
          JSON.stringify({ ...empty, format: 1, baseVersion: 1 }),
        );
      return read(k);
    });
    const remove = vi.spyOn(storage, 'removeItem');
    await expect(
      createIndexedDBEditPersistence(fake.platform).open(identity, {
        ...options(),
        legacyStorage: storage,
      }),
    ).rejects.toThrow('changed');
    expect(remove).not.toHaveBeenCalled();
    expect(fake.rows.size).toBe(1);
    const broken = idbTestPlatform();
    const corrupt = { owner: 'x', revision: 0, record: { format: 99 } };
    broken.rows.set(JSON.stringify(['s', 'p']), corrupt);
    await expect(
      createIndexedDBEditPersistence(broken.platform).open(identity, options()),
    ).rejects.toMatchObject({ status: 'unreadable' });
    expect(broken.rows.get(JSON.stringify(['s', 'p']))).toEqual(corrupt);
  });
  it('cancels pre-acquisition without writes and releases every lock', async () => {
    const fake = idbTestPlatform();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createIndexedDBEditPersistence(fake.platform).open(identity, {
        ...options(),
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
    await ticks();
    expect(fake.rows.size).toBe(0);
    expect(fake.locks.size).toBe(0);
  });
  it('serializes immutable snapshots even if the caller mutates the source', async () => {
    const fake = idbTestPlatform();
    const binding = await createIndexedDBEditPersistence(fake.platform).open(
      identity,
      options(),
    );
    const gate = deferred<undefined>();
    fake.gateCommits(gate.promise);
    const original = { ...empty, baseVersion: 1 };
    const first = binding.save(original);
    original.baseVersion = 99;
    const second = binding.save({ ...empty, baseVersion: 2 });
    await ticks();
    fake.gateCommits();
    gate.resolve(undefined);
    await Promise.all([first, second]);
    expect(fake.rows.get(JSON.stringify(['s', 'p']))).toMatchObject({
      revision: 3,
      record: { baseVersion: 2 },
    });
    await binding.close();
  });
  it('fails closed when legacy storage is inaccessible, including missing legacy input', async () => {
    const fake = idbTestPlatform();
    const adapter = createIndexedDBEditPersistence(fake.platform);
    await expect(
      adapter.open(identity, {
        signal: new AbortController().signal,
        onUnavailable: vi.fn(),
      }),
    ).rejects.toMatchObject({ status: 'unavailable' });
    expect(fake.rows.size).toBe(0);
    const legacyStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      removeItem: vi.fn(),
    };
    await expect(
      adapter.open(identity, { ...options(), legacyStorage }),
    ).rejects.toThrow('denied');
    expect(legacyStorage.removeItem).not.toHaveBeenCalled();
    expect(fake.rows.size).toBe(0);
    expect(fake.locks.size).toBe(0);
  });
  it('normal close drains already-accepted saves before releasing ownership', async () => {
    const fake = idbTestPlatform();
    const binding = await createIndexedDBEditPersistence(fake.platform).open(
      identity,
      options(),
    );
    const saving = binding.save({ ...empty, baseVersion: 7 });
    const closing = binding.close();
    await expect(binding.save(empty)).rejects.toThrow('closed');
    await saving;
    await closing;
    expect(fake.rows.get(JSON.stringify(['s', 'p']))).toMatchObject({
      record: { baseVersion: 7 },
    });
    expect(fake.locks.size).toBe(0);
  });
  it('rejects duplicate IDs and unsupported formats without partial-prefix recovery', () => {
    const group = {
      id: 'same',
      label: 'move',
      source: 'timeline',
      ops: [],
      status: 'unsent',
    };
    expect(() =>
      validateOutbox({ ...empty, groups: [group, group] }, identity),
    ).toThrow('unique');
    expect(() => validateOutbox({ ...empty, format: 3 }, identity)).toThrow();
  });
});
