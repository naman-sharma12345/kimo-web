import { expect, it } from 'vitest';
import { serverEventSchema, clientEventSchema } from './schema';
it('keeps legacy packets valid without inserting proposed defaults', () => {
  const events = [
    { t: 'agent.status', state: 'thinking', label: 'reading your note' },
    { t: 'agent.action.end', id: 'a', ok: true, durationMs: 1 },
    { t: 'agent.message', id: 'm', role: 'agent', kind: 'say', text: 'hi' },
    {
      t: 'asset.added',
      asset: {
        id: 'a',
        kind: 'image',
        name: 'pattern',
        url: '/pattern',
        source: 'web',
      },
    },
  ];
  for (const event of events)
    expect(serverEventSchema.parse(event)).toEqual(event);
  expect(clientEventSchema.parse({ t: 'interrupt', text: 'hi' })).toEqual({
    t: 'interrupt',
    text: 'hi',
  });
});
it('retains optional proposals and rejects invalid identity and stream numbers', () => {
  expect(
    serverEventSchema.parse({
      t: 'agent.status',
      state: 'thinking',
      label: 'reading your note',
      inReplyTo: 'u',
    }),
  ).toHaveProperty('inReplyTo', 'u');
  expect(
    clientEventSchema.parse({
      t: 'interrupt',
      text: 'hi',
      clientMessageId: 'u',
    }),
  ).toHaveProperty('clientMessageId', 'u');
  expect(
    serverEventSchema.parse({
      t: 'agent.action.end',
      id: 'a',
      ok: true,
      durationMs: 1,
      resultSummary: 'actual',
    }),
  ).toHaveProperty('resultSummary', 'actual');
  const message = {
    t: 'agent.message',
    id: 'm',
    role: 'agent',
    kind: 'say',
    text: 'hi',
  };
  expect(
    serverEventSchema.parse({
      ...message,
      stream: { sequence: 0, done: false },
    }),
  ).toHaveProperty('stream', { sequence: 0, done: false });
  for (const sequence of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(
      serverEventSchema.safeParse({
        ...message,
        stream: { sequence, done: true },
      }).success,
    ).toBe(false);
  expect(
    serverEventSchema.safeParse({ ...message, stream: { sequence: 0 } })
      .success,
  ).toBe(false);
  expect(
    clientEventSchema.safeParse({
      t: 'interrupt',
      text: 'hi',
      clientMessageId: '',
    }).success,
  ).toBe(false);
  expect(
    serverEventSchema.safeParse({
      t: 'asset.added',
      actionId: '',
      asset: {
        id: 'a',
        kind: 'image',
        name: 'pattern',
        url: '/pattern',
        source: 'web',
      },
    }).success,
  ).toBe(false);
});
