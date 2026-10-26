import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BrandMark } from '@/components/landing/brand';
export const alt = 'kimo · tell it the video';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const runtime = 'nodejs';
/** Source the same design tokens as the rendered page, including the allowed display size. */
export default async function OpenGraphImage() {
  const root = existsSync(join(process.cwd(), 'src/styles/tokens.css'))
    ? process.cwd()
    : join(process.cwd(), 'apps/web');
  const [css, sans, serif] = await Promise.all([
    readFile(join(root, 'src/styles/tokens.css'), 'utf8'),
    readFile(
      join(root, 'node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf'),
    ),
    readFile(join(root, 'public/fonts/instrument-serif-italic.ttf')),
  ]);
  function token(name: string) {
    const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (!match?.[1]) throw new Error(`Missing OG token: ${name}`);
    return match[1].trim();
  }
  const display = Number(token('t-display').match(/,\s*(\d+)px\)$/)?.[1] ?? 88);
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: '100%',
        background: token('ink-0'),
        color: token('cream-100'),
        fontFamily: 'Geist',
        position: 'relative',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          fontSize: display,
          lineHeight: Number(token('leading-display')),
          letterSpacing: token('tracking-display'),
        }}
      >
        <span>tell it the video.</span>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          watch it get{' '}
          <span
            style={{
              fontFamily: 'Instrument Serif',
              fontStyle: 'italic',
              fontSize: display * 1.06,
              marginLeft: token('space-16'),
            }}
          >
            made.
          </span>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: token('space-48'),
          left: token('space-48'),
          display: 'flex',
          alignItems: 'center',
          gap: token('space-8'),
          fontSize: token('t-17'),
        }}
      >
        <div
          style={{
            display: 'flex',
            width: token('space-20'),
            height: token('space-20'),
          }}
        >
          <BrandMark />
        </div>
        <span>kimo</span>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: 'Geist', data: sans, weight: 400, style: 'normal' },
        { name: 'Instrument Serif', data: serif, weight: 400, style: 'italic' },
      ],
    },
  );
}
