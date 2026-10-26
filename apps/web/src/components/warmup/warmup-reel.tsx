'use client';
import * as React from 'react';
import { useEffect, useId, useRef, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { FileText, Music } from 'lucide-react';
import { durations, easings, spring } from '@/lib/motion';
import { warmupTiming, type WarmupStep } from './state';
export interface ReelAsset {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio' | 'doc';
  thumbnail?: string;
  waveform?: Float32Array;
}
const geometry = {
  tile: 96,
  gap: 6,
  viewport: 360,
  speed: 24,
  barMax: 40,
  ratios: [10 / 16, 1, 12 / 16, 7 / 16],
} as const;
export function WarmupReel({
  assets,
  step,
  progress,
  unfolding,
}: {
  assets: readonly ReelAsset[];
  step: WarmupStep;
  progress: number;
  unfolding: boolean;
}) {
  const reduced = useReducedMotion();
  const pattern = useId().replaceAll(':', '');
  const reel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduced || unfolding || !assets.length) return;
    let frame = 0;
    const previous = new Map<Element, number>();
    const animations = new Set<Animation>();
    const tick = () => {
      const root = reel.current;
      if (!root) return;
      const playhead = root.getBoundingClientRect().left + root.clientWidth / 2;
      root
        .querySelectorAll<HTMLElement>('.warmup-thumbnail')
        .forEach((tile) => {
          const bounds = tile.getBoundingClientRect();
          const center = bounds.left + bounds.width / 2;
          const before = previous.get(tile);
          if (before !== undefined && before > playhead && center <= playhead) {
            const animation = tile.animate(
              [
                { filter: 'brightness(1)' },
                { filter: 'brightness(1.25)' },
                { filter: 'brightness(1)' },
              ],
              { duration: warmupTiming.beat },
            );
            animations.add(animation);
            animation.onfinish = () => animations.delete(animation);
          }
          previous.set(tile, center);
        });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      animations.forEach((animation) => animation.cancel());
    };
  }, [assets.length, reduced, unfolding]);
  const source: ReelAsset[] = assets.length
    ? [...assets]
    : Array.from({ length: 6 }, (_, index) => ({
        id: `empty-${index}`,
        name: '',
        kind: 'doc',
      }));
  const tiles = Array.from(
    { length: Math.max(4, source.length) },
    (_, index) => source[index % source.length],
  ).filter((asset): asset is ReelAsset => !!asset);
  const width = tiles.length * (geometry.tile + geometry.gap);
  const style = {
    '--reel-distance': `${width}px`,
    '--reel-duration': `${width / geometry.speed}s`,
  } as CSSProperties;
  return (
    <div
      ref={reel}
      className="warmup-reel"
      data-step={step}
      data-unfolding={unfolding || undefined}
    >
      <div className="warmup-filmstrip" style={style}>
        <div className="warmup-filmstrip-track">
          {[0, 1].map((copy) => (
            <div
              className="warmup-filmstrip-copy"
              key={copy}
              aria-hidden={copy === 1 || undefined}
            >
              {tiles.map((asset, index) => {
                return (
                  <div
                    key={`${copy}-${asset.id}-${index}`}
                    className="warmup-thumbnail"
                    data-empty={!assets.length || undefined}
                    style={
                      {
                        viewTransitionName:
                          copy === 0 && index < assets.length
                            ? `asset-${asset.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
                            : undefined,
                      } as CSSProperties
                    }
                    title={asset.name}
                  >
                    {asset.thumbnail ? (
                      <svg
                        viewBox="0 0 96 54"
                        role="img"
                        aria-label={asset.name}
                      >
                        <image
                          href={asset.thumbnail}
                          width="96"
                          height="54"
                          preserveAspectRatio="xMidYMid slice"
                        />
                      </svg>
                    ) : assets.length ? (
                      asset.kind === 'audio' ? (
                        asset.waveform ? (
                          <svg
                            viewBox="0 0 96 54"
                            role="img"
                            aria-label={`${asset.name} waveform`}
                          >
                            {Array.from({ length: 24 }, (_, i) => {
                              const peak =
                                asset.waveform?.[
                                  Math.floor(i * (asset.waveform.length / 24))
                                ] ?? 0;
                              return (
                                <rect
                                  key={i}
                                  x={i * 4}
                                  y={27 - Math.max(2, peak * 40) / 2}
                                  width="2"
                                  height={Math.max(2, peak * 40)}
                                  rx="1"
                                  fill="currentColor"
                                />
                              );
                            })}
                          </svg>
                        ) : (
                          <Music aria-label={asset.name} />
                        )
                      ) : (
                        <FileText aria-label={asset.name} />
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <svg className="warmup-sprockets" aria-hidden="true">
          <defs>
            <pattern
              id={pattern}
              width="12"
              height="64"
              patternUnits="userSpaceOnUse"
            >
              <rect
                x="4"
                y="2"
                width="4"
                height="3"
                rx="1"
                fill="currentColor"
              />
              <rect
                x="4"
                y="59"
                width="4"
                height="3"
                rx="1"
                fill="currentColor"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${pattern})`} />
        </svg>
      </div>
      <svg className="warmup-playhead" viewBox="0 0 7 80" aria-hidden="true">
        <path d="M0 0h7L3.5 7z" fill="currentColor" />
        <path d="M3.5 0v80" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <motion.div
        className="warmup-bars"
        animate={
          step === 'ready' && !reduced ? { scale: [1, 1.06, 1] } : { scale: 1 }
        }
        transition={{ duration: durations.d4, ease: easings.out }}
        aria-hidden="true"
      >
        {geometry.ratios.map((ratio, index) => (
          <motion.i
            key={index}
            animate={{
              height: reduced
                ? ratio * geometry.barMax
                : step === 'upload'
                  ? Math.max(0.1, progress) * geometry.barMax
                  : step === 'watch'
                    ? [
                        geometry.barMax * 0.3,
                        geometry.barMax,
                        geometry.barMax * 0.3,
                      ]
                    : ratio * geometry.barMax,
            }}
            transition={
              reduced
                ? { duration: durations.d2 }
                : step === 'watch'
                  ? {
                      duration: warmupTiming.waveSeconds,
                      ease: easings.inOut,
                      repeat: Infinity,
                      delay: index * warmupTiming.waveStaggerSeconds,
                    }
                  : step === 'plan'
                    ? {
                        ...spring.snappy,
                        delay: index * warmupTiming.waveStaggerSeconds,
                      }
                    : spring.soft
            }
          />
        ))}
      </motion.div>
    </div>
  );
}
