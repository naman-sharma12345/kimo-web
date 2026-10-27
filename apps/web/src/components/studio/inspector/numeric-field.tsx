'use client';
import * as React from 'react';
import type { KimoProject, Op } from '@kimo/client';
import type { EditingAPI } from '@/lib/editing/types';
import { Row } from '@/components/ui/row';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { clamp } from './model';
import { FieldTransaction } from './transaction';
import { useValueTween } from './value-tween';
import styles from './inspector.module.css';
export interface NumericFieldProps {
  label: string;
  displayLabel?: React.ReactNode;
  value: number;
  baseline: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  acting?: boolean;
  slider?: boolean;
  keyframe?: React.ReactNode;
  editing: EditingAPI;
  clipIds: readonly string[];
  build(value: number, project: KimoProject): readonly Op[];
  onError?: (message: string) => void;
}
export function NumericField({
  label,
  displayLabel,
  value,
  baseline,
  unit = '',
  min = -1e9,
  max = 1e9,
  step = 1,
  disabled,
  acting,
  slider,
  keyframe,
  editing,
  clipIds,
  build,
  onError,
}: NumericFieldProps) {
  const [local, setLocal] = React.useState<string | null>(null);
  const displayed = useValueTween(value, !!acting && local === null);
  const transaction = React.useRef<FieldTransaction | null>(null);
  const drag = React.useRef<{
    x: number;
    value: number;
    pointer: number;
  } | null>(null);
  const raf = React.useRef<number | undefined>(undefined);
  const pending = React.useRef<number | undefined>(undefined);
  const latest = React.useRef({ build, onError });
  latest.current = { build, onError };
  const getTransaction = () =>
    (transaction.current ??= new FieldTransaction(editing, clipIds, label));
  const report = (e: unknown) =>
    latest.current.onError?.(
      e instanceof Error ? e.message : 'The value could not be changed.',
    );
  const preview = (next: number) => {
    if (disabled || !Number.isFinite(next)) return;
    const n = clamp(next, min, max);
    setLocal(String(Number(n.toFixed(6))));
    try {
      getTransaction().preview((p) => latest.current.build(n, p));
    } catch (e) {
      report(e);
      transaction.current?.cancel();
      transaction.current = null;
    }
  };
  const flush = () => {
    if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    raf.current = undefined;
    if (pending.current !== undefined) {
      const n = pending.current;
      pending.current = undefined;
      preview(n);
    }
  };
  const finish = () => {
    flush();
    const tx = transaction.current;
    transaction.current = null;
    void tx
      ?.commit()
      ?.then((result) => {
        if (result.status === 'failed')
          latest.current.onError?.(result.error ?? 'The edit failed.');
      })
      .catch(report);
    setLocal(null);
  };
  const cancel = () => {
    if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    raf.current = undefined;
    pending.current = undefined;
    drag.current = null;
    transaction.current?.cancel();
    transaction.current = null;
    setLocal(null);
  };
  React.useEffect(
    () => () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
      transaction.current?.cancel();
    },
    [editing],
  );
  React.useEffect(() => {
    if (disabled) {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
      raf.current = undefined;
      pending.current = undefined;
      drag.current = null;
      transaction.current?.cancel();
      transaction.current = null;
      setLocal(null);
    }
  }, [disabled]);
  const current =
    local !== null && local.trim() && Number.isFinite(Number(local))
      ? Number(local)
      : value;
  const changed = Math.abs(current - baseline) > 1e-6;
  const invalid =
    local !== null && (!local.trim() || !Number.isFinite(Number(local)));
  const typedFinish = () => {
    if (invalid) cancel();
    else finish();
  };
  return (
    <div className={styles.numeric} data-acting={acting || undefined}>
      <Row
        label={
          <span className={styles.numericLabel}>
            {changed && (
              <button
                type="button"
                className={styles.reset}
                aria-label={`reset ${label}`}
                title="reset"
                disabled={disabled}
                onClick={() => {
                  preview(baseline);
                  finish();
                }}
              >
                <span />
              </button>
            )}
            <button
              type="button"
              className={styles.scrub}
              aria-label={`scrub ${label}`}
              title={`drag to change ${label}`}
              disabled={disabled}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancel();
                }
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  e.stopPropagation();
                  preview(
                    current +
                      (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1),
                  );
                }
              }}
              onKeyUp={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.stopPropagation();
                  finish();
                }
              }}
              onPointerDown={(e) => {
                if (e.button !== 0 || drag.current) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = {
                  x: e.clientX,
                  value: current,
                  pointer: e.pointerId,
                };
                getTransaction().begin();
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.pointer !== e.pointerId) return;
                pending.current =
                  d.value +
                  ((e.clientX - d.x) / 8) * step * (e.shiftKey ? 10 : 1);
                if (raf.current === undefined)
                  raf.current = requestAnimationFrame(() => {
                    raf.current = undefined;
                    const n = pending.current;
                    pending.current = undefined;
                    if (n !== undefined) preview(n);
                  });
              }}
              onPointerUp={(e) => {
                if (drag.current?.pointer !== e.pointerId) return;
                drag.current = null;
                finish();
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={cancel}
              onLostPointerCapture={() => {
                if (drag.current) cancel();
              }}
            >
              {displayLabel ?? label}
            </button>
          </span>
        }
        value={
          <span className={styles.value}>
            <Input
              aria-label={label}
              inputMode="decimal"
              aria-invalid={invalid || undefined}
              value={local ?? String(Number(displayed.toFixed(6)))}
              disabled={disabled}
              onFocus={() => {
                setLocal(String(value));
                getTransaction().begin();
              }}
              onChange={(e) => {
                const text = e.target.value;
                setLocal(text);
                if (text.trim() && Number.isFinite(Number(text)))
                  preview(Number(text));
              }}
              onBlur={typedFinish}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancel();
                  e.currentTarget.blur();
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  typedFinish();
                  e.currentTarget.blur();
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  e.stopPropagation();
                  preview(
                    current +
                      (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1),
                  );
                }
              }}
            />
            <span className={styles.unit}>{unit}</span>
            {keyframe}
          </span>
        }
      />
      {slider && (
        <Slider
          aria-label={`${label} slider`}
          min={min}
          max={max}
          step={step}
          value={[clamp(current, min, max)]}
          disabled={disabled}
          onValueChange={(v) => {
            if (v[0] !== undefined) preview(v[0]);
          }}
          onValueCommit={finish}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
        />
      )}
    </div>
  );
}
