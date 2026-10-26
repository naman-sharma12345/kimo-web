export interface Peaks {
  waveform: Float32Array;
  timelinePeaks: Float32Array;
}
export function computePeaks(samples: Float32Array, sampleRate = 8000): Peaks {
  const waveform = new Float32Array(64);
  const stride = Math.max(1, Math.round(sampleRate * 0.01));
  const timelinePeaks = new Float32Array(Math.ceil(samples.length / stride));
  for (let i = 0; i < samples.length; i++) {
    const value = Math.min(1, Math.abs(samples[i] ?? 0));
    const bin = Math.min(63, Math.floor((i * 64) / samples.length));
    waveform[bin] = Math.max(waveform[bin] ?? 0, value);
    const index = Math.floor(i / stride);
    timelinePeaks[index] = Math.max(timelinePeaks[index] ?? 0, value);
  }
  return { waveform, timelinePeaks };
}
export async function peaksOffThread(
  samples: Float32Array,
  signal: AbortSignal,
): Promise<Peaks> {
  if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
  if (
    typeof window === 'undefined' ||
    !window.Worker ||
    typeof URL.createObjectURL !== 'function'
  )
    return computePeaks(samples);
  const source = `const compute = ${computePeaks.toString()}; onmessage = e => { const p = compute(e.data); postMessage(p, [p.waveform.buffer, p.timelinePeaks.buffer]); };`;
  const url = URL.createObjectURL(
    new Blob([source], { type: 'text/javascript' }),
  );
  let worker: InstanceType<typeof window.Worker> | undefined;
  try {
    worker = new window.Worker(url);
    const active = worker;
    return await new Promise<Peaks>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', cancel);
        active.terminate();
      };
      const cancel = () => {
        cleanup();
        reject(new DOMException('Canceled', 'AbortError'));
      };
      const timeout = setTimeout(() => {
        cleanup();
        resolve(computePeaks(samples));
      }, 10000);
      signal.addEventListener('abort', cancel, { once: true });
      active.onmessage = (event: MessageEvent<Peaks>) => {
        cleanup();
        resolve(event.data);
      };
      active.onerror = () => {
        cleanup();
        resolve(computePeaks(samples));
      };
      active.postMessage(samples);
    });
  } catch {
    return computePeaks(samples);
  } finally {
    worker?.terminate();
    URL.revokeObjectURL(url);
  }
}
