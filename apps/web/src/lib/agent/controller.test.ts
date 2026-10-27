import { describe, expect, it, vi } from 'vitest';
import { createAgentController, type AgentTransport } from './controller';
function setup(acting = false) {
  const transport: AgentTransport = {
    acting: () => acting,
    assets: () => [],
    send: vi.fn(() => true),
    message: vi.fn(async () => {}),
    now: () => 100,
    userSent: vi.fn(),
    intent: vi.fn(),
  };
  return {
    transport,
    controller: createAgentController({ sessionId: 's' }, transport),
  };
}
describe('single Shell transport agent controller', () => {
  it('uses one interrupt path and only the exact reading status acknowledges it', async () => {
    const { controller, transport } = setup(true);
    await controller.send({ text: 'shorter please' });
    expect(transport.send).toHaveBeenCalledWith({
      t: 'interrupt',
      text: 'shorter please',
    });
    expect(transport.message).not.toHaveBeenCalled();
    controller.receive({
      t: 'agent.status',
      state: 'thinking',
      label: 'planning',
    });
    expect(controller.getSnapshot().items[0]).toMatchObject({
      interrupt: 'pending',
    });
    await expect(controller.send({ text: 'second' })).rejects.toThrow(
      'previous note',
    );
    controller.receive({
      t: 'agent.status',
      state: 'thinking',
      label: 'reading your note',
    });
    expect(controller.getSnapshot().items[0]).toMatchObject({
      interrupt: 'read',
    });
  });
  it('does not infer safe replay from HTTP uncertainty', async () => {
    const { controller, transport } = setup();
    vi.mocked(transport.message).mockRejectedValueOnce(
      new Error('network lost'),
    );
    await expect(controller.send({ text: 'note' })).rejects.toThrow(
      'network lost',
    );
    expect(controller.getSnapshot().items[0]).toMatchObject({
      delivery: 'unknown',
    });
    expect(transport.message).toHaveBeenCalledTimes(1);
  });
  it('hard stop never toggles into resume and failed dispatch is not success', () => {
    const { controller, transport } = setup(true);
    controller.pause(true);
    controller.pause(true);
    expect(transport.send).toHaveBeenNthCalledWith(1, { t: 'pause' });
    expect(transport.send).toHaveBeenNthCalledWith(2, { t: 'pause' });
    expect(controller.getSnapshot().items[0]).toMatchObject({
      text: 'you stopped kimo',
    });
    vi.mocked(transport.send).mockReturnValue(false);
    expect(() => controller.pause()).toThrow('not dispatched');
    expect(controller.getSnapshot().items).toHaveLength(2);
  });
  it('keeps confirmed attachments in chat without a duplicate association call', async () => {
    const { controller } = setup();
    await expect(
      controller.send({ text: 'note', attachmentIds: ['missing'] }),
    ).rejects.toThrow('confirmation');
    expect(controller.getSnapshot().items).toHaveLength(0);
  });
  it('does not publish late HTTP completion after disposal', async () => {
    const { controller, transport } = setup();
    let resolve = () => {};
    vi.mocked(transport.message).mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const listener = vi.fn();
    controller.subscribe(listener);
    const send = controller.send({ text: 'note' });
    controller.dispose();
    resolve();
    await send;
    expect(listener).toHaveBeenCalledTimes(1);
    expect(transport.userSent).not.toHaveBeenCalled();
  });
});

it('lets a known-undispatched interrupt recover without poisoning the next ACK identity', async () => {
  const { controller, transport } = setup(true);
  vi.mocked(transport.send).mockReturnValueOnce(false);
  await expect(controller.send({ text: 'not sent' })).rejects.toThrow(
    'not dispatched',
  );
  await controller.send({ text: 'sent once' });
  controller.receive({
    t: 'agent.status',
    state: 'thinking',
    label: 'reading your note',
  });
  expect(controller.getSnapshot().items[0]).toMatchObject({
    delivery: 'failed',
    interrupt: undefined,
  });
  expect(controller.getSnapshot().items[1]).toMatchObject({
    delivery: 'accepted',
    interrupt: 'read',
  });
});

