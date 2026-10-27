import { deflateSync } from 'node:zlib';

// Original deterministic RGB fixtures. Rows use PNG filter 0 and top-left origin.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, checksum]);
}
export function fixturePng(width, height, sample) {
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgb = sample(x, y);
      for (let c = 0; c < 3; c++)
        pixels[y * (width * 3 + 1) + 1 + x * 3 + c] = rgb[c];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export function syntheticMask() {
  return fixturePng(640, 360, (x, y) => {
    const inside = ((x - 320) / 110) ** 2 + ((y - 180) / 155) ** 2 <= 1;
    const value = inside ? 255 : 0;
    return [value, value, value];
  });
}
export function identityLut() {
  return fixturePng(512, 512, (x, y) => {
    const blue = Math.floor(y / 64) * 8 + Math.floor(x / 64);
    return [x % 64, y % 64, blue].map((value) =>
      Math.round((value / 63) * 255),
    );
  });
}
