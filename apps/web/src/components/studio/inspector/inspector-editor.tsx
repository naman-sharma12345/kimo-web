'use client';
import * as React from 'react';
import type { Clip, KimoProject, Op } from '@kimo/client';
import { Button } from '@/components/ui/button';
import { InspectorSection, Reason, Segments, Switch } from './controls';
import { NumericField } from './numeric-field';
import { TransformSection } from './transform-section';
import { TextStyleControls, TextContentFields } from './text-section';
import { ColourSection } from './colour-section';
import { EffectsSection } from './effects-section';
import {
  MaskSection,
  AudioSection,
  TransitionsSection,
  SourceSection,
} from './media-sections';
import { ProjectSection } from './project-section';
import { CaptionsEditor } from '../text-editing/captions-editor';
import type { CaptionsEditorProps } from '../text-editing/types';
import { cropValue } from './model';
import { currentClip, patchClip, type Scope } from './scope';
import { speedClip } from '@/lib/editing/commands';
import type { InspectorEditorProps } from './types';
import styles from './inspector.module.css';
function ClipInspector({
  props,
  clips,
  report,
}: {
  props: InspectorEditorProps;
  clips: readonly Clip[];
  report(message: string): void;
}) {
  const clip = clips[0];
  const [aspectLock, setAspectLock] = React.useState(false);
  const section = (
    label: string,
    children: React.ReactNode,
    onOpenChange?: (open: boolean) => void,
  ) => (
    <InspectorSection
      key={label}
      label={label}
      scope={props.project.id}
      storage={props.storage}
      onOpenChange={onOpenChange}
    >
      {children}
    </InspectorSection>
  );
  if (!clip) return null;
  const disabled = clips.some(
    (c) =>
      c.locked || props.project.tracks.find((t) => t.id === c.trackId)?.locked,
  );
  const pitchCapability = props.audioCapabilities?.(clip.id);
  const activity = props.propertyActivity?.find(
    (a) => a.running && clips.some((c) => c.id === a.clipId),
  );
  const edit = (label: string, build: (p: KimoProject) => readonly Op[]) => {
    if (disabled) return;
    try {
      const p = props.editing.getState().project;
      const ops = build(p);
      if (ops.length)
        void props.editing
          .editGroup(ops, label, 'inspector')
          .then((r) => {
            if (r.status === 'failed') report(r.error ?? 'The edit failed.');
          })
          .catch((e) =>
            report(e instanceof Error ? e.message : 'The edit failed.'),
          );
    } catch (e) {
      report(e instanceof Error ? e.message : 'The edit failed.');
    }
  };
  const scope: Scope = {
    props,
    clip,
    disabled,
    report,
    edit,
    acting: (property) =>
      activity?.clipId === clip.id && activity.property === property,
  };
  const multi = clips.length > 1;
  return (
    <>
      {disabled && (
        <Reason>
          Selection is locked. Unlock the clip or track to edit it.
        </Reason>
      )}
      {multi && (
        <Reason>
          {clips.length} clips selected. Transform sets an absolute value for
          all selected clips in one group. Other controls require one selected
          clip.
        </Reason>
      )}
      {section('Transform', <TransformSection scope={scope} clips={clips} />)}
      {!multi && (
        <>
          {section(
            'Crop',
            <>
              {(['l', 't', 'r', 'b'] as const).map((edge) => (
                <NumericField
                  key={edge}
                  label={`crop ${edge.toUpperCase()}`}
                  unit="%"
                  value={(clip.transform.crop?.[edge] ?? 0) * 100}
                  baseline={0}
                  min={0}
                  max={99.9}
                  step={0.1}
                  disabled={disabled}
                  acting={scope.acting(`transform.crop.${edge}`)}
                  editing={props.editing}
                  clipIds={[clip.id]}
                  onError={report}
                  build={(v, p) => {
                    const c = currentClip(p, clip.id);
                    return [
                      patchClip(c, {
                        transform: cropValue(c, edge, v, aspectLock),
                      }),
                    ];
                  }}
                />
              ))}
              <Switch
                label="aspect lock"
                value={aspectLock}
                onChange={setAspectLock}
                disabled={disabled}
              />
              <Button
                size="sm"
                disabled={disabled}
                onClick={() =>
                  edit('reset crop', (p) => {
                    const c = currentClip(p, clip.id);
                    return [
                      patchClip(c, {
                        transform: {
                          ...c.transform,
                          crop: { l: 0, t: 0, r: 0, b: 0 },
                        },
                      }),
                    ];
                  })
                }
              >
                reset crop
              </Button>
            </>,
          )}
          {section(
            'Speed',
            <>
              <Segments
                label="speed presets"
                value={`${clip.speed}×`}
                options={['0.5×', '1×', '1.5×', '2×']}
                disabled={disabled}
                onChange={(v) =>
                  edit('change speed', (p) =>
                    speedClip(p, clip.id, Number(v.slice(0, -1)), props.assets),
                  )
                }
              />
              <NumericField
                label="custom speed"
                unit="×"
                value={clip.speed}
                baseline={1}
                min={0.1}
                max={4}
                step={0.1}
                disabled={disabled}
                acting={scope.acting('speed')}
                editing={props.editing}
                clipIds={[clip.id]}
                onError={report}
                build={(v, p) => speedClip(p, clip.id, v, props.assets)}
              />
              <Switch
                label="keep pitch"
                acting={scope.acting('keepPitch')}
                value={clip.keepPitch ?? true}
                disabled={disabled || pitchCapability?.keepPitch === false}
                onChange={(v) =>
                  edit('keep pitch', (p) => [
                    patchClip(currentClip(p, clip.id), { keepPitch: v }),
                  ])
                }
              />
              {pitchCapability?.keepPitch === false ? (
                <Reason>
                  {pitchCapability.reason ??
                    'pitch preservation is unavailable for this audio path'}
                </Reason>
              ) : null}
            </>,
          )}
          {clip.text &&
            section(
              'Text',
              <>
                <TextContentFields scope={scope} />
                <TextStyleControls scope={scope} />
              </>,
            )}
          {section('Colour', <ColourSection scope={scope} />)}
          {section('Effects', <EffectsSection scope={scope} />)}
          {section('Mask', <MaskSection scope={scope} />, props.onMaskOpen)}
          {(clip.kind === 'audio' || clip.kind === 'video') &&
            section('Audio', <AudioSection scope={scope} />)}
          {section('Transitions', <TransitionsSection scope={scope} />)}
          {clip.kind === 'image' &&
            section('Source', <SourceSection scope={scope} />)}
        </>
      )}
    </>
  );
}
function CaptionTrackInspector({ props }: { props: InspectorEditorProps }) {
  const track = props.project.tracks.find((t) => t.id === props.captionTrackId);
  if (!track || track.kind !== 'text')
    return <Reason>Caption track is no longer available.</Reason>;
  if (!props.onSeek)
    return (
      <Reason>
        Caption editing requires the parent preview seek callback.
      </Reason>
    );
  const captionProps: CaptionsEditorProps = {
    editing: props.editing,
    project: props.project,
    trackId: track.id,
    playhead: props.playhead,
    onSeek: props.onSeek,
  };
  return (
    <fieldset className={styles.textFields} disabled={track.locked}>
      <CaptionsEditor {...captionProps} />
    </fieldset>
  );
}
export function InspectorEditor(props: InspectorEditorProps) {
  const [error, setError] = React.useState<string | null>(null);
  const clips = props.selection.flatMap((id) =>
    props.project.clips[id] ? [props.project.clips[id]] : [],
  );
  const selectionKey = [props.project.id, ...props.selection].join(':');
  return (
    <div
      className={styles.inspector}
      aria-label="inspector"
      data-action-id={props.activeAction?.id}
      data-clip-id={props.activeAction?.clipId}
    >
      {props.activeAction ? (
        <p role="status">{props.activeAction.title}</p>
      ) : null}
      {error && (
        <p className={styles.error} role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            dismiss
          </button>
        </p>
      )}
      {props.captionTrackId ? (
        <InspectorSection
          label="Text"
          scope={props.project.id}
          storage={props.storage}
        >
          <CaptionTrackInspector
            key={`${props.project.id}:${props.captionTrackId}`}
            props={props}
          />
        </InspectorSection>
      ) : clips.length ? (
        <ClipInspector
          key={selectionKey}
          props={props}
          clips={clips}
          report={setError}
        />
      ) : (
        <InspectorSection
          label="Project"
          scope={props.project.id}
          storage={props.storage}
        >
          <ProjectSection
            key={props.project.id}
            props={props}
            report={setError}
          />
        </InspectorSection>
      )}
    </div>
  );
}
