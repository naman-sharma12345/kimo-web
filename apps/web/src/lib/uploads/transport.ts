export const MULTIPART_THRESHOLD = 100 * 1024 * 1024;
export const PART_SIZE = 16 * 1024 * 1024;
export const RETRY_DELAYS = [1000, 3000, 9000] as const;
export const abortError = () =>
  new DOMException('Upload canceled', 'AbortError');
export const isAbort = (error: unknown) =>
  error instanceof Error && error.name === 'AbortError';
export function splitParts(file: Blob): Blob[] {
  const parts: Blob[] = [];
  for (let start = 0; start < file.size; start += PART_SIZE)
    parts.push(file.slice(start, Math.min(file.size, start + PART_SIZE)));
  return parts;
}
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const stop = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}
export function putBlob(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  signal: AbortSignal,
  progress: (bytes: number) => void,
  factory = () => new XMLHttpRequest(),
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const xhr = factory();
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
      xhr.upload.onprogress = null;
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => {
      xhr.abort();
      fail(abortError());
    };
    xhr.open('PUT', url);
    for (const [key, value] of Object.entries(headers))
      xhr.setRequestHeader(key, value);
    xhr.timeout = 120000;
    xhr.upload.onprogress = (event) =>
      progress(Math.min(body.size, event.loaded));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300)
        return fail(new Error(`Upload failed (${xhr.status})`));
      const etag = xhr.getResponseHeader('ETag') ?? '';
      cleanup();
      progress(body.size);
      resolve(etag);
    };
    xhr.onerror = () => fail(new Error('Upload network error'));
    xhr.ontimeout = () => fail(new Error('Upload timed out'));
    xhr.onabort = () => fail(abortError());
    signal.addEventListener('abort', abort, { once: true });
    try {
      xhr.send(body);
    } catch (error) {
      fail(error instanceof Error ? error : new Error('Upload failed'));
    }
  });
}
