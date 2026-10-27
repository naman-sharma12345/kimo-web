'use client';
import * as React from 'react';
import { Diamond } from 'lucide-react';
import type { Clip, KimoProject, Op } from '@kimo/client';
import { interpolateKeyframes } from '../../../../../../packages/compositor/src/scene-builder';
import { NumericField } from './numeric-field';
import { animationTime, hasKey, toggleKey } from './model';
import { currentClip, patchClip, type Scope } from './scope';
import styles from './inspector.module.css';
type Scalar = keyof Omit<Clip['transform'], 'crop'>;
const properties: readonly {
  key: Scalar;
  label: string;
  unit: string;
  baseline: number;
  min: number;
  max: number;
  factor: number;
}[] = [
  {
    key: 'x',
    label: 'position X',
    unit: 'px',
    baseline: 0,
    min: -1e6,
    max: 1e6,
    factor: 1,
  },
  {
    key: 'y',
    label: 'position Y',
    unit: 'px',
    baseline: 0,
    min: -1e6,
    max: 1e6,
    factor: 1,
  },
  {
    key: 'scale',
    label: 'scale',
    unit: '%',
    baseline: 100,
    min: 0.01,
    max: 100000,
    factor: 100,
  },
  {
    key: 'rotation',
    label: 'rotation',
    unit: '°',
    baseline: 0,
    min: -36000,
    max: 36000,
    factor: 1,
  },
  {
    key: 'opacity',
    label: 'opacity',
    unit: '%',
    baseline: 100,
    min: 0,
    max: 100,
    factor: 100,
  },
];
export function scalarValue(clip: Clip, key: Scalar, playhead: number) {
  return interpolateKeyframes(
    clip.keyframes.filter(
      (k) => k.property === key || k.property === `transform.${key}`,
    ),
    playhead - clip.start + (clip.animationOffsetSec ?? 0),
    clip.transform[key],
  );
}
export function scalarOps(
  project: KimoProject,
  ids: readonly string[],
  key: Scalar,
  value: number,
  playhead: number,
): Op[] {
  return ids.map((id) => {
    const clip = currentClip(project, id);
    const keys = clip.keyframes.filter(
      (k) => k.property === key || k.property === `transform.${key}`,
    );
    if (keys.length) {
      const time = animationTime(clip, playhead, project.fps);
      return patchClip(clip, {
        keyframes: [
          ...clip.keyframes.filter(
            (k) =>
              !(
                (k.property === key || k.property === `transform.${key}`) &&
                Math.abs(k.time - time) < 0.5 / project.fps
              ),
          ),
          { property: key, time, value, easing: 'linear' },
        ],
      });
    }
    return patchClip(clip, { transform: { ...clip.transform, [key]: value } });
  });
}
export function TransformSection({
  scope,
  clips,
}: {
  scope: Scope;
  clips: readonly Clip[];
}) {
  const { clip, props, disabled, report } = scope,
    ids = clips.map((c) => c.id);
  return (
    <>
      {properties.map((property) => {
        const time = animationTime(clip, props.playhead, props.project.fps),
          keyed = hasKey(clip, property.key, time, props.project.fps);
        return (
          <NumericField
            key={property.key}
            label={property.label}
            value={
              scalarValue(clip, property.key, props.playhead) * property.factor
            }
            baseline={property.baseline}
            unit={property.unit}
            min={property.min}
            max={property.max}
            disabled={disabled}
            acting={
              scope.acting(`transform.${property.key}`) ||
              scope.acting(property.key)
            }
            editing={props.editing}
            clipIds={ids}
            onError={report}
            build={(value, p) =>
              scalarOps(
                p,
                ids,
                property.key,
                value / property.factor,
                props.playhead,
              )
            }
            keyframe={
              <button
                type="button"
                className={styles.keyframe}
                data-keyed={keyed}
                aria-label={`${keyed ? 'remove' : 'add'} ${property.label} keyframe`}
                aria-pressed={keyed}
                disabled={disabled}
                onClick={() =>
                  scope.edit(`${property.label} keyframe`, (p) =>
                    ids.map((id) => {
                      const c = currentClip(p, id);
                      const op = toggleKey(
                        c,
                        property.key,
                        props.playhead,
                        p.fps,
                      );
                      if (
                        op.op === 'clip.update' &&
                        !hasKey(
                          c,
                          property.key,
                          animationTime(c, props.playhead, p.fps),
                          p.fps,
                        ) &&
                        op.patch.keyframes
                      ) {
                        const last = op.patch.keyframes.at(-1);
                        if (last)
                          last.value = scalarValue(
                            c,
                            property.key,
                            props.playhead,
                          );
                      }
                      return op;
                    }),
                  )
                }
              >
                <Diamond aria-hidden="true" />
              </button>
            }
          />
        );
      })}
    </>
  );
}