describe('authoritative presentation restore', () => {
  const start = {
    t: 'agent.action.start',
    id: 'actual-a',
    tool: 'trim',
    title: 'recorded trim',
    args: {},
  } as const;
  const end = {
    t: 'agent.action.end',
    id: 'actual-a',
    ok: true,
    durationMs: 12,
    resultSummary: 'recorded result',
  } as const;
  const review = {
    t: 'agent.message',
    id: 'review',
    role: 'agent',
    kind: 'ask_review',
    text: 'review this',
  } as const;
  it('rehydrates seeded action IDs, streams, errors and status without side effects or duplicates', () => {
    const { transport } = setup();
    transport.attention = vi.fn();
    const controller = createAgentController(
      {
        sessionId: 's',
        originalPrompt: 'original',
        actionIds: ['actual-a', 'missing-history'],
      },
      transport,
    );
    const events = [
      start,
      start,
      end,
      review,
      {
        t: 'agent.message',
        id: 'm',
        role: 'agent',
        kind: 'say',
        text: 'one',
        stream: { sequence: 0, done: false },
      },
      {
        t: 'agent.message',
        id: 'm',
        role: 'agent',
        kind: 'say',
        text: 'one two',
        stream: { sequence: 1, done: true },
      },
      { t: 'error', code: 'E', message: 'recorded' },
      { t: 'agent.status', state: 'waiting_user', label: 'review' },
      { t: 'project.ops', version: 99, ops: [] },
      {
        t: 'asset.added',
        asset: {
          id: 'web',
          kind: 'image',
          name: 'web',
          url: '/web',
          source: 'web',
        },
      },
    ] satisfies import('@kimo/client').ServerEvent[];
    controller.restoreHistory(events);
    const restored = controller.getSnapshot();
    controller.restoreHistory(events);
    expect(controller.getSnapshot()).toEqual(restored);
    expect(restored.actionOrder).toEqual(['actual-a']);
    expect(restored.actions['actual-a']).toMatchObject({
      status: 'done',
      resultSummary: 'recorded result',
    });
    expect(restored.actions['missing-history']).toBeUndefined();
    expect(restored.items.filter((item) => item.id === 'm')).toEqual([
      expect.objectContaining({ text: 'one two' }),
    ]);
    expect(restored.status?.state).toBe('waiting_user');
    expect(restored.assets).toEqual({
      web: {
        id: 'web',
        kind: 'image',
        name: 'web',
        url: '/web',
        source: 'web',
      },
    });
    expect(transport.send).not.toHaveBeenCalled();
    expect(transport.message).not.toHaveBeenCalled();
    expect(transport.attention).not.toHaveBeenCalled();
    expect(transport.intent).not.toHaveBeenCalled();
    expect(transport.userSent).not.toHaveBeenCalled();
  });
  it('preserves current pending user intent and does not treat an old status as its ACK', async () => {
    const { controller } = setup(true);
    await controller.send({ text: 'current pending source' });
    const pending = controller.getSnapshot().items[0];
    controller.restoreHistory([
      start,
      end,
      { t: 'agent.status', state: 'thinking', label: 'reading your note' },
    ]);
    expect(
      controller.getSnapshot().items.find((item) => item.id === pending?.id),
    ).toEqual(pending);
    await expect(controller.send({ text: 'second' })).rejects.toThrow(
      'previous note',
    );
    controller.receive({
      t: 'agent.status',
      state: 'thinking',
      label: 'reading your note',
    });
    expect(
      controller.getSnapshot().items.find((item) => item.id === pending?.id),
    ).toMatchObject({ interrupt: 'read' });
  });
  it('keeps unmatched live tails but does not regress authoritative status with an observed live prefix', () => {
    const { controller } = setup();
    const working = {
      t: 'agent.status',
      state: 'acting',
      label: 'working',
    } as const;
    controller.receive(working);
    controller.receive(start);
    controller.restoreHistory([
      working,
      start,
      end,
      { t: 'agent.status', state: 'idle', label: 'finished' },
    ]);
    expect(controller.getSnapshot().status?.label).toBe('finished');
    expect(controller.getSnapshot().actions['actual-a']?.status).toBe('done');
    controller.receive(review);
    controller.restoreHistory([working, start, end]);
    expect(
      controller.getSnapshot().items.some((item) => item.id === 'review'),
    ).toBe(true);
    const previous = controller.getSnapshot();
    controller.restoreHistory(undefined);
    expect(controller.getSnapshot()).toBe(previous);
    controller.dispose();
    controller.restoreHistory([]);
    expect(controller.getSnapshot()).toBe(previous);
  });
});

it('rehydrates web-image and mask presentation without resource or transport side effects', () => {
  const { controller, transport } = setup();
  transport.attention = vi.fn();
  const asset = {
    id: 'web-1',
    kind: 'image' as const,
    source: 'web' as const,
    name: 'recorded image',
    url: '/image.jpg',
  };
  const events = [
    { t: 'asset.added' as const, asset, actionId: 'image-action' },
    {
      t: 'sam.mask' as const,
      clipId: 'c',
      maskAssetId: 'mask-1',
      previewPolygon: [],
    },
  ];
  controller.restoreHistory(events);
  controller.restoreHistory(events);
  const state = controller.getSnapshot();
  expect(state.items.filter((item) => item.kind === 'web-images')).toHaveLength(
    1,
  );
  expect(state.items.filter((item) => item.kind === 'sam')).toHaveLength(1);
  expect(state.assets['web-1']).toEqual(asset);
  expect(transport.send).not.toHaveBeenCalled();
  expect(transport.message).not.toHaveBeenCalled();
  expect(transport.attention).not.toHaveBeenCalled();
});
it('does not label initial attachment as reconnected but announces a real subsequent recovery', () => {
  const { controller } = setup();
  controller.connection(false);
  controller.connection(false);
  controller.connection(true);
  expect(controller.getSnapshot().items).not.toContainEqual(
    expect.objectContaining({ text: 'reconnected' }),
  );
  controller.connection(false);
  controller.connection(true);
  controller.connection(true);
  expect(
    controller
      .getSnapshot()
      .items.filter(
        (item) => item.kind === 'system' && item.text === 'reconnected',
      ),
  ).toHaveLength(1);
});
