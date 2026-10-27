'use client';
import * as React from 'react';
import type { Clip } from '@kimo/client';
import { Row } from '@/components/ui/row';
import { InspectorTextField } from '../text-editing/inspector-text-field';
import type { InspectorTextFieldProps } from '../text-editing/types';
import { Select, Segments } from './controls';
import { NumericField } from './numeric-field';
import { canonicalStyle, textStyleDefaults } from './model';
import { currentClip, patchClip, type Scope } from './scope';
import { FieldTransaction } from './transaction';
import styles from './inspector.module.css';
const swatches: readonly {
  name: string;
  rgb: [number, number, number, number];
}[] = [
  { name: 'white', rgb: [1, 1, 1, 1] },
  { name: 'black', rgb: [0, 0, 0, 1] },
  { name: 'cream', rgb: [245 / 255, 241 / 255, 231 / 255, 1] },
  { name: 'kimo orange', rgb: [1, 90 / 255, 36 / 255, 1] },
  { name: 'yellow', rgb: [1, 216 / 255, 77 / 255, 1] },
];
function colorHex(color: readonly number[]) {
  return (
    '#' +
    color
      .slice(0, 3)
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function TextColourPicker({
  scope,
  color,
}: {
  scope: Scope;
  color: readonly number[];
}) {
  const [local, setLocal] = React.useState<string | null>(null);
  const tx = React.useRef<FieldTransaction | null>(null);
  const begin = () => {
    tx.current ??= new FieldTransaction(
      scope.props.editing,
      [scope.clip.id],
      'text colour',
    );
    tx.current.begin();
  };
  const commit = () => {
    const pending = tx.current;
    tx.current = null;
    setLocal(null);
    void pending
      ?.commit()
      ?.then((r) => {
        if (r.status === 'failed')
          scope.report(r.error ?? 'The text colour could not be saved.');
      })
      .catch((e) => scope.report(String(e)));
  };
  React.useEffect(() => () => tx.current?.cancel(), []);
  return (
    <input
      type="color"
      className={styles.customColor}
      aria-label="custom text colour"
      value={local ?? colorHex(color)}
      disabled={scope.disabled}
      onFocus={begin}
      onChange={(e) => {
        const value = e.target.value;
        setLocal(value);
        const hex = value.slice(1);
        try {
          begin();
          tx.current?.preview((p) => {
            const clip = currentClip(p, scope.clip.id);
            if (!clip.text) return [];
            return [
              patchClip(clip, {
                text: {
                  ...clip.text,
                  color: [
                    parseInt(hex.slice(0, 2), 16) / 255,
                    parseInt(hex.slice(2, 4), 16) / 255,
                    parseInt(hex.slice(4, 6), 16) / 255,
                    clip.text.color?.[3] ?? 1,
                  ],
                },
              }),
            ];
          });
        } catch (e) {
          scope.report(String(e));
          tx.current?.cancel();
          tx.current = null;
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          tx.current?.cancel();
          tx.current = null;
          setLocal(null);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          commit();
        }
      }}
    />
  );
}
export function TextStyleControls({ scope }: { scope: Scope }) {
  const { clip, props, disabled, report } = scope;
  const text = clip.text;
  if (!text) return null;
  const style = canonicalStyle(text.style),
    defaults = textStyleDefaults.find((s) => s.id === style),
    color = text.color ?? [1, 1, 1, 1];
  const patch = (label: string, values: Partial<NonNullable<Clip['text']>>) =>
    scope.edit(label, (p) => {
      const c = currentClip(p, clip.id);
      return c.text ? [patchClip(c, { text: { ...c.text, ...values } })] : [];
    });
  return (
    <>
      <Select
        label="text style"
        acting={scope.acting('text.style')}
        value={style}
        disabled={disabled}
        options={textStyleDefaults.map((s) => ({ value: s.id, label: s.id }))}
        onChange={(value) =>
          patch('text style', {
            style: value as NonNullable<Clip['text']>['style'],
          })
        }
      />
      <div className={styles.stylePreviews} aria-label="text style previews">
        {textStyleDefaults.map((s) => (
          <button
            key={s.id}
            type="button"
            className={styles.stylePreview}
            style={{ fontFamily: s.family }}
            aria-label={`use ${s.id} style`}
            aria-pressed={style === s.id}
            disabled={disabled}
            onClick={() => patch('text style', { style: s.id })}
          >
            {s.id}
          </button>
        ))}
      </div>
      <NumericField
        label="font size"
        unit="px"
        value={text.fontSize ?? defaults?.size ?? 56}
        baseline={defaults?.size ?? 56}
        min={1}
        max={4096}
        disabled={disabled}
        acting={scope.acting('text.fontSize')}
        editing={props.editing}
        clipIds={[clip.id]}
        onError={report}
        build={(v, p) => {
          const c = currentClip(p, clip.id);
          return c.text
            ? [patchClip(c, { text: { ...c.text, fontSize: v } })]
            : [];
        }}
      />
      <Segments
        label="alignment"
        acting={scope.acting('text.alignment')}
        value={
          text.alignment ??
          (style === 'lower-third' || style === 'label-mono'
            ? 'left'
            : 'center')
        }
        options={['left', 'center', 'right']}
        disabled={disabled}
        onChange={(alignment) =>
          patch('text alignment', {
            alignment: alignment as 'left' | 'center' | 'right',
          })
        }
      />
      <Row
        label="colour"
        value={
          <span className={styles.swatches}>
            {swatches.map((s) => (
              <button
                type="button"
                key={s.name}
                className={styles.swatch}
                style={{
                  backgroundColor: `rgba(${s.rgb[0] * 255}, ${s.rgb[1] * 255}, ${s.rgb[2] * 255}, ${s.rgb[3]})`,
                }}
                aria-label={`${s.name} text colour`}
                aria-pressed={s.rgb.every((v, i) => v === color[i])}
                disabled={disabled}
                onClick={() => patch('text colour', { color: s.rgb })}
              />
            ))}
            <TextColourPicker scope={scope} color={color} />
          </span>
        }
      />
      <Select
        label="animation"
        acting={scope.acting('text.animation')}
        value={text.animation ?? 'none'}
        options={['none', 'fade', 'rise', 'type on', 'pop words'].map(
          (value) => ({ value, label: value }),
        )}
        disabled={disabled}
        onChange={(animation) =>
          patch('text animation', {
            animation: animation as NonNullable<Clip['text']>['animation'],
          })
        }
      />
      <Segments
        label="position"
        acting={scope.acting('text.position')}
        value={
          text.position ??
          (style === 'title-serif' ||
          style === 'title-bold' ||
          style === 'quote'
            ? 'middle'
            : 'bottom')
        }
        options={['bottom', 'middle', 'top']}
        disabled={disabled}
        onChange={(position) =>
          patch('text position', {
            position: position as 'bottom' | 'middle' | 'top',
          })
        }
      />
    </>
  );
}

/** Actual writer-owned text model, never another content/debounce/IME implementation. */
export function TextContentFields({ scope }: { scope: Scope }) {
  const { clip, props } = scope;
  if (!clip.text) return null;
  const primary: InspectorTextFieldProps = {
    editing: props.editing,
    clip,
    field: 'content',
    source: 'inspector',
    label: 'text content',
  };
  return (
    <fieldset className={styles.textFields} disabled={scope.disabled}>
      <div data-acting={scope.acting('text.content') || undefined}>
        <InspectorTextField {...primary} />
      </div>
      {(canonicalStyle(clip.text.style) === 'lower-third' ||
        clip.text.secondaryContent !== undefined) && (
        <div data-acting={scope.acting('text.secondaryContent') || undefined}>
          <InspectorTextField
            {...primary}
            field="secondaryContent"
            label="secondary text"
          />
        </div>
      )}
    </fieldset>
  );
}
