'use client';
import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NumericField } from './numeric-field';
import { FieldTransaction } from './transaction';
import { Select, Reason } from './controls';
import {
  effectParams,
  numericParam,
  reorderEffects,
  canonicalEffect,
} from './model';
import { boundedEffectParam } from './colour-section';
import { currentClip, patchClip, type Scope } from './scope';
import styles from './inspector.module.css';
const kinds = [
  { value: 'blur', label: 'blur' },
  { value: 'vignette', label: 'vignette' },
  { value: 'grain', label: 'grain' },
  { value: 'sharpen', label: 'sharpen' },
  { value: 'black_white', label: 'black & white' },
  { value: 'zoom_punch_in', label: 'zoom punch-in' },
];
export function EffectsSection({ scope }: { scope: Scope }) {
  const { clip, props, disabled, report } = scope;
  const drag = React.useRef<{
    id: string;
    transaction: FieldTransaction;
  } | null>(null);
  React.useEffect(() => () => drag.current?.transaction.cancel(), []);
  React.useEffect(() => {
    if (disabled) {
      drag.current?.transaction.cancel();
      drag.current = null;
    }
  }, [disabled]);
  const previewDrag = (target: string) => {
    const active = drag.current;
    if (!active) return;
    try {
      active.transaction.preview((p) => {
        const c = currentClip(p, clip.id);
        return [
          patchClip(c, {
            effects: reorderEffects(
              c.effects,
              c.effects.findIndex((e) => e.id === active.id),
              c.effects.findIndex((e) => e.id === target),
            ),
          }),
        ];
      });
    } catch (e) {
      report(
        e instanceof Error ? e.message : 'Effect order could not be changed.',
      );
      active.transaction.cancel();
      drag.current = null;
    }
  };
  const [add, setAdd] = React.useState('blur');
  const move = (id: string, target: number) =>
    scope.edit('reorder effects', (p) => {
      const c = currentClip(p, clip.id);
      return [
        patchClip(c, {
          effects: reorderEffects(
            c.effects,
            c.effects.findIndex((e) => e.id === id),
            target,
          ),
        }),
      ];
    });
  return (
    <>
      <ol className={styles.effects} aria-label="applied effects">
        {clip.effects.map((effect, index) => (
          <li
            key={effect.id}
            className={styles.effect}
            onDragOver={(e) => {
              if (drag.current && !disabled) {
                e.preventDefault();
                previewDrag(effect.id);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              const active = drag.current;
              if (!active) return;
              if (disabled) {
                active.transaction.cancel();
                drag.current = null;
                return;
              }
              previewDrag(effect.id);
              drag.current = null;
              void active.transaction
                .commit()
                ?.then((r) => {
                  if (r.status === 'failed')
                    report(r.error ?? 'Effect order could not be saved.');
                })
                .catch((e) => report(String(e)));
            }}
          >
            <div className={styles.effectHeader}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`drag ${effect.kind}`}
                draggable={!disabled}
                disabled={disabled}
                onDragStart={(e) => {
                  try {
                    const transaction = new FieldTransaction(
                      props.editing,
                      [clip.id],
                      'reorder effects',
                    );
                    transaction.begin();
                    drag.current = { id: effect.id, transaction };
                    e.dataTransfer.setData('text/plain', effect.id);
                    e.dataTransfer.effectAllowed = 'move';
                  } catch (error) {
                    e.preventDefault();
                    report(
                      error instanceof Error
                        ? error.message
                        : 'Effect ordering is unavailable.',
                    );
                  }
                }}
                onDragEnd={() => {
                  drag.current?.transaction.cancel();
                  drag.current = null;
                }}
              >
                <GripVertical aria-hidden="true" />
              </button>
              <span className={styles.effectName}>
                {kinds.find((k) => k.value === effect.kind)?.label ??
                  effect.kind}
              </span>
              <Button
                iconOnly
                data-acting={
                  scope.acting(`effects.${effect.id}.enabled`) || undefined
                }
                tooltip={
                  effect.enabled === false ? 'enable effect' : 'disable effect'
                }
                aria-label={`${effect.enabled === false ? 'enable' : 'disable'} ${effect.kind}`}
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  scope.edit('toggle effect', (p) => {
                    const c = currentClip(p, clip.id);
                    return [
                      patchClip(c, {
                        effects: c.effects.map((e) =>
                          e.id === effect.id
                            ? { ...e, enabled: e.enabled === false }
                            : e,
                        ),
                      }),
                    ];
                  })
                }
              >
                {effect.enabled === false ? <EyeOff /> : <Eye />}
              </Button>
              <Button
                iconOnly
                tooltip="move effect up"
                aria-label={`move ${effect.kind} up`}
                size="xs"
                variant="ghost"
                disabled={disabled || index === 0}
                onClick={() => move(effect.id, index - 1)}
              >
                <ArrowUp />
              </Button>
              <Button
                iconOnly
                tooltip="move effect down"
                aria-label={`move ${effect.kind} down`}
                size="xs"
                variant="ghost"
                disabled={disabled || index === clip.effects.length - 1}
                onClick={() => move(effect.id, index + 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                iconOnly
                tooltip="remove effect"
                aria-label={`remove ${effect.kind}`}
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  scope.edit('remove effect', (p) => {
                    const c = currentClip(p, clip.id);
                    return [
                      patchClip(c, {
                        effects: c.effects.filter((e) => e.id !== effect.id),
                      }),
                    ];
                  })
                }
              >
                <Trash2 />
              </Button>
            </div>
            {effectParams[canonicalEffect(effect.kind)]
              ?.filter(
                (param) => param.key !== 'x' || effect.params.x !== undefined,
              )
              .map((param) => (
                <NumericField
                  key={param.key}
                  label={`${effect.kind} ${param.key}`}
                  value={numericParam(
                    effect,
                    canonicalEffect(effect.kind) === 'blur' ? 'x' : param.key,
                    canonicalEffect(effect.kind) === 'blur'
                      ? numericParam(effect, 'radius', 8)
                      : param.baseline,
                  )}
                  baseline={param.baseline}
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  editing={props.editing}
                  clipIds={[clip.id]}
                  disabled={disabled}
                  acting={scope.acting(`effects.${effect.id}.${param.key}`)}
                  onError={report}
                  build={(v, p) => {
                    const c = currentClip(p, clip.id),
                      current = c.effects.find((e) => e.id === effect.id);
                    if (!current) throw new Error('The effect was removed.');
                    return [
                      patchClip(c, {
                        effects: c.effects.map((e) =>
                          e.id === effect.id
                            ? {
                                ...e,
                                params: boundedEffectParam(e, param.key, v),
                              }
                            : e,
                        ),
                      }),
                    ];
                  }}
                />
              ))}
            {canonicalEffect(effect.kind) === 'blur' &&
              (effect.params.strength !== undefined ||
                effect.params.y !== undefined) && (
                <Reason>
                  Stored blur strength/y are retained; the current preview does
                  not consume them. Radius controls the actual blur.
                </Reason>
              )}
            {canonicalEffect(effect.kind) === 'grade' && (
              <Reason>Grade parameters are in the Colour section.</Reason>
            )}
            {!effectParams[canonicalEffect(effect.kind)] &&
              canonicalEffect(effect.kind) !== 'grade' &&
              effect.kind !== 'lut' && (
                <Reason>
                  This effect has no supported parameter controls.
                </Reason>
              )}
          </li>
        ))}
      </ol>
      {!clip.effects.length && <Reason>No effects applied.</Reason>}
      <Select
        label="effect"
        value={add}
        options={kinds}
        onChange={setAdd}
        disabled={disabled}
      />
      <Button
        size="sm"
        disabled={disabled}
        onClick={() =>
          scope.edit('add effect', (p) => {
            const c = currentClip(p, clip.id);
            const defaults = effectParams[add] ?? [];
            return [
              patchClip(c, {
                effects: [
                  ...c.effects,
                  {
                    id: crypto.randomUUID(),
                    kind: add,
                    enabled: true,
                    params: Object.fromEntries(
                      defaults
                        .filter((param) => param.key !== 'x')
                        .map((param) => [param.key, param.baseline]),
                    ),
                  },
                ],
              }),
            ];
          })
        }
      >
        add effect
      </Button>
    </>
  );
}
