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
