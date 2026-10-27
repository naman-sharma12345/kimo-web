'use client';
import * as React from 'react';
import type { LevelMeterAPI, MeterSample } from './types';
import { Reason } from './controls';
import styles from './inspector.module.css';
export function meterDb(sample: MeterSample): number {
  if (!sample.playing) return -Infinity;
  const peak = sample.channels.reduce(
    (max, n) => (Number.isFinite(n) && n > max ? n : max),
    0,
  );
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}
export function LevelMeter({
  api,
  clipId,
}: {
  api?: LevelMeterAPI;
  clipId: string;
}) {
  const [db, setDb] = React.useState(-Infinity);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setDb(-Infinity);
    setError(null);
    if (!api?.available) return;
    const sample = () => {
      try {
        setDb(meterDb(api.measure(clipId)));
        setError(null);
      } catch {
        setDb(-Infinity);
        setError('Live output measurement is unavailable.');
      }
    };
    sample();
    try {
      return api.subscribe(sample);
    } catch {
      setDb(-Infinity);
      setError('Live output subscription is unavailable.');
    }
  }, [api, clipId]);
  const available = api?.available && !error;
  const lit =
    available && Number.isFinite(db)
      ? Math.max(0, Math.min(20, Math.ceil(((db + 60) / 72) * 20)))
      : 0;
  return (
    <>
      <p className={styles.reason}>master output</p>
      <div
        className={styles.meter}
        role="meter"
        aria-label="master output level"
        aria-valuemin={-60}
        aria-valuemax={12}
        aria-valuenow={
          Number.isFinite(db) ? Math.max(-60, Math.min(12, db)) : -60
        }
        aria-valuetext={
          available
            ? db === -Infinity
              ? 'silent'
              : `${db.toFixed(1)} dB`
            : 'unavailable'
        }
        data-unavailable={!available}
      >
        {Array.from({ length: 20 }, (_, i) => {
          const level = Math.min(db, -60 + ((i + 1) / 20) * 72);
          return (
            <span
              key={i}
              data-lit={i < lit}
              data-zone={
                level >= 0 ? 'error' : level > -6 ? 'warning' : 'normal'
              }
            />
          );
        })}
      </div>
      {!available && (
        <Reason>
          {error ??
            (api && !api.available
              ? api.reason
              : 'Live level meter requires actual output measurements from the audio hook.')}
        </Reason>
      )}
    </>
  );
}
