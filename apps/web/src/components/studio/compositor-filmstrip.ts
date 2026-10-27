import type { FilmstripCache, FilmstripCacheEntry } from '@kimo/compositor';
import { readMedia, writeMedia } from '@/lib/media/cache';
/** Existing persisted mapping is localId -> assetId, never the reverse. */
export function invertAssetLocalMap(
  mapping: Readonly<Record<string, string>>,
): Map<string, string> {
  return new Map(
    Object.entries(mapping).map(([localId, assetId]) => [assetId, localId]),
  );
}
export function createFilmstripCache(
  mapping:
    Readonly<Record<string, string>> | (() => Readonly<Record<string, string>>),
): FilmstripCache {
  const localIdFor = (assetId: string) =>
    invertAssetLocalMap(
      typeof mapping === 'function' ? mapping() : mapping,
    ).get(assetId);
  // Timestamped entries use versioned keys and are never forged from legacy Blob[] bins.
  const metadata = new Map<string, FilmstripCacheEntry>();
  return {
    async read(key, asset) {
      const current = metadata.get(key);
      if (current) return current;
      const localId = localIdFor(asset.id);
      if (!localId) return undefined;
      const legacy = await readMedia(localId);
      // Old frames have no source timestamps. Re-extract rather than pretending exact cache hits.
      return legacy
        ? { waveform: legacy.waveform, timelinePeaks: legacy.timelinePeaks }
        : undefined;
    },
    async write(key, entry, asset) {
      metadata.set(key, entry);
      const localId = localIdFor(asset.id);
      if (!localId) return;
      const previous = await readMedia(localId);
      await writeMedia(localId, {
        ...previous,
        waveform: entry.waveform ?? previous?.waveform,
        timelinePeaks: entry.timelinePeaks ?? previous?.timelinePeaks,
      });
    },
  };
}
