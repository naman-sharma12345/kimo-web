import * as React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import {
  afterEach,
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Asset, Clip, KimoProject, Op } from '@kimo/client';
import { applyOps, effectParameterBounds } from '@kimo/client';
import { createEditingSession } from '@/lib/editing/session';
import { testPersistence } from '@/lib/editing/persistence-test-helpers';
import { InspectorEditor } from './inspector-editor';
import { NumericField } from './numeric-field';
import { FieldTransaction } from './transaction';
import {
  animationTime,
  cropValue,
  dbToGain,
  gainToDb,
  hasKey,
  makeTransition,
  reorderEffects,
  safePage,
  toggleKey,
  transitionOps,
  wheelGrade,
  wheelRGB,
  wheelPoint,
  gradeParams,
  effectParams,
  canonicalEffect,
} from './model';
import { scalarOps, scalarValue } from './transform-section';
import { boundedEffectParam } from './colour-section';
import { LevelMeter, meterDb } from './level-meter';
import type { InspectorEditorProps, MeterSample } from './types';
function fixture(): KimoProject {
  const clip: Clip = {
    id: 'c',
    trackId: 'v',
    kind: 'video',
    assetId: 'a',
    start: 2,
    duration: 5,
    in: 0,
    speed: 1,
    volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    effects: [],
    keyframes: [],
  };
  return {
    id: 'p',
    version: 0,
    fps: 30,
    width: 1920,
    height: 1080,
    duration: 7,
    tracks: [
      {
        id: 'v',
        kind: 'video',
        name: 'V1',
        muted: false,
        hidden: false,
        locked: false,
        height: 88,
      },
    ],
    clips: { c: clip },
    markers: [],
  };
}
const asset: Asset = {
  id: 'a',
  kind: 'video',
  name: 'beach_02',
  source: 'user',
  url: '/fixture.mp4',
  durationSec: 20,
};
async function harness(
  project = fixture(),
  assets: readonly Asset[] = [asset],
) {
  let server = structuredClone(project);
  const ops = vi.fn(async (_session: string, group: Op[], version: number) => {
    server = applyOps(server, group, version + 1);
    return { version: server.version };
  });
  const editing = createEditingSession({
    persistence: testPersistence().persistence,
    sessionId: 'session',
    project,
    assets,
    client: {
      ops,
      session: async () => ({
        status: 'editing',
        project: server,
        assets: [...assets],
      }),
    },
  });
  await editing.ready();
  const begin = vi.spyOn(editing, 'beginEdit'),
    preview = vi.spyOn(editing, 'previewEdit'),
    commit = vi.spyOn(editing, 'commitEdit'),
    cancel = vi.spyOn(editing, 'cancelEdit'),
    group = vi.spyOn(editing, 'editGroup');
  const props: InspectorEditorProps = {
    project,
    assets,
    editing,
    editState: editing.getState(),
    selection: ['c'],
    playhead: 3,
  };
  return { editing, ops, begin, preview, commit, cancel, group, props };
}
function live(
  h: Awaited<ReturnType<typeof harness>>,
  extra: Partial<InspectorEditorProps> = {},
) {
  function Live() {
    const [state, setState] = React.useState(h.editing.getState());
    React.useEffect(() => h.editing.subscribe(setState), []);
    return (
      <InspectorEditor
        {...h.props}
        {...extra}
        project={state.project}
        editState={state}
      />
    );
  }
  return render(<Live />);
}
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
  for (const method of [
    'setPointerCapture',
    'releasePointerCapture',
    'hasPointerCapture',
    'scrollIntoView',
  ])
    Object.defineProperty(Element.prototype, method, {
      configurable: true,
      value: vi.fn(),
    });
  // Only real rendering is browser acceptance; jsdom does not own a GPU or canvas.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => vi.useRealTimers());
