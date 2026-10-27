'use client';
import * as React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pill } from '@/components/ui/pill';
import { NumericField } from './numeric-field';
import { Select, Segments, Switch, Reason } from './controls';
import {
  dbToGain,
  gainToDb,
  makeTransition,
  safePage,
  transitionFrames,
  transitionOps,
} from './model';
import { currentClip, patchClip, type Scope } from './scope';
import { LevelMeter } from './level-meter';
import styles from './inspector.module.css';
export function MaskSection({ scope }: { scope: Scope }) {
  const { clip, props, disabled, report } = scope;
  const checkerId = React.useId().replace(/:/g, '');
  const [description, setDescription] = React.useState(''),
    [sending, setSending] = React.useState(false);
  const preview =
    props.maskPreview?.clipId === clip.id ? props.maskPreview : undefined;
  const scopeValue = clip.effects.some((e) => e.scope === 'outside_mask')
    ? 'background'
    : 'subject';
  return (
    <>
      <div className={styles.checker}>
        <svg
          className={styles.checkerGrid}
          aria-hidden="true"
          width="100%"
          height="100%"
        >
          <defs>
            <pattern
              id={`checker-${checkerId}`}
              width="16"
              height="16"
              patternUnits="userSpaceOnUse"
            >
              <rect width="16" height="16" className={styles.checkerBase} />
              <path d="M0 0h8v8H0zM8 8h8v8H8z" className={styles.checkerAlt} />
            </pattern>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill={`url(#checker-${checkerId})`}
          />
        </svg>
        {preview?.cutoutUrl ? (
          <img
            src={preview.cutoutUrl}
            alt={
              preview.subjectLabel
                ? `${preview.subjectLabel} mask cutout`
                : 'mask cutout'
            }
          />
        ) : (
          <Reason>Subject cutout thumbnail unavailable.</Reason>
        )}
      </div>
      {preview?.subjectLabel && (
        <p className={styles.reason}>{preview.subjectLabel}</p>
      )}
      {!clip.mask && <Reason>No mask applied.</Reason>}
      <Switch
        label="invert"
        acting={scope.acting('mask.invert')}
        value={clip.mask?.invert ?? false}
        disabled={disabled || !clip.mask}
        onChange={(value) =>
          scope.edit('invert mask', (p) => {
            const c = currentClip(p, clip.id);
            if (!c.mask) return [];
            return [patchClip(c, { mask: { ...c.mask, invert: value } })];
          })
        }
      />
      <NumericField
        label="feather"
        value={clip.mask?.feather ?? 0}
        baseline={0}
        min={0}
        max={256}
        step={0.1}
        slider
        editing={props.editing}
        clipIds={[clip.id]}
        disabled={disabled || !clip.mask}
        acting={scope.acting('mask.feather')}
        onError={report}
        build={(v, p) => {
          const c = currentClip(p, clip.id);
          return c.mask
            ? [patchClip(c, { mask: { ...c.mask, feather: v } })]
            : [];
        }}
      />
      <Reason>
        Feather uses proposed mask units; engine units are not yet verified.
      </Reason>
      <Segments
        label="apply effect to"
        acting={clip.effects.some((e) => scope.acting(`effects.${e.id}.scope`))}
        value={scopeValue}
        options={['subject', 'background']}
        disabled={disabled || !clip.mask || !clip.effects.length}
        onChange={(next) =>
          scope.edit('change mask effect scope', (p) => {
            const c = currentClip(p, clip.id);
            return [
              patchClip(c, {
                effects: c.effects.map((e) => ({
                  ...e,
                  scope: next === 'subject' ? 'inside_mask' : 'outside_mask',
                })),
              }),
            ];
          })
        }
      />
      <Input
        aria-label="re-segment: describe what to select"
        placeholder="re-segment: describe what to select"
        value={description}
        disabled={disabled}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={
          disabled || !props.onMessage || !description.trim() || sending
        }
        onClick={() => {
          if (!props.onMessage) return;
          setSending(true);
          const asset = props.assets.find((a) => a.id === clip.assetId);
          const label = asset?.name ?? clip.text?.content ?? clip.id;
          void Promise.resolve()
            .then(() =>
              props.onMessage?.(
                `use sam 3.1 to select "${description.trim()}" on ${label}`,
                clip.id,
              ),
            )
            .catch((e) =>
              report(
                e instanceof Error
                  ? e.message
                  : 'The SAM request was not sent.',
              ),
            )
            .finally(() => setSending(false));
        }}
      >
        run sam
      </Button>
      {!props.onMessage && (
        <Reason>SAM requires the parent agent-message callback.</Reason>
      )}
    </>
  );
}
export function AudioSection({ scope }: { scope: Scope }) {
  const { clip, props, disabled, report } = scope;
  return (
    <>
      <NumericField
        label="volume"
        unit="dB"
        value={gainToDb(clip.volume ?? 1)}
        baseline={0}
        min={-60}
        max={12}
        step={0.1}
        slider
        disabled={disabled}
        acting={scope.acting('volume')}
        editing={props.editing}
        clipIds={[clip.id]}
        onError={report}
        build={(v, p) => [
          patchClip(currentClip(p, clip.id), { volume: dbToGain(v) }),
        ]}
      />
      {(['fadeInSec', 'fadeOutSec'] as const).map((key) => (
        <NumericField
          key={key}
          label={key === 'fadeInSec' ? 'fade in' : 'fade out'}
          unit="s"
          value={clip[key] ?? 0}
          baseline={0}
          min={0}
          max={clip.duration}
          step={0.1}
          disabled={disabled}
          acting={scope.acting(key)}
          editing={props.editing}
          clipIds={[clip.id]}
          onError={report}
          build={(v, p) => [patchClip(currentClip(p, clip.id), { [key]: v })]}
        />
      ))}
      <Switch
        label="duck under voice"
        acting={scope.acting('duckUnderVoice')}
        value={clip.duckUnderVoice ?? clip.audioRole === 'music'}
        disabled={disabled}
        onChange={(v) =>
          scope.edit('duck under voice', (p) => [
            patchClip(currentClip(p, clip.id), { duckUnderVoice: v }),
          ])
        }
      />
      <LevelMeter api={props.levelMeter} clipId={clip.id} />
    </>
  );
}
export function TransitionsSection({ scope }: { scope: Scope }) {
  const { clip, props, disabled, report } = scope;
  const kinds = ['cut', 'crossfade', 'dip', 'slide', 'zoom_in', 'whip'];
  return (
    <>
      {(['transitionIn', 'transitionOut'] as const).map((side) => {
        const transition = clip[side],
          label = side === 'transitionIn' ? 'in' : 'out';
        return (
          <div key={side}>
            <Select
              label={`${label} type`}
              acting={scope.acting(`${side}.kind`)}
              value={transition?.kind ?? 'cut'}
              options={kinds.map((kind) => ({
                value: kind,
                label:
                  kind === 'crossfade'
                    ? 'cross dissolve'
                    : kind === 'zoom_in'
                      ? 'zoom in'
                      : kind,
              }))}
              disabled={disabled}
              onChange={(kind) =>
                scope.edit(`${label} transition`, (p) => {
                  const c = currentClip(p, clip.id);
                  return transitionOps(
                    p,
                    c,
                    side,
                    makeTransition(
                      c[side],
                      { kind: kind as NonNullable<typeof transition>['kind'] },
                      p.fps,
                    ),
                  );
                })
              }
            />
            <NumericField
              label={`${label} duration`}
              unit="f"
              value={transitionFrames(transition, props.project.fps)}
              baseline={0}
              min={0}
              max={Math.floor(clip.duration * props.project.fps)}
              disabled={disabled}
              acting={scope.acting(`${side}.durationFrames`)}
              editing={props.editing}
              clipIds={[
                clip.id,
                ...Object.values(props.project.clips)
                  .filter(
                    (c) =>
                      c.trackId === clip.trackId &&
                      c.id !== clip.id &&
                      Math.abs(
                        side === 'transitionIn'
                          ? c.start + c.duration - clip.start
                          : clip.start + clip.duration - c.start,
                      ) <
                        0.5 / props.project.fps,
                  )
                  .map((c) => c.id),
              ]}
              onError={report}
              build={(v, p) => {
                const c = currentClip(p, clip.id);
                return transitionOps(
                  p,
                  c,
                  side,
                  makeTransition(
                    c[side],
                    { durationFrames: Math.round(v) },
                    p.fps,
                  ),
                );
              }}
            />
            {(transition?.kind === 'slide' || transition?.kind === 'whip') && (
              <Select
                label={`${label} direction`}
                acting={scope.acting(`${side}.direction`)}
                value={transition.direction ?? 'left'}
                options={['left', 'right', 'up', 'down'].map((v) => ({
                  value: v,
                  label: v,
                }))}
                disabled={disabled}
                onChange={(direction) =>
                  scope.edit(`${label} direction`, (p) => {
                    const c = currentClip(p, clip.id);
                    return transitionOps(
                      p,
                      c,
                      side,
                      makeTransition(
                        c[side],
                        {
                          direction: direction as
                            'left' | 'right' | 'up' | 'down',
                        },
                        p.fps,
                      ),
                    );
                  })
                }
              />
            )}
          </div>
        );
      })}
    </>
  );
}
export function SourceSection({ scope }: { scope: Scope }) {
  const { clip, props, disabled, report } = scope;
  const asset = props.assets.find((a) => a.id === clip.assetId),
    attribution = asset?.attribution,
    url = safePage(attribution?.pageUrl);
  const replace = (mode: 'search' | 'upload') => {
    void Promise.resolve()
      .then(() => props.onReplace?.(clip.id, mode))
      .catch((e) =>
        report(
          e instanceof Error ? e.message : 'The replacement request failed.',
        ),
      );
  };
  if (!asset) return <Reason>Source asset metadata unavailable.</Reason>;
  return (
    <>
      {asset.thumbUrl && (
        <img
          className={styles.sourceThumb}
          src={asset.thumbUrl}
          alt={asset.name}
        />
      )}
      <p className={styles.reason}>{asset.name}</p>
      {asset.source === 'web' && (
        <>
          <Pill>web source</Pill>
          {attribution?.site && (
            <p className={styles.reason}>found on {attribution.site}</p>
          )}
          {url ? (
            <a
              className={styles.sourceLink}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              open page <ArrowUpRight aria-hidden="true" />
            </a>
          ) : (
            <Reason>Source page unavailable.</Reason>
          )}
          {attribution?.license && (
            <p className={styles.reason}>{attribution.license}</p>
          )}
        </>
      )}
      {asset.width && asset.height && (
        <p className={styles.metadata}>
          {asset.width} × {asset.height}
        </p>
      )}
      {asset.durationSec !== undefined && (
        <p className={styles.metadata}>{asset.durationSec.toFixed(2)} s</p>
      )}
      <Button
        size="sm"
        disabled={disabled || !props.onReplace}
        onClick={() => replace('search')}
      >
        replace image
      </Button>
      <Button
        size="sm"
        disabled={disabled || !props.onReplace}
        onClick={() => replace('upload')}
      >
        upload my own
      </Button>
      {!props.onReplace && (
        <Reason>
          Replacement and upload require the parent asset callbacks.
        </Reason>
      )}
    </>
  );
}
