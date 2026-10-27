import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { syntheticMask, identityLut } from './fixture-png.mjs';
const dir = 'packages/mock-server/fixtures';
mkdirSync(dir, { recursive: true });
const run = (args) => {
  const result = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
  });
  return result.status === 0;
};
for (let i = 1; i <= 3; i++) {
  if (!existsSync(`${dir}/clip-${i}.mp4`))
    run([
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=1920x1080:rate=30:duration=8`,
      '-vf',
      `hue=h=${i * 60}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '32',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '1',
      `${dir}/clip-${i}.mp4`,
    ]);
}
if (!existsSync(`${dir}/music.wav`))
  run([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:duration=8',
    '-c:a',
    'pcm_s16le',
    `${dir}/music.wav`,
  ]);
if (!existsSync(`${dir}/image.png`))
  run([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360',
    '-frames:v',
    '1',
    '-threads',
    '1',
    `${dir}/image.png`,
  ]);
writeFileSync(`${dir}/mask.png`, syntheticMask());
writeFileSync(`${dir}/identity-lut.png`, identityLut());
writeFileSync(
  `${dir}/SOURCES.md`,
  '# Fixture provenance\n\nThese seven fixtures are original deterministic synthetic test patterns, a sine tone, a binary ellipse luma mask and an identity 64-cube LUT atlas. scripts/fixtures.mjs uses FFmpeg for media and scripts/fixture-png.mjs for PNGs. The mask is not a SAM inference result; the LUT uses top-left origin, red x, green y and blue tile index in an 8x8 grid. No stock media, recordings, or third-party music. Dedicated CC0-1.0 by the project for these generated fixtures only. They are not represented as real footage.\n\nThe spec suggested Pexels/Pixabay CC0 URLs, but those providers’ standard licenses are not CC0. No unverified downloads were made.\n',
);