afterAll(() => vi.unstubAllGlobals());
describe('pure inspector contracts', () => {
  it('dB conversion is reversible and finite at the floor, not a mute estimate', () => {
    for (const db of [-60, -24, -6, 0, 12])
      expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 9);
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(12)).toBeCloseTo(3.9810717);
    expect(gainToDb(0)).toBe(-60);
    expect(gainToDb(NaN)).toBe(-60);
  });
  it('wheel formula preserves neutral and yields chromatic, bounded RGB', () => {
    expect(wheelRGB(0, 0)).toEqual([1, 1, 1]);
    expect(wheelRGB(1, 0)).toEqual([1, 0, 0]);
    expect(wheelGrade(0, 0, 0, -1, 1)).toEqual([0, 0, 0]);
    expect(wheelGrade(0, 0, 1, 0.001, 16)).toEqual([1, 1, 1]);
    const red = wheelGrade(1, 0, 0, -1, 1);
    expect(red[0]).toBeCloseTo(2 / 3);
    expect(red[1]).toBeCloseTo(-1 / 3);
    expect(red[2]).toBeCloseTo(-1 / 3);
    for (const v of wheelGrade(50, -20, 0, -1, 1))
      expect(v).toBeGreaterThanOrEqual(-1);
  });
  it('crop locks actual retained aspect and prevents a zero or negative crop area', () => {
    const clip = fixture().clips.c;
    if (!clip) throw new Error('fixture');
    const crop = cropValue(clip, 'l', 25, true).crop;
    expect(crop?.l).toBe(0.25);
    expect(1 - (crop?.t ?? 0) - (crop?.b ?? 0)).toBeCloseTo(0.75);
    const limited = cropValue(
      {
        ...clip,
        transform: { ...clip.transform, crop: { l: 0, t: 0, r: 0.5, b: 0 } },
      },
      'l',
      99,
      false,
    ).crop;
    expect(limited?.l).toBeCloseTo(0.499);
  });
  it('keyframes use stable split animation time and remove canonical aliases once', () => {
    const clip = fixture().clips.c;
    if (!clip) throw new Error('fixture');
    clip.animationOffsetSec = 7;
    expect(animationTime(clip, 3, 30)).toBe(8);
    const op = toggleKey(clip, 'x', 3, 30);
    if (op.op !== 'clip.update') throw new Error('op');
    expect(op.patch.keyframes?.[0]).toMatchObject({
      property: 'x',
      time: 8,
      value: 0,
    });
    const keyed = {
      ...clip,
      keyframes: [{ property: 'transform.x', time: 8, value: 20 }],
    };
    expect(hasKey(keyed, 'x', 8, 30)).toBe(true);
    expect(toggleKey(keyed, 'x', 3, 30)).toMatchObject({
      patch: { keyframes: [] },
    });
  });
  it('animated scalar edits set one evaluated key rather than changing the unused base', () => {
    const p = fixture(),
      c = p.clips.c;
    if (!c) throw new Error('fixture');
    c.keyframes = [
      { property: 'x', time: 0, value: 0 },
      { property: 'x', time: 2, value: 100 },
    ];
    expect(scalarValue(c, 'x', 3)).toBe(50);
    const ops = scalarOps(p, ['c'], 'x', 70, 3);
    const next = applyOps(p, ops);
    expect(next.clips.c?.transform.x).toBe(0);
    expect(next.clips.c?.keyframes.find((k) => k.time === 1)?.value).toBe(70);
  });
  it('effect reorder keeps disabled state and params; vignette stays valid', () => {
    const effects: Clip['effects'] = [
      { id: 'a', kind: 'blur', params: { radius: 10 }, enabled: false },
      { id: 'b', kind: 'grain', params: { amount: 0.2 }, scope: 'inside_mask' },
    ];
    expect(reorderEffects(effects, 0, 1)).toEqual([effects[1], effects[0]]);
    expect(effects[0]?.id).toBe('a');
    expect(reorderEffects(effects, -1, 2)).toEqual(effects);
    const params = boundedEffectParam(
      { id: 'e', kind: 'vignette', params: { inner: 0.4, outer: 1 } },
      'inner',
      1.5,
    );
    expect(params.inner).toBeCloseTo(0.999999);
  });
  it('transition duration frames and seconds always agree and update actual adjacent cut', () => {
    const p = fixture(),
      c = p.clips.c;
    if (!c) throw new Error('fixture');
    p.clips.next = { ...c, id: 'next', start: 7 };
    const t = makeTransition(
      { kind: 'slide', duration: 0.4 },
      { durationFrames: 15, direction: 'right' },
      30,
    );
    expect(t).toEqual({
      kind: 'slide',
      duration: 0.5,
      durationFrames: 15,
      direction: 'right',
    });
    const ops = transitionOps(p, c, 'transitionOut', t);
    expect(ops).toHaveLength(2);
    expect(ops[1]).toMatchObject({ id: 'next', patch: { transitionIn: t } });
    p.clips.next.locked = true;
    expect(() => transitionOps(p, c, 'transitionOut', t)).toThrow('locked');
  });
  it('attribution only allows http(s)', () => {
    expect(safePage('javascript:alert(1)')).toBeUndefined();
    expect(safePage('https://example.org/page')).toBe(
      'https://example.org/page',
    );
  });
});
describe('transaction and numeric controls', () => {
  it('previews replace begin baseline, commits once and cancellation sends nothing', async () => {
    const h = await harness(),
      tx = new FieldTransaction(h.editing, ['c'], 'x');
    const build =
      (n: number) =>
      (p: KimoProject): Op[] => [
        {
          op: 'clip.update',
          id: 'c',
          patch: {
            transform: {
              ...(p.clips.c?.transform ?? {
                x: 0,
                y: 0,
                scale: 1,
                rotation: 0,
                opacity: 1,
              }),
              x: n,
            },
          },
        },
      ];
    tx.preview(build(5));
    tx.preview(build(8));
    expect(h.ops).not.toHaveBeenCalled();
    await tx.commit();
    await tx.commit();
    expect(h.ops).toHaveBeenCalledTimes(1);
    expect(h.commit).toHaveBeenCalledTimes(1);
    const next = new FieldTransaction(h.editing, ['c'], 'y');
    next.preview(build(20));
    next.cancel();
    expect(h.ops).toHaveBeenCalledTimes(1);
    expect(h.editing.getState().project.clips.c?.transform.x).toBe(8);
  });
  it('typing, clamping, Enter/blur and reset each produce one group', async () => {
    const h = await harness();
    render(
      <NumericField
        label="scale"
        unit="%"
        value={100}
        baseline={100}
        min={1}
        max={400}
        editing={h.editing}
        clipIds={['c']}
        build={(n, p) => [
          {
            op: 'clip.update',
            id: 'c',
            patch: {
              transform: {
                ...(p.clips.c?.transform ?? {
                  x: 0,
                  y: 0,
                  scale: 1,
                  rotation: 0,
                  opacity: 1,
                }),
                scale: n / 100,
              },
            },
          },
        ]}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'scale' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '900' } });
    expect(input).toHaveValue('400');
    expect(h.ops).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(1));
    expect(h.ops.mock.calls[0]?.[1]).toMatchObject([
      { patch: { transform: { scale: 4 } } },
    ]);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.blur(input);
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(2));
  });
  it('arrows are ±1 and shift ±10, Escape cancels and canonical reset is exact', async () => {
    const p = fixture();
    if (p.clips.c) p.clips.c.transform.x = 25;
    const h = await harness(p);
    render(
      <NumericField
        label="position X"
        value={25}
        baseline={0}
        unit="px"
        editing={h.editing}
        clipIds={['c']}
        build={(n) => [
          {
            op: 'clip.update',
            id: 'c',
            patch: {
              transform: { x: n, y: 0, scale: 1, rotation: 0, opacity: 1 },
            },
          },
        ]}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'position X' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    expect(input).toHaveValue('35');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveValue('34');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(h.ops).not.toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'reset position X' }));
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(1));
    expect(h.ops.mock.calls[0]?.[1]).toMatchObject([
      { patch: { transform: { x: 0 } } },
    ]);
  });
});
describe('inspector integration', () => {
  it('shows project only without selection; aspect cancel sends none, confirm one real group and callback', async () => {
    const h = await harness(),
      reframe = vi.fn();
    live(h, { selection: [], onReframeRequest: reframe });
    expect(screen.getByRole('button', { name: 'Project' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Transform' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'aspect' }), {
      target: { value: '9:16' },
    });
    expect(
      screen.getByText('change the frame? kimo will reframe every clip.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(h.group).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'aspect' }), {
      target: { value: '1:1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'change frame' }));
    await waitFor(() =>
      expect(reframe).toHaveBeenCalledWith({ width: 1080, height: 1080 }),
    );
    expect(h.group).toHaveBeenCalledTimes(1);
    expect(h.ops.mock.calls[0]?.[1]).toEqual([
      { op: 'project.update', patch: { width: 1080, height: 1080 } },
    ]);
  });
  it('retains one baseline through real project notes debounce and no duplicate blur commit', async () => {
    const h = await harness();
    vi.useFakeTimers();
    live(h, { selection: [] });
    const input = screen.getByRole('textbox', {
      name: 'project notes for kimo',
    });
    fireEvent.change(input, { target: { value: 'Keep the title.' } });
    expect(h.preview).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(149));
    expect(h.preview).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(h.ops).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(650);
    });
    expect(h.commit).toHaveBeenCalledTimes(1);
    fireEvent.blur(input);
    expect(h.commit).toHaveBeenCalledTimes(1);
  });
  it('speed presets/custom and keep pitch write actual typed fields', async () => {
    const h = await harness();
    live(h);
    fireEvent.click(screen.getByRole('radio', { name: '1.5×' }));
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(1));
    expect(h.editing.getState().project.clips.c?.speed).toBe(1.5);
    fireEvent.click(screen.getByRole('switch', { name: 'keep pitch' }));
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(2));
    expect(h.editing.getState().project.clips.c?.keepPitch).toBe(false);
  });
  it('missing compare, named LUT, meter hooks are clearly unavailable, not fabricated', async () => {
    const h = await harness();
    live(h);
    expect(screen.getByRole('button', { name: 'before/after' })).toBeDisabled();
    expect(
      screen.getByText(/Identity is not a named look/),
    ).toBeInTheDocument();
    const meter = screen.getByRole('meter', { name: 'master output level' });
    expect(meter).toHaveAttribute('aria-valuetext', 'unavailable');
    expect(meter.querySelectorAll('[data-lit="true"]')).toHaveLength(0);
    expect(
      within(screen.getByRole('combobox', { name: 'LUT' })).getByRole(
        'option',
        { name: 'warm film' },
      ),
    ).toBeDisabled();
  });
  it('uses actual LUT asset IDs, supports removing unsupported current LUT', async () => {
    const p = fixture(),
      c = p.clips.c;
    if (!c) throw new Error('fixture');
    c.effects = [{ id: 'old', kind: 'lut', params: { lutAssetId: 'unknown' } }];
    const lut: Asset = {
      id: 'warm-original',
      kind: 'image',
      name: 'original LUT',
      url: '/actual.png',
      source: 'user',
      lut: { size: 64, layout: 'tiles_8x8', colorSpace: 'srgb' },
    };
    const h = await harness(p, [asset, lut]);
    live(h, { lutAssets: { 'warm film': 'warm-original' } });
    const select = screen.getByRole('combobox', { name: 'LUT' });
    expect(select).toHaveValue('unsupported');
    fireEvent.change(select, { target: { value: 'warm film' } });
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(1));
    expect(
      h.editing.getState().project.clips.c?.effects.at(-1)?.params.lutAssetId,
    ).toBe('warm-original');
    fireEvent.change(select, { target: { value: 'none' } });
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(2));
    expect(h.editing.getState().project.clips.c?.effects).toEqual([]);
  });
  it('SAM sends exact message only through callback; no mask subject invented', async () => {
    const h = await harness(),
      message = vi.fn();
    live(h, {
      onMessage: message,
      maskPreview: {
        clipId: 'c',
        subjectLabel: 'cyclist',
        cutoutUrl: '/real-cutout.png',
      },
    });
    expect(
      screen.getByRole('img', { name: 'cyclist mask cutout' }),
    ).toHaveAttribute('src', '/real-cutout.png');
    fireEvent.change(
      screen.getByRole('textbox', {
        name: 're-segment: describe what to select',
      }),
      { target: { value: 'the red bicycle' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'run sam' }));
    await waitFor(() =>
      expect(message).toHaveBeenCalledWith(
        'use sam 3.1 to select "the red bicycle" on beach_02',
        'c',
      ),
    );
    expect(h.ops).not.toHaveBeenCalled();
  });
  it('effect eye and keyboard reorder preserve list order/params', async () => {
    const p = fixture(),
      c = p.clips.c;
    if (!c) throw new Error('fixture');
    c.effects = [
      { id: 'blur1', kind: 'blur', params: { radius: 10 } },
      { id: 'grain1', kind: 'grain', params: { amount: 0.3 } },
    ];
    const h = await harness(p);
    live(h);
    fireEvent.click(screen.getByRole('button', { name: 'disable blur' }));
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(1));
    expect(h.editing.getState().project.clips.c?.effects[0]?.enabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'move blur down' }));
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(2));
    expect(
      h.editing.getState().project.clips.c?.effects.map((e) => e.id),
    ).toEqual(['grain1', 'blur1']);
    expect(h.editing.getState().project.clips.c?.effects[1]).toMatchObject({
      enabled: false,
      params: { radius: 10 },
    });
  });
  it('locked clips guard controls, multi selection changes all transforms in one batch', async () => {
    const p = fixture(),
      c = p.clips.c;
    if (!c) throw new Error('fixture');
    p.clips.other = { ...c, id: 'other', start: 8 };
    const h = await harness(p);
    live(h, { selection: ['c', 'other'] });
    const input = screen.getByRole('textbox', { name: 'position X' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '77' } });
    fireEvent.blur(input);
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(1));
    expect(h.ops.mock.calls[0]?.[1]).toHaveLength(2);
    expect(h.editing.getState().project.clips.other?.transform.x).toBe(77);
  });
  it('one running property owns orange styling in a panel', async () => {
    const h = await harness();
    live(h, {
      propertyActivity: [
        {
          clipId: 'c',
          property: 'transform.x',
          actionId: 'action',
          running: true,
        },
        {
          clipId: 'c',
          property: 'transform.y',
          actionId: 'action',
          running: true,
        },
      ],
    });
    expect(document.querySelectorAll('[data-acting="true"]')).toHaveLength(1);
  });
  it('collapse persistence is project-scoped local convenience only; mask callback resets on unmount', async () => {
    const h = await harness(),
      onMaskOpen = vi.fn(),
      storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const view = live(h, { onMaskOpen, storage });
    fireEvent.click(screen.getByRole('button', { name: 'Mask' }));
    expect(storage.setItem).toHaveBeenCalledWith(
      'kimo:inspector:v1:p:Mask',
      'closed',
    );
    expect(onMaskOpen).toHaveBeenLastCalledWith(false);
    view.unmount();
    expect(onMaskOpen).toHaveBeenLastCalledWith(false);
    expect(h.ops).not.toHaveBeenCalled();
  });
});
describe('real injected meter', () => {
  it('uses real samples, warning strictly above -6, error at 0, resets stopped output', () => {
    let sample: MeterSample = { playing: true, channels: [0.5, 0.1] },
      listener: () => void = () => {};
    const unsubscribe = vi.fn();
    const api = {
      available: true as const,
      measure: vi.fn(() => sample),
      subscribe: vi.fn((fn: () => void) => {
        listener = fn;
        return unsubscribe;
      }),
    };
    const view = render(<LevelMeter api={api} clipId="c" />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuetext', '-6.0 dB');
    expect(meter.querySelector('[data-lit="true"]')).toHaveAttribute(
      'data-zone',
      'normal',
    );
    sample = { playing: true, channels: [0.75] };
    act(listener);
    expect(
      meter.querySelector('[data-lit="true"][data-zone="warning"]'),
    ).not.toBeNull();
    expect(meter.querySelector('[data-lit="true"]')).toHaveAttribute(
      'data-zone',
      'normal',
    );
    sample = { playing: true, channels: [1] };
    act(listener);
    expect(
      meter.querySelector('[data-lit="true"][data-zone="error"]'),
    ).not.toBeNull();
    sample = { playing: false, channels: [1] };
    act(listener);
    expect(meter).toHaveAttribute('aria-valuetext', 'silent');
    expect(meter.querySelectorAll('[data-lit="true"]')).toHaveLength(0);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
  it('ignores invalid channels, zero is actual silence, no guessed gain levels', () => {
    expect(meterDb({ playing: true, channels: [0, NaN, -1, Infinity] })).toBe(
      -Infinity,
    );
    expect(meterDb({ playing: true, channels: [0.01] })).toBeCloseTo(-40);
    expect(meterDb({ playing: false, channels: [1] })).toBe(-Infinity);
  });
});
function sendPointer(
  target: HTMLElement,
  type: string,
  x: number,
  shiftKey = false,
) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    clientX: x,
    button: 0,
    shiftKey,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}
describe('inspector additional edge cases', () => {
  it('scrubs at 8px per unit, shift 10x, sends only on release and cancels lost capture', async () => {
    const h = await harness();
    vi.useFakeTimers();
    render(
      <NumericField
        label="drag value"
        value={0}
        baseline={0}
        editing={h.editing}
        clipIds={['c']}
        build={(n) => [
          {
            op: 'clip.update',
            id: 'c',
            patch: {
              transform: { x: n, y: 0, scale: 1, rotation: 0, opacity: 1 },
            },
          },
        ]}
      />,
    );
    const label = screen.getByRole('button', { name: 'scrub drag value' });
    sendPointer(label, 'pointerdown', 0);
    sendPointer(label, 'pointermove', 8);
    act(() => vi.advanceTimersByTime(32));
    expect(screen.getByRole('textbox', { name: 'drag value' })).toHaveValue(
      '1',
    );
    expect(h.ops).not.toHaveBeenCalled();
    sendPointer(label, 'pointermove', 16, true);
    sendPointer(label, 'pointerup', 16, true);
    await act(async () => {});
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.ops.mock.calls[0]?.[1]).toMatchObject([
      { patch: { transform: { x: 20 } } },
    ]);
    sendPointer(label, 'pointerdown', 0);
    sendPointer(label, 'pointermove', 80);
    sendPointer(label, 'lostpointercapture', 80);
    act(() => vi.advanceTimersByTime(32));
    expect(h.cancel).toHaveBeenCalled();
    expect(h.ops).toHaveBeenCalledTimes(1);
  });
  it('invalid numeric blur abandons the whole edit instead of sending stale intermediate input', async () => {
    const h = await harness();
    render(
      <NumericField
        label="finite"
        value={0}
        baseline={0}
        editing={h.editing}
        clipIds={['c']}
        build={(n) => [{ op: 'clip.update', id: 'c', patch: { volume: n } }]}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'finite' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.change(input, { target: { value: 'not a number' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.blur(input);
    expect(h.ops).not.toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalledTimes(1);
  });
  it('clip and track locks prevent numeric edits and preserve current project', async () => {
    const p = fixture(),
      c = p.clips.c;
    if (!c) throw new Error('fixture');
    c.locked = true;
    const h = await harness(p);
    live(h);
    expect(screen.getByRole('textbox', { name: 'position X' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'keep pitch' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'add effect' })).toBeDisabled();
    expect(h.ops).not.toHaveBeenCalled();
  });
  it('text exposes exactly eight canonical styles, five animations and real colour/alignment/position fields', async () => {
    const p = fixture(),
      c = p.clips.c;
    if (!c) throw new Error('fixture');
    c.kind = 'text';
    p.tracks = p.tracks.map((t) => ({ ...t, kind: 'text', height: 48 }));
    delete c.assetId;
    c.text = {
      content: 'hello',
      secondaryContent: 'world',
      style: 'lower_third',
    };
    const h = await harness(p);
    live(h);
    expect(
      within(screen.getByRole('combobox', { name: 'text style' })).getAllByRole(
        'option',
      ),
    ).toHaveLength(8);
    expect(screen.getByRole('combobox', { name: 'text style' })).toHaveValue(
      'lower-third',
    );
    expect(
      within(screen.getByRole('combobox', { name: 'animation' })).getAllByRole(
        'option',
      ),
    ).toHaveLength(5);
    fireEvent.change(screen.getByRole('combobox', { name: 'text style' }), {
      target: { value: 'title-bold' },
    });
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(1));
    expect(h.editing.getState().project.clips.c?.text).toMatchObject({
      style: 'title-bold',
      content: 'hello',
      secondaryContent: 'world',
    });
    fireEvent.click(screen.getByRole('button', { name: 'yellow text colour' }));
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(2));
    expect(h.editing.getState().project.clips.c?.text?.color).toEqual([
      1,
      216 / 255,
      77 / 255,
      1,
    ]);
    fireEvent.change(screen.getByRole('combobox', { name: 'animation' }), {
      target: { value: 'pop words' },
    });
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(3));
    expect(h.editing.getState().project.clips.c?.text?.animation).toBe(
      'pop words',
    );
  });
  it('custom content colour picker previews repeatedly and commits one group, Escape cancels', async () => {
    const p = fixture(),
      c = p.clips.c;
    if (!c) throw new Error('fixture');
    c.kind = 'text';
    p.tracks = p.tracks.map((t) => ({ ...t, kind: 'text', height: 48 }));
    delete c.assetId;
    c.text = { content: 'hello', style: 'caption-clean' };
    const h = await harness(p);
    live(h);
    const picker = screen.getByLabelText('custom text colour');
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: '#' + '123456' } });
    fireEvent.change(picker, { target: { value: '#' + '345678' } });
    expect(h.ops).not.toHaveBeenCalled();
    fireEvent.blur(picker);
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(1));
    expect(h.editing.getState().project.clips.c?.text?.color).toEqual([
      52 / 255,
      86 / 255,
      120 / 255,
      1,
    ]);
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: '#' + 'abcdef' } });
    fireEvent.keyDown(picker, { key: 'Escape' });
    fireEvent.blur(picker);
    expect(h.ops).toHaveBeenCalledTimes(1);
  });
  it('source displays actual attribution, safe link/licence/thumbnail and injected replace modes', async () => {
    const p = fixture(),
      c = p.clips.c;
    if (!c) throw new Error('fixture');
    c.kind = 'image';
    const source: Asset = {
      ...asset,
      kind: 'image',
      source: 'web',
      thumbUrl: '/actual-thumb.jpg',
      width: 1000,
      height: 600,
      attribution: {
        site: 'museum.example',
        pageUrl: 'https://museum.example/work',
        license: 'CC BY 4.0',
      },
    };
    const h = await harness(p, [source]),
      replace = vi.fn();
    live(h, { onReplace: replace });
    expect(screen.getByText('found on museum.example')).toBeInTheDocument();
    expect(screen.getByText('CC BY 4.0')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'open page' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(screen.getByRole('link', { name: 'open page' })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(screen.getByRole('img', { name: 'beach_02' })).toHaveAttribute(
      'src',
      '/actual-thumb.jpg',
    );
    fireEvent.click(screen.getByRole('button', { name: 'replace image' }));
    fireEvent.click(screen.getByRole('button', { name: 'upload my own' }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
    expect(replace.mock.calls).toEqual([
      ['c', 'search'],
      ['c', 'upload'],
    ]);
    expect(h.ops).not.toHaveBeenCalled();
  });
  it('compare button delegates actual viewer toggle without changing project ops', async () => {
    const h = await harness(),
      onChange = vi.fn();
    live(h, { compare: { available: true, enabled: false, onChange } });
    fireEvent.click(screen.getByRole('button', { name: 'before/after' }));
    expect(onChange).toHaveBeenCalledWith(true, 'c');
    expect(h.ops).not.toHaveBeenCalled();
  });
  it('clears an unsupported LUT embedded in grade without destroying exposure or grade order', async () => {
    const p = fixture(),
      c = p.clips.c;
    if (!c) throw new Error('fixture');
    c.effects = [
      {
        id: 'grade1',
        kind: 'grade',
        params: { exposure: 2, lutAssetId: 'identity' },
      },
    ];
    const h = await harness(p);
    live(h);
    expect(screen.getByRole('combobox', { name: 'LUT' })).toHaveValue(
      'unsupported',
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'LUT' }), {
      target: { value: 'none' },
    });
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(1));
    expect(h.editing.getState().project.clips.c?.effects).toEqual([
      { id: 'grade1', kind: 'grade', params: { exposure: 2 } },
    ]);
  });
  it('crop aspect lock refuses expansion outside the source while retaining the chosen aspect', () => {
    const clip = fixture().clips.c;
    if (!clip) throw new Error('fixture');
    clip.transform.crop = { l: 0.25, r: 0, t: 0, b: 0 };
    const crop = cropValue(clip, 'l', 0, true).crop;
    expect(crop?.l).toBeCloseTo(0.25);
    expect(crop?.t).toBe(0);
    expect(crop?.b).toBe(0);
  });
  it('numeric audio edits convert dB to linear gain, fades clamp to clip duration and duck is typed', async () => {
    const h = await harness();
    live(h);
    const volume = screen.getByRole('textbox', { name: 'volume' });
    fireEvent.focus(volume);
    fireEvent.change(volume, { target: { value: '6' } });
    fireEvent.blur(volume);
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(1));
    expect(h.editing.getState().project.clips.c?.volume).toBeCloseTo(10 ** 0.3);
    const fade = screen.getByRole('textbox', { name: 'fade in' });
    fireEvent.focus(fade);
    fireEvent.change(fade, { target: { value: '99' } });
    fireEvent.blur(fade);
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(2));
    expect(h.editing.getState().project.clips.c?.fadeInSec).toBe(5);
    fireEvent.click(screen.getByRole('switch', { name: 'duck under voice' }));
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(3));
    expect(h.editing.getState().project.clips.c?.duckUnderVoice).toBe(true);
  });
  it('mask preview checker references its own 8px pattern and callback closes on selection removal', async () => {
    const h = await harness(),
      onMaskOpen = vi.fn();
    const view = render(
      <InspectorEditor {...h.props} onMaskOpen={onMaskOpen} />,
    );
    const pattern = document.querySelector('pattern'),
      rect = document.querySelector('svg rect[fill^="url"]');
    expect(pattern?.getAttribute('width')).toBe('16');
    expect(pattern?.querySelector('path')?.getAttribute('d')).toContain('h8v8');
    expect(rect?.getAttribute('fill')).toBe(`url(#${pattern?.id})`);
    view.rerender(
      <InspectorEditor {...h.props} selection={[]} onMaskOpen={onMaskOpen} />,
    );
    expect(onMaskOpen).toHaveBeenLastCalledWith(false);
  });
  it('meter subscription failure is explicit and silent rather than crashing or inventing levels', () => {
    render(
      <LevelMeter
        clipId="c"
        api={{
          available: true,
          measure: () => ({ playing: true, channels: [1] }),
          subscribe: () => {
            throw new Error('disconnected');
          },
        }}
      />,
    );
    expect(screen.getByRole('meter')).toHaveAttribute(
      'aria-valuetext',
      'unavailable',
    );
    expect(
      screen.getByRole('meter').querySelectorAll('[data-lit="true"]'),
    ).toHaveLength(0);
    expect(
      screen.getByText('Live output subscription is unavailable.'),
    ).toBeInTheDocument();
  });
});

