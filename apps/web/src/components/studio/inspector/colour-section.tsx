'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { NumericField } from './numeric-field';
import { Select, Reason } from './controls';
import {
  gradeParams,
  gradeChannelRange,
  numericParam,
  wheelGrade,
  wheelRGB,
  wheelPoint,
  clamp,
  canonicalEffect,
} from './model';
import { currentClip, patchClip, type Scope } from './scope';
import { FieldTransaction } from './transaction';
import type { Clip, KimoProject, Op } from '@kimo/client';
import type { LUTName } from './types';
import styles from './inspector.module.css';
const lutNames: readonly LUTName[] = [
  'warm film',
  'teal & orange',
  'bleach',
  'mono',
];
function gradeEffect(clip: Clip) {
  return clip.effects.find(
    (e) =>
      e.kind === 'grade' ||
      e.kind === 'color_grade' ||
      e.kind === 'colour_grade',
  );
}
function gradeOps(
  p: KimoProject,
  id: string,
  values: Record<string, number>,
  effectId: string,
): Op[] {
  const clip = currentClip(p, id),
    effect = gradeEffect(clip);
  const updated = {
    ...(effect ?? { id: effectId, kind: 'grade', params: {} }),
    params: { ...effect?.params, ...values },
  };
  return [
    patchClip(clip, {
      effects: effect
        ? clip.effects.map((e) => (e.id === effect.id ? updated : e))
        : [...clip.effects, updated],
    }),
  ];
}
function Wheel({
  scope,
  kind,
}: {
  scope: Scope;
  kind: 'lift' | 'gamma' | 'gain';
}) {
  const { clip, props, disabled, report } = scope;
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const tx = React.useRef<FieldTransaction | null>(null);
  const pointer = React.useRef<number | null>(null);
  const frame = React.useRef<number | undefined>(undefined);
  const point = React.useRef<[number, number] | null>(null);
  const effectId = React.useId();
  const baseline = kind === 'lift' ? 0 : 1,
    [min, max] = gradeChannelRange(kind);
  const effect = gradeEffect(clip);
  const marker = wheelPoint(
    ['R', 'G', 'B'].map((channel) =>
      numericParam(
        effect,
        `${kind}${channel}`,
        numericParam(effect, kind, baseline),
      ),
    ) as [number, number, number],
  );
  React.useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const pixels = ctx.createImageData(72, 72);
    for (let y = 0; y < 72; y++)
      for (let x = 0; x < 72; x++) {
        const nx = (x - 35.5) / 35.5,
          ny = (y - 35.5) / 35.5,
          index = (y * 72 + x) * 4;
        const rgb = wheelRGB(nx, ny);
        pixels.data.set(
          [
            rgb[0] * 255,
            rgb[1] * 255,
            rgb[2] * 255,
            Math.hypot(nx, ny) <= 1 ? 255 : 0,
          ],
          index,
        );
      }
    ctx.putImageData(pixels, 0, 0);
  }, []);
  React.useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      tx.current?.cancel();
    },
    [],
  );
  const preview = () => {
    const xy = point.current;
    if (!xy || disabled) return;
    const rgb = wheelGrade(xy[0], xy[1], baseline, min, max);
    try {
      tx.current ??= new FieldTransaction(
        props.editing,
        [clip.id],
        `${kind} colour`,
      );
      tx.current.preview((p) =>
        gradeOps(
          p,
          clip.id,
          { [`${kind}R`]: rgb[0], [`${kind}G`]: rgb[1], [`${kind}B`]: rgb[2] },
          effectId,
        ),
      );
    } catch (e) {
      report(
        e instanceof Error ? e.message : 'The colour could not be changed.',
      );
      tx.current?.cancel();
      tx.current = null;
    }
  };
  const finish = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    preview();
    point.current = null;
    const pending = tx.current;
    tx.current = null;
    void pending?.commit()?.catch((e) => report(String(e)));
  };
  return (
    <div className={styles.wheelGroup}>
      <span>{kind}</span>
      <button
        type="button"
        className={styles.wheel}
        aria-label={`${kind} colour wheel`}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            point.current = null;
            tx.current?.cancel();
            tx.current = null;
            pointer.current = null;
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || pointer.current !== null) return;
          pointer.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          point.current = [
            ((e.clientX - r.left) / r.width) * 2 - 1,
            ((e.clientY - r.top) / r.height) * 2 - 1,
          ];
          preview();
        }}
        onPointerMove={(e) => {
          if (pointer.current !== e.pointerId) return;
          const r = e.currentTarget.getBoundingClientRect();
          point.current = [
            ((e.clientX - r.left) / r.width) * 2 - 1,
            ((e.clientY - r.top) / r.height) * 2 - 1,
          ];
          if (frame.current === undefined)
            frame.current = requestAnimationFrame(() => {
              frame.current = undefined;
              preview();
            });
        }}
        onPointerUp={(e) => {
          if (pointer.current !== e.pointerId) return;
          pointer.current = null;
          finish();
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          pointer.current = null;
          point.current = null;
          tx.current?.cancel();
          tx.current = null;
        }}
        onLostPointerCapture={() => {
          if (pointer.current !== null) {
            pointer.current = null;
            point.current = null;
            tx.current?.cancel();
            tx.current = null;
          }
        }}
      >
        <canvas ref={canvas} width={72} height={72} aria-hidden="true" />
        <span
          aria-hidden="true"
          className={styles.wheelMarker}
          style={{
            left: `${50 + marker[0] * 46}%`,
            top: `${50 + marker[1] * 46}%`,
          }}
        />
      </button>
      {(['R', 'G', 'B'] as const).map((channel) => (
        <NumericField
          key={channel}
          label={`${kind} ${channel}`}
          displayLabel={channel}
          value={numericParam(
            effect,
            `${kind}${channel}`,
            numericParam(effect, kind, baseline),
          )}
          baseline={baseline}
          min={min}
          max={max}
          step={0.01}
          disabled={disabled}
          acting={scope.acting(`effects.${effect?.id}.${kind}${channel}`)}
          editing={props.editing}
          clipIds={[clip.id]}
          onError={report}
          build={(v, p) =>
            gradeOps(p, clip.id, { [`${kind}${channel}`]: v }, effectId)
          }
        />
      ))}
      <span className={styles.srOnly}>
        Use RGB fields for keyboard colour adjustment.
      </span>
    </div>
  );
}
export function ColourSection({ scope }: { scope: Scope }) {
  const { clip, props, disabled, report } = scope,
    effect = gradeEffect(clip),
    id = React.useId();
  const currentLut = clip.effects.find(
    (e) => e.kind === 'lut' || typeof e.params.lutAssetId === 'string',
  );
  const lutAssetId = currentLut?.params.lutAssetId;
  const name = lutNames.find((n) => props.lutAssets?.[n] === lutAssetId);
  const unsupported = typeof lutAssetId === 'string' && !name;
  return (
    <>
      {gradeParams.map((param) => (
        <NumericField
          key={param.key}
          label={param.key}
          value={numericParam(
            effect,
            param.key,
            param.key === 'temperature'
              ? numericParam(effect, 'temp', 0)
              : param.baseline,
          )}
          baseline={param.baseline}
          min={param.min}
          max={param.max}
          step={param.step}
          slider
          editing={props.editing}
          clipIds={[clip.id]}
          disabled={disabled}
          acting={scope.acting(`effects.${effect?.id}.${param.key}`)}
          onError={report}
          build={(v, p) => gradeOps(p, clip.id, { [param.key]: v }, id)}
        />
      ))}
      <div className={styles.wheels}>
        {(['lift', 'gamma', 'gain'] as const).map((kind) => (
          <Wheel key={kind} kind={kind} scope={scope} />
        ))}
      </div>
      <Select
        label="LUT"
        acting={scope.acting(`effects.${currentLut?.id}.lutAssetId`)}
        value={unsupported ? 'unsupported' : (name ?? 'none')}
        disabled={disabled}
        options={[
          { value: 'none', label: 'none' },
          ...lutNames.map((n) => ({
            value: n,
            label: n,
            disabled: !props.assets.some(
              (a) => a.id === props.lutAssets?.[n] && a.lut,
            ),
          })),
          ...(unsupported
            ? [
                {
                  value: 'unsupported',
                  label: 'unsupported LUT',
                  disabled: true,
                },
              ]
            : []),
        ]}
        onChange={(next) =>
          scope.edit('change LUT', (p) => {
            const c = currentClip(p, clip.id),
              without = c.effects
                .filter((e) => e.kind !== 'lut')
                .map((e) => {
                  if (typeof e.params.lutAssetId !== 'string') return e;
                  const params = { ...e.params };
                  delete params.lutAssetId;
                  return { ...e, params };
                });
            if (next === 'none') return [patchClip(c, { effects: without })];
            const assetId = props.lutAssets?.[next as LUTName];
            if (
              !assetId ||
              !props.assets.some((a) => a.id === assetId && a.lut)
            )
              throw new Error('This LUT asset is unavailable.');
            return [
              patchClip(c, {
                effects: [
                  ...without,
                  {
                    id: currentLut?.kind === 'lut' ? currentLut.id : id,
                    kind: 'lut',
                    params: { lutAssetId: assetId },
                    enabled: true,
                  },
                ],
              }),
            ];
          })
        }
      />
      {lutNames.some(
        (n) =>
          !props.assets.some((a) => a.id === props.lutAssets?.[n] && a.lut),
      ) && (
        <Reason>
          Named LUTs require registered LUT assets. Identity is not a named
          look.
        </Reason>
      )}
      <Button
        size="sm"
        variant="secondary"
        disabled={!props.compare?.available}
        aria-pressed={props.compare?.available ? props.compare.enabled : false}
        onClick={() => {
          if (props.compare?.available)
            props.compare.onChange(!props.compare.enabled, clip.id);
        }}
      >
        before/after
      </Button>
      {!props.compare?.available && (
        <Reason>
          {props.compare?.reason ??
            'Split-wipe preview is unavailable until the preview hook is connected.'}
        </Reason>
      )}
    </>
  );
}
export function boundedEffectParam(
  effect: Clip['effects'][number],
  key: string,
  value: number,
): Record<string, string | number | boolean> {
  const params = { ...effect.params, [key]: value };
  if (
    canonicalEffect(effect.kind) === 'blur' &&
    key === 'radius' &&
    typeof params.x === 'number'
  )
    params.x = value;
  if (canonicalEffect(effect.kind) === 'vignette') {
    const inner = typeof params.inner === 'number' ? params.inner : 0.4,
      outer = typeof params.outer === 'number' ? params.outer : 1;
    if (key === 'inner') params.inner = Math.min(inner, outer - 0.000001);
    else if (key === 'outer') params.outer = clamp(outer, inner + 0.000001, 2);
  }
  return params;
}
