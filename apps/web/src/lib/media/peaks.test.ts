import { describe, expect, it } from 'vitest';
import { computePeaks, peaksOffThread } from './peaks';
import { mediaKind, probeMedia, releaseMetadata } from './probe';
import { readMedia, writeMedia, deleteMedia } from './cache';
describe('local media helpers', () => {
  it('computes 64 chip peaks and one timeline peak per 10 ms at 8 kHz', () => {
    const samples = new Float32Array(8000);
    samples[0] = -0.8;
    samples[79] = 0.2;
    samples[80] = 0.4;
    samples[7999] = 1;
    const result = computePeaks(samples);
    expect(result.waveform).toHaveLength(64);
    expect(result.timelinePeaks).toHaveLength(100);
    expect(result.timelinePeaks[0]).toBeCloseTo(0.8);
    expect(result.timelinePeaks[1]).toBeCloseTo(0.4);
    expect(result.waveform[63]).toBe(1);
  });
  it('handles silence/empty samples and worker-unavailable fallback', async () => {
    expect(computePeaks(new Float32Array()).waveform).toEqual(
      new Float32Array(64),
    );
    const result = await peaksOffThread(
      new Float32Array(80),
      new AbortController().signal,
    );
    expect(result.timelinePeaks).toHaveLength(1);
  });
  it('aborts worker prep and tolerates unavailable cache/codec primitives', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      peaksOffThread(new Float32Array(), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(writeMedia('x', {})).resolves.toBeUndefined();
    await expect(readMedia('x')).resolves.toBeUndefined();
    await deleteMedia('x');
    expect(
      await probeMedia(
        new File([], 'hevc.mov', { type: 'video/quicktime' }),
        'x',
        new AbortController().signal,
      ),
    ).toEqual({ previewUnsupported: true });
    releaseMetadata({});
  });
  it('classifies all supported kinds and skips documents', async () => {
    expect(mediaKind({ type: 'video/mp4' })).toBe('video');
    expect(mediaKind({ type: 'audio/wav' })).toBe('audio');
    expect(mediaKind({ type: 'image/jpeg' })).toBe('image');
    expect(
      await probeMedia(
        new File([], 'notes.pdf'),
        'doc',
        new AbortController().signal,
      ),
    ).toEqual({});
  });
});