describe('final field contracts', () => {
  it('wheel marker inverts chromatic coordinates and core bounds own every known parameter range', () => {
    for (const [x, y] of [
      [0, 0],
      [0.3, 0.4],
      [-0.4, -0.5],
      [1, 0],
    ] as const) {
      const point = wheelPoint(wheelGrade(x, y, 1, 0.001, 16));
      expect(point[0]).toBeCloseTo(x);
      expect(point[1]).toBeCloseTo(y);
    }
    for (const param of gradeParams)
      expect([param.min, param.max]).toEqual(
        effectParameterBounds.grade?.[param.key],
      );
    for (const [kind, params] of Object.entries(effectParams))
      for (const param of params) {
        const range = effectParameterBounds[kind]?.[param.key];
        if (range) {
          expect(param.min).toBeGreaterThanOrEqual(range[0]);
          expect(param.max).toBeLessThanOrEqual(range[1]);
        }
      }
    expect(canonicalEffect('gaussian_blur')).toBe('blur');
    expect(canonicalEffect('film_grain')).toBe('grain');
    expect(canonicalEffect('black_and_white')).toBe('black_white');
  });
  it('dragging an effect row produces a real ordered patch, preserving disabled params', async () => {
    const p = fixture(),
      clip = p.clips.c;
    if (!clip) throw new Error('fixture');
    clip.effects = [
      { id: 'e1', kind: 'blur', params: { radius: 8 }, enabled: false },
      { id: 'e2', kind: 'grain', params: { amount: 0.2 } },
    ];
    const h = await harness(p);
    live(h);
    const source = screen.getByRole('button', { name: 'drag blur' }),
      target = screen.getByRole('button', { name: 'drag grain' }).closest('li');
    if (!target) throw new Error('missing drop row');
    const transfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireEvent.dragOver(target, { dataTransfer: transfer });
    fireEvent.drop(target, { dataTransfer: transfer });
    await waitFor(() => expect(h.ops).toHaveBeenCalledTimes(1));
    expect(
      h.editing.getState().project.clips.c?.effects.map((e) => e.id),
    ).toEqual(['e2', 'e1']);
    expect(h.editing.getState().project.clips.c?.effects[1]).toMatchObject({
      enabled: false,
      params: { radius: 8 },
    });
  });
  it('a centred title reports middle placement rather than pretending it is at bottom', async () => {
    const p = fixture(),
      c = p.clips.c;
    if (!c) throw new Error('fixture');
    c.kind = 'text';
    delete c.assetId;
    c.text = { content: 'title', style: 'title-serif' };
    p.tracks = p.tracks.map((t) => ({ ...t, kind: 'text', height: 48 }));
    const h = await harness(p);
    live(h);
    expect(screen.getByRole('radio', { name: 'middle' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
  it('text style action property owns one orange treatment and clears when the action ends', async () => {
    const p = fixture(),
      c = p.clips.c;
    if (!c) throw new Error('fixture');
    c.kind = 'text';
    delete c.assetId;
    c.text = { content: 'title', style: 'title-serif' };
    p.tracks = p.tracks.map((t) => ({ ...t, kind: 'text', height: 48 }));
    const h = await harness(p);
    const activity = [
      {
        clipId: 'c',
        property: 'text.style',
        actionId: 'real-action',
        running: true,
      },
      {
        clipId: 'c',
        property: 'text.fontSize',
        actionId: 'real-action',
        running: true,
      },
    ];
    const view = render(
      <InspectorEditor {...h.props} propertyActivity={activity} />,
    );
    expect(document.querySelectorAll('[data-acting="true"]')).toHaveLength(1);
    expect(
      screen
        .getByRole('combobox', { name: 'text style' })
        .closest('[data-acting]'),
    ).toHaveAttribute('data-acting', 'true');
    view.rerender(
      <InspectorEditor
        {...h.props}
        propertyActivity={activity.map((a) => ({ ...a, running: false }))}
      />,
    );
    expect(document.querySelectorAll('[data-acting="true"]')).toHaveLength(0);
  });
  it('project notes IME does not preview or commit until composition ends; Escape discards', async () => {
    const h = await harness();
    vi.useFakeTimers();
    live(h, { selection: [] });
    const input = screen.getByRole('textbox', {
      name: 'project notes for kimo',
    });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'タイトル' } });
    act(() => vi.advanceTimersByTime(1000));
    expect(h.preview).not.toHaveBeenCalled();
    expect(h.ops).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    act(() => vi.advanceTimersByTime(150));
    expect(h.preview).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(1000));
    expect(h.ops).not.toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalledTimes(1);
  });
  it('unmount cancels an active numeric draft and never sends an edit after cleanup', async () => {
    const h = await harness();
    const view = render(
      <NumericField
        label="cleanup"
        value={0}
        baseline={0}
        editing={h.editing}
        clipIds={['c']}
        build={(n) => [{ op: 'clip.update', id: 'c', patch: { volume: n } }]}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'cleanup' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '2' } });
    view.unmount();
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(h.ops).not.toHaveBeenCalled();
  });
});
function textFixture(
  style: NonNullable<Clip['text']>['style'] = 'lower-third',
) {
  const p = fixture(),
    c = p.clips.c;
  if (!c) throw new Error('fixture');
  c.kind = 'text';
  delete c.assetId;
  c.text = {
    style,
    content: 'first line',
    secondaryContent: 'second line',
    words: [
      { t: 0, d: 2.5, w: 'first' },
      { t: 2.5, d: 2.5, w: 'line' },
    ],
  };
  p.tracks = p.tracks.map((t) => ({ ...t, kind: 'text', height: 48 }));
  return p;
}
describe('actual writer-owned text bridge', () => {
  it('primary and secondary fields share one real text.update group with preserved word timings', async () => {
    const h = await harness(textFixture());
    vi.useFakeTimers();
    live(h);
    const primary = screen.getByRole('textbox', { name: 'text content' }),
      secondary = screen.getByRole('textbox', { name: 'secondary text' });
    expect(primary).toHaveValue('first line');
    expect(secondary).toHaveValue('second line');
    fireEvent.focus(primary);
    fireEvent.change(primary, { target: { value: 'edited line' } });
    fireEvent.blur(primary, { relatedTarget: secondary });
    fireEvent.focus(secondary);
    fireEvent.change(secondary, { target: { value: 'new second line' } });
    expect(h.ops).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(150));
    expect(h.preview).toHaveBeenCalled();
    fireEvent.blur(secondary);
    await act(async () => {});
    expect(h.ops).toHaveBeenCalledTimes(1);
    expect(h.ops.mock.calls[0]?.[1]).toEqual([
      {
        op: 'text.update',
        clipId: 'c',
        content: 'edited line',
        secondaryContent: 'new second line',
        words: [
          { t: 0, d: 2.5, w: 'edited' },
          { t: 2.5, d: 2.5, w: 'line' },
        ],
      },
    ]);
  });
  it('dedicated caption mode imports real controls and uses actual parent seek', async () => {
    const h = await harness(textFixture('caption-clean')),
      seek = vi.fn();
    live(h, { captionTrackId: 'v', onSeek: seek });
    expect(
      screen.getByRole('region', { name: 'captions editor' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Project' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'find & replace' }),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole('combobox', { name: 'caption style' }),
      ).getAllByRole('option'),
    ).toHaveLength(3);
    fireEvent.click(
      screen.getByRole('button', { name: 'seek to caption 00:02:00' }),
    );
    expect(seek).toHaveBeenCalledWith(2);
  });
  it('caption mode without a real seek hook is explicitly unavailable, never a dummy callback', async () => {
    const h = await harness(textFixture('caption-clean'));
    live(h, { captionTrackId: 'v', onSeek: undefined });
    expect(
      screen.getByText(
        'Caption editing requires the parent preview seek callback.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'captions editor' }),
    ).not.toBeInTheDocument();
  });
  it('track-lock fieldset also guards actual imported text inputs', async () => {
    const p = textFixture();
    p.tracks = p.tracks.map((t) => ({ ...t, locked: true }));
    const h = await harness(p);
    live(h);
    expect(
      screen.getByRole('textbox', { name: 'text content' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('textbox', { name: 'secondary text' }),
    ).toBeDisabled();
    expect(h.ops).not.toHaveBeenCalled();
  });
});
describe('readout and drag cancellation isolation', () => {
  it('reduced-motion AI readout updates without creating any user edit or network write', async () => {
    const h = await harness();
    const build = (n: number): Op[] => [
      { op: 'clip.update', id: 'c', patch: { volume: n } },
    ];
    const view = render(
      <NumericField
        label="AI value"
        value={0}
        baseline={0}
        acting={false}
        editing={h.editing}
        clipIds={['c']}
        build={build}
      />,
    );
    view.rerender(
      <NumericField
        label="AI value"
        value={40}
        baseline={0}
        acting
        editing={h.editing}
        clipIds={['c']}
        build={build}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'AI value' })).toHaveValue('40');
    expect(h.begin).not.toHaveBeenCalled();
    expect(h.preview).not.toHaveBeenCalled();
    expect(h.ops).not.toHaveBeenCalled();
  });
  it('effect drag soft-lock preview cancels cleanly on dragend without drop', async () => {
    const p = fixture(),
      clip = p.clips.c;
    if (!clip) throw new Error('fixture');
    clip.effects = [
      { id: 'e1', kind: 'blur', params: { radius: 8 } },
      { id: 'e2', kind: 'grain', params: { amount: 0.2 } },
    ];
    const h = await harness(p);
    live(h);
    const source = screen.getByRole('button', { name: 'drag blur' }),
      target = screen.getByRole('button', { name: 'drag grain' }).closest('li');
    if (!target) throw new Error('missing row');
    const transfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(source, { dataTransfer: transfer });
    fireEvent.dragOver(target, { dataTransfer: transfer });
    expect(h.begin).toHaveBeenCalledTimes(1);
    expect(h.preview).toHaveBeenCalled();
    expect(h.ops).not.toHaveBeenCalled();
    fireEvent.dragEnd(source, { dataTransfer: transfer });
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(h.commit).not.toHaveBeenCalled();
    expect(
      h.editing.getState().project.clips.c?.effects.map((e) => e.id),
    ).toEqual(['e1', 'e2']);
  });
});

describe('parent audio capability injection', () => {
  it('disables unsupported pitch preservation without claiming a buffered audio transform', async () => {
    const h = await harness();
    live(h, {
      audioCapabilities: () => ({
        keepPitch: false,
        reason: 'buffered pitch preservation is unavailable',
      }),
    });
    expect(screen.getByRole('switch', { name: 'keep pitch' })).toBeDisabled();
    expect(
      screen.getByText('buffered pitch preservation is unavailable'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'keep pitch' }));
    expect(h.ops).not.toHaveBeenCalled();
  });
});
