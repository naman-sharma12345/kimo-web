import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

/** Synthetic local-file serving only. No caller-provided path is resolved here. */
export async function mediaResponse(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
): Promise<void> {
  const size = statSync(file).size;
  res.setHeader('Accept-Ranges', 'bytes');
  const range = req.headers.range;
  let start = 0;
  let end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const from = match?.[1] ?? '';
    const to = match?.[2] ?? '';
    if (match && (from || to)) {
      if (!from) start = Math.max(0, size - Number(to));
      else start = Number(from);
      end = from && to ? Math.min(size - 1, Number(to)) : size - 1;
    }
    if (
      !match ||
      (!from && !to) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= size ||
      end < start ||
      (!from && Number(to) <= 0)
    ) {
      res
        .writeHead(416, {
          'Content-Range': `bytes */${size}`,
          'Content-Length': 0,
        })
        .end();
      return;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.setHeader('Content-Length', Math.max(0, end - start + 1));
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }
  await pipeline(createReadStream(file, { start, end }), res);
}
