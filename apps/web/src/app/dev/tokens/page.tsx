'use client';

import { useState, type CSSProperties } from 'react';

const colors = [
  ['ink-0', '#080809'],
  ['ink-1', '#0E0E0F'],
  ['ink-2', '#151516'],
  ['ink-3', '#1D1D1E'],
  ['ink-4', '#262627'],
  ['line', 'rgb(245 241 231 / 0.07)'],
  ['line-strong', 'rgb(245 241 231 / 0.12)'],
  ['cream-100', '#F5F1E7'],
  ['cream-60', 'rgb(245 241 231 / 0.60)'],
  ['cream-38', 'rgb(245 241 231 / 0.38)'],
  ['cream-16', 'rgb(245 241 231 / 0.16)'],
  ['orange', '#FF5A24'],
  ['orange-hover', '#FF6D3D'],
  ['orange-press', '#E84E1B'],
  ['orange-12', 'rgb(255 90 36 / 0.12)'],
  ['orange-24', 'rgb(255 90 36 / 0.24)'],
  ['on-orange', '#140A05'],
  ['success', '#3DD68C'],
  ['warning', '#F5B14C'],
  ['error', '#E5484D'],
  ['track-video', '#3A3833'],
  ['track-broll', '#34383A'],
  ['track-image', '#36343A'],
  ['track-music', '#33382F'],
  ['track-voice', '#3A3530'],
  ['track-sfx', '#38353A'],
  ['track-text', '#2F3036'],
  ['track-fx', '#383338'],
] as const;

export default function TokensPage() {
  const [replay, setReplay] = useState(0);
  return (
    <main className="dev-page" data-ready="true">
      <h1>design tokens</h1>
      <section className="dev-section" aria-labelledby="colors-heading">
        <h2 id="colors-heading">colour</h2>
        <div className="dev-grid">
          {colors.map(([name, value]) => (
            <div key={name}>
              <div
                className="token-swatch"
                style={{ background: `var(--${name})` }}
              />
              <p className="token-label">
                {name}
                <br />
                {value}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className="dev-section" aria-labelledby="type-heading">
        <h2 id="type-heading">type</h2>
        {[11, 12, 13, 15, 17, 20, 28, 'display'].map((size) => (
          <p
            key={size}
            style={{
              fontSize: `var(--t-${size})`,
              lineHeight: `var(--leading-${size})`,
              letterSpacing: `var(--tracking-${size})`,
              fontWeight: `var(--weight-${size})`,
            }}
          >
            the quick cut jumps over the lazy fade
          </p>
        ))}
      </section>
      <section className="dev-section" aria-labelledby="radius-heading">
        <h2 id="radius-heading">radius</h2>
        <div className="dev-grid">
          {[4, 6, 8, 12, 20, 'pill'].map((radius) => (
            <div
              key={radius}
              className="token-swatch"
              style={{ borderRadius: `var(--r-${radius})` }}
            >
              {radius}
            </div>
          ))}
        </div>
      </section>
      <section className="dev-section" aria-labelledby="controls-heading">
        <h2 id="controls-heading">control heights</h2>
        <div className="dev-grid">
          {['xs', 'sm', 'md', 'lg', 'send'].map((size) => (
            <div
              key={size}
              style={{
                height: `var(--control-${size})`,
                background: 'var(--ink-3)',
                paddingInline: 'var(--space-16)',
              }}
            >
              {size}
            </div>
          ))}
        </div>
      </section>
      <section className="dev-section" aria-labelledby="motion-heading">
        <h2 id="motion-heading">motion</h2>
        <button
          type="button"
          onClick={() => setReplay((previous) => previous + 1)}
        >
          replay
        </button>
        <div key={replay} className="dev-grid">
          {[1, 2, 3, 4, 5].flatMap((duration) =>
            ['out', 'in-out', 'in'].map((ease) => (
              <div key={`${duration}-${ease}`} className="motion-track">
                <div
                  className="motion-square"
                  style={
                    {
                      '--demo-duration': `var(--dur-${duration})`,
                      '--demo-ease': `var(--ease-${ease})`,
                    } as CSSProperties
                  }
                />
                <p>
                  {duration} · {ease}
                </p>
              </div>
            )),
          )}
        </div>
      </section>
    </main>
  );
}
