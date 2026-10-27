import * as React from 'react';
import { afterEach, it, expect, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { createAgentNotificationController } from '@/lib/agent/notifications';
import { NotificationPrompt } from './notification-prompt';
afterEach(cleanup);
it('mounting chat never requests permission; exact card appears only after first actual send', async () => {
  const requestPermission = vi.fn(async () => 'denied' as const);
  const controller = createAgentNotificationController({
    hidden: () => false,
    getTitle: () => '',
    setTitle: () => {},
    permission: () => 'default',
    requestPermission,
    notify: () => ({ close: () => {} }),
    onVisibility: () => () => {},
    readDecision: () => null,
    writeDecision: () => {},
  });
  const view = render(<NotificationPrompt controller={controller} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  act(() => controller.userSent());
  expect(
    screen.getByText('want a ping when kimo needs you?'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'no thanks' })).toBeInTheDocument();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'yes' })),
  );
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.unmount();
  render(<NotificationPrompt controller={controller} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  controller.dispose();
});
