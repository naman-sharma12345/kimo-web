import { expect, it, vi } from 'vitest';
import {
  createFilmstripCache,
  invertAssetLocalMap,
} from './compositor-filmstrip';
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/media/cache', () => ({
  readMedia: mocks.read,
  writeMedia: mocks.write,
}));
it('observes newly uploaded localId-to-assetId mappings without replacing the controller', async () => {
  let mapping: Record<string, string> = {};
  const cache = createFilmstripCache(() => mapping);
  const asset = { id: 'asset', url: '/asset' };
  expect(await cache.read('key', asset)).toBeUndefined();
  mapping = { local: 'asset' };
  mocks.read.mockResolvedValue({ waveform: new Float32Array([0.1, 0.2]) });
  expect((await cache.read('key', asset))?.waveform).toEqual(
    new Float32Array([0.1, 0.2]),
  );
  expect(mocks.read).toHaveBeenLastCalledWith('local');
  expect(invertAssetLocalMap(mapping).get('asset')).toBe('local');
  await cache.write('key', { timelinePeaks: new Float32Array([0.3]) }, asset);
  expect(mocks.write).toHaveBeenCalledWith(
    'local',
    expect.objectContaining({ timelinePeaks: new Float32Array([0.3]) }),
  );
});
