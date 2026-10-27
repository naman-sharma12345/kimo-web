import { describe, it, expect, vi } from 'vitest';
import { createAgentNotificationController } from './notifications';
import type { NotificationEnvironment } from './notifications';
function setup(
  permission: NotificationPermission | 'unavailable' = 'default',
  decision: string | null = null,
) {
  let hidden = true;
  let title = 'original project';
  let visibility = () => {};
  const close = vi.fn();
  const unsubscribe = vi.fn();
  const requestPermission = vi.fn(async () => 'granted' as const);
  const notify = vi.fn(() => ({ close }));
  const writeDecision = vi.fn();
  const env: NotificationEnvironment = {
    hidden: () => hidden,
    getTitle: () => title,
    setTitle: (value) => {
      title = value;
    },
    permission: () => permission,
    requestPermission,
    notify,
    onVisibility: (callback) => {
      visibility = callback;
      return unsubscribe;
    },
    readDecision: () => decision,
    writeDecision,
  };
  const controller = createAgentNotificationController(env);
  return {
    controller,
    requestPermission,
    notify,
    close,
    unsubscribe,
    writeDecision,
    title: () => title,
    setTitle: (value: string) => {
      title = value;
    },
    visible: () => {
      hidden = false;
      visibility();
    },
  };
}
describe('one shell-owned notification controller', () => {
  it('asks only after actual user send plus explicit yes, never construction or attention', async () => {
    const s = setup();
    expect(s.controller.getSnapshot()).toBe(false);
    s.controller.attention({ id: 'r', kind: 'ask_review' });
    expect(s.requestPermission).not.toHaveBeenCalled();
    await s.controller.answer('yes');
    expect(s.requestPermission).not.toHaveBeenCalled();
    s.controller.userSent();
    expect(s.controller.getSnapshot()).toBe(true);
    await s.controller.answer('yes');
    expect(s.requestPermission).toHaveBeenCalledTimes(1);
    expect(s.controller.getSnapshot()).toBe(false);
    s.controller.dispose();
  });
  it('no thanks persists decision without requesting permission and never prompts again', async () => {
    const s = setup();
    s.controller.userSent();
    await s.controller.answer('no thanks');
    s.controller.userSent();
    expect(s.controller.getSnapshot()).toBe(false);
    expect(s.writeDecision).toHaveBeenCalledWith('no thanks');
    expect(s.requestPermission).not.toHaveBeenCalled();
    s.controller.dispose();
  });
  it.each(['denied', 'unavailable'] as const)(
    'handles %s without prompting or constructing a notification',
    (permission) => {
      const s = setup(permission);
      s.controller.userSent();
      expect(s.controller.getSnapshot()).toBe(false);
      s.controller.attention({ id: 'r', kind: 'ask_review' });
      expect(s.title()).toBe('(1) kimo needs you');
      expect(s.notify).not.toHaveBeenCalled();
      s.controller.dispose();
      expect(s.title()).toBe('original project');
    },
  );
  it('dedupes requests and restores old hidden title and closes notifications on visibility', () => {
    const s = setup('granted');
    s.controller.attention({ id: 'r1', kind: 'ask_review' });
    s.controller.attention({ id: 'r1', kind: 'ask_review' });
    s.controller.attention({ id: 'c1', kind: 'ask_choice' });
    expect(s.title()).toBe('(1) kimo needs you');
    expect(s.notify).toHaveBeenCalledTimes(2);
    expect(s.notify).toHaveBeenCalledWith('kimo · your first cut is ready');
    s.visible();
    expect(s.title()).toBe('original project');
    expect(s.close).toHaveBeenCalledTimes(2);
    s.controller.attention({ id: 'c2', kind: 'ask_choice' });
    expect(s.notify).toHaveBeenCalledTimes(2);
    s.controller.dispose();
  });
  it('does not overwrite a newer title owned elsewhere during cleanup', () => {
    const s = setup('granted');
    s.controller.attention({ id: 'r1', kind: 'ask_review' });
    s.setTitle('new project');
    s.controller.dispose();
    expect(s.title()).toBe('new project');
    expect(s.unsubscribe).toHaveBeenCalledTimes(1);
    expect(s.close).toHaveBeenCalledTimes(1);
    s.controller.attention({ id: 'r2', kind: 'ask_review' });
    expect(s.notify).toHaveBeenCalledTimes(1);
  });
  it('persists choice across a recreated shell and isolates unsubscribe', () => {
    const s = setup('default', 'no thanks');
    const listener = vi.fn();
    const off = s.controller.subscribe(listener);
    s.controller.userSent();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(s.controller.getSnapshot()).toBe(false);
    off();
    s.controller.userSent();
    expect(listener).toHaveBeenCalledTimes(1);
    s.controller.dispose();
  });
});
